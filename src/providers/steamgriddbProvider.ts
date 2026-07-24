import { RequestUrlParam } from "obsidian";
import { CoverProvider, CoverSearchOptions, CoverSearchResult } from "../types";
import { withRetry } from "../utils";
import {
	asArray,
	asNumber,
	asRecord,
	asString,
	requestOnce,
	retryOptions,
} from "./providerHttp";

const BASE = "https://www.steamgriddb.com/api/v2";

/**
 * Cover provider backed by the SteamGridDB API. Auth is a single user-supplied
 * API key sent as `Authorization: Bearer <key>` — there is no OAuth flow, token
 * caching, or refresh. Used for the Games category.
 *
 * Search is a two-step lookup, both plain GETs:
 *   1. `/search/autocomplete/<query>` resolves free text to a game id.
 *   2. `/grids/game/<id>` returns ready-to-use cover images for that id.
 * A query that matches no game, or a game with no grids, yields an empty result
 * set (a clean "no results" state) rather than an error.
 */
export class SteamGridDbProvider implements CoverProvider {
	readonly id = "steamgriddb";

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

		// Both requests share ONE time budget. Compute the deadline once and give
		// each step only the time still remaining, so two round-trips can never
		// exceed the caller's timeout.
		const deadline = Date.now() + Math.max(0, opts.timeoutMs);

		const gameId = await this.resolveGameId(trimmed, remaining(deadline));
		if (gameId === null) {
			return []; // no matching game — clean "no results"
		}

		return this.fetchGrids(gameId, remaining(deadline), opts.maxResults);
	}

	/** Step 1: resolve free-text query → game id, or `null` if nothing matches. */
	private async resolveGameId(
		query: string,
		timeoutMs: number,
	): Promise<number | null> {
		const param = this.get(
			`${BASE}/search/autocomplete/${encodeURIComponent(query)}`,
		);
		const response = await withRetry(
			() => requestOnce(param),
			retryOptions(timeoutMs),
		);

		const root = asRecord(response.json as unknown);
		const data = asArray(root?.data);
		if (!data || data.length === 0) {
			return null;
		}
		return asNumber(asRecord(data[0])?.id);
	}

	/** Step 2: fetch grid images for a game id. Empty array if it has no grids. */
	private async fetchGrids(
		gameId: number,
		timeoutMs: number,
		maxResults: number,
	): Promise<CoverSearchResult[]> {
		const param = this.get(`${BASE}/grids/game/${gameId}`);
		const response = await withRetry(
			() => requestOnce(param),
			retryOptions(timeoutMs),
		);

		const root = asRecord(response.json as unknown);
		const data = asArray(root?.data);
		if (!data) {
			return [];
		}

		const results: CoverSearchResult[] = [];
		for (const item of data) {
			const record = asRecord(item);
			// SteamGridDB returns direct, ready-to-use image URLs: `thumb` for the
			// preview and `url` for the full-resolution image — no base assembly.
			const thumb = asString(record?.thumb);
			const url = asString(record?.url);
			if (!thumb || !url) {
				continue;
			}
			results.push({
				thumbnailUrl: thumb,
				fullResUrl: url,
				sourceLabel: "SteamGridDB",
			});
			if (results.length >= maxResults) {
				break;
			}
		}
		return results;
	}

	/** A GET request carrying the Bearer auth header. */
	private get(url: string): RequestUrlParam {
		return {
			url,
			method: "GET",
			headers: { Authorization: `Bearer ${this.apiKey}` },
		};
	}
}

/** Time left until `deadline`, never negative (0 makes withRetry time out at once). */
function remaining(deadline: number): number {
	return Math.max(0, deadline - Date.now());
}
