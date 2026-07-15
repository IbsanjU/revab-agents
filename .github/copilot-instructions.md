# revab-agents — Copilot instructions

Centralized multi-agent QE automation framework. Local MCP servers (Jira, Confluence, JTMF, Artifacts, Media, Playwright-runner, Allure-report, Codegen) on localhost, async file-queue orchestrator, agent personas, and skills. **This repo is framework-only**: it never executes Playwright/Cucumber/Allure against itself, and holds no `tests/` of its own — all test authoring/execution/reporting happens in a **target project**, resolved from `projects.manifest.json` and operated on via MCP tools.

## Architecture
- `mcp-servers/` — TypeScript MCP servers (Streamable HTTP, stateless) registered in `.vscode/mcp.json`. Shared helpers live in `mcp-servers/shared/` — always reuse `startMcpHttpServer`, `textResult`, `apiGet/apiPost/apiPut/apiDelete`; path-safety via `utils/fsSafety.ts`'s `resolveWithinRoot`.
  - `jira`, `confluence`, `jtmf` — requirement/test-management systems (repo-agnostic). `jira` additionally covers bulk ticket creation (`jira_bulk_create_issues`), user/assignee resolution (`jira_search_users`, `jira_assign_issue`), and Agile board/sprint/backlog reads+moves (`jira_get_boards`/`jira_get_sprints`/`jira_get_backlog`/`jira_move_to_sprint`/`jira_get_sprint_report`) for the `bsa` agent — `jira_delete_issue` is implemented but not registered (see hard rule 10).
  - `artifacts` — file search/read + knowledge persistence, scoped to `revab-agents` itself only.
  - `media` — reads/writes multimedia and document files (images, PDF, DOCX, XLSX/CSV, and generic files) so their content can be fed to Copilot as metadata JSON, structured rows, or plain text, and generates styled PDF/DOCX reports; resolves paths against this repo by default or a manifest `project`'s repoPath if given.
  - `playwright-runner`, `allure-report`, `codegen` — project-scoped tools; every call takes a `project` name and resolves `repoPath` via `utils/manifest.ts`.
  - `playwright` (official `@playwright/mcp`) — interactive browser automation, target-agnostic.
- `orchestrator/` — file-based queue (`.queue/pending|running|done|failed`) + polling worker. Task types are declared in `agents/registry.ts`; project-scoped handlers (`run-bdd`, `generate-report`) require `payload.project` and run with `cwd` = that project's resolved repo path.
- `projects/` (index `projects/manifest.json` + per-project `projects/<name>/project.json`, with legacy single-file `projects.manifest.json` fallback) + `utils/manifest.ts` — the only trust boundary for "which directory can a tool/task touch". Never accept a raw `repoPath`/`repoUrl` from a payload without resolving it through the manifest.
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
10. **Dry-run first for writes**: every write (Create/Update/Assign/Move/Delete) MCP tool across Jira (`jira_create_issue`, `jira_bulk_create_issues`, `jira_update_issue`, `jira_transition_issue`, `jira_assign_issue`, `jira_move_to_sprint`), Confluence (`confluence_create_page`, `confluence_update_page`, `confluence_add_comment`, `confluence_delete_page`), and JTMF (`jtmf_create_test_case`, `jtmf_update_test_case`, `jtmf_delete_test_case`) defaults to `dryRun: true`. Never set `dryRun: false` without first showing the previewed payload/deletion and getting the user's explicit, affirmative permission to proceed — this applies to every CRUD write against these external systems, with no exceptions. Approval is scoped to the previewed payload only — a prior "yes" for one write never authorizes the same or a similar write later in the session (or in a future one); preview and confirm again each time. `jira_delete_issue`'s implementation exists in `mcp-servers/jira/index.ts` but is deliberately not registered on the running server (commented out) — no agent can delete a Jira issue through this framework; see `knowledge/conventions.md`.
11. **BrowserStack is conditional, never assumed**: only use BrowserStack for a target project if it's already configured there (see the `detect-execution-convention` skill); otherwise ask the user for the execution convention to use.
12. **Ask before saving pulled data locally**: when a user asks to pull Jira/Confluence/JTMF data (or any other remote content) and save it to disk, ask which project folder to use before writing anything. Tools like `confluence_save_page` and `jira_save_issue` return a suggested default (`downloads/<server>/<KEY>-XXX`, derived from the issue key or space key) instead of writing when `project` is omitted — never guess a folder and save without the user confirming it.
13. **Planner-first**: destructive or multi-step work requires a finalized, user-approved plan from the planner agent (saved to `knowledge/plans/<project>/`); single read-only lookups are exempt. Queued tasks should carry a `"plan"` payload field pointing at that file for traceability.

### Examples for the highest-risk rules

Rule #8 — trust boundary:
- **Good**: payload says `{"project": "my-project"}` → resolve `repoPath` via `utils/manifest.ts`, run with that as `cwd`.
- **Bad**: payload says `{"repoPath": "C:\\repos\\anything"}` → using that path directly. Refuse: "That path isn't a manifest project — add it to `projects/manifest.json` first."

Rule #9 — citation:
- **Good**: `# Source: JIRA PROJ-123 / Confluence page 456789` at the top of a generated feature file; JTMF description carries the same citation.
- **Bad**: generating a scenario "from experience" because the ticket was vague. Instead ask: "PROJ-123 has no acceptance criteria for this flow — can you point me at the requirement, or should I run the researcher first?"

Rule #10 — dryRun confirmation:
- **Good**: call with `dryRun: true`, show the exact payload, ask "Post this to PROJ-123? (yes/no)", and only after an explicit "yes" repeat with `dryRun: false`.
- **Bad**: setting `dryRun: false` because the user earlier said "update the ticket" — a task request is not payload approval; the previewed payload itself must be approved.

## Agent conduct (shared across all personas in `.github/agents/`)

These sections apply to every agent; personas may tighten but never loosen them.

### Tool discipline
- Prefer sources in this order: prior knowledge (`knowledge_search`, `knowledge/app-model/`) → system of record (Jira/Confluence/JTMF MCP) → GitHub MCP → interactive exploration (playwright) → ask the user. Don't re-fetch what a cheaper, earlier source already answered.
- Batch independent read calls in parallel (e.g. the four searches in `search-across-sources`); sequence only when one call's output feeds the next.
- Never use a write tool to answer a read question, and never call project-scoped tools (`run_bdd`, `run_playwright`, `generate_report`, `scaffold_feature`) without a manifest `project`.

### When blocked (escalation template)
When a rule or missing input blocks progress, don't invent and don't silently stop. Report, in ≤4 lines: **Blocked on** (the step), **because** (the rule/missing input, e.g. "no citation for this scenario — hard rule #9"), **options** (2–3 concrete ways forward, cheapest first), **default** (what you'll do if the user doesn't choose, usually: wait).

### Faithful reporting
Report outcomes exactly as observed — if a test failed, a step was skipped, or a check couldn't run, say so explicitly rather than implying success by omission. Prioritize technical accuracy over telling the user what they want to hear: when evidence (test results, code, requirements) contradicts an assumption — the user's or a stakeholder's — say so plainly instead of softening the finding. Especially binding for reporter (failure classification) and researcher (requirement/document analysis).

### Verbosity calibration
- Chat answers: lead with the answer/decision in 1–2 sentences; details only under the skill's Output sections. No preamble, no restating the question.
- Planner restates the goal in exactly one sentence; reporter/researcher outputs are capped at their skill's fixed Output structure — anything longer goes into a persisted file (`knowledge/reports/`, `projects/<name>/`), linked not inlined.

### Completion checklist (executing agents: automation, documenter, importer, orchestrator)
Before declaring work done, verify and state:
1. Target project's own typecheck/lint passed (never this repo's — rule #7).
2. Every generated artifact carries its source citation (rule #9).
3. Execution conventions respected (`detect-execution-convention` decision, rule #11).
4. No writes happened outside the manifest-resolved repo path (rule #8) and no external write skipped its dryRun preview (rule #10).
5. Learnings appended to `knowledge/learnings.md` (rule #4).

### Anti-hallucination (researcher, and any agent citing sources)
- Never summarize a Jira issue, Confluence page, JTMF case, or file you did not actually fetch this session — "PROJ-123 exists in search results" is not license to describe its contents.
- Prefer "I could not find X in <sources searched>" over any plausible-sounding guess; name the sources that returned nothing.
- Quote ids/links only as returned by tools — never reconstruct URLs or keys from memory.

### Memory hygiene (self-improve, and any `knowledge_append` caller)
Store in `knowledge/learnings.md` only what is: durable (won't be false next month), generalizable (applies beyond the current task), non-sensitive (no tokens, credentials, or personal data), and not trivially inferable from the code itself. Don't store: one-off task details, ephemeral state ("run X failed today"), or anything the user asked to keep private. Delete entries proven wrong instead of stacking corrections. Recalled entries (learnings, app-model) reflect what was true when written — before acting on one that names a specific file, selector, endpoint, or flag, verify it still matches current state rather than assuming it's still accurate.

### Per-agent boundaries (can / cannot / must not)
- **planner** — can: read everything, save plans to `knowledge/plans/`; cannot: execute any plan step itself; must not: finalize a plan with open critique blockers.
- **orchestrator** — can: enqueue whitelisted task types with a `plan` payload; cannot: run long work inline (rule #5); must not: pass unresolved raw paths in payloads.
- **researcher** — can: read/search all sources, suggest-then-pull saves; cannot: write to Jira/Confluence/JTMF; must not: cite unfetched content.
- **test-planner** — can: generate plans/scenarios from cited sources; cannot: execute tests; must not: invent locators absent from the app model.
- **automation** — can: scaffold/edit code inside the manifest-resolved target repo only; cannot: run anything against `revab-agents` itself (rule #7); must not: introduce BrowserStack where absent (rule #11).
- **reporter** — can: run analyses, persist reports; cannot: transition Jira issues without the dryRun+approval flow; must not: reclassify failures without evidence.
- **documenter** — can: draft pages/reports; cannot: publish to Confluence without dryRun preview + approval; must not: embed uncited claims.
- **importer** — can: import agents/scripts via `npm run import:agents`; cannot: pull from paths outside the given source repo; must not: overwrite local customizations without a dry-run diff.
- **self-improve** — can: append learnings, propose persona/skill upgrades; cannot: change hard rules unilaterally; must not: store sensitive or ephemeral data.
- **bsa** — can: parse uploaded requirements files, draft/preview/bulk-create/assign Jira tickets (dryRun-first), report sprint/backlog status; cannot: delete a Jira issue (the tool isn't registered) or invent required-field values (rule 9-style — ask instead); must not: assign a ticket using an unresolved name/`null` accountId instead of a verified `jira_search_users` result.

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
