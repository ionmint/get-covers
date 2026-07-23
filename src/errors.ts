/**
 * Typed errors for cover providers, so callers can react to *why* a search
 * failed (rate limit vs. outage vs. timeout vs. everything else) instead of a
 * single generic Error. Shared by every provider, by the retry helper, and by
 * the Modal's error messaging.
 *
 * This module depends on nothing beyond the built-in Error, so both providers
 * and low-level helpers (utils.ts) can import it without creating a cycle.
 */

/** Base class for all cover-provider failures. Never thrown directly. */
export abstract class CoverProviderError extends Error {
	/** HTTP status code when the failure came from an HTTP response, else undefined. */
	readonly status: number | undefined;
	/**
	 * True when retrying the identical request shortly might succeed (transient
	 * server-side state). Drives the default retry policy in `withRetry`.
	 */
	readonly retryable: boolean;

	protected constructor(
		name: string,
		message: string,
		status: number | undefined,
		retryable: boolean,
	) {
		super(message);
		this.name = name;
		this.status = status;
		this.retryable = retryable;
		// Preserve `instanceof` across the prototype chain even if this code is
		// ever downleveled below ES2015 (native ES2018 classes don't need it).
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/** HTTP 429 — the provider is rate-limiting us. Transient: safe to retry. */
export class RateLimitError extends CoverProviderError {
	constructor(message = "Rate limited (HTTP 429).") {
		super("RateLimitError", message, 429, true);
	}
}

/** HTTP 503 — the provider is temporarily unavailable. Transient: safe to retry. */
export class ServiceUnavailableError extends CoverProviderError {
	constructor(message = "Service temporarily unavailable (HTTP 503).") {
		super("ServiceUnavailableError", message, 503, true);
	}
}

/** The request exceeded the caller's time budget. Not retryable — we're out of time. */
export class TimeoutError extends CoverProviderError {
	constructor(message = "Request timed out.") {
		super("TimeoutError", message, undefined, false);
	}
}

/** Any other HTTP or network failure. Carries the HTTP status when there was one. */
export class ProviderError extends CoverProviderError {
	constructor(status: number | undefined, message?: string) {
		super(
			"ProviderError",
			message ??
				(status !== undefined
					? `Provider error (${status}).`
					: "Provider error."),
			status,
			false,
		);
	}
}

/**
 * True for the transient failures the retry policy should retry (429 / 503).
 * Providers pass this to `withRetry` to make the "only retry 503/429" intent
 * explicit at the call site.
 */
export function isTransientError(error: unknown): boolean {
	return (
		error instanceof RateLimitError ||
		error instanceof ServiceUnavailableError
	);
}
