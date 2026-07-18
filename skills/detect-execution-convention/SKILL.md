---
name: detect-execution-convention
description: Decide how a target project's tests should execute (local Playwright, BrowserStack, or a custom convention) — BrowserStack only if already present in that repo. Use before any run_bdd/run_playwright call, and whenever a project's manifest entry has no execution.mode set. SKIP inferring BrowserStack from the repo's name, org, or an org-wide convention alone — only trust config/deps actually detected by detect_conventions.
---
# Detect execution convention

BrowserStack (or any other cloud/mobile grid) must never be introduced into a target
project just because it's supported by this framework. It is only used if the target
repo already has it configured.

## Steps
1. Call the `codegen` MCP tool `detect_conventions` for the project. It reports:
   `playwrightVersion`, `cucumberVersion`, `hasAllure`, `browserstackDetected`, `scripts`.
2. If `browserstackDetected` is true:
   - Set that project's manifest `execution.mode = "browserstack"`.
   - Reuse the target repo's own BrowserStack config/credentials convention (its own
     `.env`/CI secrets, `browserstack.yml`, or Playwright project config) — never
     hardcode or invent new BrowserStack credentials in `revab-agents`.
3. If `browserstackDetected` is false:
   - Do **not** propose or scaffold BrowserStack.
   - Check the manifest's `execution.customConvention` field first.
   - If still unset, ask the user one targeted question: "This project has no
     BrowserStack setup — should tests run with local Playwright browsers, an
     existing grid/provider already used by this repo, or something else?"
   - Persist the answer into `execution.mode`/`execution.customConvention` in
     `projects.manifest.json` so future runs don't re-ask.
4. Record the decision (and evidence) in `knowledge/learnings.md` via `knowledge_append`,
   scoped per project, so the `reporter` and `automation` agents don't re-detect every run.

## Output
Respond with exactly these sections, in this order:
1. **Decision** — one line: `execution.mode` chosen (`local` | `browserstack` | `custom`) for the project.
2. **Evidence** — the files/deps `detect_conventions` actually found (versions, config files), never assumptions.
3. **Manifest change** — the exact `execution` field values persisted (or the one targeted question asked if unresolved).
4. **Recorded** — the `knowledge/learnings.md` entry appended for this decision.

## Rules
- Never add BrowserStack devDependencies/config to a target repo that doesn't already have them, even if asked to "add mobile testing" — clarify with the user first per step 3.
- Detection evidence (which files/deps were found) must be stated, not assumed.
- SKIP: don't infer BrowserStack from the org's general habits, a similarly-named sibling project, or "most of our projects use it" — only `detect_conventions`'s actual findings for *this* repo count as evidence.

## Verification surface (which observation actually counts as "it works")
Running the BDD/Playwright suite proves the test passed — not that the underlying feature behaves correctly end to end. Match the target project's surface to what counts as real evidence before declaring a scenario verified:

| Surface | What counts as verified | What doesn't |
|---|---|---|
| Web UI | An observed browser interaction/assertion (via Playwright's own actions, or the official `playwright` MCP server) | Only a green Cucumber run with no observed UI state |
| API/service | An actual request/response captured (status code, body) | Only a passing assertion on a mocked/stubbed client |
| CLI | Captured stdout/exit code from an actual invocation | Only reading the CLI's source to infer behavior |

Cite which kind of evidence backed a "passing" verdict when reporting results — this reinforces the shared **Faithful reporting** rule.
