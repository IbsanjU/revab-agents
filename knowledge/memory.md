# Project Memory

In-repo Copilot memory — version-controlled, shared across machines and sessions.
Agents read this at session start and append learnings via the artifacts `knowledge_append` MCP tool (which writes to `knowledge/learnings.md`) or by directly editing this file.

---

## Framework facts

- **MCP servers** (local HTTP, stateless, `.vscode/mcp.json`):
  - `jira` :7311 — `jira_search`, `jira_get_issue`, `jira_get_epic_children`, `jira_add_comment`
  - `confluence` :7312 — `confluence_search`, `confluence_get_page`, `confluence_get_children`, `confluence_get_attachments`, `confluence_download_attachment`, `confluence_get_comments`, `confluence_extract_links`
  - `jtmf` :7313 — `jtmf_get_test_case`, `jtmf_search_tests`, `jtmf_get_test_plan`, `jtmf_raw_get`
  - `artifacts` :7314 — `list_files`, `read_repo_file`, `allure_summary`, `knowledge_append`
  - `playwright` :7315 — official `@playwright/mcp` via `npm run serve:playwright` (npx, local — works without org MCP enablement)
  - Shared infra: `mcp-servers/shared/server.ts` (`startMcpHttpServer`, `textResult`, `errorResult`)
- **Orchestrator**: file queue `.queue/pending|running|done|failed`; handlers in `agents/registry.ts`; CLI `npm run task -- enqueue|status|types`; worker `npm run worker`.
- **Agents**: 7 files in `.github/agents/*.agent.md` (orchestrator, researcher, test-planner, automation, reporter, importer, self-improve).
- **Tests**: Playwright + Cucumber ESM via `tsx`; world in `tests/support/world.ts`; Allure results in `reports/allure-results/`.
- **Knowledge**: `knowledge/learnings.md` (dated session entries) + `knowledge/conventions.md` (team rules).
- **Tool names** (VS Code agent YAML): `edit/editFiles` (not `editFiles`), `runCommands`, `runTasks`, `codebase`, `search`, `problems`, `testFailure`, `fetch`.
- **Media limits**: attachments (images/video/pdf) can be listed, downloaded, and referenced — not visually interpreted (no org vision capability). OCR via tesseract.js is a possible future add. Confluence viewer analytics needs Cloud Premium.
- **Windows PATH fix** per terminal session: `$env:Path = "C:\Program Files\nodejs;$env:Path"; Set-ExecutionPolicy -Scope Process Bypass -Force`.

## Pending setup (per developer)
- Copy `.env.example` → `.env` and fill in Atlassian auth (`ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, base URLs, `JTMF_STEPS_FIELD`).
- `npx playwright install chromium` (one-time).
