---
name: analyze-test-failures
description: Analyze failed BDD runs using Allure results — classify failures as product bug, test bug, environment, or data issues, and propose fixes. Use when tests fail, when asked "why did the run fail", or after a regression run completes. Supports an optional depth: "quick" (default, single-pass classification) or "thorough" (adversarially re-checks each candidate classification before reporting it).
---
# Analyze test failures

## Steps
1. Get the summary: call the artifacts MCP tool `allure_summary` (or read reports/allure-results/*-result.json directly for stack traces).
2. For each failure, gather: scenario name, failing step, error message, stack trace, screenshot attachment if present.
3. Classify with evidence:
   - **Product bug** — app behavior contradicts the acceptance criteria (cross-check the Jira ticket via `jira_get_issue`).
   - **Test bug** — bad locator, race condition, stale assertion, data coupling between scenarios.
   - **Environment** — connection refused, 5xx, missing test data, auth expiry.
   - **Data** — assertion on values that legitimately changed.
4. For test bugs, propose the concrete code fix (locator strategy, web-first assertion, isolation).
5. For repeat offenders, check knowledge/learnings.md history; record new flaky tests there.
6. Output the reporter-format table: scenario | classification | root cause | suggested fix/owner.
7. **Thorough mode only** (when asked for a deeper pass, or classifications disagree with a cited
   acceptance criterion): treat step 3's classification as a *candidate*, then run one adversarial
   re-check per candidate — actively try to disprove it against the evidence (stack trace, Jira AC,
   prior flaky history) before accepting it. Only report a classification that survives that check;
   otherwise mark it "uncertain" and say what additional evidence would resolve it.

## Output
Respond with exactly these sections, in this order, no preamble:
1. **Run summary** — one line: project, total/passed/failed counts, Allure run id.
2. **Failure table** — `scenario | classification (product bug/test bug/environment/data) | root cause | suggested fix/owner`, one row per failure.
3. **Repeat offenders** — scenarios already recorded as flaky in `knowledge/learnings.md`, or "None".
4. **Citations** — Allure result ids and any Jira keys cross-checked, one per line.

## Anti-patterns to reject
- Adding retries or sleeps to mask flakiness.
- Marking failures as "flaky" without two observed alternating outcomes.
- Watching only for a success marker in run output/status — a hang, crash, or unexpected exit
  looks identical to "still running" if you only grep for the happy path. Any status check must
  cover every terminal state (passed/failed/broken/cancelled/timeout), not just the pass marker.
