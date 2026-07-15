---
name: route-assignee
description: Resolve the right Jira assignee for a ticket — explicit name in the input first, otherwise a component/label/issue-type roster lookup — and turn that into a verified accountId. Use before any jira_assign_issue call or before setting fields.assignee in a create/bulk-create payload.
---
# Route assignee

## Steps
1. **Explicit override wins**: if the ticket's source (Excel column, chat request) names a
   person, use that — skip the roster.
2. **Roster lookup**: otherwise read `projects/<project>/team-roster.json` (via the
   `artifacts` server's `read_repo_file`, or `media`'s file tools) and match in this order
   (per the file's own `resolutionOrder`): `byComponent` -> `byLabel` -> `byIssueType` ->
   `defaultAssignee`. Use the first match found.
3. **Resolve to an accountId**: whatever name comes out of step 1 or 2, call
   `jira_search_users` (scoped with `projectKey` when known) to find the matching Jira
   accountId. Never pass a raw name/email to `jira_assign_issue` or a create payload's
   `assignee` field — only a verified `accountId`.
4. **Ambiguous or no match**: if `jira_search_users` returns more than one plausible match,
   or the roster has no entry and no `defaultAssignee` is configured, leave the ticket
   unassigned and flag it for the user rather than guessing.
5. **Apply**: either merge `{ accountId }` into the create payload's `fields.assignee`
   (bulk-create/create flow) or call `jira_assign_issue` with `dryRun: true` first
   (post-hoc assignment flow), per the caller's context.

## Output
When called standalone (not embedded in `bulk-create-tickets`), respond with:
1. **Resolution** — per ticket: matched rule (explicit / component / label / issueType /
   default / none), resolved name, resolved accountId (or "unresolved — needs user input").
2. **Ambiguities** — any ticket where multiple users matched, listed with all candidates.

## Rules
- `team-roster.json` is a placeholder template until a project fills in real accountIds
  (`projects/my-project/team-roster.json` — see its `_placeholder` note); if entries still
  read `"accountId": null`, treat that as "no match" and flag it, don't assign a null.
- Re-resolve every time — a roster file can change between sessions; don't cache a prior
  session's accountId mapping.
