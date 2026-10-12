import { test } from "node:test";
import assert from "node:assert/strict";
import { citationWeight, scoreConsensus, type Finding } from "./consensus.js";

const claimOf = (findings: Finding[], key: string) => {
  const result = scoreConsensus(findings).claims.find((c) => c.key === key);
  assert.ok(result, `claim ${key} should exist`);
  return result;
};

test("citation weight: system of record 1, bare URL 0.6, filler or missing 0", () => {
  assert.equal(citationWeight("PROJ-123"), 1);
  assert.equal(citationWeight("confluence:456"), 1);
  assert.equal(citationWeight("https://example.com/spec"), 0.6);
  assert.equal(citationWeight("TBD"), 0);
  assert.equal(citationWeight(undefined), 0);
});

test("two agents with system-of-record sources accept a claim", () => {
  const r = claimOf(
    [
      { agent: "r1", key: "login-lockout", claim: "Lockout after 5 tries", citation: "PROJ-1" },
      { agent: "r2", key: "login-lockout", claim: "Account locks at 5 attempts", citation: "confluence:99" },
    ],
    "login-lockout"
  );
  assert.equal(r.verdict, "accepted");
  assert.equal(r.score, 1);
});

test("one agent alone is single-source however well cited", () => {
  const report = scoreConsensus([
    { agent: "r1", key: "a", claim: "A", citation: "PROJ-1" },
    { agent: "r2", key: "b", claim: "B", citation: "PROJ-2" },
  ]);
  assert.ok(report.claims.every((c) => c.verdict === "single-source"));
});

test("an agent repeating itself cannot inflate a claim", () => {
  const r = claimOf(
    [
      { agent: "r1", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "r1", key: "a", claim: "A again", citation: "PROJ-1" },
      { agent: "r2", key: "other", claim: "Other", citation: "PROJ-2" },
    ],
    "a"
  );
  assert.equal(r.supporters.length, 1);
  assert.equal(r.verdict, "single-source");
});

test("a claim with no valid citation is unsupported even if everyone repeats it", () => {
  const r = claimOf(
    [
      { agent: "r1", key: "a", claim: "A", citation: "TBD" },
      { agent: "r2", key: "a", claim: "A", citation: "from the requirements" },
    ],
    "a"
  );
  assert.equal(r.verdict, "unsupported");
  assert.equal(r.score, 0);
});

test("an unsourced dispute does not move the score", () => {
  const r = claimOf(
    [
      { agent: "r1", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "r2", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "critic", key: "a", claim: "I doubt it", stance: "disputes" },
    ],
    "a"
  );
  assert.equal(r.disputers.length, 0);
  assert.equal(r.verdict, "accepted");
});

test("a sourced dispute lowers the score and is recorded as dissent", () => {
  const r = claimOf(
    [
      { agent: "r1", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "r2", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "r3", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "critic", key: "a", claim: "Contradicted", citation: "confluence:7", stance: "disputes" },
    ],
    "a"
  );
  // (3 − 1) / 4 = 0.5 < 0.6 with a sourced dispute → contested, not accepted.
  assert.equal(r.score, 0.5);
  assert.equal(r.verdict, "contested");
});

test("accepted-with-dissent when support still clears the threshold", () => {
  const r = claimOf(
    [
      { agent: "r1", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "r2", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "r3", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "r4", key: "a", claim: "A", citation: "PROJ-1" },
      { agent: "critic", key: "a", claim: "Minor doubt", citation: "https://x.example/y", stance: "disputes", confidence: 0.5 },
    ],
    "a"
  );
  // (4 − 0.3) / 5 = 0.74 ≥ 0.6
  assert.equal(r.score, 0.74);
  assert.equal(r.verdict, "accepted-with-dissent");
});

test("confidence scales a finding's weight", () => {
  const r = claimOf(
    [
      { agent: "r1", key: "a", claim: "A", citation: "PROJ-1", confidence: 0.5 },
      { agent: "r2", key: "a", claim: "A", citation: "PROJ-1", confidence: 0.5 },
    ],
    "a"
  );
  assert.equal(r.score, 0.5);
  assert.equal(r.verdict, "weak");
});

test("claims without a key group by normalized wording", () => {
  const report = scoreConsensus([
    { agent: "r1", claim: "Lockout after 5 tries.", citation: "PROJ-1" },
    { agent: "r2", claim: "lockout AFTER 5 tries", citation: "PROJ-1" },
  ]);
  assert.equal(report.claims.length, 1);
  assert.equal(report.claims[0]?.verdict, "accepted");
});

test("empty input yields an empty report", () => {
  assert.deepEqual(scoreConsensus([]).claims, []);
});
