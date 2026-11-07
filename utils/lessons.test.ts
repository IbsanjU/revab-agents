import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { confidence, reinforce, validateLessons, verdict } from "./lessons.js";

const block = (over: Record<string, string> = {}) =>
  Object.entries({ id: "a-lesson", trigger: "when x", action: "do y", scope: "global", domain: "d", support: "1", contradict: "0", evidence: "PR #1", last: "2026-11-07", ...over })
    .map(([k, v]) => `${k}: ${v}`).join("\n");

test("confidence is computed from support and contradiction, not stored", () => {
  assert.equal(confidence({ support: 1, contradict: 0 }), 0.3);
  assert.equal(confidence({ support: 3, contradict: 0 }), 0.66);
  assert.equal(confidence({ support: 3, contradict: 1 }), 0.33);
  assert.ok(confidence({ support: 10, contradict: 0 }) < 1, "never reaches certainty");
});

test("a valid file parses; prose, headings and comments between blocks are ignored", () => {
  const { lessons, problems } = validateLessons(`# Lessons\n\nSome prose.\n\n${block()}\n\n<!-- note -->\n\n${block({ id: "second" })}\n`);
  assert.deepEqual(problems, []);
  assert.deepEqual(lessons.map((l) => l.id), ["a-lesson", "second"]);
});

test("missing evidence, bad scope, duplicate id and bad numbers are each reported", () => {
  const text = [block({ evidence: "" }), block({ id: "b", scope: "everywhere" }), block({ id: "a-lesson" }), block({ id: "c", support: "0" })].join("\n\n");
  const msgs = validateLessons(text).problems.map((p) => p.message).join("|");
  assert.match(msgs, /missing `evidence`/);
  assert.match(msgs, /scope must be/);
  assert.match(msgs, /duplicate id/);
  assert.match(msgs, /support must be an integer >= 1/);
});

test("promotion needs 3 observations and no contradiction; heavy contradiction goes to review", () => {
  const l = (support: number, contradict: number) => validateLessons(block({ support: String(support), contradict: String(contradict) })).lessons[0];
  assert.equal(verdict(l(2, 0)).verdict, "keep");
  assert.equal(verdict(l(3, 0)).verdict, "promote");
  assert.equal(verdict(l(5, 1)).verdict, "keep", "one contradiction blocks promotion");
  assert.equal(verdict(l(2, 2)).verdict, "review");
});

test("a project-scoped lesson is promoted to that project, not to the shared rules", () => {
  const l = validateLessons(block({ scope: "project:checkout", support: "3" })).lessons[0];
  assert.match(verdict(l).why, /checkout project/);
});

test("reinforce raises support, appends evidence and date on the right block only", () => {
  const text = `${block()}\n\n${block({ id: "other" })}\n`;
  const next = reinforce(text, "a-lesson", "PR #9", "2026-12-01");
  const { lessons } = validateLessons(next);
  assert.equal(lessons[0].support, 2);
  assert.equal(lessons[0].evidence, "PR #1; PR #9");
  assert.equal(lessons[0].last, "2026-12-01");
  assert.equal(lessons[1].support, 1, "the other lesson is untouched");
  assert.equal(validateLessons(reinforce(next, "a-lesson", "PR #10", "2026-12-02", true)).lessons[0].contradict, 1);
  assert.throws(() => reinforce(text, "nope", "x", "2026-12-01"), /no lesson/);
});

test("the real knowledge/lessons.md is valid", async () => {
  const { problems, lessons } = validateLessons(await fs.readFile("knowledge/lessons.md", "utf8"));
  assert.deepEqual(problems, []);
  assert.ok(lessons.length >= 6);
});
