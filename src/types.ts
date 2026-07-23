/**
 * Shared type definitions for the Cover Search plugin.
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

/** Gallery/theme preference for the search Modal. */
export type GalleryTheme = "light" | "dark" | "auto";

/** Which search backend the Modal targets. Phase 1: UI only, no branching yet. */
export type SearchMode = "database" | "google";

/** What to do with a selected cover: download it into the vault, or store the URL. */
export type Destination = "download" | "url";

/**
 * A single cover image result returned by a provider (or the Phase 1 mock).
 */
export interface CoverResult {
	/** Stable identifier for this result within a result set. */
	id: string;
	/** URL for the grid thumbnail (smaller image). */
	thumbnailUrl: string;
	/** URL for the full-resolution image (used when assigning/downloading). */
	fullUrl: string;
	/** Optional intrinsic width of the full image, if known. */
	width?: number;
	/** Optional intrinsic height of the full image, if known. */
	height?: number;
	/** Optional human-readable source label (e.g. provider name). */
	sourceLabel?: string;
}

/**
 * Common interface every cover provider implements.
 * Real providers arrive in a later phase; the Phase 1 mock conforms to this shape.
 */
export interface CoverProvider {
	/** Stable provider id (also the key used in the settings `apiKeys` map). */
	readonly id: string;
	/** Perform a search and return zero or more cover results. */
	search(query: string): Promise<CoverResult[]>;
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
	/** Gallery theme preference for the Modal. */
	galleryTheme: GalleryTheme;
	/** Default search mode the Modal opens with. */
	defaultSearchMode: SearchMode;
	/** Default destination the Modal opens with. */
	defaultDestination: Destination;
	/** The Type → Category mapping table. */
	typeMappings: TypeMapping[];
}
