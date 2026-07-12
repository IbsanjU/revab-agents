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

### 2026-07-09
- Self-review follow-up: framework now has real tests. `npm test` runs Node's built-in test runner (`node --import tsx --test`) over `utils/manifest.test.ts`, `orchestrator/queue.test.ts`, and `scripts/check-conventions.test.ts` (27 tests). Tests use env-var overrides (`MANIFEST_PATH_OVERRIDE`, `QUEUE_ROOT_DIR`) + cache-busted dynamic imports to isolate module state per test.
- `orchestrator/queue.ts` now has crash-recovery: `reclaimStale(staleMs)` requeues tasks stuck in `running` past a threshold (default 10min), tracked via `task.reclaimCount`; after `MAX_RECLAIMS` (3) it moves the task to `failed` instead of looping forever. Worker sweeps every `WORKER_STALE_SWEEP_MS` (default 60s); `npm run task -- reclaim [staleMs]` triggers it manually.
- Fixed a real pre-existing bug found while testing: `enqueue()` task ids could collide/misorder within the same millisecond (relied on `Date.now()-randomUUID` string sort for FIFO). Now includes a monotonic per-process sequence number in the id.
- Hardened `agents/registry.ts`'s `import-agents` handler: `payload.source` is now checked against a shell-metacharacter denylist and must resolve to an existing directory before being passed to `execCommand("npm", ...)` (which uses `spawn(..., { shell: true })` — argv entries there are not immune to injection).
- Added `npm run check:conventions` (`scripts/check-conventions.ts`): validates every `skills/*/SKILL.md` frontmatter (`name` matches dir, non-empty `description`) and that every `agents/registry.ts` handler calling `resolveProjectRepoPath(...)` first guards on `payload.project`.
- Added `npm run knowledge:rotate` (`scripts/rotate-learnings.ts`): archives all-but-current-month dated entries from `knowledge/learnings.md` into `knowledge/learnings/<YYYY-MM>.md` once the main file exceeds ~8KB; no-op below that threshold.
- Deferred: a dedicated OCR/speech-to-text MCP server (still the biggest documented capability gap) — not built this pass, flagged as the highest-leverage next server if image/video requirement extraction becomes a frequent real workflow.

### 2026-07-12
- Hardening pass landed: shared HTTP-server helper hardening, `knowledge_search` artifacts tool, docs-drift lint in `check:conventions` (every registered MCP tool name must appear in both `README.md` and `knowledge/memory.md`; every server dir must be in `.vscode/mcp.json`), and a CI workflow (`.github/workflows/ci.yml`: typecheck + test + check:conventions) with explicit least-privilege `permissions`.
- CodeQL findings fixed and verified clean: `utils/diagramParse.ts` entity decoding rewritten as a single-pass regex replace (avoids double-decoding/incomplete-sanitization class of bugs); CI workflow given explicit `permissions` block.
- Full validation green on this branch: `npm run typecheck`, `npm test` (57 tests), `npm run check:conventions`, CodeQL (0 alerts).

### 2026-07-11
- Removed `fixtures/sample-target-repo/` entirely — this is a generic agent framework meant to operate on any external target project or standalone, not something that needs a bundled sample project to demonstrate itself. `projects.manifest.json` now ships a `my-project` placeholder entry (`repoPath`/`repoUrl` both to be filled in by the adopter) since the schema requires at least one project. Updated `README.md`, `.github/copilot-instructions.md`, `agents/registry.ts` payload examples, and `knowledge/memory.md` accordingly.

### 2026-07-12 (prompt-pattern hardening)
- Adopted production-prompt patterns (as patterns only — no external prompt text copied): every `skills/*/SKILL.md` now has a fixed **Output** contract section; `.github/copilot-instructions.md` gained Good/Bad example pairs for hard rules #8/#9/#10 and a shared **Agent conduct** section (tool discipline, when-blocked escalation template, verbosity calibration, executing-agent completion checklist, anti-hallucination anchors, memory hygiene, per-agent can/cannot/must-not boundaries).
- Deferred: propagating/echoing the shared Agent conduct sections into the individual `.github/agents/*.agent.md` personas — the cloud execution environment cannot access that directory; do this in a local session if per-persona tightening is wanted. Plan: `knowledge/plans/framework/2026-07-12-prompt-pattern-hardening.md`.
- Follow-up landed: `npm run agents:conduct` (`scripts/apply-agent-conduct.ts`) appends the per-persona Conduct/Boundaries sections (plus completion checklist / when-blocked / anti-hallucination / memory-hygiene / verbosity blocks where applicable) into `.github/agents/*.agent.md`. Idempotent via a `<!-- shared-conduct:v1 -->` marker; `--dry-run` previews. Run it locally once — the cloud agent cannot write into `.github/agents/`.
