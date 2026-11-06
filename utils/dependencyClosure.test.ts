import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyClosure, type PackageFs } from "./dependencyClosure.js";

function fakeModules(pkgs: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>): PackageFs {
  const files = new Map(Object.entries(pkgs).map(([n, p]) => [`/nm/${n}/package.json`, JSON.stringify(p)]));
  return { exists: (p) => files.has(p), read: (p) => files.get(p)! };
}

test("follows dependencies transitively and returns a sorted, de-duplicated list", () => {
  const fs = fakeModules({ a: { dependencies: { c: "1", b: "1" } }, b: { dependencies: { c: "1" } }, c: {} });
  assert.deepEqual(dependencyClosure("/nm", ["a"], fs), { packages: ["a", "b", "c"], missing: [] });
});

test("handles scoped packages", () => {
  const fs = fakeModules({ a: { dependencies: { "@s/x": "1" } }, "@s/x": {} });
  assert.deepEqual(dependencyClosure("/nm", ["a"], fs).packages, ["@s/x", "a"]);
});

test("a skipped pattern is neither included nor followed (platform-specific native packages)", () => {
  const fs = fakeModules({ a: { optionalDependencies: { "@napi-rs/canvas": "1" } }, "@napi-rs/canvas": { dependencies: { z: "1" } }, z: {} });
  assert.deepEqual(dependencyClosure("/nm", ["a"], fs, [/^@napi-rs\//]), { packages: ["a"], missing: [] });
});

test("a missing required dependency is reported, a missing optional one is not", () => {
  const fs = fakeModules({ a: { dependencies: { gone: "1" }, optionalDependencies: { maybe: "1" } } });
  assert.deepEqual(dependencyClosure("/nm", ["a"], fs), { packages: ["a"], missing: ["gone"] });
});

test("a requested root that does not exist is reported missing", () => {
  assert.deepEqual(dependencyClosure("/nm", ["nope"], fakeModules({})).missing, ["nope"]);
});

test("cycles terminate", () => {
  const fs = fakeModules({ a: { dependencies: { b: "1" } }, b: { dependencies: { a: "1" } } });
  assert.deepEqual(dependencyClosure("/nm", ["a"], fs).packages, ["a", "b"]);
});
