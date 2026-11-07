import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentSpec } from "../prompts/types.js";
import { buildGraph, diffBaseline, gatewayToolName, handoffTargets, mentionedTools, renderGraphMarkdown } from "./capabilityGraph.js";

const agent = (over: Partial<AgentSpec> & { name: string }): AgentSpec => ({
  description: "d", role: "r", owns: [], doesNot: [], tools: [], flow: [], handoff: "", ...over,
});
const tools = [
  { name: "jira_search", server: "jira" },
  { name: "git_log", server: "git" },
  { name: "notify_email", server: "notify" },
];

test("gatewayToolName strips only the gateway prefix", () => {
  assert.equal(gatewayToolName("mcp__gateway__git_log"), "git_log");
  assert.equal(gatewayToolName("Read"), null);
  assert.equal(gatewayToolName("mcp__other__git_log"), null);
});

test("mentionedTools matches only backticked real tool names", () => {
  const names = new Set(["jira_search", "git_log"]);
  assert.deepEqual(mentionedTools("use `jira_search` then git_log and `notathing`", names), ["jira_search"]);
});

test("handoffTargets reads **agent** names and doesNot.to, ignoring self and unknown names", () => {
  const names = new Set(["a", "b", "c"]);
  const a = agent({ name: "a", handoff: "Hand to **b** or **a** or **zzz**", doesNot: [{ what: "x", to: "c" }] });
  assert.deepEqual(handoffTargets(a, names), ["b", "c"]);
});

test("a skill naming a tool its owner lacks is a skill-tool-gap; holding it clears the finding", () => {
  const skills = [{ name: "s1", text: "call `jira_search`" }];
  const without = buildGraph({ agents: [agent({ name: "a", skills: ["s1"] })], skills, tools });
  assert.ok(without.findings.some((f) => f.key === "skill-tool-gap:s1:a:jira_search"));
  const withTool = buildGraph({ agents: [agent({ name: "a", skills: ["s1"], tools: ["mcp__gateway__jira_search"] })], skills, tools });
  assert.ok(!withTool.findings.some((f) => f.kind === "skill-tool-gap"));
});

test("unheld tools, unowned skills and dangling references are reported", () => {
  const g = buildGraph({
    agents: [agent({ name: "a", skills: ["ghost"], tools: ["mcp__gateway__nope"] })],
    skills: [{ name: "lonely", text: "" }],
    tools,
  });
  const keys = g.findings.map((f) => f.key);
  assert.ok(keys.includes("unheld-tool:notify_email"));
  assert.ok(keys.includes("unowned-skill:lonely"));
  assert.ok(keys.includes("dangling-skill:a:ghost"));
  assert.ok(keys.includes("dangling-tool:a:nope"));
  assert.ok(keys.some((k) => k.startsWith("dangling-lifecycle:")), "lifecycle names missing from this tiny repo must be flagged");
});

test("diffBaseline separates new findings from fixed ones", () => {
  const f = [{ key: "k1", kind: "unheld-tool" as const, message: "m1" }, { key: "k2", kind: "unheld-tool" as const, message: "m2" }];
  const d = diffBaseline(f, ["k2", "gone"]);
  assert.deepEqual(d.added.map((x) => x.key), ["k1"]);
  assert.deepEqual(d.stale, ["gone"]);
});

test("rendering is deterministic and marks new vs accepted findings", () => {
  const g = buildGraph({ agents: [agent({ name: "a" })], skills: [], tools });
  const k = g.findings[0].key;
  const one = renderGraphMarkdown(g, [k]);
  assert.equal(one, renderGraphMarkdown(g, [k]));
  assert.match(one, /accepted \(baseline\)/);
  assert.match(renderGraphMarkdown(g, []), /\*\*new\*\*/);
});

test("the real repo graph has no dangling references (typos in specs fail here)", async () => {
  const { AGENTS } = await import("../prompts/agents/index.js");
  const { promises: fs } = await import("fs");
  const names = (await fs.readdir("skills", { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const g = buildGraph({
    agents: AGENTS,
    skills: names.map((n) => ({ name: n, text: "" })),
    tools: (await import("../mcp-servers/gateway/tools.js").then((m) => m.captureAllTools())).map((t) => ({ name: t.name, server: t.server })),
  });
  assert.deepEqual(g.findings.filter((f) => f.kind.startsWith("dangling")).map((f) => f.message), []);
});
