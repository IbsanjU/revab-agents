import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentSpec } from "../prompts/types.js";
import { AGENTS } from "../prompts/agents/index.js";
import { runCapabilityEvals, runGlobalEvals } from "./capabilities.js";

test("the real agent specs pass every capability eval", () => {
  const failures = [...runCapabilityEvals(AGENTS), ...runGlobalEvals(AGENTS)];
  assert.deepEqual(
    failures,
    [],
    `expected no eval failures, got:\n${failures.map((f) => `  ${f.agent}: ${f.detail}`).join("\n")}`,
  );
});

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    name: "orchestrator",
    description: "d",
    role: "r",
    owns: ["o"],
    doesNot: [{ what: "research", to: "researcher" }],
    tools: ["Read", "Bash", "Task", "mcp__jira__jira_search", "mcp__artifacts__knowledge_search"],
    flow: ["enqueue via npm run task -- enqueue run-bdd"],
    handoff: "h",
    ...overrides,
  };
}

test("a missing required tool is caught (the orchestrator terminal regression)", () => {
  // Only the orchestrator spec is supplied, so the other expectations correctly
  // report `unknown-agent`; assert on this agent's failures specifically.
  const failures = runCapabilityEvals([spec({ tools: ["Read", "Task"] })]).filter(
    (f) => f.agent === "orchestrator",
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, "missing-tool");
  assert.match(failures[0]?.detail ?? "", /Bash/);
});

test("a forbidden tool is caught (scope leak into another agent's job)", () => {
  const failures = runCapabilityEvals([
    spec({ tools: ["Read", "Bash", "Task", "Write", "mcp__jira__jira_search", "mcp__artifacts__knowledge_search"] }),
  ]);
  assert.ok(failures.some((f) => f.kind === "forbidden-tool" && /Write/.test(f.detail)));
});

test("a required statement missing from the spec text is caught", () => {
  const failures = runCapabilityEvals([spec({ flow: ["just delegate somehow"] })]);
  assert.ok(failures.some((f) => f.kind === "missing-statement" && /npm run task/.test(f.detail)));
});

test("an unknown agent name is reported rather than silently skipped", () => {
  const failures = runCapabilityEvals([spec({ name: "orchestrater" })]);
  assert.ok(failures.some((f) => f.kind === "unknown-agent"));
});

test("global invariants catch wildcards, missing hand-offs, and deferred rules", () => {
  const wildcard = runGlobalEvals([spec({ name: "x", tools: ["mcp__jira__*" as never] })]);
  assert.ok(wildcard.some((f) => /wildcard/.test(f.detail)));

  const noEdges = runGlobalEvals([spec({ name: "x", doesNot: [] })]);
  assert.ok(noEdges.some((f) => /doesNot/.test(f.detail)));

  const deferred = runGlobalEvals([
    spec({ name: "x", always: ["follow the rules in .github/copilot-instructions.md"] }),
  ]);
  assert.ok(deferred.some((f) => /inlined/.test(f.detail)));
});
