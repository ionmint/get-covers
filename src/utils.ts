/**
 * Small, dependency-free helpers shared across the plugin.
 */

/** Characters that are illegal in file/folder names on common filesystems. */
const ILLEGAL_FILENAME_CHARS = /[:/\\*?"<>|]/g;

/**
 * Sanitize a string (typically derived from a note title) so it is safe to use
 * as a file or folder name.
 *
 * - Removes the illegal characters: `: / \ * ? " < > |`
 * - Collapses runs of whitespace to a single space
 * - Trims leading/trailing whitespace and trailing dots/spaces (illegal on Windows)
 * - Falls back to `"cover"` if nothing usable remains
 */
export function sanitizeFilename(name: string): string {
	const cleaned = name
		.replace(ILLEGAL_FILENAME_CHARS, "")
		.replace(/\s+/g, " ")
		.trim()
		// Trim any trailing dots or spaces (both illegal as trailing chars on Windows).
		.replace(/[. ]+$/g, "")
		.trim();

	return cleaned.length > 0 ? cleaned : "cover";
}

/**
 * Create a debounced version of `fn` that delays invocation until `wait`
 * milliseconds have elapsed since the last call.
 *
 * Typed without `any`: the wrapped function must return void.
 */
export function debounce<T extends (...args: never[]) => void>(
	fn: T,
	wait: number,
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>): void => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			timeoutId = null;
			fn(...args);
		}, wait);
	};
}
