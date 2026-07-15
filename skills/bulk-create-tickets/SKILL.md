---
name: bulk-create-tickets
description: Turn an uploaded Excel/CSV sheet (or a chat-described list of requirements) into a previewed, deduped batch of Jira tickets with all required fields, then create them on explicit confirmation. Use whenever a stakeholder hands over a bulk list of work items instead of one ticket at a time.
---
# Bulk create tickets

## Steps
1. **Parse the source**:
   - `.xlsx`/`.xls` -> `read_excel_rows` (media server); `.csv` -> `read_csv_rows`.
   - Chat-described list -> split into one draft per discrete work item yourself.
2. **Map columns to fields** with a loose header match (`Summary`/`Title`, `Description`/
   `Details`, `Type`/`Issue Type`, `Assignee`/`Owner`, `Priority`, `Component`, `Labels`,
   `Story Points`/`Estimate`, `Epic`/`Epic Link`). If a column can't be confidently mapped,
   ask the user what it means — never drop it silently.
3. **Validate required fields** per issue type (see `knowledge/conventions.md`'s
   required-fields table). Rows missing a required field are still included in the preview
   but flagged `incomplete: true` with the missing field names — never invent the missing
   value.
4. **Resolve assignees** for rows that name one, via the `route-assignee` skill (do this
   before the preview so the preview shows the real accountId/display name, not a raw
   name string).
5. **Preview**: call `jira_bulk_create_issues` with `dryRun: true` (the default). This
   returns, per row: the resolved Jira fields payload and any `potentialDuplicates` found
   by the tool's built-in dedup search. Merge in your own `incomplete` flags from step 3.
6. **Confirm**: show the user the full batch preview (see Output below) and get explicit
   approval before setting `dryRun: false`. Approval covers exactly this preview — if the
   user asks for changes, re-run the preview and re-confirm.
7. **Create**: call again with `dryRun: false`. The tool is partial-failure tolerant — read
   the per-row `results` (created / skipped-as-duplicate / error) rather than assuming an
   all-or-nothing outcome. If a row needs to land in a non-default status (e.g. "Ready for
   Grooming" instead of the workflow's default "To Do"), set that row's `transitionName` in
   the draft — it's applied right after a successful, non-duplicate create; a transition
   failure is reported per-row (`transitionError`) without undoing the create.
8. **Assign**: for created rows that didn't carry an inline assignee in the create payload,
   call `jira_assign_issue` (dryRun-first) using the accountId resolved in step 4. For a
   batch of *existing* tickets needing the same field change or status move later, use the
   `bulk-update-tickets` skill instead of looping single-ticket calls.
9. **Cite the source**: each created ticket's description (or a follow-up comment via
   `jira_add_comment`) should note where it came from — file name + row number, or "bulk
   chat request on <date>".

## Output
Respond with exactly these sections, in this order:
1. **Batch preview** — a table: row #, summary, issue type, resolved assignee (or
   "unresolved"), `incomplete`/missing fields (or "complete"), `potentialDuplicates` (or
   "none").
2. **Confirmation status** — awaiting approval / approved / declined.
3. **Result** — after an approved create: created keys + links, skipped-as-duplicate rows,
   and any per-row errors, verbatim.
4. **Follow-ups** — rows that still need manual info (incomplete fields, unmapped columns,
   unresolved assignees) for the user to fill in.

## Rules
- Never create a row flagged `incomplete` without the user explicitly saying to proceed
  anyway (and even then, never fabricate the missing value — create it genuinely incomplete
  and say so).
- Never bypass the dedup search (`skipDedupe: true`) unless the user explicitly asks to,
  and say so in the preview when you do.
- A bad or ambiguous row blocks itself, not the batch — keep going and report it, don't stop
  the whole run over one row.
