---
name: sprint-backlog-report
description: Report current sprint health and backlog state for a Jira project — status breakdown, unassigned tickets, tickets missing required fields, backlog size. Use for "what's the status of the sprint/backlog", after a bulk-create, or on a recurring tracking cadence.
---
# Sprint / backlog report

## Steps
1. **Find the board**: `jira_get_boards` scoped to the project's `jira.projectKey` (from the
   manifest) if the board id isn't already known.
2. **Find the sprint**: `jira_get_sprints` (default `state: "active,future"`) — use the
   active sprint unless the user asks for a specific one.
3. **Sprint health**: `jira_get_sprint_report` for the resolved sprintId — returns total,
   `byStatus` counts, `unassigned`, `missingDescription`, `missingPriority`.
4. **Backlog view**: `jira_get_backlog` for the same board — report size and, if the user
   wants detail, the issue list (respect `fields`/`maxResults`).
5. **Optional deep dive**: `jira_search` with a targeted JQL (e.g. `project = X AND sprint in
   openSprints() AND assignee is EMPTY`) when the user wants the actual issue list behind a
   count from step 3, not just the number.

## Output
Respond with exactly these sections, in this order:
1. **Sprint status line** — sprint name/id, total tickets, one-line health read (e.g.
   "12 total: 5 done, 4 in progress, 3 to do; 2 unassigned").
2. **Status breakdown** — table of status -> count.
3. **Needs attention** — unassigned tickets (keys), tickets missing description/priority
   (keys) — these are the ones a BSA should groom before/during sprint planning.
4. **Backlog** — size, and (if requested) the issue list.

## Rules
- Never call `jira_move_to_sprint` as part of a routine report — that's a write, and only
  happens on explicit user request with a dryRun preview first.
- If no active sprint exists, say so explicitly and report backlog-only rather than
  inventing a sprint.
