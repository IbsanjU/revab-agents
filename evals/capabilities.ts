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
      { tool: "mcp__gateway__git_branches", because: "its own flow checks for in-progress work before dispatching" },
      {
        tool: "Bash",
        because:
          "the async queue CLI (`npm run task -- enqueue`, `npm run worker`) is its delegation mechanism on hosts without a Task subagent tool — without a terminal it cannot dispatch anything",
      },
      {
        tool: "mcp__gateway__consensus_score",
        because: "adversarial-review scores agreement with this tool; without it the orchestrator would be eyeballing consensus instead of computing it",
      },
    ],
    mustNotHave: [
      { tool: "Write", because: "writing code/docs belongs to automation and documenter" },
      { tool: "mcp__gateway__scaffold_feature", because: "scaffolding belongs to test-planner/automation" },
    ],
    mustState: [
      { text: "npm run task", because: "it must know the concrete queue command, not just 'delegate'" },
    ],
  },
  {
    agent: "researcher",
    mustHave: [
      { tool: "mcp__gateway__confluence_download_attachment", because: "extract-requirements-from-image downloads the attachment first" },
      { tool: "mcp__gateway__git_show", because: "structure-project-data dates content from commits" },
      { tool: "mcp__gateway__github_search_commits", because: "structure-project-data and search-across-sources search commit history" },
      { tool: "mcp__gateway__github_search_issues", because: "search-across-sources federates GitHub issues" },
      { tool: "mcp__gateway__github_search_repos", because: "search-across-sources federates GitHub repos" },
      { tool: "mcp__gateway__github_search_topics", because: "search-across-sources federates GitHub topics" },
      { tool: "mcp__gateway__confluence_extract_links", because: "search-across-sources surfaces linked sources first" },
      { tool: "mcp__gateway__jtmf_get_test_case", because: "search-across-sources resolves a test-case key directly" },
      { tool: "mcp__gateway__jira_get_issue", because: "reading tickets is its core job" },
      { tool: "mcp__gateway__ocr_image", because: "its own flow runs extract-requirements-from-image, which cannot execute at all without this tool" },
      { tool: "mcp__gateway-code__codemode_search", because: "its always-rule tells it to scan with Code Mode; the rule is dead text without both tools" },
      { tool: "mcp__gateway-code__codemode_execute", because: "same: search alone cannot run the script it prepares" },
    ],
    mustNotHave: [
      { tool: "Write", because: "researcher is read-only; saving is suggest-then-pull via the save tools" },
      { tool: "mcp__gateway__jira_create_issue", because: "it must never write to a system of record (hard rule: read-only role)" },
      { tool: "mcp__gateway__confluence_update_page", because: "publishing belongs to documenter, dryRun-gated" },
    ],
    mustState: [
      { text: "codemode_execute", because: "the scan-with-Code-Mode rule must name the tool, not just say 'use code'" },
      { text: "cannot write", because: "the rule must say Code Mode cannot write, so the researcher never reaches for it to modify anything" },
    ],
  },
  {
    agent: "automation",
    mustHave: [
      { tool: "mcp__playwright-local__browser_navigate", because: "verify drives the real UI through the policy-controlled browser server" },
      { tool: "mcp__playwright-local__page_snapshot", because: "verify drives the real UI through the policy-controlled browser server" },
      { tool: "mcp__playwright-local__page_click", because: "verify drives the real UI through the policy-controlled browser server" },
      { tool: "mcp__playwright-local__page_type", because: "verify drives the real UI through the policy-controlled browser server" },
      { tool: "mcp__playwright-local__page_console_logs", because: "verify drives the real UI through the policy-controlled browser server" },
      { tool: "mcp__gateway__get_result_json", because: "verify captures the real assertion output" },
      { tool: "mcp__gateway__run_playwright", because: "verify runs the scenario the change affects" },
      { tool: "Bash", because: "it runs the target project's tooling" },
      { tool: "mcp__gateway__run_bdd", because: "execution must route through playwright-runner, not raw shell" },
      { tool: "mcp__gateway__git_diff", because: "verify/code-review/simplify — all mandatory pre-done steps — open by getting the diff first" },
    ],
    mustNotHave: [
      { tool: "mcp__playwright-local__page_eval", because: "running arbitrary script in a page is switched off by policy and is never granted" },
      { tool: "mcp__gateway__jira_create_issue", because: "ticket writes belong to bsa/reporter, dryRun-gated" },
    ],
  },
  {
    agent: "bsa",
    mustHave: [
      { tool: "mcp__gateway__jira_add_comment", because: "bulk-create-tickets notes a ticket's source on creation" },
      { tool: "mcp__gateway__read_repo_file", because: "route-assignee reads ownership files in the repo" },
      { tool: "mcp__gateway__jira_bulk_create_issues", because: "bulk intake is its core job" },
      { tool: "mcp__gateway__jira_search_users", because: "assignee accountIds must be resolved, never guessed" },
      { tool: "mcp__gateway__jira_get_boards", because: "sprint-backlog-report must resolve the board before it can resolve a sprint" },
      { tool: "mcp__gateway__jira_get_sprints", because: "sprint-backlog-report resolves the active sprint before calling jira_get_sprint_report" },
    ],
    mustNotHave: [
      {
        tool: "mcp__gateway__jira_delete_issue",
        because: "deletion is deliberately impossible in this framework — the tool is not registered on the running server",
      },
    ],
  },
  {
    agent: "planner",
    mustHave: [
      { tool: "mcp__gateway__knowledge_search", because: "it must check prior plans/learnings before proposing new work" },
    ],
    mustNotHave: [
      { tool: "Bash", because: "the planner plans and never executes — execution is the orchestrator's to dispatch" },
      { tool: "Write", because: "plans are saved on approval; it must not write code" },
    ],
    mustState: [
      { text: "size-and-slice", because: "sizing is its first move; without it every request gets full ceremony or none" },
      { text: "never whether you ask", because: "right-sizing must not become a way to skip the approval gate" },
      { text: "Up-tier, never down", because: "risky work must not be shrunk into a light plan by its apparent size" },
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
        tool: "mcp__gateway__get_test_files",
        because:
          "it is told to reuse the project's existing step phrasing, which requires actually reading those steps",
      },
      {
        tool: "mcp__gateway__scaffold_feature",
        because: "scenarios are persisted into the target project through codegen, never written directly",
      },
      {
        tool: "mcp__gateway__confluence_get_page",
        because: "acceptance criteria frequently live in Confluence, not only in Jira",
      },
      {
        tool: "mcp__gateway__git_diff",
        because: "review-against-spec's step 1 gets the diff directly — without this tool that skill can't run",
      },
      {
        tool: "mcp__gateway__jtmf_create_test_case",
        because: "it owns tracking each scaffolded scenario in JTMF via upload-to-jtmf — without the write tool that step is impossible",
      },
    ],
    mustNotHave: [
      { tool: "Bash", because: "planning never executes anything — running tests belongs to automation/reporter" },
      { tool: "mcp__gateway__scaffold_step", because: "step/page implementation belongs to automation" },
    ],
    mustState: [
      {
        text: "projects/<project>/test-plans",
        because:
          "plans live under the project's own folder; an agent told to write to `knowledge/test-plans/` would violate the manifest layout",
      },
      { text: "test-design-techniques", because: "coverage must be derived by a named technique, not improvised" },
      { text: "upload-to-jtmf", because: "JTMF tracking must go through the dedup-check-then-dryRun skill, not an improvised direct write" },
    ],
  },
  {
    agent: "reporter",
    mustHave: [
      { tool: "mcp__gateway__jira_get_issue", because: "analyze-test-failures cross-checks a failure against the Jira acceptance criteria" },
      { tool: "mcp__gateway__allure_summary", because: "failure analysis reads Allure results" },
      { tool: "mcp__gateway__jira_transition_issue", because: "its own flow posts to Jira via update-jira-epic after approval — without this tool that step is impossible" },
      { tool: "mcp__gateway__recording_summary", because: "analyze-test-failures uses a session recording as evidence for the classification" },
      { tool: "mcp__gateway__git_log", because: "the ship skill scopes a release from commit history" },
      { tool: "mcp__gateway__git_branches", because: "the ship skill identifies the release branch/range" },
      { tool: "mcp__gateway__jira_search", because: "the ship skill lists open blockers for the release scope" },
    ],
    mustNotHave: [
      { tool: "mcp__gateway__scaffold_step", because: "fixing code belongs to automation" },
    ],
  },
  {
    agent: "documenter",
    mustHave: [
      { tool: "mcp__gateway__allure_summary", because: "consolidate-project-report reads the latest run" },
      { tool: "mcp__gateway__get_result_json", because: "consolidate-project-report pulls failure detail" },
      { tool: "mcp__gateway__jira_search", because: "consolidate-project-report lists ticket and epic state" },
      { tool: "mcp__gateway__jira_get_epic_children", because: "consolidate-project-report walks each epic in scope" },
      { tool: "mcp__gateway__confluence_search", because: "consolidate-project-report finds the HLRs" },
      { tool: "mcp__gateway__confluence_get_children", because: "consolidate-project-report walks the HLR page tree" },
      { tool: "mcp__gateway__jtmf_search_tests", because: "consolidate-project-report lists current test cases" },
      { tool: "mcp__gateway__confluence_get_page", because: "a section-level diff preview needs the current page content" },
      { tool: "mcp__gateway__confluence_update_page", because: "its flow applies a confirmed update to an existing page" },
    ],
    mustNotHave: [
      { tool: "mcp__gateway__confluence_delete_page", because: "the framework never deletes: documenter updates or supersedes" },
      { tool: "mcp__gateway__jira_transition_issue", because: "documenting never changes a ticket's status" },
    ],
  },
  {
    agent: "importer",
    mustHave: [
      { tool: "Edit", because: "normalizing frontmatter and secrets in an imported file is an in-place edit, not a rewrite" },
      { tool: "Bash", because: "it runs `npm run import:agents` (dry-run first) and the conventions check" },
      { tool: "mcp__gateway__knowledge_append", because: "its flow records the import in the learnings log" },
    ],
    mustNotHave: [
      { tool: "mcp__gateway__jira_update_issue", because: "importing assets never writes to Jira" },
      { tool: "mcp__gateway__confluence_update_page", because: "importing assets never writes to Confluence" },
    ],
    mustState: [
      { text: "gateway/tools.ts", because: "an imported MCP server joins the one gateway, not a second .vscode/mcp.json entry" },
      { text: "check:conventions", because: "an imported skill must pass the frontmatter and graph checks before the import counts as done" },
    ],
  },
  {
    agent: "self-improve",
    mustHave: [
      { tool: "mcp__gateway__github_search_code", because: "build-capability looks for existing implementations on GitHub" },
      { tool: "mcp__gateway__github_search_repos", because: "build-capability looks for existing implementations on GitHub" },
      { tool: "mcp__gateway__knowledge_append", because: "persisting learnings is its core job" },
      { tool: "Edit", because: "it proposes and applies approved spec/skill upgrades" },
    ],
    mustState: [
      { text: "lessons -- reinforce", because: "a repeat observation must raise support on the existing lesson, not add a duplicate" },
      { text: "lessons -- promote", because: "promotion of repeatedly confirmed lessons is how learning becomes a skill or rule" },
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
