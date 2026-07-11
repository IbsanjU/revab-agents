# revab-agents — Copilot instructions

Centralized multi-agent QE automation framework. Local MCP servers (Jira, Confluence, JTMF, Artifacts, Media, Playwright-runner, Allure-report, Codegen) on localhost, async file-queue orchestrator, agent personas, and skills. **This repo is framework-only**: it never executes Playwright/Cucumber/Allure against itself, and holds no `tests/` of its own — all test authoring/execution/reporting happens in a **target project**, resolved from `projects.manifest.json` and operated on via MCP tools.

## Architecture
- `mcp-servers/` — TypeScript MCP servers (Streamable HTTP, stateless) registered in `.vscode/mcp.json`. Shared helpers live in `mcp-servers/shared/` — always reuse `startMcpHttpServer`, `textResult`, `apiGet/apiPost/apiPut/apiDelete`; path-safety via `utils/fsSafety.ts`'s `resolveWithinRoot`.
  - `jira`, `confluence`, `jtmf` — requirement/test-management systems (repo-agnostic).
  - `artifacts` — file search/read + knowledge persistence, scoped to `revab-agents` itself only.
  - `media` — reads/writes multimedia and document files (images, PDF, DOCX, and generic files) so their content can be fed to Copilot as metadata JSON or plain text, and generates styled PDF/DOCX reports; resolves paths against this repo by default or a manifest `project`'s repoPath if given.
  - `playwright-runner`, `allure-report`, `codegen` — project-scoped tools; every call takes a `project` name and resolves `repoPath` via `utils/manifest.ts`.
  - `playwright` (official `@playwright/mcp`) — interactive browser automation, target-agnostic.
- `orchestrator/` — file-based queue (`.queue/pending|running|done|failed`) + polling worker. Task types are declared in `agents/registry.ts`; project-scoped handlers (`run-bdd`, `generate-report`) require `payload.project` and run with `cwd` = that project's resolved repo path.
- `projects.manifest.json` + `utils/manifest.ts` — the only trust boundary for "which directory can a tool/task touch". Never accept a raw `repoPath`/`repoUrl` from a payload without resolving it through the manifest.
- `fixtures/sample-target-repo/` — a minimal Playwright+Cucumber+Allure project used only to smoke-test the MCP tools; not part of this framework's own build/test.
- `knowledge/` — persistent learnings and conventions. Agents append here after every session; `knowledge/app-model/<project>.md` holds living app maps; `knowledge/reports/<project>/` holds consolidated project reports.
- `scripts/`, `utils/` — generic, parameterized, reusable modules only.

## Session start
Read `knowledge/memory.md` first — it contains the canonical in-repo project memory (framework facts, tool names, pending setup). Then read `knowledge/learnings.md` for prior session learnings.

## Hard rules
1. **Reuse on second use**: if a pattern appears twice, extract it into `utils/` (code) or `scripts/` (CLI) as a generic module. Never copy-paste logic.
2. **No secrets in code**: all auth comes from `.env` (see `.env.example`). Never hardcode tokens or URLs.
3. **Generic first**: new tools, steps, and scripts must be parameterized and project-agnostic where possible.
4. **Persist learnings**: after completing significant work, append what was learned (new conventions, failed approaches, org-specific quirks) to `knowledge/learnings.md` — via the `knowledge_append` MCP tool or direct edit.
5. **Async by default**: long-running work (test runs, report generation, imports) goes through the orchestrator queue (`npm run task -- enqueue <type>`), not blocking calls.
6. **Windows-friendly**: scripts must run in PowerShell; use `cross-env` for env vars in npm scripts.
7. **No execution against `revab-agents` itself**: this repo has no test suite; every Playwright/Cucumber/Allure operation targets a project resolved from `projects.manifest.json`.
8. **Trust boundary**: only `repoPath`s resolved through `projects.manifest.json` (via `utils/manifest.ts`) may be used as a command `cwd` or file-write root — never a raw path/URL from a tool argument or task payload.
9. **Citation required**: every generated test case, script, or Jira/JTMF write must carry a source citation (Jira key, Confluence page id, transcript timestamp, or app-model reference). No citation → ask, don't invent.
10. **Dry-run first for writes**: every write (Create/Update/Delete) MCP tool across Jira (`jira_create_issue`, `jira_update_issue`, `jira_transition_issue`, `jira_delete_issue`), Confluence (`confluence_create_page`, `confluence_update_page`, `confluence_add_comment`, `confluence_delete_page`), and JTMF (`jtmf_create_test_case`, `jtmf_update_test_case`, `jtmf_delete_test_case`) defaults to `dryRun: true`. Never set `dryRun: false` without first showing the previewed payload/deletion and getting the user's explicit, affirmative permission to proceed — this applies to every CRUD write against these external systems, with no exceptions.
11. **BrowserStack is conditional, never assumed**: only use BrowserStack for a target project if it's already configured there (see the `detect-execution-convention` skill); otherwise ask the user for the execution convention to use.
12. **Ask before saving pulled data locally**: when a user asks to pull Jira/Confluence/JTMF data (or any other remote content) and save it to disk, ask which project folder to use before writing anything. Tools like `confluence_save_page` and `jira_save_issue` return a suggested default (`downloads/<server>/<KEY>-XXX`, derived from the issue key or space key) instead of writing when `project` is omitted — never guess a folder and save without the user confirming it.

## Skill / MCP tool / agent boundary
- **MCP tool** (new I/O: shell exec, external file access, HTTP) → `mcp-servers/*`.
- **Skill** (a reusable prompt playbook composing existing tools, no new I/O) → `skills/*/SKILL.md`.
- **Agent** (a persona orchestrating skills/tools for a role) → `.github/agents/*.agent.md`.

## Commands
- `npm run serve:mcp` — start all MCP servers (jira, confluence, jtmf, artifacts, media, playwright-runner, allure-report, codegen, playwright)
- `npm run worker` — start the async task worker
- `npm run task -- enqueue <type> '<json>'` / `-- status` / `-- types` (project-scoped types require `{"project":"<name>"}`)
- `npm run import:agents -- <sourceRepoPath> [--dry-run]` — import agents from another repo
- `npm run typecheck` — validate all TypeScript in this framework repo (never runs target-project tests)

## Adding a new MCP tool
Register it in the relevant `mcp-servers/*/index.ts` via `server.registerTool(name, { description, inputSchema }, handler)`; wrap responses with `textResult` / `errorResult`. Zod shapes only in `inputSchema`. If it touches a target project's files/shell, take a `project` argument and resolve via `utils/manifest.ts`.

## Adding a new orchestrator task type
Add a `TaskHandler` to `agents/registry.ts`. Handlers must only run whitelisted npm scripts and validate payload fields — never interpolate raw payload into shell strings. Project-scoped handlers must require `payload.project` and resolve `cwd` via `resolveProjectRepoPath`.
