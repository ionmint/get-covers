import { RequestUrlParam } from "obsidian";
import { CoverProvider, CoverSearchOptions, CoverSearchResult } from "../types";
import { withRetry } from "../utils";
import {
	asArray,
	asNumber,
	asRecord,
	asString,
	clamp,
	requestOnce,
	retryOptions,
} from "./providerHttp";

/**
 * Cover provider backed by the public Open Library API. No API key is required.
 * Used for the Books category.
 *
 * Search hits `search.json`, which returns lightweight `docs`; each doc points at
 * a cover via a numeric `cover_i` (preferred) or an edition OLID
 * (`cover_edition_key`). The cover images themselves come from the separate covers
 * CDN at fixed sizes — `-M` (medium) for the grid thumbnail and `-L` (large) for
 * the best-available full-resolution image. Docs with neither identifier have no
 * cover art and are skipped (a clean "no results" rather than a broken image).
 */
const SEARCH_ENDPOINT = "https://openlibrary.org/search.json";
const COVER_BASE = "https://covers.openlibrary.org/b";

/** Open Library accepts a large `limit`; keep it sane relative to what we render. */
const OPEN_LIBRARY_MAX_RESULTS = 100;

export class OpenLibraryProvider implements CoverProvider {
	readonly id = "openLibrary";

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

		// Retry transient 429/503 with exponential backoff, within the caller's
		// total time budget (see providerHttp / withRetry).
		const response = await withRetry(
			() => requestOnce(param),
			retryOptions(opts.timeoutMs),
		);

		// `response.json` is typed `any` by Obsidian; launder it to `unknown` and
		// validate the shape ourselves so no `any` leaks into our code.
		const json: unknown = response.json;
		return parseDocs(json, opts.maxResults);
	}

	private buildUrl(query: string, maxResults: number): string {
		const params = new URLSearchParams();
		params.set("q", query);
		params.set("limit", String(clamp(maxResults, 1, OPEN_LIBRARY_MAX_RESULTS)));
		// Ask only for the fields we use, to keep the response small.
		params.set("fields", "cover_i,cover_edition_key,title,author_name");
		return `${SEARCH_ENDPOINT}?${params.toString()}`;
	}
}

/** Parse an Open Library `search.json` response into cover results (no `any`). */
function parseDocs(json: unknown, maxResults: number): CoverSearchResult[] {
	const root = asRecord(json);
	const docs = asArray(root?.docs);
	if (!docs) {
		return [];
	}

	const results: CoverSearchResult[] = [];
	for (const doc of docs) {
		const record = asRecord(doc);
		if (!record) {
			continue;
		}
		const urls = coverUrls(record);
		if (!urls) {
			continue; // no cover art for this edition — skip
		}
		results.push({
			thumbnailUrl: urls.thumbnail,
			fullResUrl: urls.full,
			sourceLabel: asString(record.title) ?? "Open Library",
		});
		if (results.length >= maxResults) {
			break;
		}
	}
	return results;
}

/**
 * Build the medium (thumbnail) and large (full-res) cover URLs for a doc,
 * preferring the numeric cover id and falling back to the edition OLID. Returns
 * null when the doc exposes neither.
 */
function coverUrls(
	record: Record<string, unknown>,
): { thumbnail: string; full: string } | null {
	const coverId = asNumber(record.cover_i);
	if (coverId !== null) {
		return {
			thumbnail: `${COVER_BASE}/id/${coverId}-M.jpg`,
			full: `${COVER_BASE}/id/${coverId}-L.jpg`,
		};
	}
	const olid = asString(record.cover_edition_key);
	if (olid !== null) {
		return {
			thumbnail: `${COVER_BASE}/olid/${olid}-M.jpg`,
			full: `${COVER_BASE}/olid/${olid}-L.jpg`,
		};
	}
	return null;
}
