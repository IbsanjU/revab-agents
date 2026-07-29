import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { semanticBoolean } from "./semanticBoolean.js";
import { semanticNumber } from "./semanticNumber.js";

test("semanticBoolean coerces the string 'false' to false (does not treat it as truthy)", () => {
  const schema = semanticBoolean(z.boolean().optional());
  assert.equal(schema.parse("false"), false);
});

test("semanticBoolean coerces the string 'true' to true", () => {
  assert.equal(semanticBoolean().parse("true"), true);
});

test("semanticBoolean passes real booleans through unchanged", () => {
  assert.equal(semanticBoolean().parse(true), true);
  assert.equal(semanticBoolean().parse(false), false);
});

test("semanticBoolean leaves an optional undefined as undefined", () => {
  const schema = semanticBoolean(z.boolean().optional());
  assert.equal(schema.parse(undefined), undefined);
});

test("semanticNumber coerces a numeric string to a number", () => {
  assert.equal(semanticNumber(z.number().optional()).parse("25"), 25);
});

test("semanticNumber passes real numbers through and rejects non-numeric strings", () => {
  assert.equal(semanticNumber().parse(7), 7);
  assert.throws(() => semanticNumber().parse("not-a-number"));
});
