/**
 * Capability evals — executable assertions about what each agent CAN and CANNOT do.
 *
 * These are the regression net for agent behavior. Prompt edits are easy to get
 * subtly wrong: tightening the orchestrator to "delegate only" once stripped its
 * terminal access, leaving it unable to dispatch anything at all — a break nobody
 * noticed until it failed in real use. A capability eval states the invariant
 * ("orchestrator must be able to drive the queue CLI") so the next such edit fails
 * `npm run eval` instead of failing the user.
 *
 * Two kinds of check, both derived from the typed specs (`prompts/agents/*.ts`):
 *  - `mustHave`  — a tool the agent needs to do its own job at all.
 *  - `mustNotHave` — a tool that would let it do another agent's job, or something
 *    a hard rule forbids (e.g. bsa must never hold a Jira delete tool).
 *
 * Behavioral evals (does it *use* them well?) live in `evals/behavior/*.md` and are
 * judged per run; these structural ones are cheap, deterministic, and run in CI.
 */
import type { AgentSpec, ToolName } from "../prompts/types.js";

export interface CapabilityExpectation {
  agent: string;
  /** Tools the agent must hold, each with why — the why is the regression's epitaph. */
  mustHave: Array<{ tool: ToolName; because: string }>;
  /** Tools the agent must not hold, each with why. */
  mustNotHave: Array<{ tool: ToolName; because: string }>;
  /** Substrings that must appear somewhere in the spec's flow/always/never text. */
  mustState?: Array<{ text: string; because: string }>;
}

export const EXPECTATIONS: CapabilityExpectation[] = [
  {
    agent: "orchestrator",
    mustHave: [
      {
        tool: "Bash",
        because:
          "the async queue CLI (`npm run task -- enqueue`, `npm run worker`) is its delegation mechanism on hosts without a Task subagent tool — without a terminal it cannot dispatch anything",
      },
    ],
    mustNotHave: [
      { tool: "Write", because: "writing code/docs belongs to automation and documenter" },
      { tool: "mcp__codegen__scaffold_feature", because: "scaffolding belongs to test-planner/automation" },
    ],
    mustState: [
      { text: "npm run task", because: "it must know the concrete queue command, not just 'delegate'" },
    ],
  },
  {
    agent: "researcher",
    mustHave: [
      { tool: "mcp__jira__jira_get_issue", because: "reading tickets is its core job" },
    ],
    mustNotHave: [
      { tool: "Write", because: "researcher is read-only; saving is suggest-then-pull via the save tools" },
      { tool: "mcp__jira__jira_create_issue", because: "it must never write to a system of record (hard rule: read-only role)" },
      { tool: "mcp__confluence__confluence_update_page", because: "publishing belongs to documenter, dryRun-gated" },
    ],
  },
  {
    agent: "automation",
    mustHave: [
      { tool: "Bash", because: "it runs the target project's tooling" },
      { tool: "mcp__playwright-runner__run_bdd", because: "execution must route through playwright-runner, not raw shell" },
    ],
    mustNotHave: [
      { tool: "mcp__jira__jira_create_issue", because: "ticket writes belong to bsa/reporter, dryRun-gated" },
    ],
  },
  {
    agent: "bsa",
    mustHave: [
      { tool: "mcp__jira__jira_bulk_create_issues", because: "bulk intake is its core job" },
      { tool: "mcp__jira__jira_search_users", because: "assignee accountIds must be resolved, never guessed" },
    ],
    mustNotHave: [
      {
        tool: "mcp__jira__jira_delete_issue",
        because: "deletion is deliberately impossible in this framework — the tool is not registered on the running server",
      },
    ],
  },
  {
    agent: "planner",
    mustHave: [
      { tool: "mcp__artifacts__knowledge_search", because: "it must check prior plans/learnings before proposing new work" },
    ],
    mustNotHave: [
      { tool: "Bash", because: "the planner plans and never executes — execution is the orchestrator's to dispatch" },
      { tool: "Write", because: "plans are saved on approval; it must not write code" },
    ],
  },
  {
    agent: "test-planner",
    mustHave: [
      {
        tool: "Write",
        because:
          "its flow saves the plan to `projects/<project>/test-plans/<EPIC-KEY>.md` — without a write tool that step is impossible, the same defect class as the orchestrator's stripped terminal",
      },
      {
        tool: "mcp__playwright-runner__get_test_files",
        because:
          "it is told to reuse the project's existing step phrasing, which requires actually reading those steps",
      },
      {
        tool: "mcp__codegen__scaffold_feature",
        because: "scenarios are persisted into the target project through codegen, never written directly",
      },
      {
        tool: "mcp__confluence__confluence_get_page",
        because: "acceptance criteria frequently live in Confluence, not only in Jira",
      },
    ],
    mustNotHave: [
      { tool: "Bash", because: "planning never executes anything — running tests belongs to automation/reporter" },
      { tool: "mcp__codegen__scaffold_step", because: "step/page implementation belongs to automation" },
    ],
    mustState: [
      {
        text: "projects/<project>/test-plans",
        because:
          "plans live under the project's own folder; an agent told to write to `knowledge/test-plans/` would violate the manifest layout",
      },
      { text: "test-design-techniques", because: "coverage must be derived by a named technique, not improvised" },
    ],
  },
  {
    agent: "reporter",
    mustHave: [
      { tool: "mcp__allure-report__allure_summary", because: "failure analysis reads Allure results" },
    ],
    mustNotHave: [
      { tool: "mcp__codegen__scaffold_step", because: "fixing code belongs to automation" },
    ],
  },
  {
    agent: "self-improve",
    mustHave: [
      { tool: "mcp__artifacts__knowledge_append", because: "persisting learnings is its core job" },
      { tool: "Edit", because: "it proposes and applies approved spec/skill upgrades" },
    ],
    mustNotHave: [],
  },
];

export interface EvalFailure {
  agent: string;
  kind: "missing-tool" | "forbidden-tool" | "missing-statement" | "unknown-agent";
  detail: string;
}

/** Run every capability expectation against the specs. Returns [] when all hold. */
export function runCapabilityEvals(specs: AgentSpec[]): EvalFailure[] {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const failures: EvalFailure[] = [];

  for (const expectation of EXPECTATIONS) {
    const spec = byName.get(expectation.agent);
    if (!spec) {
      failures.push({
        agent: expectation.agent,
        kind: "unknown-agent",
        detail: `no spec named "${expectation.agent}" — was it renamed or removed?`,
      });
      continue;
    }
    const tools = new Set<string>(spec.tools);

    for (const { tool, because } of expectation.mustHave) {
      if (!tools.has(tool)) {
        failures.push({
          agent: spec.name,
          kind: "missing-tool",
          detail: `must hold \`${tool}\` — ${because}`,
        });
      }
    }
    for (const { tool, because } of expectation.mustNotHave) {
      if (tools.has(tool)) {
        failures.push({
          agent: spec.name,
          kind: "forbidden-tool",
          detail: `must NOT hold \`${tool}\` — ${because}`,
        });
      }
    }
    const body = [...spec.flow, ...(spec.always ?? []), ...(spec.never ?? [])].join("\n");
    for (const { text, because } of expectation.mustState ?? []) {
      if (!body.includes(text)) {
        failures.push({
          agent: spec.name,
          kind: "missing-statement",
          detail: `spec text must mention "${text}" — ${because}`,
        });
      }
    }
  }
  return failures;
}

/**
 * Framework-wide invariants that apply to EVERY agent, independent of role.
 * These encode the lessons that caused the wandering in the first place.
 */
export function runGlobalEvals(specs: AgentSpec[]): EvalFailure[] {
  const failures: EvalFailure[] = [];
  for (const spec of specs) {
    // No wildcards: an over-broad grant is what gives a model too many equal options.
    for (const tool of spec.tools) {
      if (tool.includes("*")) {
        failures.push({
          agent: spec.name,
          kind: "forbidden-tool",
          detail: `wildcard tool grant \`${tool}\` — enumerate the exact tools instead`,
        });
      }
    }
    // Every agent must declare at least one hand-off, or its scope has no edge.
    if (!spec.doesNot.length) {
      failures.push({
        agent: spec.name,
        kind: "missing-statement",
        detail: "no `doesNot` hand-off boundaries — an agent with no edges will do everything",
      });
    }
    // Rules must be inlined, never delegated to a file a host may not load.
    const body = [spec.role, ...spec.flow, ...(spec.always ?? []), ...(spec.never ?? [])].join("\n");
    if (/copilot-instructions\.md/.test(body)) {
      failures.push({
        agent: spec.name,
        kind: "missing-statement",
        detail:
          "spec defers rules to copilot-instructions.md — rules must be inlined so they load on any model",
      });
    }
  }
  return failures;
}
