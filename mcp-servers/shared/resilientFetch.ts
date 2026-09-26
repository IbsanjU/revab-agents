/**
 * Timeout + retry wrapper around fetch, shared by every HTTP-backed MCP server.
 *
 * Two failure modes made agents unreliable in practice:
 *  - **Hangs.** A bare `fetch` has no timeout. When Atlassian is slow or a proxy
 *    black-holes a connection, the tool call never returns and the agent sits
 *    there forever with no error to reason about.
 *  - **Transient failures.** Atlassian Cloud rate-limits aggressively (429) and
 *    returns occasional 502/503/504. Failing the whole task on a blip makes the
 *    agent look broken and invites it to start guessing around the error.
 *
 * SAFETY — why writes are not blindly retried: replaying a POST that actually
 * succeeded (but whose response was lost) would create a duplicate Jira issue or
 * Confluence page. So:
 *  - GET (idempotent, read-only) retries on 429, 5xx, and network errors.
 *  - POST/PUT/DELETE retry ONLY on 429, and only when the server sent a
 *    `Retry-After` header — an explicit statement that the request was rejected,
 *    not processed. Every other write failure surfaces immediately.
 * A network error mid-write is never retried: we cannot know whether the server
 * applied it.
 *
 * Tunable via `HTTP_TIMEOUT_MS` (default 30s) and `HTTP_MAX_RETRIES` (default 2).
 */
import { intEnv } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
/** Cap backoff so a large `Retry-After` can't stall an interactive tool call. */
const MAX_BACKOFF_MS = 20_000;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** Statuses worth retrying: rate limiting and transient upstream/gateway errors. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Parse `Retry-After` (delta-seconds or HTTP-date) into ms.
 * Returns undefined when absent or unparseable.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Exponential backoff with jitter, unless the server told us exactly how long to wait. */
export function backoffMs(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined) return Math.min(retryAfter, MAX_BACKOFF_MS);
  // Cap AFTER adding jitter — capping first then adding would exceed the ceiling.
  const base = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
  return Math.min(base, MAX_BACKOFF_MS);
}

/**
 * Decide whether to retry, given the method and what happened.
 * `status` is undefined for a network-level failure (no response received).
 */
export function shouldRetry(
  method: HttpMethod,
  status: number | undefined,
  hasRetryAfter: boolean,
): boolean {
  if (method === "GET") {
    // No response at all, or a transient status — safe to repeat a read.
    return status === undefined || isRetryableStatus(status);
  }
  // Writes: only an explicit, server-signalled rate limit is safe to repeat,
  // because it means the request was rejected rather than applied.
  return status === 429 && hasRetryAfter;
}

export interface ResilientFetchOptions {
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  /** Override the default timeout for a known-slow endpoint. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetch with a hard timeout and method-aware retries.
 * Throws a descriptive Error on timeout or after retries are exhausted.
 */
export async function resilientFetch(url: string, opts: ResilientFetchOptions): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? intEnv("HTTP_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const maxRetries = intEnv("HTTP_MAX_RETRIES", DEFAULT_MAX_RETRIES);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      });

      if (attempt < maxRetries && !res.ok) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        if (shouldRetry(opts.method, res.status, retryAfter !== undefined)) {
          await sleep(backoffMs(attempt, retryAfter));
          continue;
        }
      }
      return res;
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      lastError = aborted
        ? new Error(`Request timed out after ${timeoutMs}ms: ${opts.method} ${url}`)
        : err instanceof Error
          ? err
          : new Error(String(err));

      // A timeout on a write is NOT safe to repeat — the server may have applied it.
      const retryable = !aborted && shouldRetry(opts.method, undefined, false);
      if (attempt < maxRetries && retryable) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Request failed: ${opts.method} ${url}`);
}
