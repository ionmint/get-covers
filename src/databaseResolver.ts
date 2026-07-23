import { Category, CoverProvider, TypeMapping } from "./types";
import { GoogleBooksProvider } from "./providers/googleBooksProvider";

/** Settings `apiKeys` key under which the optional Google Books key is stored. */
const GOOGLE_BOOKS_KEY = "googleBooks";

/** Dependencies the resolver needs to construct concrete providers. */
export interface ProviderContext {
	/** API keys keyed by provider id (from settings). */
	apiKeys: Record<string, string>;
}

/**
 * The outcome of resolving a note's Type in Database mode.
 *
 * - `provider`: the Type mapped to a Category that has a real provider wired.
 * - `google-images-fallback`: either the Type mapped to nothing, or it mapped to
 *   a Category whose provider isn't implemented yet. The Modal should fall back
 *   to Google Images; `reason` is a short, user-facing explanation of why.
 */
export type DatabaseResolution =
	| { kind: "provider"; category: Category; provider: CoverProvider }
	| {
			kind: "google-images-fallback";
			category: Category | null;
			reason: string;
	  };

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
 * Resolve a `Category` to a concrete provider instance. Only Books is wired to a
 * real provider (Google Books) for now; every other category returns `null`
 * ("no provider available") until its provider is implemented.
 */
export function resolveProviderForCategory(
	category: Category,
	context: ProviderContext,
): CoverProvider | null {
	switch (category) {
		case "Books":
			return new GoogleBooksProvider(context.apiKeys[GOOGLE_BOOKS_KEY]);
		case "Movies":
		case "TV Shows":
		case "Anime":
		case "Manga":
		case "Games":
			return null; // no real provider wired yet
		default:
			// Exhaustiveness guard: adding a Category without handling it here is a
			// compile error, forcing an explicit wire-or-fallback decision.
			return assertNever(category);
	}
}

/**
 * Full Database-mode resolution: Type → Category → provider, with a Google Images
 * fallback (plus a user-facing reason) whenever no real provider applies.
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
		return { kind: "google-images-fallback", category: null, reason };
	}

	const provider = resolveProviderForCategory(category, context);
	if (provider === null) {
		return {
			kind: "google-images-fallback",
			category,
			reason: `No ${category} provider is available yet.`,
		};
	}

	return { kind: "provider", category, provider };
}

function assertNever(value: never): never {
	throw new Error(`Unhandled category: ${String(value)}`);
}
