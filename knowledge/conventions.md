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
  `name`/directory, non-empty `description`) and that every `agents/registry.ts` handler which
  calls `resolveProjectRepoPath(...)` first requires/validates `payload.project` — run it whenever
  a skill or registry handler is added or changed.
- `npm test` runs the framework's own unit tests (Node's built-in test runner via `tsx`) for
  `utils/manifest.ts`, `orchestrator/queue.ts`, and `scripts/check-conventions.ts`.
