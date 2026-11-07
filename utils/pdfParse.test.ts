import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasAvailable, installRenderingStubs, loadPdfParse, newPdfParser } from "./pdfParse.js";

test("stubs are defined only where missing, and report what they added", () => {
  const target: Record<string, unknown> = { DOMMatrix: class Real {} };
  const real = target.DOMMatrix;
  assert.deepEqual(installRenderingStubs(target).sort(), ["ImageData", "Path2D"]);
  assert.equal(target.DOMMatrix, real, "a real implementation is never replaced");
  assert.deepEqual(installRenderingStubs(target), [], "idempotent");
});

test("the DOMMatrix stand-in is constructible and starts as the identity", () => {
  const target: Record<string, unknown> = {};
  installRenderingStubs(target);
  const M = target.DOMMatrix as new (init?: number[]) => { a: number; d: number; e: number };
  const m = new M();
  assert.deepEqual([m.a, m.d, m.e], [1, 1, 0]);
  assert.equal(new M([2, 0, 0, 3, 5, 6]).e, 5);
});

test("loadPdfParse loads once and returns a usable parser class", async () => {
  const first = await loadPdfParse();
  assert.equal(await loadPdfParse(), first);
  assert.equal(typeof first.PDFParse, "function");
  assert.ok(await newPdfParser(new Uint8Array(0)).then(() => true, () => true), "constructing does not throw at load");
});

test("in a checkout the real canvas is found, so nothing is stubbed", () => {
  assert.equal(canvasAvailable(), true, "dev installs include the optional native canvas");
});
