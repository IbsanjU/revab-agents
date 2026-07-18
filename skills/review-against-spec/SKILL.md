---
name: review-against-spec
description: Two-axis review of a target project's changes since a fixed point — Standards (does the code follow the target repo's own documented conventions?) and Spec (does it match the Jira ticket/acceptance criteria it was built from?). Use when reviewing a branch/PR/work-in-progress against its source ticket, or when the user asks to "review since X". Skip when there's no cited source ticket to check Spec against — run plain `code-review` instead.
---
# Review against spec

Runs two independent checks side by side so one doesn't mask the other: code that follows every
convention but implements the wrong thing (Standards pass, Spec fail), or code that does exactly
what the ticket asked but breaks the repo's own conventions (Spec pass, Standards fail).

## Steps
1. **Pin the fixed point** — whatever ref the user names (branch, tag, commit); if none given,
   ask once: "review against what — a branch, a commit, or the default branch?" Get the diff via
   `git_diff`/`git_log` (manifest-resolved project).
2. **Identify the spec source**: the Jira key(s) cited in the feature file(s)/commit messages
   the diff touches (`# Source: ...`, hard rule 9) — pull via `jira_get_issue` for full
   acceptance criteria. No cited ticket → tell the user there's no Spec source and run plain
   `code-review` instead (don't invent a spec).
3. **Identify the standards sources**: the target project's own lint/format config, any
   `CONTRIBUTING`/style doc, and `.github/instructions/playwright-bdd.instructions.md` for
   BDD-structure conventions.
4. **Run both checks** (sequential is fine, or in parallel if delegating to subagents):
   - **Standards**: read the sources from step 3, then the diff; report every place it violates
     a documented standard, citing the exact rule + line. Skip anything already caught by the
     target repo's own lint/format tooling.
   - **Spec**: read the acceptance criteria, then the diff; report (a) criteria not implemented
     or only partially implemented, (b) behavior added that wasn't asked for (scope creep),
     (c) criteria that look implemented but the implementation looks wrong. Quote the acceptance
     criterion for each finding (hard rule 9 — every line of this report needs a traceable
     source too).
5. **Aggregate**: present under two separate headings, **Standards** and **Spec** — don't merge
   or re-rank across axes. End with one line: total findings per axis, worst single issue if any.

## Output
Respond with exactly these sections, in this order:
1. **Standards** — findings citing the exact documented rule + file:line, or "no violations found".
2. **Spec** — findings per acceptance criterion (not implemented / partial / scope creep / looks wrong), each quoting the criterion, or "all criteria covered".
3. **Summary line** — total findings per axis, worst single issue if any.

## Rules
- Never invent acceptance criteria to check Spec against — no citation, no Spec axis (fall back
  to `code-review`, note why).
- Standards findings must quote the actual rule, not a general style preference.
