import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, parseRetryAfter, shouldRetry } from "./resilientFetch.js";

test("parseRetryAfter reads delta-seconds", () => {
  assert.equal(parseRetryAfter("30"), 30_000);
});

test("parseRetryAfter reads an HTTP-date relative to now", () => {
  const now = Date.parse("2026-07-25T12:00:00Z");
  assert.equal(parseRetryAfter("Sat, 25 Jul 2026 12:00:10 GMT", now), 10_000);
});

test("parseRetryAfter returns undefined when absent or unparseable", () => {
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter("soon"), undefined);
});

test("a past HTTP-date clamps to zero rather than going negative", () => {
  const now = Date.parse("2026-07-25T12:00:00Z");
  assert.equal(parseRetryAfter("Sat, 25 Jul 2026 11:59:50 GMT", now), 0);
});

test("GET retries on rate limits, transient 5xx, and network errors", () => {
  assert.equal(shouldRetry("GET", 429, false), true);
  assert.equal(shouldRetry("GET", 503, false), true);
  assert.equal(shouldRetry("GET", undefined, false), true, "no response = safe to repeat a read");
});

test("GET does not retry a genuine client error", () => {
  assert.equal(shouldRetry("GET", 404, false), false);
  assert.equal(shouldRetry("GET", 401, false), false);
});

// The critical safety property: replaying a write that may have been applied
// would create a duplicate Jira issue or Confluence page.
test("writes are NOT retried on 5xx or network failure", () => {
  for (const method of ["POST", "PUT", "DELETE"] as const) {
    assert.equal(shouldRetry(method, 503, false), false, `${method} must not repeat on 5xx`);
    assert.equal(shouldRetry(method, undefined, false), false, `${method} must not repeat on network error`);
    assert.equal(shouldRetry(method, 500, true), false, `${method} must not repeat on 500`);
  }
});

test("writes retry only on a 429 that carries Retry-After (explicitly not processed)", () => {
  assert.equal(shouldRetry("POST", 429, true), true);
  assert.equal(shouldRetry("POST", 429, false), false, "a 429 without Retry-After is not a safe signal");
});

test("backoff grows exponentially and stays bounded", () => {
  const first = backoffMs(0);
  const later = backoffMs(4);
  assert.ok(first >= 500 && first < 1000, `unexpected first backoff: ${first}`);
  assert.ok(later > first);
  assert.ok(backoffMs(20) <= 20_000, "backoff must stay capped");
});

test("a server-provided Retry-After wins over computed backoff, still capped", () => {
  assert.equal(backoffMs(0, 5_000), 5_000);
  assert.equal(backoffMs(0, 120_000), 20_000, "an absurd Retry-After must not stall the call");
});
