import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { findRecordingDir, scrub, stripUrl, summarizeRecording } from "./recordingSummary.js";

const nd = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

async function session(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rec-"));
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body);
  return dir;
}

test("scrub removes bearer tokens, JWTs and long hex, and truncates", () => {
  assert.equal(scrub("Authorization: Bearer abc.def-123 failed"), "Authorization: Bearer [redacted] failed");
  assert.match(scrub("t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig_nature_x"), /\[redacted-jwt\]/);
  assert.match(scrub("key " + "a".repeat(40)), /\[redacted-hex\]/);
  assert.equal(scrub("x".repeat(500)).length, 200);
});

test("stripUrl drops the query string and fragment", () => {
  assert.equal(stripUrl("https://app.test/api/items?token=SECRET#frag"), "https://app.test/api/items");
  assert.equal(stripUrl("not a url?secret=1"), "not a url");
});

test("a recording is summarized; sensitive fields never reach the output", async () => {
  const dir = await session({
    "manifest.json": JSON.stringify({ status: "complete", startedAt: "2026-11-07T00:00:00Z", counts: { network: 3 } }),
    "network.ndjson": nd([
      { method: "GET", url: "https://app.test/api/cart?session=SECRETQ", status: 500, requestHeaders: { authorization: "Bearer SECRETH" }, responseBody: "SECRETBODY" },
      { method: "GET", url: "https://app.test/api/cart?session=other", status: 500 },
      { method: "GET", url: "https://app.test/ok", status: 200 },
      { method: "POST", url: "https://app.test/pay", failure: "net::ERR_CONNECTION_RESET", responseBodySkipped: "too-large" },
    ]),
    "browser-events.ndjson": nd([
      { type: "console", level: "error", text: "Uncaught TypeError at Bearer SECRETC" },
      { type: "console", level: "error", text: "Uncaught TypeError at Bearer SECRETC" },
      { type: "console", level: "warning", text: "w" },
      { type: "web-error", error: "ReferenceError: x\n   at foo" },
      { type: "page-crashed" },
    ]),
    "interactions.ndjson": nd([
      { type: "click", target: { accessibleName: "Pay now", tagName: "BUTTON" }, frameUrl: "https://app.test/cart?x=1" },
      { type: "input", target: { tagName: "INPUT", accessibleName: "Card" }, data: { value: "4111-SECRETCARD" } },
    ]),
    "storage-state.json": '{"cookies":[{"value":"SECRETCOOKIE"}]}',
  });
  const s = await summarizeRecording(dir);
  assert.equal(s.session.status, "complete");
  assert.equal(s.network.total, 4);
  const cart = s.network.failed.find((f) => f.url === "https://app.test/api/cart");
  assert.equal(cart?.count, 2, "same endpoint with different query strings is one failure");
  assert.ok(s.network.failed.some((f) => f.failure === "net::ERR_CONNECTION_RESET"));
  assert.deepEqual(s.network.bodiesSkipped, { "too-large": 1 });
  assert.deepEqual(s.console.errors, [{ text: "Uncaught TypeError at Bearer [redacted]", count: 2 }]);
  assert.equal(s.console.warnings, 1);
  assert.deepEqual(s.webErrors, ["ReferenceError: x"]);
  assert.equal(s.pageCrashes, 1);
  assert.deepEqual(s.interactions.byType, { click: 1, input: 1 });
  assert.deepEqual(s.interactions.last[0], { type: "click", target: "Pay now", page: "https://app.test/cart" });
  assert.deepEqual(s.caveats, []);
  const out = JSON.stringify(s);
  for (const secret of ["SECRETQ", "SECRETH", "SECRETBODY", "SECRETC", "SECRETCARD", "SECRETCOOKIE"]) {
    assert.ok(!out.includes(secret), `${secret} must not appear in the summary`);
  }
});

test("an interrupted, partial recording is flagged and a torn last line is tolerated", async () => {
  const dir = await session({
    "manifest.json": JSON.stringify({ status: "interrupted", counts: { "write-error": 2 } }),
    "network.ndjson": nd([{ method: "GET", url: "https://a.test/x", status: 404 }]) + '{"method":"GET","ur',
  });
  const s = await summarizeRecording(dir);
  assert.equal(s.network.total, 1);
  const c = s.caveats.join("|");
  assert.match(c, /interrupted/);
  assert.match(c, /2 event\(s\) failed to write/);
  assert.match(c, /browser-events\.ndjson is missing/);
});

test("findRecordingDir picks the folder itself, else the newest session, else null", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "recs-"));
  assert.equal(await findRecordingDir(base), null);
  const old = path.join(base, "old"); const fresh = path.join(base, "fresh");
  for (const d of [old, fresh]) { await mkdir(d); await writeFile(path.join(d, "manifest.json"), "{}"); }
  await utimes(path.join(old, "manifest.json"), new Date(1000), new Date(1000));
  assert.equal(await findRecordingDir(base), fresh);
  assert.equal(await findRecordingDir(old), old);
});
