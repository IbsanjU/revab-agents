# revab-agents — Copilot instructions

Centralized multi-agent QE automation framework. Local MCP servers (Jira, Confluence, JTMF, Artifacts) on localhost, async file-queue orchestrator, Playwright + Cucumber BDD, Allure reporting.

## Architecture
- `mcp-servers/` — TypeScript MCP servers (Streamable HTTP, stateless) registered in `.vscode/mcp.json`. Shared helpers live in `mcp-servers/shared/` — always reuse `startMcpHttpServer`, `textResult`, `apiGet/apiPost`.
- `orchestrator/` — file-based queue (`.queue/pending|running|done|failed`) + polling worker. Task types are declared in `agents/registry.ts`.
- `tests/` — Cucumber features (`features/`), step definitions (`steps/`), Playwright world (`support/`). Allure results go to `reports/allure-results`.
- `knowledge/` — persistent learnings and conventions. Agents append here after every session.
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

## Commands
- `npm run serve:mcp` — start all four MCP servers
- `npm run worker` — start the async task worker
- `npm run task -- enqueue <type> '<json>'` / `-- status` / `-- types`
- `npm run test:bdd` — run BDD suite; `npm run report:generate` + `report:open` — Allure
- `npm run import:agents -- <sourceRepoPath> [--dry-run]` — import agents from another repo
- `npm run typecheck` — validate all TypeScript

## Adding a new MCP tool
Register it in the relevant `mcp-servers/*/index.ts` via `server.registerTool(name, { description, inputSchema }, handler)`; wrap responses with `textResult` / `errorResult`. Zod shapes only in `inputSchema`.

## Adding a new orchestrator task type
Add a `TaskHandler` to `agents/registry.ts`. Handlers must only run whitelisted npm scripts and validate payload fields — never interpolate raw payload into shell strings.
