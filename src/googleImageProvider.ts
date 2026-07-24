import { RequestUrlParam } from "obsidian";
import { CoverProvider, CoverSearchOptions, CoverSearchResult } from "./types";
import { withRetry } from "./utils";
import {
	asArray,
	asRecord,
	asString,
	requestOnce,
	retryOptions,
} from "./providers/providerHttp";

/*
 * WHY SerpAPI — and why this is NOT scraping:
 *
 * Google publishes no official image/cover-search API, so the realistic options
 * are (a) scrape google.com/search directly, or (b) use a hosted search API.
 * Scraping is a non-starter here: it violates Google's ToS, means parsing fragile,
 * frequently-changing HTML, and gets CAPTCHA'd/blocked — especially from the
 * varied mobile IPs an Obsidian mobile client uses. So this provider is API-based
 * only; it never touches google.com itself.
 *
 * SerpAPI's `google_images` engine is a good fit because:
 *   - It's a single documented JSON GET — works through Obsidian's `requestUrl`
 *     with no SDK, no OAuth, no browser — so it behaves identically on desktop,
 *     Android and iOS.
 *   - Each result already carries BOTH a `thumbnail` and the `original`
 *     full-resolution URL, mapping straight onto CoverSearchResult with no
 *     base-URL assembly.
 *   - It handles the Google-side blocking/CAPTCHA problem server-side, which is
 *     exactly the reliability we can't get by scraping from a mobile device.
 *   - It has a free tier for light use and requires only a single API key (read
 *     from settings), with no rotation/refresh logic.
 *
 * This is the ONLY provider that receives the image query (Search + Suffix); every
 * structured provider receives just the plain Search text.
 */

const ENDPOINT = "https://serpapi.com/search.json";

/** Cover provider backed by SerpAPI's Google Images engine. Requires an API key. */
export class GoogleImageProvider implements CoverProvider {
	readonly id = "serpapi";

	private readonly apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey.trim();
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
			url: this.buildUrl(trimmed),
			method: "GET",
		};

		const response = await withRetry(
			() => requestOnce(param),
			retryOptions(opts.timeoutMs),
		);

		const json: unknown = response.json;
		return parseImages(json, opts.maxResults);
	}

	private buildUrl(query: string): string {
		const params = new URLSearchParams();
		params.set("engine", "google_images");
		params.set("q", query);
		params.set("api_key", this.apiKey);
		return `${ENDPOINT}?${params.toString()}`;
	}
}

/**
 * Parse a SerpAPI `google_images` response into cover results (no `any`). Each
 * entry exposes a ready-to-use `thumbnail` and an `original` full-resolution URL;
 * entries missing either are skipped. A response with no `images_results` (e.g.
 * SerpAPI's "no results" case) naturally yields an empty array.
 */
function parseImages(json: unknown, maxResults: number): CoverSearchResult[] {
	const root = asRecord(json);
	const items = asArray(root?.images_results);
	if (!items) {
		return [];
	}

	const results: CoverSearchResult[] = [];
	for (const item of items) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		const thumbnail = asString(record.thumbnail);
		const original = asString(record.original);
		if (!thumbnail || !original) {
			continue; // need both a preview and a full-res URL
		}
		results.push({
			thumbnailUrl: thumbnail,
			fullResUrl: original,
			sourceLabel:
				asString(record.title) ??
				asString(record.source) ??
				"Google Images",
		});
		if (results.length >= maxResults) {
			break;
		}
	}
	return results;
}
