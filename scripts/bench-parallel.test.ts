import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, speedup } from "./bench-parallel.js";

test("speedup is a rounded ratio and guards a zero denominator", () => {
  assert.equal(speedup(400, 100), 4);
  assert.equal(speedup(10, 0), 0);
});

test("independent sleeping tasks run materially faster in parallel", async () => {
  const t = await compare("sleep", 4, () => new Promise((r) => setTimeout(r, 40)));
  assert.ok(t.sequentialMs >= 150, `sequential ${t.sequentialMs}ms should be about 4×40`);
  assert.ok(t.speedup >= 2, `expected ≥2× speedup, got ${t.speedup}`);
});
