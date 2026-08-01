/**
 * Small helpers shared across the plugin. The only import is the leaf `errors`
 * module (typed failures), so this file stays free of heavyweight dependencies.
 */
import { TimeoutError } from "./errors";

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
 * Race a promise against a timeout. If `promise` does not settle within
 * `timeoutMs`, the returned promise rejects with a timeout error.
 *
 * Used to bound network calls made through Obsidian's `requestUrl`, which has no
 * native timeout. Note: the underlying request is NOT aborted (requestUrl exposes
 * no abort signal); once the timeout wins, its eventual result is simply ignored.
 * Internal to this module — `withRetry` is the only caller.
 */
function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message = "Request timed out.",
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(
			() => reject(new TimeoutError(message)),
			timeoutMs,
		);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/** Options for {@link withRetry}. */
export interface RetryOptions {
	/** Number of RETRIES after the first attempt (2 → up to 3 attempts total). */
	retries: number;
	/** Base backoff in ms; grows exponentially (base, base*3, base*9, …). */
	baseDelayMs: number;
	/**
	 * Total time budget in ms for ALL attempts and backoff delays combined. The
	 * helper never exceeds it: an in-flight attempt is bounded by the remaining
	 * budget, and a backoff that would spill past the budget stops the retries.
	 */
	timeoutMs: number;
	/**
	 * Decides whether a thrown error is worth retrying. Defaults to retrying any
	 * error object that reports `retryable === true` (e.g. the transient provider
	 * errors), so most callers can omit it.
	 */
	isRetryable?: (error: unknown) => boolean;
}

/**
 * Run `fn`, retrying on transient failures with exponential backoff, without
 * ever exceeding `opts.timeoutMs` across all attempts combined.
 *
 * - Retries only errors for which `isRetryable` returns true; every other error
 *   propagates immediately (permanent failures are never retried).
 * - Backoff grows as `baseDelayMs * 3^attempt` (e.g. 500ms, then 1500ms).
 * - Each attempt is bounded by the remaining budget; if the budget runs out a
 *   {@link TimeoutError} is thrown. If the next backoff would spill past the
 *   budget, the LAST error is propagated instead of starting another attempt.
 *
 * Fully generic and provider-agnostic: any provider (TMDb, AniList, SteamGridDB,
 * Open Library, …) reuses it by throwing errors that report
 * themselves as retryable — no backoff/timeout logic is duplicated per provider.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	opts: RetryOptions,
): Promise<T> {
	const deadline = Date.now() + Math.max(0, opts.timeoutMs);
	const isRetryable = opts.isRetryable ?? defaultIsRetryable;
	const maxAttempts = Math.max(1, opts.retries + 1);

	for (let attempt = 0; ; attempt++) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new TimeoutError();
		}
		try {
			// `return await` (not bare `return`) so rejections hit the catch here.
			// Bound the attempt so a single hung request can't exceed the budget.
			return await withTimeout(fn(), remaining);
		} catch (error) {
			const isLastAttempt = attempt >= maxAttempts - 1;
			if (isLastAttempt || !isRetryable(error)) {
				throw error;
			}
			const delay = opts.baseDelayMs * Math.pow(3, attempt);
			if (Date.now() + delay >= deadline) {
				// Backing off would blow the budget — propagate the last error now.
				throw error;
			}
			await sleep(delay);
		}
	}
}

/** Retry anything that flags itself `retryable === true`; used when no predicate is given. */
function defaultIsRetryable(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { retryable?: unknown }).retryable === true
	);
}

/** Promise-based delay. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
