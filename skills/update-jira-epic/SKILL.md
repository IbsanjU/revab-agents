---
name: update-jira-epic
description: Update Jira ticket/epic status and evidence links after test planning or test execution, with a dry-run preview and explicit user confirmation before writing. Use after reporter classifies results or test-planner links coverage to an epic.
---
# Update Jira epic/ticket

## Steps
1. Determine what changed: new test coverage linked, execution verdict (pass/fail),
   or a status that should move (e.g. "Ready for QA" -> "Done").
2. **Preview**: call `jira_update_issue` or `jira_transition_issue` with `dryRun: true`
   (the default). For transitions, this also returns the list of valid transition names
   for that issue — never guess a transition name.
3. **Ask before posting**: show the user the exact field/transition change and comment
   text; only proceed with `dryRun: false` after explicit approval (same rule as
   existing Jira comment behavior in the `reporter` agent).
4. **Write**: call again with `dryRun: false`, optionally attaching a summary comment
   (execution verdict, Allure link, JTMF test case keys) via `comment`.
5. Log the change (issue key, old/new status, evidence link) to `knowledge/learnings.md`.

## Rules
- Never transition an issue to "Done"/"Closed" purely because tests passed — status
  changes reflect the user's process, not just test results; always confirm.
- Status/field updates must cite the evidence (test case keys, Allure run id) in the
  accompanying comment so the change is auditable.
