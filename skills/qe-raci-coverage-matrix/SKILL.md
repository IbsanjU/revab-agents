---
name: qe-raci-coverage-matrix
description: Build a terse RACI and a test coverage matrix (who tests what in which environment, with status, source and gaps) from a scope list, requirements or meeting notes. Use when several teams test parts of one release and the user needs to show who owns what and where the gaps are. Skip for a single-team test plan.
---
# QE RACI and coverage matrix

Two tables that answer "who owns this?" and "is it covered in each environment?", with every row carrying a status and a source so nobody has to ask where it came from.

## Inputs
- Scope or capability list (categories and items), requirements, or meeting notes
- Teams as roles
- Environments in order (for example Dev, QA, PAT, Prod)
- The project glossary, if one exists

If the scope list or the roles are missing, ask for them. Do not invent either.

## Status values (use exactly these)
`Agreed` (stated by someone with authority in a dated source) · `Proposed` (inferred, needs confirmation) · `Gap - confirm` (nobody named) · `Owner TBC` (not discussed) · `Out of scope`.
Never upgrade `Proposed` to `Agreed` without a source that says so.

## Coverage matrix
One row per scope item. Columns:

`# | Category | Scope | What | <one column per environment: owner> | Status | Source`

- **What**: a phrase list in the source's wording, not sentences.
- **Owner cell**: a role, plus a short qualifier only when needed ("sampled", "regression only").
- **Source**: a citation with its date (a Jira key, `confluence:<id>`, `path:line`, `transcript:<id>@HH:MM:SS`).
- Keep the user's category numbering. If the source numbering is wrong, fix it and say so.

## RACI
One row per activity. Columns:

`# | Activity | Env | <one column per role> | Notes | Source`

- Cell values: `A/R`, `A`, `R`, `C`, `I`, `-`.
- Activities are short labels; detail goes in Notes, also short.
- Include coordination activities, not only testing: data setup, access handover, evidence, sign-off, production setup, post-deployment checks.

## Rules
- **Exactly one Accountable per row.** Where each team owns its own component, one per team, and say so in the key. A Responsible with no Accountable is a gap.
- No row without a status. No activity without an environment. No row without a source, or the word `uncited`.
- Roles, not personal names.
- Use the source's own terms and acronyms. Define each abbreviation once in the key.
- Teams own testing of their own code. State in the document that the matrix is guidance, not their test scope.
- List what is explicitly out of scope under the tables.
- When two sources disagree, use the newer one **unless** the older is higher authority (a signed requirement or approved plan against an informal remark). In that case keep the higher one, mark the row `Proposed`, and list the conflict under To confirm. Never merge them silently.

## Output
1. **Key** - RACI letters, environments, abbreviations, status meanings. One line each.
2. **RACI** table.
3. **Coverage matrix**, grouped by category.
4. **To confirm** - every `Proposed`, `Gap - confirm` and `Owner TBC` row, and every source conflict, as a short list.

Markdown by default. If asked for a spreadsheet and no tool here can build one, give CSV text per table and say so. Save only to a folder the user confirmed inside a manifest project.

## Check before finishing
- Count the Accountables in every RACI row and show the count of rows that fail.
- Every abbreviation is in the key.
- Every row has a status, an environment and a source.
- No sentence where a phrase will do.
