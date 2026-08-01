import { Category, CoverProvider, TypeMapping } from "./types";
import { OpenLibraryProvider } from "./providers/openLibraryProvider";
import { TmdbProvider } from "./providers/tmdbProvider";
import { AniListProvider } from "./providers/anilistProvider";
import { SteamGridDbProvider } from "./providers/steamgriddbProvider";

/**
 * Settings `apiKeys` keys under which each provider's key is stored. These match
 * the provider `id` values and the keys written by the settings tab.
 */
const TMDB_KEY = "tmdb";
const STEAMGRIDDB_KEY = "steamgriddb";

/** Dependencies the resolver needs to construct concrete providers. */
export interface ProviderContext {
	/** API keys keyed by provider id (from settings). */
	apiKeys: Record<string, string>;
}

/**
 * The outcome of resolving a note's Type in Database mode.
 *
 * - `provider`: the Type mapped to a Category that has a usable provider.
 * - `google-images-fallback`: either the Type mapped to nothing, or it mapped to
 *   a Category whose provider is missing a required API key. The Modal should
 *   fall back to Google Images; `reason` is a short, user-facing explanation.
 */
export type DatabaseResolution =
	| { kind: "provider"; provider: CoverProvider }
	| { kind: "google-images-fallback"; reason: string };

/**
 * The outcome of mapping a Category to a provider: either a ready provider, or a
 * user-facing reason it can't be used yet (currently only "required key missing").
 */
type ProviderResolution =
	| { ok: true; provider: CoverProvider }
	| { ok: false; reason: string };

/**
 * Resolve a note's `Type` value to a `Category` using the user's mapping.
 * Matching is case-insensitive and trimmed on both sides. Returns `null` when the
 * Type is empty or not present in the mapping.
 */
export function resolveCategory(
	typeValue: string,
	mappings: TypeMapping[],
): Category | null {
	const needle = typeValue.trim().toLowerCase();
	if (needle.length === 0) {
		return null;
	}
	for (const mapping of mappings) {
		if (mapping.type.trim().toLowerCase() === needle) {
			return mapping.category;
		}
	}
	return null;
}

/**
 * Resolve a `Category` to a concrete provider. Every category is now wired:
 *   Books → Open Library (no key), Movies/TV Shows → TMDb (key required),
 *   Anime/Manga → AniList (no key), Games → SteamGridDB (key required).
 * Providers that require a key but have none configured resolve to a `reason`
 * so the caller can fall back gracefully.
 */
export function resolveProviderForCategory(
	category: Category,
	context: ProviderContext,
): ProviderResolution {
	switch (category) {
		case "Books":
			// Open Library needs no key.
			return { ok: true, provider: new OpenLibraryProvider() };
		case "Movies":
			return requireKey(context, TMDB_KEY, "TMDb", (key) =>
				new TmdbProvider("movie", key),
			);
		case "TV Shows":
			return requireKey(context, TMDB_KEY, "TMDb", (key) =>
				new TmdbProvider("tv", key),
			);
		case "Anime":
			return { ok: true, provider: new AniListProvider("ANIME") };
		case "Manga":
			return { ok: true, provider: new AniListProvider("MANGA") };
		case "Games":
			return requireKey(context, STEAMGRIDDB_KEY, "SteamGridDB", (key) =>
				new SteamGridDbProvider(key),
			);
		default:
			// Exhaustiveness guard: adding a Category without handling it here is a
			// compile error, forcing an explicit wire-or-fallback decision.
			return assertNever(category);
	}
}

/**
 * Full Database-mode resolution: Type → Category → provider, with a Google Images
 * fallback (plus a user-facing reason) whenever no usable provider applies.
 */
export function resolveDatabaseProvider(
	typeValue: string,
	mappings: TypeMapping[],
	context: ProviderContext,
): DatabaseResolution {
	const category = resolveCategory(typeValue, mappings);
	if (category === null) {
		const shownType = typeValue.trim();
		const reason =
			shownType.length > 0
				? `No category is mapped to Type "${shownType}".`
				: "This note has no Type set.";
		return { kind: "google-images-fallback", reason };
	}

	const resolution = resolveProviderForCategory(category, context);
	if (!resolution.ok) {
		return { kind: "google-images-fallback", reason: resolution.reason };
	}

	return { kind: "provider", provider: resolution.provider };
}

/**
 * Build a provider that needs an API key, or a fallback reason when the key is
 * absent/blank. `make` only ever sees a non-empty, trimmed key.
 */
function requireKey(
	context: ProviderContext,
	keyId: string,
	label: string,
	make: (key: string) => CoverProvider,
): ProviderResolution {
	const key = context.apiKeys[keyId]?.trim();
	if (!key) {
		return {
			ok: false,
			reason: `A ${label} API key is required — add it in the plugin settings.`,
		};
	}
	return { ok: true, provider: make(key) };
}

function assertNever(value: never): never {
	throw new Error(`Unhandled category: ${String(value)}`);
}
