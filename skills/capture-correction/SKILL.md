---
name: capture-correction
description: Turn a user correction of an agent ("no, do it this way") into a logged record, a concrete Never/Always rule in that agent's spec, and an eval case so it can't regress. Use the moment the user corrects agent behavior, and during self-improve to work the open backlog. Skip when the user is changing what they want rather than fixing how the agent behaved.
---
# Capture correction

A correction is the highest-value signal this framework produces and the easiest to lose:
it lives in one session's chat and disappears. This skill converts it into three durable
artifacts — a **record**, a **rule**, and an **eval** — so the same mistake stops recurring
instead of being re-corrected forever.

Pairs with `capture-learning` (facts the agents should know) and `skillify` (processes worth
reusing). This one is specifically about *behavior that was wrong*.

## Phase 1 — Separate correction from change-of-mind
Only log it as a correction when the agent did something **wrong given what it was told**.
If the user simply wants something different now, that's a new requirement — not a correction.
Ask yourself: "was the agent's behavior defensible under its own rules?" If yes, it's a spec
gap; if no, it's a violation. Both are loggable — say which.

## Phase 2 — Generalize into a rule
Write the reusable form, not the incident:
- Bad: "it ran `npm test` for my-project on Tuesday."
- Good: "the orchestrator uses the terminal only for the queue CLI; test execution is dispatched."
State it as an imperative the agent can follow *before* the situation recurs. If you cannot
state it generally, you don't understand the failure yet — dig further.

## Phase 3 — Log it
```
npm run correction -- log --agent <name> --task "<what was attempted>" \
  --observed "<what it did>" --expected "<what it should have done>" \
  --rule "<the generalized rule>" --severity low|medium|high
```
Records land in `knowledge/corrections/<YYYY-MM>.jsonl`. Use `npm run correction -- list` to
see the open backlog grouped by agent — **the most-corrected agent is the one to fix next**,
and a rule repeating across records is the strongest signal available.

## Phase 3.5 — Check for a repeat pattern, right now
`npm run correction -- log` itself prints a **⚠ REPEATED PATTERN** notice when the agent
you just logged against now has 2+ open corrections — it lists the prior rule(s) so you can
judge, by meaning, whether this is the same underlying pattern recurring (not a coincidence).
If it is: **don't leave it queued for later** — go straight to Phase 4, in this same turn,
for all of that agent's matching open records together. A second occurrence of the same
mistake is the strongest signal this log produces; treat it as urgent regardless of the
severity either record was logged at.

If the same rule/theme is recurring across **different agents** (check the full
`npm run correction -- list` output, not just this one agent's group), that's not one
agent's spec gap — it's a framework-wide one. Fold it into `prompts/shared/conduct.ts`
(inlined into every persona via `AGENT_CONDUCT`) instead of copy-pasting the same fix into
each agent's spec separately; see Phase 4.

## Phase 4 — Fold it into the agent (or the shared conduct, if it's cross-agent)
Single-agent pattern → edit that agent's typed spec — `prompts/agents/<name>.ts` — never a
generated `.agent.md`:
- A violation → add a concrete **Never** bullet (state the wrong action *and* the right one:
  "Never shell out to test commands — dispatch via the queue instead").
- A missing capability → fix `tools`, and add a `mustHave` entry in `evals/capabilities.ts`.
- A scope leak → tighten `owns` / add a `doesNot` hand-off.

Cross-agent pattern (Phase 3.5 found the same theme recurring in 2+ agents) → add or extend
a section in `prompts/shared/conduct.ts` instead — write it generic (the rule any agent
should follow), not the specific agent/task that surfaced it; a one-line example naming the
triggering topic is fine as an illustration, but the rule itself must read as generic.

Either way, finish with `npm run build:prompts` and `npm run correction -- applied <id...>`
(pass every id the fold covers, not just the most recent one).

## Phase 5 — Prove it can't come back
Add or extend an eval so the fix is enforced, not hoped for:
- Structural (a tool must/must not be held) → `evals/capabilities.ts`, runs in CI via `npm run eval`.
- Behavioral (it must *use* things correctly) → a case in `evals/behavior/<name>.md` with a
  must/must-not rubric, and record the run result in that file's table.

## Rules
- Generalize before logging — a record whose `rule` is incident-specific is nearly worthless.
- One correction, one rule. If a correction implies three rules, log three records.
- A second occurrence of the same pattern for one agent is not a queue item for later — fold
  it in this turn (Phase 3.5).
- A pattern repeating across different agents belongs in `prompts/shared/conduct.ts`, generic,
  not copy-pasted into each agent's spec separately.
- Never edit a generated `.agent.md`; the change would be overwritten at the next build.
- Prefer a concrete negative example ("❌ X → ✅ Y") over an abstract principle — models follow
  those far more reliably.
