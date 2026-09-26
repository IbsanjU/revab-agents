---
name: onboard-project
description: Bootstrap a brand-new target project's manifest entry and initial app-model — analyze the repo for its test paths, build/lint commands, and high-level architecture, then draft `projects/<name>/project.json` and a starter app-model for user review. Use when the user asks to add a new project to the framework, or points at a repo that isn't in the manifest yet. Skip for a project that's already in `projects/manifest.json` — use `structure-project-data` to refresh its app-model instead.
---
# Onboard project

Turns "here's a new repo, set it up" into a reviewable draft instead of a blind write — the
manifest is the framework's trust boundary (hard rule 8), so nothing here is saved without the
user confirming it.

## Steps
1. **Locate the repo**: a local `repoPath` or a `repoUrl` the user gives (never invent one).
2. **Detect test conventions**: run `codegen`'s `detect_conventions` against the path to confirm
   it's a supported Playwright/TypeScript/Cucumber project and to read its existing
   `testPaths`/script names — don't guess a `tests/` layout.
3. **Detect execution convention**: run the `detect-execution-convention` skill (BrowserStack or
   local — never assume, hard rule 11).
4. **Find the high-level architecture** — read the repo's own `README`, its build/lint/test
   commands (`package.json` scripts or equivalent), and skim the top-level directory structure
   via `git_log`/`git_show`. Focus on the "why", not an exhaustive file list — don't repeat
   what's already obvious from the file tree, and don't invent sections ("Common Tasks",
   "Tips") that nothing in the repo actually supports.
5. **Draft `project.json`**: `name`, `repoPath`/`repoUrl`, `testPaths`, and — if the user
   supplies them — `jira`/`confluence`/`jtmf` ids. Leave `execution.mode` as `local` unless
   step 3 found BrowserStack already configured.
6. **Draft a starter app-model**: a short `projects/<name>/app-model.md` covering the
   architecture and testing conventions found in steps 2-4 — every line cited to the file/
   command that showed it (hard rule 9 — citation required). Thin is fine; fabricated is not.
7. **Present both drafts** to the user for approval before writing anything — this is
   multi-step, project-defining work, so route it through the planner first if the user hasn't
   already approved a plan (hard rule 13).
8. On approval: add the entry to `projects/manifest.json`, write `projects/<name>/project.json`
   and `projects/<name>/app-model.md`.

## Output
Respond with exactly these sections, in this order:
1. **Detection summary** — what `detect_conventions`/`detect-execution-convention` actually found (stack, testPaths, execution mode), with the evidence files named.
2. **Draft project.json** — the exact JSON the user is approving.
3. **Draft app-model** — the starter `projects/<name>/app-model.md` content, every line cited.
4. **Confirmation status** — awaiting approval / approved / declined.
5. **Result** — after approval: the files written (manifest entry, project.json, app-model.md).

## Rules
- Never write to `projects/manifest.json` before the user approves the drafted `project.json`.
- Don't list obvious file-tree structure or generic development advice in the app-model — only
  what took reading multiple files to figure out.
- If an existing `CONTRIBUTING.md`/style doc/CI config documents conventions, fold the
  important parts into the app-model instead of leaving the user to find them separately.
