import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import type { CapturedTool } from "../mcp-servers/gateway/tools.js";
import { appendMark, withCallLog, type CallRecord } from "../mcp-servers/gateway/callLog.js";
import { BEHAVIOR_CHECKS } from "../evals/behaviorChecks.js";
import { evaluateChecks, manualItems, parseBehaviorEval, parseLog, parseRefs, recordRun, renderPack, segmentFor, verdictOf } from "./behaviorEvals.js";

const call = (tool: string, over: Partial<CallRecord> = {}): CallRecord => ({ t: "2026-11-07T00:00:00Z", tool, server: "s", risk: "read", ok: true, ms: 1, ...over });

test("every real behavior eval parses: an agent, a prompt, and a Must and Must not list", async () => {
  const dir = "evals/behavior";
  for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".md"))) {
    const e = parseBehaviorEval(f.replace(/\.md$/, ""), await fs.readFile(path.join(dir, f), "utf8"));
    assert.ok(e.agent !== "?", `${f} has an Agent line`);
    assert.ok(e.prompts.length >= 1, `${f} has a prompt`);
    assert.ok(e.must.length >= 1 && e.mustNot.length >= 1, `${f} has Must and Must not items`);
    assert.ok(Object.hasOwn(BEHAVIOR_CHECKS, e.id), `${f} has an entry in evals/behaviorChecks.ts (empty is fine)`);
  }
  const ids = new Set((await fs.readdir(dir)).map((f) => f.replace(/\.md$/, "")));
  for (const id of Object.keys(BEHAVIOR_CHECKS)) assert.ok(ids.has(id), `behaviorChecks.ts names a case that does not exist: ${id}`);
});

test("a numbered multi-prompt eval yields one prompt per item, and multi-line bullets are joined", async () => {
  const e = parseBehaviorEval("planner-right-sizes", await fs.readFile("evals/behavior/planner-right-sizes.md", "utf8"));
  assert.equal(e.prompts.length, 3);
  assert.match(e.prompts[0], /^Rename the `smoke` tag/);
  const o = parseBehaviorEval("orchestrator-delegates", await fs.readFile("evals/behavior/orchestrator-delegates.md", "utf8"));
  assert.ok(o.must.some((m) => m.includes("queue:") && m.includes("enqueue run-bdd")), "a bullet that wraps onto the next line is one item");
});

test("checks: never, mustCall, noLiveWrites, readOnly and before behave as documented", () => {
  const calls = [call("a"), call("jira_x", { risk: "write", dryRun: true }), call("jira_y", { risk: "write", dryRun: false }), call("b")];
  const r = (c: Parameters<typeof evaluateChecks>[1][number]) => evaluateChecks(calls, [c])[0];
  assert.equal(r({ kind: "never", tool: "zzz", why: "" }).pass, true);
  assert.equal(r({ kind: "never", tool: "a", why: "" }).pass, false);
  assert.equal(r({ kind: "mustCall", tool: "b", why: "" }).pass, true);
  assert.equal(r({ kind: "mustCall", tool: "c", why: "" }).pass, false);
  const live = r({ kind: "noLiveWrites", why: "" });
  assert.equal(live.pass, false);
  assert.match(live.detail, /jira_y/);
  assert.equal(r({ kind: "readOnly", why: "" }).pass, false);
  assert.equal(evaluateChecks([call("a")], [{ kind: "readOnly", why: "" }])[0].pass, true);
  assert.equal(r({ kind: "before", first: ["a"], then: "b", why: "" }).pass, true);
  assert.equal(r({ kind: "before", first: ["b"], then: "a", why: "" }).pass, false, "a came before b, not after");
  assert.equal(r({ kind: "before", first: ["b"], then: "never-called", why: "" }).pass, true, "vacuous when the later tool was never called");
});

test("a write with no dryRun argument is not counted as a live write (it has no preview mode)", () => {
  assert.equal(evaluateChecks([call("knowledge_append", { risk: "write" })], [{ kind: "noLiveWrites", why: "" }])[0].pass, true);
});

test("segmentFor takes the calls after the latest mark of that case, up to the next mark", () => {
  const lines = parseLog([
    JSON.stringify({ mark: "e1", t: "t" }), JSON.stringify(call("old")),
    JSON.stringify({ mark: "e1", t: "t" }), JSON.stringify(call("one")), JSON.stringify(call("two")),
    JSON.stringify({ mark: "e2", t: "t" }), JSON.stringify(call("other")),
  ].join("\n") + '\n{"torn":');
  assert.deepEqual(segmentFor(lines, "e1")!.map((c) => c.tool), ["one", "two"]);
  assert.equal(segmentFor(lines, "nope"), null);
});

test("verdict: a failed machine check or judged failure is FAIL; unjudged items leave it PENDING; all clear is PASS", async () => {
  const e = parseBehaviorEval("x", "# t\n**Agent:** a\n## Task prompt\n> p\n## Rubric\n**Must:**\n- one\n**Must not:**\n- two\n## Runs\n");
  const items = manualItems(e);
  assert.deepEqual(items.map((i) => i.ref), ["M1", "N1"]);
  const ok = evaluateChecks([call("a")], [{ kind: "mustCall", tool: "a", why: "" }]);
  const bad = evaluateChecks([], [{ kind: "mustCall", tool: "a", why: "" }]);
  assert.equal(verdictOf(ok, items, ["M1", "N1"], []).verdict, "PASS");
  assert.equal(verdictOf(ok, items, ["M1"], []).verdict, "PENDING");
  assert.equal(verdictOf(ok, items, ["M1"], ["N1"]).verdict, "FAIL");
  assert.equal(verdictOf(bad, items, ["M1", "N1"], []).verdict, "FAIL", "the log is evidence a person's pass cannot override");
  assert.throws(() => parseRefs("M9", new Set(["M1"])), /unknown item/);
});

test("recordRun replaces each kind of placeholder and appends after real rows", () => {
  const row = { date: "2026-11-08", host: "VS Code Copilot / m", result: "PASS", notes: "a | b" };
  const italic = recordRun("# t\n\n## Runs\n\n_No live-model run recorded yet._\n", row);
  assert.doesNotMatch(italic, /No live-model run/);
  assert.match(italic, /\| 2026-11-08 \| VS Code Copilot \/ m \| PASS \| a \/ b \|/);
  const tmpl = "## Runs\n\n| Date | Model / host | Result | Notes |\n|---|---|---|---|\n| _(record each run: pass/fail + what it did wrong)_ | | | |\n";
  const t = recordRun(tmpl, row);
  assert.doesNotMatch(t, /_\(record/);
  assert.equal((t.match(/^\|.*PASS/gm) ?? []).length, 1);
  const twice = recordRun(t, { ...row, date: "2026-11-09", result: "FAIL" });
  assert.equal((twice.match(/^\| 2026-/gm) ?? []).length, 2);
  assert.match(recordRun("# t\n", row), /## Runs/);
});

test("the pack names the agent, the exact prompt, the mark and score commands, and the automatic checks", async () => {
  const e = parseBehaviorEval("ship-unknown-is-not-pass", await fs.readFile("evals/behavior/ship-unknown-is-not-pass.md", "utf8"));
  const pack = renderPack([e], (id) => BEHAVIOR_CHECKS[id] ?? []);
  assert.match(pack, /npm run eval:behavior -- mark ship-unknown-is-not-pass/);
  assert.match(pack, /Pick \*\*reporter\*\*/);
  assert.match(pack, /Can we ship release 2\.4/);
  assert.match(pack, /--model "<model shown in the picker>"/);
  assert.match(pack, /a readiness report never transitions a ticket/);
});

test("the call log records names and flags only, never argument values, and never breaks a call", async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "calllog-")), "sub", "calls.jsonl");
  const ok: CapturedTool = { server: "jira", name: "jira_create_issue", description: "", inputSchema: { dryRun: z.boolean().optional(), summary: z.string() }, handler: async () => ({ content: [{ type: "text", text: "RESULTSECRET" }] }) };
  const boom: CapturedTool = { server: "jira", name: "jira_get_issue", description: "", inputSchema: {}, handler: async () => { throw new Error("nope"); } };
  const [a, b] = withCallLog([ok, boom], file);
  await a.handler({ summary: "ARGSECRET", dryRun: true });
  await assert.rejects(async () => b.handler({}), /nope/, "the tool's own error still surfaces");
  appendMark(file, "case-1");
  const text = await fs.readFile(file, "utf8");
  assert.ok(!text.includes("ARGSECRET") && !text.includes("RESULTSECRET"), "no values in the log");
  const lines = parseLog(text);
  const first = lines[0] as CallRecord;
  assert.deepEqual([first.tool, first.risk, first.dryRun, first.ok], ["jira_create_issue", "write", true, true]);
  assert.equal((lines[1] as CallRecord).ok, false);
  assert.equal(withCallLog([ok], undefined)[0], ok, "no file, no wrapping");
  // an unwritable path must not break the call
  const blocker = path.join(path.dirname(path.dirname(file)), "a-file");
  await fs.writeFile(blocker, "x");
  const [c] = withCallLog([ok], path.join(blocker, "sub", "calls.jsonl")); // a path under a regular file cannot be created
  assert.ok((await c.handler({ summary: "x" })).content[0].text === "RESULTSECRET");
});
