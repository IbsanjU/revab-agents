---
name: structure-project-data
description: Reconcile and sanitize raw data pulled from Jira/Confluence/JTMF/GitHub/git into one clean, deduplicated, freshness-checked project structure document (the project's app-model, or a scoped topic summary) — every line traceable to its most recently updated source. Use whenever multiple sources cover the same topic/feature and need consolidating into a single source of truth, or when (re)building the project's app-model. Skip when there's a single already-authoritative source with nothing to reconcile — cite it directly instead.
---
# Structure project data

Composes existing read tools across Jira/Confluence/JTMF/GitHub/git — no new I/O, purely a
reconciliation-and-writing playbook. Generic across roles: `researcher` building a brief,
`bsa` scoping a batch of tickets, `test-planner` mapping app structure, `documenter`
maintaining docs, `automation` checking prior conventions before scaffolding — any agent
that pulled data from more than one place and needs it turned into one clean structure
instead of staying scattered.

## Steps
1. **Gather every source covering the topic.** Prefer the `search-across-sources` skill to
   fan out across Jira/Confluence/JTMF/GitHub, plus `git_log`/`git_search`/`git_branches`
   for local history and in-progress branches. Pull full content only for sources that
   look relevant, not everything a search returned.
2. **Timestamp every source before using its content** — a fact's freshness matters as
   much as its content:
   - Confluence: `confluence_get_page`'s `version` (number, and `when`/`by` once returned)
   - Jira: `updated`/`created` fields (present by default on `jira_search` results;
     explicit on `jira_get_issue`)
   - JTMF: the test case's own last-modified field, if the tool returns one
   - GitHub: commit/file dates from `github_search_commits`/`github_get_file`
   - git: commit dates from `git_log`/`git_show`
   A source with no discoverable date is **unknown freshness** — say so; never assume it's
   old or new.
3. **Reconcile conflicts.** When two or more sources describe the same fact differently,
   the most recently updated one is authoritative. Name the superseded source(s) and their
   dates explicitly — never drop them silently or blend conflicting facts into an average.
   If freshness is tied or unclear, don't guess: list both versions and ask which is correct.
4. **Deduplicate.** Merge near-identical fragments from different sources into one entry,
   citing every source that agreed — agreement across independent sources is worth stating,
   not just discarding the "extra" copies.
5. **Sanitize before writing:**
   - Strip source-system markup (Confluence storage HTML, Jira wiki markup) down to plain
     structured text/Markdown — never paste raw HTML/wiki markup into the output document.
   - Normalize terminology to one canonical name per feature/component; flag (don't
     silently resolve) cases where sources use different names for what looks like the
     same thing.
   - Treat anything that looks like a secret, token, or credential as a hard stop — redact
     it, don't write it to any file, and flag it back to the user.
6. **Write the structure:**
   - Project-wide structure → the project's app-model file (`projects/<project>/app-model.md`,
     or `knowledge/app-model/<project>.md` if that's where this project's app-model already
     lives) — create or update. Never blind-overwrite: diff against the current version and
     preserve sections the new data doesn't touch, the same discipline the documenter agent
     uses for Confluence updates.
   - Narrower, topic-scoped output (e.g. feeding a single research brief) → inline in that
     output's own structure/Sources section instead of touching the shared app-model file.
7. **Every line cites its source(s) and their freshness date.** This is exactly the kind of
   generated artifact the citation-required hard rule (rule 9) applies to — a line with no
   traceable, dated source is either cut or listed as an open question, never asserted.

## Output
When updating a project's app-model (or producing a standalone structure doc), respond with:
1. **Updated sections** — what changed, and which (fresher) source drove each change.
2. **Conflicts found** — the superseded fact, both sources, both dates, and which one won.
3. **Unknowns** — anything with no discoverable freshness date, flagged as such.
4. **Skipped/ambiguous** — anything that needed a human call instead of an automatic merge.

## Rules
- Never invent structure the sources don't support — a thin or partially-empty section
  beats a fabricated one.
- Every merged fact keeps its full citation list, not just the source that "won".
- This skill never deletes prior app-model content on its own — superseded facts are marked
  superseded (old date + new date), not removed, unless the user explicitly confirms a
  section should be replaced outright.
- Read-only with respect to Jira/Confluence/JTMF: this skill only writes to files
  (`app-model.md` or the calling output), never back to an external system.
