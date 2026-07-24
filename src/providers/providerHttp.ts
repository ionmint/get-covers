/**
 * Shared low-level plumbing for every cover provider:
 *
 *  - `requestOnce`  — one Obsidian `requestUrl` call whose non-success outcomes
 *    are translated into the typed errors in `../errors` (so callers never see a
 *    generic Error and the retry helper can tell transient from permanent).
 *  - `retryOptions` — the single, shared transient-retry policy (429/503, 2
 *    retries, exponential backoff, bounded by the caller's total time budget).
 *  - JSON type-guards (`asRecord` / `asString` / `asNumber` / `asArray`) that
 *    validate the shape of an untyped `unknown` response without ever using `any`.
 *
 * Extracting this here keeps each provider tiny and guarantees they all handle
 * status codes, retries and malformed JSON identically.
 */
import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import { RetryOptions } from "../utils";
import {
	ProviderError,
	RateLimitError,
	ServiceUnavailableError,
	isTransientError,
} from "../errors";

/** Transient-retry policy shared by all providers: up to 2 retries (3 attempts). */
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

/**
 * Build the {@link RetryOptions} every provider passes to `withRetry`: retry only
 * the transient 429/503 failures, with exponential backoff, all bounded by
 * `timeoutMs` (the caller's total budget). Centralised so no provider re-declares
 * the backoff/timeout numbers.
 */
export function retryOptions(timeoutMs: number): RetryOptions {
	return {
		retries: MAX_RETRIES,
		baseDelayMs: BASE_RETRY_DELAY_MS,
		timeoutMs,
		isRetryable: isTransientError,
	};
}

/**
 * Perform ONE HTTP request and translate the outcome into a typed error when it
 * isn't a 2xx success:
 *   429 → RateLimitError, 503 → ServiceUnavailableError (both retryable),
 *   any other non-2xx → ProviderError(status), network failure → ProviderError.
 *
 * `throw: false` is forced so requestUrl resolves for every HTTP status and we
 * inspect `response.status` ourselves (requestUrl's default throw hides the code).
 * Wrap this in `withRetry(() => requestOnce(param), retryOptions(timeoutMs))`.
 */
export async function requestOnce(
	param: RequestUrlParam,
): Promise<RequestUrlResponse> {
	let response: RequestUrlResponse;
	try {
		response = await requestUrl({ ...param, throw: false });
	} catch (error) {
		// No HTTP response at all (DNS failure, offline, connection reset, …).
		throw new ProviderError(undefined, `Network error: ${errorMessage(error)}`);
	}

	const status = response.status;
	if (status === 429) {
		throw new RateLimitError();
	}
	if (status === 503) {
		throw new ServiceUnavailableError();
	}
	if (status < 200 || status >= 300) {
		throw new ProviderError(status);
	}
	return response;
}

/** Clamp `value` to the inclusive `[min, max]` range (flooring to an integer). */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(Math.floor(value), min), max);
}

/** Narrow `unknown` to a plain object, or `null` if it isn't one. */
export function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/** Narrow `unknown` to a non-empty string, or `null`. */
export function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Narrow `unknown` to a finite number, or `null`. */
export function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Narrow `unknown` to an array, or `null`. */
export function asArray(value: unknown): unknown[] | null {
	return Array.isArray(value) ? value : null;
}

/** Best-effort message from an unknown thrown value, without `any`. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
