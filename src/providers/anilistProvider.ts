import { RequestUrlParam } from "obsidian";
import { CoverProvider, CoverSearchOptions, CoverSearchResult } from "../types";
import { withRetry } from "../utils";
import {
	asArray,
	asRecord,
	asString,
	clamp,
	requestOnce,
	retryOptions,
} from "./providerHttp";

/**
 * AniList media type. A single provider instance is bound to one, chosen by the
 * resolver from the note's Category: Anime → "ANIME", Manga → "MANGA".
 */
export type AniListMediaType = "ANIME" | "MANGA";

const ENDPOINT = "https://graphql.anilist.co";

/** AniList caps `perPage` at 50. */
const ANILIST_MAX_PER_PAGE = 50;

/**
 * GraphQL query: search `media` filtered by `$type`, ordered by best match, and
 * return each title plus the three cover-image sizes AniList exposes. Sent as the
 * `query` field of a JSON POST body (NOT as URL query params).
 */
const SEARCH_QUERY = `
query ($search: String!, $type: MediaType, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: $type, sort: SEARCH_MATCH) {
      title { romaji english native }
      coverImage { medium large extraLarge }
    }
  }
}`;

/**
 * Cover provider backed by the public AniList GraphQL API. No API key is required
 * for basic search. Used for both the Anime and Manga categories via the
 * `mediaType` binding.
 */
export class AniListProvider implements CoverProvider {
	readonly id = "anilist";

	private readonly mediaType: AniListMediaType;

	constructor(mediaType: AniListMediaType) {
		this.mediaType = mediaType;
	}

	async search(
		query: string,
		opts: CoverSearchOptions,
	): Promise<CoverSearchResult[]> {
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			return [];
		}

		const body = JSON.stringify({
			query: SEARCH_QUERY,
			variables: {
				search: trimmed,
				type: this.mediaType,
				perPage: clamp(opts.maxResults, 1, ANILIST_MAX_PER_PAGE),
			},
		});

		const param: RequestUrlParam = {
			url: ENDPOINT,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body,
		};

		const response = await withRetry(
			() => requestOnce(param),
			retryOptions(opts.timeoutMs),
		);

		const json: unknown = response.json;
		return parseMedia(json, opts.maxResults);
	}
}

/**
 * Parse an AniList GraphQL response into cover results (no `any`). GraphQL-level
 * errors arrive as HTTP 200 with no `data`, which naturally yields an empty
 * result set here. Entries without a usable cover image are skipped.
 */
function parseMedia(json: unknown, maxResults: number): CoverSearchResult[] {
	const root = asRecord(json);
	const data = asRecord(root?.data);
	const page = asRecord(data?.Page);
	const media = asArray(page?.media);
	if (!media) {
		return [];
	}

	const results: CoverSearchResult[] = [];
	for (const item of media) {
		const record = asRecord(item);
		const cover = asRecord(record?.coverImage);
		if (!cover) {
			continue;
		}
		const medium = asString(cover.medium);
		const large = asString(cover.large);
		const extraLarge = asString(cover.extraLarge);
		// Thumbnail: prefer the small `medium`; full-res: prefer the largest.
		const thumbnailUrl = medium ?? large ?? extraLarge;
		if (!thumbnailUrl) {
			continue; // no cover art — skip
		}
		const fullResUrl = extraLarge ?? large ?? medium ?? thumbnailUrl;
		results.push({
			thumbnailUrl,
			fullResUrl,
			sourceLabel: titleOf(record),
		});
		if (results.length >= maxResults) {
			break;
		}
	}
	return results;
}

/** Human-readable label from an AniList `title` object, English-first. */
function titleOf(record: Record<string, unknown> | null): string {
	const title = asRecord(record?.title);
	return (
		asString(title?.english) ??
		asString(title?.romaji) ??
		asString(title?.native) ??
		"AniList"
	);
}
