import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { resolveWithinRoot } from "./fsSafety.js";

test("resolveWithinRoot allows a path inside the root", () => {
  const root = path.resolve("/tmp/root-example");
  assert.equal(resolveWithinRoot(root, "sub/file.txt"), path.join(root, "sub/file.txt"));
});

test("resolveWithinRoot allows the root itself", () => {
  const root = path.resolve("/tmp/root-example");
  assert.equal(resolveWithinRoot(root, "."), root);
});

test("resolveWithinRoot rejects a path traversal escape (../)", () => {
  const root = path.resolve("/tmp/root-example");
  assert.throws(() => resolveWithinRoot(root, "../outside.txt"));
});

test("resolveWithinRoot rejects a sibling directory with a similar name prefix", () => {
  const root = path.resolve("/tmp/root-example");
  assert.throws(() => resolveWithinRoot(root, "../root-example-evil/file.txt"));
});
