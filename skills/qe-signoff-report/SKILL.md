---
name: qe-signoff-report
description: Produce an end-of-phase QE sign-off or test summary report from results, defects and evidence - scope tested, results, open defects, what was not tested and why, exit criteria, risks, recommendation. Use at the end of SIT, E2E, UAT, PAT or regression when the user needs a sign-off document or go/no-go input. Skip for a mid-cycle status update, and for a live release-readiness check (use ship).
---
# QE sign-off report

The document a person signs. It recommends; it never signs, and it never hides what was not tested.

**Relation to `ship`:** `ship` decides "can we release?" from live evidence (commits, tickets, Allure results). This skill writes the formal end-of-phase document from the phase's results. When both are asked for, run `ship` first and reuse its evidence.

## Inputs
Ask for whatever is missing; do not fill gaps from memory.
- Test phase, environment, dates, build or release version
- Planned scope (test plan, coverage matrix or test case list)
- Execution results (passed, failed, blocked, not run). If the project has Allure results, read them with `allure_summary` and say how old they are
- Defects (ID, severity, status, owner). If the project is in Jira, `jira_search` can list them; cite the JQL
- Evidence location
- Workarounds and known limitations
- Entry and exit criteria, if defined

## Steps
1. **Reconcile scope and results.** Every planned item is one of: passed, failed, blocked, not run, descoped. Nothing unaccounted for.
2. **Compute the numbers** from the data given. Run the arithmetic and show that planned = passed + failed + blocked + not run + descoped for each row. Never estimate.
3. **Classify open defects** by severity and whether each blocks sign-off.
4. **List what was not tested** and why (blocked, descoped, environment, data, time), with who accepted it if known.
5. **Check exit criteria** one by one: met, not met, or cannot be evidenced.
6. **State the recommendation** by the rule below.

## Recommendation rule
- `Sign-off`: every required exit criterion is met and evidenced, and no open defect blocks.
- `Sign-off with conditions`: every required criterion is evidenced; anything unmet or untested is listed and **accepted by a named role**; the conditions are stated.
- `No sign-off`: any required criterion not met or cannot be evidenced, or any blocking defect open.
A criterion that cannot be evidenced is `Unknown`, and `Unknown` never counts as a pass.

## Output
1. **Recommendation** - one line, with the conditions.
2. **Missing data** - at the top, if any: what you needed and did not get.
3. **Scope** - phase, environment, dates, version, what was in scope.
4. **Results** - table: area, planned, passed, failed, blocked, not run, descoped, source.
5. **Open defects** - table: ID, severity, summary, owner, blocks sign-off (yes / no).
6. **Not tested** - item, reason, accepted by.
7. **Workarounds and limitations** - item, workaround, as-of date.
8. **Exit criteria** - criterion, status, evidence.
9. **Risks carried forward** - one line each.
10. **Sign-off table** - test type, environment, signing role, date (blank until signed).

## Rules
- Cite the source of every figure (Allure result ids, Jira keys or JQL, file and line, or "provided by the user").
- Use the project's own terms, IDs and acronyms. Roles, not personal names, unless asked.
- Phrases and tables, not paragraphs.
- Never hide a failed or untested item. If the data is incomplete, say what is missing at the top.
- The report recommends; a person signs. Do not state that sign-off was given unless the user says so.
- Posting to Jira or Confluence is a separate step: dryRun first, and only on request.
