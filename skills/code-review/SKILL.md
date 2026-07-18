---
name: code-review
description: Review a target project's pending diff for correctness bugs and reuse/simplification/efficiency cleanups, at a chosen effort level (low: fast, high-confidence only; high: broader multi-angle coverage, may include less-certain findings). Use before finishing an automation/documenter task that changed code in a target project, or whenever the user asks to "review" a diff/branch/PR. Skip for a diff that's just generated boilerplate (e.g. a single scaffolded feature file with no hand-edits) — nothing to review yet.
---
# Code review

Reviews the pending diff in a manifest-resolved **project** (never `revab-agents` itself — this
skill reviews target-repo changes). Two effort levels; pick `low` for a quick pass, `high` for
deeper coverage. Uses the `git` MCP server's `git_diff`/`git_log`, never a bare shell diff.

## Phase 0 — Gather the diff
- Resolve `project`; get the diff via `git_diff` (base: the project's default/upstream branch,
  or a ref the user names) plus `git_log` for the commit list. If there are uncommitted changes
  in the working tree, include those too — review often runs before a commit.
- If a PR/branch/path was named, scope to that instead of the whole history.

## Phase 1 — Find candidates
Work through these angles (all of them at `high`, just the first three at `low`):
- **Line-by-line scan**: for every changed line, what input/state/timing makes it wrong?
  Inverted conditions, off-by-one, null/undefined access, swallowed errors, wrong-variable
  copy-paste.
- **Removed-behavior check**: for every deleted/replaced line, what invariant did it enforce —
  is it re-established elsewhere in the diff, or just gone?
- **Cross-file tracer**: for each changed function, do its callers still hold (new
  precondition, changed return shape, new exception)?
- **Reuse** *(high only)*: does the diff reimplement something the target repo (or
  `revab-agents`' own `utils/`) already has?
- **Simplification** *(high only)*: redundant state, copy-paste-with-a-twist, dead code,
  unnecessary nesting — name the simpler form.
- **Efficiency** *(high only)*: redundant computation/I/O, sequential calls that could run in
  parallel, blocking work on a hot path.
- **Conventions** *(high only)*: check the diff against the target project's own lint/style
  config and any `CONTRIBUTING.md`/style doc it has, plus
  `.github/instructions/playwright-bdd.instructions.md` when the diff touches BDD code — only
  flag a violation you can quote (exact rule + exact line).

Each candidate needs `file`, `line`, a one-line `summary`, and a concrete `failure_scenario`
(what input/state makes it actually break) — not a vague "could be an issue".

## Phase 2 — Verify
Drop a candidate only when you can show it's already handled in the diff, factually wrong, or
provably impossible — not for being merely "depends on runtime state" when that state is
realistic (a rare-but-reachable error path, a race, a boundary the code doesn't exclude). Keep
everything else. Correctness findings always outrank cleanup/convention findings when trimming
to the cap (10 at `high`, 4 at `low`).

## Output
Findings-first, ranked most-severe first, each as `file:line — summary — failure_scenario`.
Group correctness findings above cleanup/convention findings. If nothing survives, say so
explicitly — don't pad the report with style nits to look thorough.

## Rules
- This skill only reports findings — it doesn't edit code (the `automation` agent applies any
  resulting fix and re-verifies it via the `verify` skill).
- Never review `revab-agents`' own code as if it were the target project (hard rule 7).
- A citation-worthy convention violation must quote the actual rule; no vague "style" calls.
