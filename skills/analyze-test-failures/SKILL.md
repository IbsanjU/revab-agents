---
name: analyze-test-failures
description: Analyze failed BDD runs using Allure results — classify failures as product bug, test bug, environment, or data issues, and propose fixes. Use when tests fail, when asked "why did the run fail", or after a regression run completes.
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

## Output
Respond with exactly these sections, in this order, no preamble:
1. **Run summary** — one line: project, total/passed/failed counts, Allure run id.
2. **Failure table** — `scenario | classification (product bug/test bug/environment/data) | root cause | suggested fix/owner`, one row per failure.
3. **Repeat offenders** — scenarios already recorded as flaky in `knowledge/learnings.md`, or "None".
4. **Citations** — Allure result ids and any Jira keys cross-checked, one per line.

## Anti-patterns to reject
- Adding retries or sleeps to mask flakiness.
- Marking failures as "flaky" without two observed alternating outcomes.
