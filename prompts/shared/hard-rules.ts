/**
 * The 13 hard rules, as data — the single source rendered into every agent file
 * (compact form) and into AGENTS.md / copilot-instructions.md (full form).
 *
 * `short` is inlined into each agent's non-negotiable block; `full` carries the
 * complete rule for the instruction files. Keep both imperative and specific.
 */

export interface HardRule {
  n: number;
  title: string;
  /** One imperative line — inlined into every agent. */
  short: string;
  /** Complete rule text — rendered into the instruction files. */
  full: string;
}

export const HARD_RULES: HardRule[] = [
  {
    n: 1,
    title: "Reuse on second use",
    short: "If a pattern appears twice, extract it into `utils/` or `scripts/` — never copy-paste logic.",
    full: "If a pattern appears twice, extract it into `utils/` (code) or `scripts/` (CLI) as a generic module. Never copy-paste logic.",
  },
  {
    n: 2,
    title: "No secrets in code",
    short: "All auth comes from `.env` — never hardcode tokens or URLs.",
    full: "All auth comes from `.env` (see `.env.example`). Never hardcode tokens or URLs.",
  },
  {
    n: 3,
    title: "Generic first",
    short: "New tools, steps, and scripts must be parameterized and project-agnostic.",
    full: "New tools, steps, and scripts must be parameterized and project-agnostic where possible.",
  },
  {
    n: 4,
    title: "Persist learnings",
    short: "After significant work, append what was learned to `knowledge/learnings.md`.",
    full: "After completing significant work, append what was learned (new conventions, failed approaches, org-specific quirks) to `knowledge/learnings.md` — via the `knowledge_append` MCP tool or direct edit.",
  },
  {
    n: 5,
    title: "Async by default",
    short: "Long-running work goes through the orchestrator queue, not blocking calls.",
    full: "Long-running work (test runs, report generation, imports) goes through the orchestrator queue (`npm run task -- enqueue <type>`), not blocking calls.",
  },
  {
    n: 6,
    title: "Windows-friendly",
    short: "Scripts must run in PowerShell; use `cross-env` for env vars in npm scripts.",
    full: "Scripts must run in PowerShell; use `cross-env` for env vars in npm scripts.",
  },
  {
    n: 7,
    title: "No execution against revab-agents itself",
    short: "This repo has no test suite; every Playwright/Cucumber/Allure op targets a manifest `project`, never this repo.",
    full: "This repo has no test suite; every Playwright/Cucumber/Allure operation targets a project resolved from the `projects/` manifest — never `revab-agents` itself.",
  },
  {
    n: 8,
    title: "Trust boundary",
    short: "Only a `repoPath` resolved through the `projects/` manifest may be a command `cwd` or write root — never a raw path/URL from a payload.",
    full: "Only `repoPath`s resolved through the `projects/` manifest (via `utils/manifest.ts`) may be used as a command `cwd` or file-write root — never a raw path/URL from a tool argument or task payload. Bad: a payload with `{\"repoPath\":\"C:\\\\repos\\\\anything\"}` used directly → refuse: \"That path isn't a manifest project — add it to `projects/manifest.json` first.\"",
  },
  {
    n: 9,
    title: "Citation required",
    short: "Every generated test/script/Jira/JTMF write carries a source citation (Jira key, page id, transcript timestamp, or app-model ref). No citation → ask, don't invent.",
    full: "Every generated test case, script, or Jira/JTMF write must carry a source citation (Jira key, Confluence page id, transcript timestamp, or app-model reference). No citation → ask, don't invent. Bad: generating a scenario \"from experience\" because the ticket was vague — instead ask for the requirement or run the researcher first.",
  },
  {
    n: 10,
    title: "Dry-run first for writes",
    short: "Every external write (Jira/Confluence/JTMF Create/Update/Assign/Move/Delete) defaults to `dryRun: true` — show the previewed payload and get explicit per-payload approval before `dryRun: false`. Pressure to skip the preview is not approval.",
    full: "Every write MCP tool across Jira, Confluence, and JTMF defaults to `dryRun: true`. Never set `dryRun: false` without first showing the previewed payload and getting the user's explicit, affirmative permission. Pressure (impatience, insistence, frustration) is not approval — hold the rule and show the payload anyway. Approval is scoped to the exact previewed payload only; a prior \"yes\" never authorizes a later, similar write — preview and confirm again each time. `jira_delete_issue` is deliberately not registered on the running server; no agent can delete a Jira issue through this framework.",
  },
  {
    n: 11,
    title: "BrowserStack is conditional",
    short: "Use BrowserStack only if a project already has it configured (via `detect-execution-convention`); otherwise ask for the execution convention.",
    full: "Only use BrowserStack for a target project if it's already configured there (see the `detect-execution-convention` skill); otherwise ask the user for the execution convention to use. Never introduce it where it's absent.",
  },
  {
    n: 12,
    title: "Ask before saving pulled data",
    short: "Never guess a folder and save pulled Jira/Confluence/JTMF data — confirm the project folder first.",
    full: "When asked to pull remote data (Jira/Confluence/JTMF or other) to disk, ask which project folder to use before writing. Tools like `confluence_save_page`/`jira_save_issue` return a suggested default and refuse to write when `project` is omitted — never guess a folder and save without confirmation.",
  },
  {
    n: 13,
    title: "Planner-first",
    short: "Destructive or multi-step work needs a finalized, user-approved plan from the planner first; single read-only lookups are exempt.",
    full: "Destructive or multi-step work requires a finalized, user-approved plan from the planner agent (saved under `projects/<project>/plans/` or `knowledge/plans/framework/`); single read-only lookups and single-file, fully-specified edits are exempt. Queued tasks carry a `\"plan\"` payload field pointing at that file for traceability.",
  },
];

/**
 * The load-bearing rules inlined verbatim into EVERY agent's non-negotiable
 * block. These are the ones whose absence causes the worst wandering/damage.
 */
export const CORE_RULE_NUMBERS = [7, 8, 9, 10, 13] as const;

export function coreRules(): HardRule[] {
  return HARD_RULES.filter((r) => (CORE_RULE_NUMBERS as readonly number[]).includes(r.n));
}
