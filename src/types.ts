/**
 * Shared type definitions for the Get Covers plugin.
 * This file contains types and interfaces only — no runtime logic.
 */

/**
 * The fixed set of categories a note `Type` can map to.
 * These are NOT user-editable (the settings dropdown is constrained to these).
 */
export type Category =
	| "Books"
	| "Movies"
	| "TV Shows"
	| "Anime"
	| "Manga"
	| "Games";

/** All allowed category values, in display order. Useful for building dropdowns. */
export const CATEGORIES: readonly Category[] = [
	"Books",
	"Movies",
	"TV Shows",
	"Anime",
	"Manga",
	"Games",
] as const;

/** Which search backend the Modal targets: structured Database routing, or Google Images. */
export type SearchMode = "database" | "google";

/** What to do with a selected cover: download it into the vault, or store the URL. */
export type Destination = "download" | "url";

/**
 * A single cover image result returned by a provider.
 *
 * `thumbnailUrl` is the small image shown in the grid — it is the ONLY image
 * fetched while browsing results. `fullResUrl` is the best-available larger
 * image and is requested ONLY when the user selects this result (see the Modal),
 * which keeps mobile bandwidth down.
 */
export interface CoverSearchResult {
	/** URL for the grid thumbnail (small image, loaded during search). */
	thumbnailUrl: string;
	/**
	 * URL for the best-available full-resolution image. Not necessarily a true
	 * original — some providers (e.g. Google Books) only expose an enlarged
	 * thumbnail. Requested only on selection.
	 */
	fullResUrl: string;
	/** Human-readable label for the result (used as the image alt / aria text). */
	sourceLabel: string;
}

/** Options every provider search receives: a bounded result count and timeout. */
export interface CoverSearchOptions {
	/** Maximum number of results to return. */
	maxResults: number;
	/** Network timeout in milliseconds; the provider must not exceed it. */
	timeoutMs: number;
}

/**
 * Common interface every cover provider implements: it turns a free-text query
 * into zero or more cover results. Concrete providers live in `src/providers/`.
 */
export interface CoverProvider {
	/** Stable provider id (also the key used in the settings `apiKeys` map). */
	readonly id: string;
	/** Perform a search and return zero or more cover results. */
	search(query: string, opts: CoverSearchOptions): Promise<CoverSearchResult[]>;
}

/** One row of the Type → Category mapping table. */
export interface TypeMapping {
	/** The frontmatter `Type` value (matched case-insensitively, trimmed). */
	type: string;
	/** The category this type resolves to. */
	category: Category;
}

/** Persisted plugin settings. */
export interface CoverSearchSettings {
	/** API keys keyed by provider id. Empty in Phase 1. */
	apiKeys: Record<string, string>;
	/** Vault-relative folder where downloaded covers are stored. */
	downloadFolder: string;
	/** Frontmatter property the chosen cover is written to. */
	destinationProperty: string;
	/** Frontmatter property read to determine the note's Type. */
	typeProperty: string;
	/** Maximum number of results to request/display. */
	maxResults: number;
	/** Network request timeout, in milliseconds. */
	requestTimeout: number;
	/** Default search mode the Modal opens with. */
	defaultSearchMode: SearchMode;
	/** Default destination the Modal opens with. */
	defaultDestination: Destination;
	/** The Type → Category mapping table. */
	typeMappings: TypeMapping[];
}
