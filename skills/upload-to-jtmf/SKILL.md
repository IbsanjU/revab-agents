---
name: upload-to-jtmf
description: Create or update JTMF test-case issues from generated test cases, with dedup checks and a dry-run preview before writing. Use after test-planner produces Gherkin scenarios that need to be tracked in JTMF.
---
# Upload to JTMF

## Steps
1. **Dedup check first**: call `jtmf_search_tests` with a JQL fragment matching the
   feature/component (e.g. summary text, labels, epic key). Never create a duplicate
   of an existing test case — if one matches, prefer `jtmf_update_test_case`.
2. **Preview**: call `jtmf_create_test_case` / `jtmf_update_test_case` with `dryRun: true`
   (the default) and show the user the exact payload that would be sent.
3. **Confirm**: ask the user to approve before setting `dryRun: false` — writes to JTMF
   are never silent.
4. **Write**: call again with `dryRun: false` once approved.
5. Record the created/updated issue key back into the corresponding Gherkin feature file
   as a citation comment (e.g. `# JTMF: ABC-321`) via the `codegen` tool, so the
   requirement → test-case → automation trail stays intact.

## Output
Respond with exactly these sections, in this order:
1. **Dedup result** — existing JTMF matches found (keys + summaries), or "No duplicates found".
2. **Preview** — the exact create/update payload(s) from the `dryRun: true` call (this is what the user approves).
3. **Confirmation status** — awaiting approval / approved / declined.
4. **Result** — after an approved write: created/updated JTMF keys and the feature files annotated with citation comments.

## Rules
- Every test case pushed to JTMF must carry the same source citation used when it was
  generated (Jira key / Confluence page / transcript timestamp) in its description.
- Never bulk-create without a dedup pass; flag near-duplicate summaries for the user to
  confirm rather than silently merging or silently creating.

## Definition of done (all must be true, not just "looks complete")
1. `jtmf_search_tests` was actually called this session for dedup — not assumed clean.
2. The exact payload shown to the user is the same payload sent with `dryRun: false` — not a re-derived one.
3. The user's reply was an explicit affirmative to *that* previewed payload, not a general "go ahead" from earlier in the task.
4. The returned JTMF key was actually cited back into the feature file's `# JTMF:` comment — not just reported in chat.
