---
name: bulk-update-tickets
description: Apply the same kind of field change and/or status transition to many existing Jira tickets in one batch — from an explicit list of keys, a JQL query, or a parsed Excel/CSV sheet. Use whenever a change (priority bump, reassignment, sprint grooming status move) applies to more than a couple of tickets, instead of looping single-ticket updates. Skip when only one or two tickets need the change — use `jira_update_issue`/`jira_transition_issue` directly.
---
# Bulk update tickets

## Steps
1. **Resolve the target keys**:
   - Explicit list given by the user -> use as-is.
   - JQL described by the user (e.g. "everything unassigned in ABC's backlog") -> `jira_search`
     first, confirm the resulting key list with the user before updating anything (a JQL typo
     can silently touch the wrong tickets).
   - A parsed sheet (`read_excel_rows`/`read_csv_rows`) with a key column -> map rows to
     `{ key, fields, transitionName }`.
2. **Resolve any assignee changes** via the `route-assignee` skill (verified accountId only,
   never a raw name) before building the update payload.
3. **Resolve any transition** by name per row — `jira_bulk_update_issues` itself validates
   each row's transition against that issue's own available transitions in the preview; don't
   pre-guess a transition id.
4. **Preview**: call `jira_bulk_update_issues` with `dryRun: true` (the default) — shows each
   row's field diff and matched transition (or `null` if the name didn't match any available
   transition for that issue).
5. **Confirm**: show the user the full batch preview and get explicit approval before setting
   `dryRun: false`. Approval covers exactly this preview.
6. **Apply**: call again with `dryRun: false`. Read the per-row `results` — a field update can
   succeed even if that same row's transition then fails (reported as `transitionError`
   alongside `fieldsUpdated: true`); don't treat the whole row as failed without checking both.

## Output
Respond with exactly these sections, in this order:
1. **Batch preview** — table: row #/key, field changes, requested transition, matched
   transition (or "no match — available: ...").
2. **Confirmation status** — awaiting approval / approved / declined.
3. **Result** — after an approved update: succeeded/failed counts, and per-row detail
   (fields updated, transitioned-to, or the exact error) verbatim.

## Rules
- Never derive the target key list from a JQL query without showing the user the resolved
  keys first — JQL that's slightly too broad silently updates tickets nobody meant to touch.
- A row with an unmatched `transitionName` is not an error to hide — surface it with the
  issue's actual available transitions so the user can correct the name.
- This skill is for existing tickets only; use `bulk-create-tickets` for new ones (which also
  supports an optional post-create `transitionName` in the same call).
