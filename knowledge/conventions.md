# Conventions

Team/org conventions the agents must follow. The self-improvement agent updates this file when new conventions are decided.

## Code
- TypeScript everywhere; ESM (`type: module`); run via `tsx` (no build output).
- Reuse on second use: promote repeated logic to `utils/` or `scripts/`.
- Secrets only in `.env`; config via `mcp-servers/shared/config.ts` helpers.
- `revab-agents` never contains test code or executes tests against itself — all Playwright/Cucumber/Allure work targets a project resolved from `projects.manifest.json`.

## Testing (in target projects, via codegen/playwright-runner)
- Gherkin tags: `@smoke`/`@regression` + `@<component>` + `@<JIRA-KEY>` on every scenario.
- Every feature file carries a `# Source: <citation>` comment — no uncited scenarios.
- Page objects hold locators/actions only — assertions live in steps.
- No hard waits; web-first assertions.
- BrowserStack only if already configured in the target project (see `detect-execution-convention` skill) — never introduced by default.

## BSA / ticket authoring
- **Required fields by issue type** (the `bsa` agent's `bulk-create-tickets` skill validates
  against this before previewing a create):
  - All types: summary, description (context + why), issue type, project key.
  - Story: + acceptance criteria, component, priority, story points (only if the source gives
    an estimate — never invent one).
  - Bug: + steps to reproduce, expected vs. actual, severity/priority.
  - Task: + owner-facing deliverable description, priority.
  - Epic: + goal/outcome statement, target components.
  - A row missing a required field is still previewed (flagged `incomplete` with the missing
    field names) — never fabricate the missing value to make a row pass validation.
- **Assignee routing**: explicit assignee named in the source (Excel column, chat request)
  always wins; otherwise resolve via `projects/<project>/team-roster.json`
  (`byComponent` -> `byLabel` -> `byIssueType` -> `defaultAssignee`, per the `route-assignee`
  skill) and turn the matched name into a verified `accountId` via `jira_search_users` before
  ever assigning — never assign a raw name or a `null` placeholder accountId.
- **Bulk update, not just bulk create**: `jira_bulk_update_issues` covers batch field
  changes and/or status transitions (per row) — don't loop `jira_update_issue`/
  `jira_transition_issue` one issue at a time when a batch of tickets needs the same kind
  of change. `jira_bulk_create_issues` also accepts an optional per-row `transitionName` to
  move a newly created ticket out of its default status in the same call.
- **No deletes**: `jira_delete_issue` exists in `mcp-servers/jira/index.ts` but its
  `registerTool` call is intentionally commented out — the running `jira` server cannot
  delete an issue. Correct or transition a ticket instead (`jira_update_issue` /
  `jira_transition_issue`). Re-enabling it is a deliberate, separate decision (uncomment +
  restart the server), never a silent workaround for "the user asked to delete something."

## Process
- Long tasks go through the orchestrator queue, not blocking calls.
- Project-scoped tools/tasks always require a `project` name resolved via `utils/manifest.ts` — never a raw path/URL.
- Write-back tools (Jira/Confluence/JTMF) default to `dryRun: true` for every Create/Update/Delete operation; always show the previewed payload and get the user's explicit confirmation before disabling dryRun.
- Saving pulled data to disk (Confluence pages, Jira issues, etc.) requires an explicit, user-confirmed project folder — tools return a suggested default (`<KEY>-XXX`) instead of writing when `project` is omitted; never assume a folder.
- Every significant session ends with a `knowledge/learnings.md` entry.
- Test plans live in `knowledge/test-plans/<project>/<EPIC-KEY>.md`.
- `knowledge/learnings.md` is rotated once it grows past ~8KB: run `npm run knowledge:rotate`
  to archive all but the current month's dated entries into `knowledge/learnings/<YYYY-MM>.md`.
  Below that size the command is a safe no-op — run it periodically, no harm in running it often.
- `npm run check:conventions` validates every `skills/*/SKILL.md` has valid frontmatter (matching
  `name`/directory, non-empty `description`), that every `agents/registry.ts` handler which
  calls `resolveProjectRepoPath(...)` first requires/validates `payload.project` — run it whenever a skill or
  registry handler is added or changed.
- `npm test` runs the framework's own unit tests (Node's built-in test runner via `tsx`) for
  `utils/manifest.ts`, `orchestrator/queue.ts`, and `scripts/check-conventions.ts`.
- Agent conduct rules live once in `.github/copilot-instructions.md` (Agent conduct + Per-agent
  boundaries sections) — that file loads automatically alongside every persona, so
  `.github/agents/*.agent.md` files carry a one-line pointer, not a duplicated copy. Tighten a
  specific persona directly in its own file instead of re-pasting shared text.
