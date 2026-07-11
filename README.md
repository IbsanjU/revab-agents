# revab-agents

Centralized multi-agent QE automation framework — works in VS Code **without** org-level MCP enablement, via local MCP servers on `http://localhost`.

**This repo is framework-only.** It holds no `tests/` of its own and never executes Playwright/Cucumber/Allure against itself. All test authoring, execution, and reporting happens in a **target project** — any other repo you point it at — resolved through `projects.manifest.json` and operated on exclusively via MCP tools. See [Known limitations](#known-limitations).

## What's inside

| Area | Location | Purpose |
| --- | --- | --- |
| MCP servers | `mcp-servers/` | Jira, Confluence, JTMF, GitHub, Artifacts, Media, Playwright-runner, Allure-report, Codegen — local Streamable-HTTP servers registered in `.vscode/mcp.json` |
| Agents | `.github/agents/` | orchestrator, researcher, test-planner, automation, reporter, importer, self-improve |
| Orchestrator | `orchestrator/` + `agents/registry.ts` | async file-queue + polling worker for long-running, project-scoped tasks |
| Manifest | `projects.manifest.json` + `utils/manifest.ts` | per-project config (repo location, test paths, Jira/Confluence/JTMF ids, execution mode) — the trust boundary for which repo a tool may touch |
| Fixture | `fixtures/sample-target-repo/` | minimal Playwright+Cucumber+Allure project used only to smoke-test the MCP tools |
| Knowledge | `knowledge/` | persistent learnings, conventions, per-project app models, and consolidated reports — the framework's memory |
| Reusables | `utils/`, `scripts/`, `skills/` | generic modules, CLIs, and agent skills |

## Quickstart

```powershell
npm install
Copy-Item .env.example .env       # then fill in Jira/Confluence auth
npm run serve:mcp                 # start all MCP servers (keep running)
npm run worker                    # start the async task worker (second terminal)
```

Add your project(s) to `projects.manifest.json` (a `sample` entry pointing at `fixtures/sample-target-repo` is included as a working example). Then in VS Code: the servers in `.vscode/mcp.json` become available as MCP tools; pick an agent from the chat-mode dropdown (e.g. **orchestrator**) and tell it which `project` to work on.

## Everyday commands

```powershell
npm run task -- enqueue run-bdd '{"project":"sample","tags":"@smoke"}'   # async run via queue
npm run task -- enqueue generate-report '{"project":"sample"}'
npm run task -- status                              # queue status
npm run task -- types                               # available task types
npm run import:agents -- C:\path\to\other-repo --dry-run  # import agents/conventions from another repo
npm run typecheck                                    # typechecks revab-agents itself only
```

Project-scoped work (running BDD suites, generating Allure reports, scaffolding features/steps/pages) goes through the `playwright-runner`, `allure-report`, and `codegen` MCP tools, or the equivalent orchestrator task types — always with a `project` argument.

## MCP servers & ports

| Server | Port | Scope | Tools |
| --- | --- | --- | --- |
| jira | 7311 | repo-agnostic | `jira_search`, `jira_get_issue`, `jira_get_epic_children`, `jira_add_comment`, `jira_create_issue`, `jira_update_issue`, `jira_transition_issue`, `jira_delete_issue`, `jira_save_issue` |
| confluence | 7312 | repo-agnostic | `confluence_search`, `confluence_get_page` (text/html/structured formats), `confluence_get_children`, `confluence_get_attachments`, `confluence_download_attachment`, `confluence_get_comments`, `confluence_extract_links`, `confluence_create_page`, `confluence_update_page`, `confluence_add_comment`, `confluence_delete_page`, `confluence_save_page` |
| jtmf | 7313 | repo-agnostic | `jtmf_get_test_case`, `jtmf_search_tests`, `jtmf_get_test_plan`, `jtmf_create_test_case`, `jtmf_update_test_case`, `jtmf_delete_test_case`, `jtmf_raw_get` |
| github | 7320 | repo-agnostic | `github_search_code`, `github_search_repos`, `github_search_issues`, `github_search_commits`, `github_get_file` |
| artifacts | 7314 | this repo only | `list_files`, `read_repo_file`, `knowledge_append` |
| media | 7319 | this repo, or a manifest `project` | `get_file_metadata`, `read_pdf_text`, `read_docx_text`, `create_pdf`, `create_docx` |
| playwright-runner | 7316 | project-scoped | `run_bdd`, `run_playwright`, `get_test_files` |
| allure-report | 7317 | project-scoped | `generate_report`, `allure_summary`, `get_result_json` |
| codegen | 7318 | project-scoped | `scaffold_feature`, `scaffold_step`, `scaffold_page`, `detect_conventions` |
| playwright | 7315 | target-agnostic | Official `@playwright/mcp` — browser automation tools (navigate, click, snapshot, etc.) |

Auth: Cloud = `ATLASSIAN_AUTH_MODE=basic` (email + API token); Server/DC = `bearer` (PAT). See `.env.example`. Every Create/Update/Delete tool across Jira, Confluence, and JTMF (`jira_create_issue`, `jira_update_issue`, `jira_transition_issue`, `jira_delete_issue`, `confluence_create_page`, `confluence_update_page`, `confluence_add_comment`, `confluence_delete_page`, `jtmf_create_test_case`, `jtmf_update_test_case`, `jtmf_delete_test_case`) defaults to `dryRun: true` — always preview the payload/deletion and get explicit user confirmation before setting `dryRun: false`. GitHub auth is a single `GITHUB_TOKEN` (PAT/App token); `GITHUB_ORG` scopes searches to your org by default when a call doesn't name its own `org`/`repo`, and `GITHUB_API_BASE_URL` targets GitHub Enterprise Server instead of github.com. All `github_*` tools are read-only.

### Searching across sources
The `search-across-sources` skill federates `jira_search` + `confluence_search` +
`jtmf_search_tests` + `github_search_code`/`github_search_repos`/`github_search_issues`/
`github_search_commits` for topic-based requests ("find everything on X", "what are
the sources for X") and consolidates results into one linked **Sources** list, using
`confluence_extract_links`/`github_get_file` to pull in connecting sources.

### Saving pulled data locally
`confluence_save_page` and `jira_save_issue` pull a page/issue to disk (`downloads/confluence/<project>/...`, `downloads/jira/<project>/...`). If `project` is omitted, nothing is written — the tool returns a suggested folder name (e.g. `PROJ-XXX`, derived from the space/issue key) so the agent can ask the user to confirm or override it before saving. `confluence_get_page` and `confluence_save_page` also expand accordion/expand/tabs macros into a readable nested outline (`format: "structured"` / `page.structured.txt`) instead of flattening them away, and can return the raw storage HTML (`format: "html"` / `page.html`) for pages with rich layout.

### Media utilities
The `media` server lets agents read and generate non-text-file content:
- `get_file_metadata` — size, detected MIME type, and type-specific details (image width/height, PDF page count/info, DOCX word count) as JSON, ready to feed to Copilot as context.
- `read_pdf_text` / `read_docx_text` — extract text from local PDFs/DOCX files.
- `create_pdf` / `create_docx` — generate a styled PDF or DOCX report from a title + sections (heading/body), with an optional accent color for PDFs.


## Project manifest

`projects.manifest.json` declares every target project this framework can operate on:

```json
{
  "projects": [
    {
      "name": "sample",
      "repoPath": "fixtures/sample-target-repo",
      "repoUrl": null,
      "branch": null,
      "testPaths": { "features": "tests/features", "steps": "tests/steps", "pages": "tests/pages", "support": "tests/support" },
      "jira": { "projectKey": "ABC", "defaultJql": "project = ABC ORDER BY created DESC" },
      "confluence": { "spaceKey": "ABC" },
      "jtmf": { "projectId": "ABC", "testPlanId": null },
      "execution": { "mode": "local" }
    }
  ]
}
```

- Either `repoPath` (a local checkout) or `repoUrl` (cloned on demand into `.workspaces/<name>/`) must be set.
- `execution.mode` is `"local"` by default; `"browserstack"` is only set if a project already has BrowserStack configured (see the `detect-execution-convention` skill) — never introduced automatically.
- Loaded and validated by `utils/manifest.ts` (zod); this is the only trust boundary for which directory a tool/task may touch.

## Agent workflow

1. **orchestrator** resolves the target `project` and decomposes/delegates work.
2. **researcher** pulls epics/tickets/docs, plus manual/image/video inputs via extraction skills -> research brief.
3. **test-planner** -> risk-based plan + Gherkin, every scenario cited, scaffolded into the target project via `codegen`.
4. **automation** implements features/steps/pages in the target project, running `detect-execution-convention` before execution.
5. **reporter** runs suites async and classifies failures from Allure results (via `allure-report`); can write back to Jira/JTMF (dry-run first).
6. **self-improve** persists learnings to `knowledge/` and proposes framework upgrades — every session.

## Skills

`skills/*/SKILL.md` — reusable playbooks composing existing MCP tools: `analyze-test-failures`, `detect-execution-convention`, `upload-to-jtmf`, `update-jira-epic`, `extract-requirements-from-image`, `extract-requirements-from-video`, `consolidate-project-report`, `build-test-plan-interactive`.

## Extending

- **New MCP tool**: add `server.registerTool(...)` in `mcp-servers/*/index.ts` (reuse `mcp-servers/shared/`); take a `project` argument and resolve via `utils/manifest.ts` if it touches a target repo.
- **New MCP server**: new folder + `startMcpHttpServer(...)`, register port in `.vscode/mcp.json`, `.env.example`, and a `serve:` script.
- **New async task type**: add a handler in `agents/registry.ts`.
- **New agent**: add `.github/agents/<name>.agent.md`.
- **New skill**: add `skills/<name>/SKILL.md` — no new I/O, only composes existing tools.

## Known limitations

- Only Playwright + TypeScript + Cucumber target projects are currently supported for `codegen`/`playwright-runner` scaffolding and execution. Other automation stacks are out of scope until requested.
- Requirement extraction from images/video currently relies on native vision capability or manually supplied transcripts — no dedicated OCR/speech-to-text MCP tool exists yet (tracked in `knowledge/learnings.md`).
