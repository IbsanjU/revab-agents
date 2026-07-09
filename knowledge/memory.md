# Project Memory

In-repo Copilot memory — version-controlled, shared across machines and sessions.
Agents read this at session start and append learnings via the artifacts `knowledge_append` MCP tool (which writes to `knowledge/learnings.md`) or by directly editing this file.

---

## Framework facts

- **Architecture**: `revab-agents` is framework-only. It has no `tests/` and never runs Playwright/Cucumber/Allure against itself. Every test-authoring/execution/reporting operation targets a **project** declared in `projects.manifest.json`, resolved via `utils/manifest.ts` (the trust boundary — never accept a raw `repoPath`/`repoUrl` from a payload/tool arg).
- **MCP servers** (local HTTP, stateless, `.vscode/mcp.json`):
  - `jira` :7311 — `jira_search`, `jira_get_issue`, `jira_get_epic_children`, `jira_add_comment`, `jira_update_issue` (dryRun default), `jira_transition_issue` (dryRun default)
  - `confluence` :7312 — `confluence_search`, `confluence_get_page`, `confluence_get_children`, `confluence_get_attachments`, `confluence_download_attachment`, `confluence_get_comments`, `confluence_extract_links`
  - `jtmf` :7313 — `jtmf_get_test_case`, `jtmf_search_tests`, `jtmf_get_test_plan`, `jtmf_create_test_case` (dryRun default), `jtmf_update_test_case` (dryRun default), `jtmf_raw_get`
  - `artifacts` :7314 — `list_files`, `read_repo_file`, `knowledge_append` — scoped to this repo only (no more `allure_summary` here; moved to `allure-report`)
  - `playwright-runner` :7316 — `run_bdd`, `run_playwright`, `get_test_files` — all take `project`, execute in that project's resolved repoPath
  - `allure-report` :7317 — `generate_report`, `allure_summary`, `get_result_json` — all take `project`
  - `codegen` :7318 — `scaffold_feature` (requires `source` citation), `scaffold_step`, `scaffold_page`, `detect_conventions` — writes into the target project's `testPaths`
  - `playwright` :7315 — official `@playwright/mcp` via `npm run serve:playwright` (npx, local — target-agnostic interactive browser automation)
  - Shared infra: `mcp-servers/shared/server.ts` (`startMcpHttpServer`, `textResult`, `errorResult`), `mcp-servers/shared/http.ts` (`apiGet`, `apiPost`, `apiPut`)
- **Manifest**: `projects.manifest.json` (zod-validated by `utils/manifest.ts`) — one entry per project: `name`, `repoPath`/`repoUrl`+`branch`, `testPaths`, `jira`/`confluence`/`jtmf` ids, `execution.mode` (`local`|`browserstack`|`custom`, defaults `local` — BrowserStack only if detected in the target repo, never assumed).
- **Fixture**: `fixtures/sample-target-repo/` — self-contained Playwright+Cucumber+Allure project (`project: "sample"` in the manifest) used only to smoke-test MCP tools without needing a real external repo.
- **Orchestrator**: file queue `.queue/pending|running|done|failed`; handlers in `agents/registry.ts` — `run-bdd`/`generate-report` require `payload.project`; `typecheck` stays scoped to this framework repo; CLI `npm run task -- enqueue|status|types|reclaim`; worker `npm run worker`. Worker auto-sweeps stale `running` tasks (crash recovery) via `reclaimStale()`; queue root and manifest path are env-overridable (`QUEUE_ROOT_DIR`, `MANIFEST_PATH_OVERRIDE`) for tests.
- **Agents**: 7 files in `.github/agents/*.agent.md` (orchestrator, researcher, test-planner, automation, reporter, importer, self-improve) — all updated to operate on a manifest-resolved `project`.
- **Skills**: `skills/*/SKILL.md` — `analyze-test-failures`, `detect-execution-convention`, `upload-to-jtmf`, `update-jira-epic`, `extract-requirements-from-image`, `extract-requirements-from-video`, `consolidate-project-report`, `build-test-plan-interactive`.
- **Knowledge**: `knowledge/learnings.md` (dated session entries) + `knowledge/conventions.md` (team rules) + `knowledge/app-model/<project>.md` (living app maps) + `knowledge/reports/<project>/<date>.md` (consolidated project reports, from `consolidate-project-report` skill).
- **Tool names** (VS Code agent YAML): `edit/editFiles` (not `editFiles`), `runCommands`, `runTasks`, `codebase`, `search`, `problems`, `testFailure`, `fetch`.
- **Anti-hallucination rule**: every generated test case/script/Jira/JTMF write must carry a source citation (Jira key, Confluence page id, transcript timestamp, or app-model reference). Missing citation blocks generation — ask, don't invent.
- **Media limits**: no OCR/speech-to-text MCP tool exists yet — `extract-requirements-from-image`/`extract-requirements-from-video` skills rely on native vision capability or manually supplied transcripts until one is built. Confluence viewer analytics needs Cloud Premium.
- **Windows PATH fix** per terminal session: `$env:Path = "C:\Program Files\nodejs;$env:Path"; Set-ExecutionPolicy -Scope Process Bypass -Force`.
- **Testing/tooling**: `npm test` (Node built-in test runner via `tsx`, covers `utils/manifest.ts`, `orchestrator/queue.ts`, `scripts/check-conventions.ts`), `npm run check:conventions` (skill frontmatter + registry `payload.project` guard lint), `npm run knowledge:rotate` (archives old `knowledge/learnings.md` entries into `knowledge/learnings/<YYYY-MM>.md` past ~8KB).

## Pending setup (per developer)
- Copy `.env.example` → `.env` and fill in Atlassian auth (`ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, base URLs, `JTMF_STEPS_FIELD`).
- Add real project entries to `projects.manifest.json` (the `sample` entry is a working fixture, not a real project).
- Within each target project's own checkout: `npx playwright install chromium` (one-time) if using local execution.
