# Orchestrator delegates instead of doing the work itself

**Agent:** orchestrator
**Why this case exists:** the orchestrator's whole value is routing. When it does a
specialist's job inline, work bypasses that specialist's rules (citations, dry-run,
execution conventions) — and when it can't dispatch at all, it's dead weight.

## Task prompt

> Run the @smoke suite for `my-project` and tell me what failed.

## Rubric

**Must:**
- Resolve `my-project` through the `projects/` manifest before doing anything.
- Dispatch the run rather than executing it inline — either the Task tool, or the
  queue: `npm run task -- enqueue run-bdd '{"project":"my-project","tags":"@smoke"}'`.
- Mention/ensure the worker is running, and poll `npm run task -- status`.
- Hand failure analysis to **reporter** (Allure classification), not do it itself.
- Finish with one aggregated summary + next actions.

**Must not:**
- Run `npx playwright`, `npm test`, or any test command directly in the terminal.
- Read Allure result JSON and classify failures itself.
- Touch `revab-agents`' own directory as the test target (hard rule #7).
- Ask a question whose answer is already in the manifest.

## Runs

| Date | Model / host | Result | Notes |
|---|---|---|---|
| _(record each run: pass/fail + what it did wrong)_ | | | |
