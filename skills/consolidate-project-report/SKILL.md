---
name: consolidate-project-report
description: Produce one consolidated, traceable report for a project spanning Jira tickets/epics, Confluence HLRs, JTMF test cases, and the latest execution results. Use after a test run completes, or whenever asked for a project-level status rollup.
---
# Consolidate project report

## Steps
1. Resolve the project from `projects.manifest.json` (name, `jira.projectKey`,
   `confluence.spaceKey`, `jtmf.projectId`).
2. **Jira**: `jira_search` with the project's `defaultJql` (or an epic-scoped JQL) to
   get current ticket/epic states; `jira_get_epic_children` for each epic in scope.
3. **Confluence HLRs**: `confluence_search`/`confluence_get_children` within the
   project's space to gather high-level requirement pages; `confluence_get_page` for
   full content of each.
4. **JTMF test cases**: `jtmf_search_tests` scoped to the project to list current test
   cases and their linked Jira keys.
5. **Execution results**: `allure_summary` (from the `allure-report` MCP server) for
   the project's latest run; pull specific `get_result_json` entries for any failures
   needing detail.
6. **Map and cross-reference**: build one table — `requirement (Jira/Confluence) -> test case (JTMF) -> execution result (Allure) -> Jira status` — and flag:
   - Acceptance criteria with no linked test case.
   - Test cases with no recent execution result.
   - Jira status that looks stale versus the actual pass/fail outcome (e.g. ticket
     "Done" but linked test case failed in the latest run).
7. Persist the consolidated report to `knowledge/reports/<project>/<date>.md` via
   `knowledge_append` (or a direct file write) for trend comparison across runs.

## Output
Respond with exactly these sections, in this order:
1. **Status line** — one sentence: project, run date, overall health (green/amber/red).
2. **Traceability table** — `requirement (Jira/Confluence) | test case (JTMF) | execution result (Allure) | Jira status`, one row per requirement.
3. **Gaps** — uncovered acceptance criteria, unexecuted test cases, stale Jira statuses (each flagged explicitly, or "None").
4. **Report location** — the `knowledge/reports/<project>/<date>.md` path persisted.

## Rules
- Every row in the consolidated table must cite its four sources by id (Jira key,
  Confluence page id, JTMF key, Allure result id) — no row without full traceability.
- Call out gaps explicitly rather than omitting rows with missing links.
