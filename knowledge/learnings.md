# Learnings

Persistent, dated session learnings. Agents append here (via the artifacts `knowledge_append` MCP tool or direct edit) and read this before starting work. Keep entries short and factual; delete entries proven wrong.

Entry format:

### YYYY-MM-DD
- What was learned / decided / failed and why.

---

### 2026-07-02
- Framework scaffolded: 4 local MCP servers (jira 7311, confluence 7312, jtmf 7313, artifacts 7314), file-queue orchestrator, Playwright+Cucumber+Allure skeleton, 7 agent chat modes.
- JTMF custom fields are org-specific: set `JTMF_STEPS_FIELD` in `.env` before test-case tools return steps.

### 2026-07-04
- Major restructure: revab-agents is now framework-only. Removed in-repo `tests/`, `cucumber.js`, and Playwright/Cucumber/Allure devDependencies — this repo never executes tests against itself.
- Added `projects.manifest.json` + `utils/manifest.ts` (zod) as the trust boundary for resolving which target-repo directory any tool/task may operate on; supports both a local `repoPath` and clone-on-demand from `repoUrl` into `.workspaces/<project>/`.
- Added `fixtures/sample-target-repo/` (project name `sample`) — a minimal Playwright+Cucumber+Allure project used only to smoke-test the new MCP tools; not part of this framework's own build/test.
- New project-scoped MCP servers: `playwright-runner` (7316), `allure-report` (7317, replaces `artifacts`' old `allure_summary`), `codegen` (7318, scaffolds features/steps/pages into a target repo and requires a `source` citation on every feature file).
- Added write tools (dryRun-by-default): `jtmf_create_test_case`, `jtmf_update_test_case`, `jira_update_issue`, `jira_transition_issue`. Added `apiPut` helper to `mcp-servers/shared/http.ts`.
- Added skills: `detect-execution-convention` (BrowserStack only if already present in the target repo, never assumed), `upload-to-jtmf`, `update-jira-epic`, `extract-requirements-from-image`, `extract-requirements-from-video`, `consolidate-project-report`, `build-test-plan-interactive`.
- Known gap: no OCR/speech-to-text MCP tool yet — image/video extraction skills currently depend on native vision capability or manually supplied transcripts. Candidate future work if multi-modal extraction needs to be fully automated.
- Orchestrator handlers (`run-bdd`, `generate-report`) now require `payload.project` and execute with `cwd` resolved from the manifest; `typecheck` remains scoped to this framework repo.
