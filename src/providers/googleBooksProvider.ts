import { RequestUrlParam } from "obsidian";
import { CoverProvider, CoverSearchOptions, CoverSearchResult } from "../types";
import { withRetry } from "../utils";
import {
	asRecord,
	asString,
	clamp,
	requestOnce,
	retryOptions,
} from "./providerHttp";

/**
 * The zoom level requested for the "full-resolution" cover.
 *
 * IMPORTANT — read this before touching the resolution logic:
 * Google Books does NOT expose a true original-resolution cover image. The API
 * only returns `imageLinks.thumbnail` / `imageLinks.smallThumbnail` at modest
 * sizes. To get the best available resolution we take the thumbnail URL and BUMP
 * its `zoom=` query parameter to a higher value (and drop the decorative
 * `&edge=curl` page-curl). This yields a larger render of the SAME source image
 * — it is the best the API offers, NOT a real original. Do not advertise it as
 * one.
 */
const FULL_RES_ZOOM = 3;

/** Google Books rejects `maxResults` above 40. */
const GOOGLE_BOOKS_MAX_RESULTS = 40;

const ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

/**
 * Cover provider backed by the public Google Books API. No API key is required
 * for basic search; an optional key (constructor arg) only raises the quota.
 */
export class GoogleBooksProvider implements CoverProvider {
	readonly id = "googleBooks";

	/** Optional API key. `undefined` means "use the free, keyless quota". */
	private readonly apiKey: string | undefined;

	constructor(apiKey?: string) {
		const trimmed = apiKey?.trim();
		this.apiKey = trimmed && trimmed.length > 0 ? trimmed : undefined;
	}

	async search(
		query: string,
		opts: CoverSearchOptions,
	): Promise<CoverSearchResult[]> {
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			return [];
		}

		const param: RequestUrlParam = {
			url: this.buildUrl(trimmed, opts.maxResults),
			method: "GET",
		};

		// Retry transient 429/503 with exponential backoff, all within the
		// caller's total time budget (see providerHttp / withRetry).
		const response = await withRetry(
			() => requestOnce(param),
			retryOptions(opts.timeoutMs),
		);

		// `response.json` is typed `any` by Obsidian; launder it to `unknown` and
		// validate the shape ourselves so no `any` leaks into our code.
		const json: unknown = response.json;
		return parseVolumes(json);
	}

	private buildUrl(query: string, maxResults: number): string {
		const params = new URLSearchParams();
		params.set("q", query);
		params.set(
			"maxResults",
			String(clamp(maxResults, 1, GOOGLE_BOOKS_MAX_RESULTS)),
		);
		params.set("printType", "books");
		if (this.apiKey) {
			params.set("key", this.apiKey);
		}
		return `${ENDPOINT}?${params.toString()}`;
	}
}

/** Parse the Google Books `volumes` response into cover results (no `any`). */
function parseVolumes(json: unknown): CoverSearchResult[] {
	const root = asRecord(json);
	const items = root ? root.items : undefined;
	if (!Array.isArray(items)) {
		return [];
	}

	const results: CoverSearchResult[] = [];
	for (const item of items) {
		const volumeInfo = asRecord(asRecord(item)?.volumeInfo);
		const imageLinks = asRecord(volumeInfo?.imageLinks);
		if (!imageLinks) {
			continue; // this volume has no cover art — skip it
		}
		const thumb =
			asString(imageLinks.thumbnail) ?? asString(imageLinks.smallThumbnail);
		if (!thumb) {
			continue;
		}
		results.push({
			thumbnailUrl: upgradeToHttps(thumb),
			fullResUrl: toFullResUrl(thumb),
			sourceLabel: asString(volumeInfo?.title) ?? "Google Books",
		});
	}
	return results;
}

/**
 * Derive the best-available "full-resolution" URL from a thumbnail URL by bumping
 * `zoom=` and stripping the page-curl. See FULL_RES_ZOOM for why this is merely
 * the best Google Books offers, not a true original.
 */
function toFullResUrl(thumbnailUrl: string): string {
	try {
		const url = new URL(thumbnailUrl);
		url.searchParams.set("zoom", String(FULL_RES_ZOOM));
		url.searchParams.delete("edge"); // drop the &edge=curl page-curl effect
		if (url.protocol === "http:") {
			url.protocol = "https:";
		}
		return url.toString();
	} catch {
		// Unparseable URL: fall back to the original, at least upgraded to https.
		return upgradeToHttps(thumbnailUrl);
	}
}

/** Upgrade an http URL to https to avoid mixed-content blocking in the modal. */
function upgradeToHttps(url: string): string {
	return url.startsWith("http://")
		? `https://${url.slice("http://".length)}`
		: url;
}
