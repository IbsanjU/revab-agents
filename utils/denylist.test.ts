import { test } from "node:test";
import assert from "node:assert/strict";
import { findDenied, parseDenylist } from "./denylist.js";

test("a plain term matches as a whole word, case-insensitively", () => {
  const { entries } = parseDenylist("Acme");
  const hit = (t: string) => findDenied([{ path: "a.md", text: t }], entries).length;
  assert.equal(hit("built for ACME teams"), 1);
  assert.equal(hit("acme."), 1);
  assert.equal(hit("acmeinc and macmeal"), 0, "not inside a longer word");
});

test("a regex entry can exclude a legitimate use", () => {
  const { entries } = parseDenylist("/(?<!graph )\\bZQ\\b/");
  const hit = (t: string) => findDenied([{ path: "a.md", text: t }], entries).length;
  assert.equal(hit("graph ZQ\n  A --> B"), 0, "the legitimate use is excluded");
  assert.equal(hit("the ZQ team owns it"), 1);
});

test("comments and blanks are ignored; a bad regex is reported, not thrown", () => {
  const { entries, errors } = parseDenylist("# note\n\nreal\n/([/\n");
  assert.equal(entries.length, 1);
  assert.equal(errors.length, 1);
});

test("a hit reports the file and line but never the matched text", () => {
  const { entries } = parseDenylist("secretcorp");
  const hits = findDenied([{ path: "docs/x.md", text: "one\ntwo secretcorp three" }], entries);
  assert.deepEqual(hits, [{ path: "docs/x.md", line: 2, entry: "secretcorp" }]);
});

test("no entries means no hits", () => {
  assert.deepEqual(findDenied([{ path: "a", text: "anything" }], []), []);
});
