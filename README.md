# revab-agents

Centralized multi-agent QE automation framework — works in VS Code **without** org-level MCP enablement, via local MCP servers on `http://localhost`.

## What's inside

| Area | Location | Purpose |
| --- | --- | --- |
| MCP servers | `mcp-servers/` | Jira, Confluence, JTMF, Artifacts — local Streamable-HTTP servers registered in `.vscode/mcp.json` |
| Agents | `.github/chatmodes/` | orchestrator, researcher, test-planner, automation, reporter, importer, self-improve |
| Orchestrator | `orchestrator/` + `agents/registry.ts` | async file-queue + polling worker for long-running tasks |
| Tests | `tests/` | Playwright + Cucumber BDD with Allure reporting |
| Knowledge | `knowledge/` | persistent learnings & conventions — the framework's memory |
| Reusables | `utils/`, `scripts/`, `skills/` | generic modules, CLIs, and agent skills |

## Quickstart

```powershell
npm install
npx playwright install chromium   # once, for browser tests
Copy-Item .env.example .env       # then fill in Jira/Confluence auth
npm run serve:mcp                 # start all 4 MCP servers (keep running)
npm run worker                    # start the async task worker (second terminal)
```

Then in VS Code: the servers in `.vscode/mcp.json` become available as MCP tools; pick an agent from the chat-mode dropdown (e.g. **orchestrator**).

## Everyday commands

```powershell
npm run test:bdd                                    # run BDD suite
npm run test:bdd -- --tags "@smoke"                 # run tagged scenarios
npm run report:generate; npm run report:open        # Allure HTML report
npm run task -- enqueue run-bdd '{"tags":"@smoke"}' # async run via queue
npm run task -- status                              # queue status
npm run task -- types                               # available task types
npm run import:agents -- C:\path\to\other-repo --dry-run  # import agents from another repo
npm run typecheck
```

## MCP servers & ports

| Server | Port | Tools |
| --- | --- | --- |
| jira | 7311 | `jira_search`, `jira_get_issue`, `jira_get_epic_children`, `jira_add_comment` |
| confluence | 7312 | `confluence_search`, `confluence_get_page`, `confluence_get_children`, `confluence_get_attachments`, `confluence_download_attachment`, `confluence_get_comments`, `confluence_extract_links` |
| jtmf | 7313 | `jtmf_get_test_case`, `jtmf_search_tests`, `jtmf_get_test_plan`, `jtmf_raw_get` |
| artifacts | 7314 | `list_files`, `read_repo_file`, `allure_summary`, `knowledge_append` |
| playwright | 7315 | Official `@playwright/mcp` — browser automation tools (navigate, click, snapshot, etc.) |

Auth: Cloud = `ATLASSIAN_AUTH_MODE=basic` (email + API token); Server/DC = `bearer` (PAT). See `.env.example`.

## Agent workflow

1. **orchestrator** decomposes work and delegates.
2. **researcher** pulls epics/tickets/docs -> research brief.
3. **test-planner** -> risk-based plan + Gherkin (saved to `knowledge/test-plans/`).
4. **automation** implements features/steps/pages.
5. **reporter** runs suites async and classifies failures from Allure results.
6. **self-improve** persists learnings to `knowledge/` and proposes framework upgrades — every session.

## Extending

- **New MCP tool**: add `server.registerTool(...)` in `mcp-servers/*/index.ts` (reuse `mcp-servers/shared/`).
- **New MCP server**: new folder + `startMcpHttpServer(...)`, register port in `.vscode/mcp.json` and a `serve:` script.
- **New async task type**: add a handler in `agents/registry.ts`.
- **New agent**: add `.github/chatmodes/<name>.chatmode.md`.
