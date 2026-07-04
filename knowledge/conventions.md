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
- Write-back tools (Jira/JTMF) default to `dryRun: true`; confirm with the user before disabling.
- Every significant session ends with a `knowledge/learnings.md` entry.
- Test plans live in `knowledge/test-plans/<project>/<EPIC-KEY>.md`.
