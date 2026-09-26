---
name: verify
description: Verify that a change in a target project actually works by running it and observing real behavior — not by re-running its own test suite. Use after automation implements or fixes something, before declaring the task done. Skip when there's no runtime surface to drive (docs-only change, type-only change with no behavioral diff) — say so instead of running tests to fill the gap.
---
# Verify

Verification is runtime observation: run the target project, drive it to where the changed
code executes, and capture what you actually see. That capture is the evidence — not "the
tests pass," not "the code looks right from reading it."

## Rules
- **Don't just run the test suite and call it verification.** Running tests proves the suite
  passes, not that the feature works end-to-end. Run the scenario/tag the change actually
  affects (`playwright-runner`'s `run_bdd`/`run_playwright`), then go further: drive the same
  flow the way a user would (through the UI/API), not just through the automated steps.
- **Find the surface.** A changed page-object method's surface isn't its return value — it's
  the scenario that exercises it end-to-end. A changed step definition's surface is the
  feature file that calls it. Trace inward from the diff to the actual user-facing flow.
- **No repo/no runtime surface** → say so and stop; don't fabricate a verification.

## Steps
1. Get the diff (`git_diff`/`git_log` on the manifest-resolved project) — this is the scope.
2. Identify the surface: which scenario/tag/page reaches the changed code.
3. Run it (`run_bdd`/`run_playwright`, tag-scoped to the change) and capture the actual result
   (`allure_summary`/`get_result_json`) — not just exit code, the real assertion output.
4. **Push on it**: once the happy path passes, try one adjacent case the change didn't
   explicitly target (an empty/boundary value, a repeated action, an unexpected order) — this
   is what a careful human reviewer would try next, and it's where regressions hide.
5. Report the verdict (PASS/FAIL/BLOCKED/SKIP) plus what was actually observed — a PASS with a
   sharp "noticed X while driving it" note is worth more than a bare PASS.

## Output
- **Verdict**: PASS / FAIL / BLOCKED / SKIP (with the skip reason if applicable).
- **What was run**: the exact scenario/tag/command.
- **Observed**: the real output — Allure summary, assertion text, or screenshot reference.
- **Pushed on**: the one adjacent case tried beyond the happy path, and what happened.
