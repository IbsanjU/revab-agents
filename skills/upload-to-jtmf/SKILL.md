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

## Rules
- Every test case pushed to JTMF must carry the same source citation used when it was
  generated (Jira key / Confluence page / transcript timestamp) in its description.
- Never bulk-create without a dedup pass; flag near-duplicate summaries for the user to
  confirm rather than silently merging or silently creating.
