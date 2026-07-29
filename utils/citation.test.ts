import { test } from "node:test";
import assert from "node:assert/strict";
import { requireCitation, validateCitation } from "./citation.js";

test("accepts each supported citation form", () => {
  const cases: Array<[string, string]> = [
    ["PROJ-123", "jira"],
    ["confluence:456789", "confluence"],
    ["page:456789", "confluence"],
    ["jtmf:ABC-321", "jtmf"],
    ["app-model:my-project#checkout", "app-model"],
    ["transcript:kickoff@00:12:34", "transcript"],
    ["transcript:kickoff@12:34", "transcript"],
    ["src/pages/login.ts:42", "file"],
    ["https://jira.example.com/browse/PROJ-1", "url"],
  ];
  for (const [raw, kind] of cases) {
    const result = validateCitation(raw);
    assert.equal(result.valid, true, `${raw} should be valid`);
    assert.equal(result.citations[0]?.kind, kind, `${raw} should parse as ${kind}`);
  }
});

test("accepts several comma-separated sources", () => {
  const result = validateCitation("PROJ-123, confluence:456");
  assert.equal(result.valid, true);
  assert.equal(result.citations.length, 2);
});

// The whole point: filler that satisfies a non-empty check but names nothing.
test("rejects placeholder filler an agent reaches for when it has no source", () => {
  for (const filler of ["TBD", "todo", "N/A", "none", "unknown", "from the requirements", "experience", "assumed"]) {
    const result = validateCitation(filler);
    assert.equal(result.valid, false, `"${filler}" must be rejected`);
    assert.match(result.error ?? "", /placeholder|not a recognizable/i);
  }
});

test("rejects empty or missing citations with the rule cited", () => {
  for (const value of ["", "   ", undefined]) {
    const result = validateCitation(value);
    assert.equal(result.valid, false);
    assert.match(result.error ?? "", /hard rule #9/);
  }
});

test("rejects free prose that merely looks descriptive", () => {
  for (const prose of ["the login page", "as discussed in standup", "acceptance criteria"]) {
    assert.equal(validateCitation(prose).valid, false, `"${prose}" must be rejected`);
  }
});

test("rejects a partly-invalid list rather than accepting the good half", () => {
  assert.equal(validateCitation("PROJ-123, TBD").valid, false);
});

test("requireCitation throws with an actionable message, or returns the parsed sources", () => {
  assert.throws(() => requireCitation("TBD"), /placeholder/i);
  assert.deepEqual(requireCitation("PROJ-7").map((c) => c.kind), ["jira"]);
});
