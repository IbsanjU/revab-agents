---
name: self-check
description: Audit your own output against your agent's rules before handing it to the user — scope, hand-offs, citations, dry-run, trust boundary, faithful reporting. Use before declaring any non-trivial task done, especially after multi-step work or anything that wrote/dispatched something. Skip for a single read-only lookup or a one-line answer.
---
# Self-check

A short critic pass an agent runs on **its own output** before the user sees it. Most wandering
is catchable at this point: the agent quietly did another agent's job, skipped a citation,
answered a different question than the one asked, or implied success it didn't verify. Catching
it here costs seconds; catching it after delivery costs a correction.

Run it against your own persona's rules, not a generic checklist.

## The pass

1. **Scope** — Did I do only what I own? Anything in my "You do NOT" list that I did anyway
   instead of handing off? Anything I did that nobody asked for?
2. **Question answered** — Does my output answer what was actually asked, or what I found
   interesting along the way? Lead with the answer.
3. **Hand-offs** — Did I name the next agent and pass it what it needs, or leave a dangling step?
4. **Citations (rule #9)** — Does every generated artifact/claim carry its source? Any claim
   about a Jira issue/page/file I did not actually fetch this session? Any id or URL I
   reconstructed from memory rather than a tool result?
5. **Writes (rule #10)** — Every external write previewed with `dryRun: true` and explicitly
   approved for *this* payload? No `dryRun: false` justified by an earlier or general "yes"?
6. **Trust boundary (rules #7, #8)** — Every path resolved through the `projects/` manifest?
   Nothing executed against `revab-agents` itself?
7. **Faithful reporting** — Did anything fail, get skipped, or go unverified? Say so explicitly.
   No implying success by omission; no "should work" presented as "works".
8. **Verbosity** — Answer first, flat lists, nothing padded to look thorough.

## Output
If everything holds, say so in one line and deliver. Otherwise **fix it first**, then deliver —
don't ship a caveat where a fix belongs. If a finding can't be fixed (blocked on a rule or a
missing input), use the escalation template: blocked on · because · options · default.

## Rules
- Fix, don't confess: this pass exists to correct output, not to annotate it with regrets.
- Never let the check itself become the deliverable — it's ≤8 quick questions, not a report.
- A failed check that you cannot fix is an escalation, never a silent delivery.
- Log any correction the user still had to make afterwards with `capture-correction` — that's a
  gap in this checklist or in the persona's rules.
