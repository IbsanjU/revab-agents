---
name: qe-program-coordination
description: Coordinate a multi-team QE effort (SIT, E2E, PAT) in stages by routing each stage to the specialist that owns it - notes, capability matrix, RACI, test plan, evidence, sign-off. Use when several teams test different parts of one release and someone has to organize who tests what and keep the documents current. Skip for a single-team test run, a one-off document, or a single question about one stage.
---
# QE program coordination

A program has many teams, many sources and many documents that must agree. The orchestrator runs this skill: it **routes each stage to the specialist who owns it and reviews what comes back**. It does not write the documents itself (`route-to-specialist`, `review-delegated-work`). Multi-step work needs an approved plan first (hard rule 13), and each stage reads the previous stage's output, so never skip ahead.

## Who runs each stage

| Stage | Output | Owner | Skill or method |
|---|---|---|---|
| 0 Set up | program card, glossary | **planner** (plan), user confirms | `references/templates.md` |
| 1 Ingest | sources listed, tagged, current vs superseded | **researcher** | `extract-requirements-from-image`, `structure-project-data`, `search-across-sources` |
| 2 Digest | notes and a delta against earlier notes | **researcher** | `qe-meeting-notes` |
| 3 Capability matrix | matrix with gaps and overlaps | **test-planner** | `qe-raci-coverage-matrix` |
| 4 Ownership | RACI and open ownership questions | **test-planner** | `qe-raci-coverage-matrix` |
| 5 Plan | test plan and cases per test item | **test-planner** | `qe-test-plan-builder` |
| 6 Coordinate | decision log, risk register, agenda, status updates | **documenter** (Jira follow-ups: **bsa**, dryRun) | `references/templates.md` |
| 7 Execute and evidence | progress, evidence packs, defects, workaround log | **reporter** (runs: **automation**) | `analyze-test-failures`, `references/templates.md` |
| 8 Sign-off | sign-off matrix, not-tested list, hand-off, lessons | **reporter** | `qe-signoff-report`, `ship` for release go/no-go |

## Operating rules (every stage)
1. **Roles, not names** in every deliverable. A role-to-person map exists only if the user asks for one, and only in a local file that is not committed.
2. **Use the program's own terms.** At stage 0 get a glossary (for example "SIT", never "system test") and use it exactly. Add corrections as they come.
3. **One Accountable per RACI row** (one per team on rows each team owns). Responsible without an Accountable is a gap.
4. **Status on every row:** `Agreed`, `Proposed`, `Gap - confirm`, `Owner TBC`, `Out of scope` (defined in `qe-raci-coverage-matrix`). Never upgrade `Proposed` to `Agreed` without a source that says so.
5. **Environment on every activity:** Dev/integration, QA (E2E), PAT, Preview to Prod, Prod.
6. **Conflicting sources:** the newest dated source wins among sources of equal authority, and the older is recorded as superseded with a pointer. A higher-authority source (a signed requirement, an approved plan) is **not** overridden by a newer informal one: flag the conflict and ask. Never merge sources silently and never let a meeting remark override a primary document.
7. **Teams own testing of their own code.** A shared matrix is guidance, not their test scope. Say so in the document.
8. **No opinions about individuals** in notes or logs. Record actions and risks.
9. **Transcripts are imperfect.** Flag anything unverified and list it for confirmation.
10. **Cite every decision, action and row** with a source and date, in a form `utils/citation.ts` accepts (hard rule 9). A row with no source says `uncited`.
11. **Do not fill gaps from memory.** If a source is missing, say so and ask for it.
12. **Check every date** against the holidays and absences on the program card.

## How the orchestrator runs a stage
1. Say which stage you are in, which inputs you read and who you are routing to.
2. Dispatch the stage to its owner with the `project`, the approved plan's path and the previous stage's output. Independent stages or sources may run in parallel.
3. Review the result with `review-delegated-work`: status, environment and source on every row, one Accountable per RACI row, glossary terms, no names, dates checked.
4. End the stage with a **To confirm** list of every `Proposed`, `Gap - confirm` and `Owner TBC` item and ask the user to confirm. Do not move to the next stage while a blocking gap remains unless the user says to continue.
5. Offer the next stage. Never run all stages unprompted.
6. Append what changed and why to a short change log in the confirmed folder.

## Retrieval
Prefer what the specialists can read: `knowledge_search` for prior work, then the sources themselves. Prefer current over superseded sources and cite what you use. If nothing is found or a tool is unavailable, say so and ask for the document. Before any content goes to an index or external service, confirm it is an approved location for that data.

## Output conventions
Markdown by default. Tables stay narrow, with long notes in a Notes column. Unconfirmed items are listed at the end of each stage.

## Check before finishing a stage
- Every row has a status, an environment and a source.
- Every RACI row has exactly one Accountable.
- No personal names or opinions about individuals.
- Terms match the glossary.
- Every date was checked against holidays and absences.
