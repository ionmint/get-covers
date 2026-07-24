import { RequestUrlParam } from "obsidian";
import { CoverProvider, CoverSearchOptions, CoverSearchResult } from "../types";
import { withRetry } from "../utils";
import {
	asArray,
	asRecord,
	asString,
	requestOnce,
	retryOptions,
} from "./providerHttp";

/**
 * Which TMDb search endpoint (and result field names) to use. A single provider
 * instance is bound to one media type, chosen by the resolver from the note's
 * Category: Movies → "movie", TV Shows → "tv".
 */
export type TmdbMediaType = "movie" | "tv";

const ENDPOINT = "https://api.themoviedb.org/3";

/**
 * Image CDN base. Hardcoded on purpose: TMDb documents this base + the size
 * segments below as stable, so we skip the extra `/configuration` round-trip the
 * API technically offers. `w200` is the grid thumbnail; `original` the full-res.
 */
const IMAGE_BASE = "https://image.tmdb.org/t/p/";
const THUMB_SIZE = "w200";
const FULL_SIZE = "original";

/**
 * Cover provider backed by The Movie Database (TMDb) v3 API. Requires a v3 API
 * key (passed as the `api_key` query parameter). Used for both the Movies and
 * TV Shows categories via the `mediaType` binding.
 */
export class TmdbProvider implements CoverProvider {
	readonly id = "tmdb";

	private readonly mediaType: TmdbMediaType;
	private readonly apiKey: string;

	constructor(mediaType: TmdbMediaType, apiKey: string) {
		this.mediaType = mediaType;
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
		return parseResults(json, opts.maxResults);
	}

	private buildUrl(query: string): string {
		const params = new URLSearchParams();
		params.set("api_key", this.apiKey);
		params.set("query", query);
		params.set("include_adult", "false");
		return `${ENDPOINT}/search/${this.mediaType}?${params.toString()}`;
	}
}

/**
 * Parse a TMDb `/search/{movie,tv}` response into cover results (no `any`).
 * Items without a `poster_path` are skipped (nothing to show). The title lives in
 * `title`/`original_title` for movies and `name`/`original_name` for TV shows —
 * we accept whichever is present so one parser serves both media types.
 */
function parseResults(json: unknown, maxResults: number): CoverSearchResult[] {
	const root = asRecord(json);
	const items = asArray(root?.results);
	if (!items) {
		return [];
	}

	const results: CoverSearchResult[] = [];
	for (const item of items) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		const posterPath = asString(record.poster_path);
		if (!posterPath) {
			continue; // no poster art — skip
		}
		const label =
			asString(record.title) ??
			asString(record.name) ??
			asString(record.original_title) ??
			asString(record.original_name) ??
			"TMDb";
		results.push({
			thumbnailUrl: `${IMAGE_BASE}${THUMB_SIZE}${posterPath}`,
			fullResUrl: `${IMAGE_BASE}${FULL_SIZE}${posterPath}`,
			sourceLabel: label,
		});
		if (results.length >= maxResults) {
			break;
		}
	}
	return results;
}
