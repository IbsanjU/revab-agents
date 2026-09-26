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

## Phase 4 — Fold it into the agent
Edit that agent's typed spec — `prompts/agents/<name>.ts` — never a generated `.agent.md`:
- A violation → add a concrete **Never** bullet (state the wrong action *and* the right one:
  "Never shell out to test commands — dispatch via the queue instead").
- A missing capability → fix `tools`, and add a `mustHave` entry in `evals/capabilities.ts`.
- A scope leak → tighten `owns` / add a `doesNot` hand-off.
Then `npm run build:prompts` and `npm run correction -- applied <id>`.

## Phase 5 — Prove it can't come back
Add or extend an eval so the fix is enforced, not hoped for:
- Structural (a tool must/must not be held) → `evals/capabilities.ts`, runs in CI via `npm run eval`.
- Behavioral (it must *use* things correctly) → a case in `evals/behavior/<name>.md` with a
  must/must-not rubric, and record the run result in that file's table.

## Rules
- Generalize before logging — a record whose `rule` is incident-specific is nearly worthless.
- One correction, one rule. If a correction implies three rules, log three records.
- Never edit a generated `.agent.md`; the change would be overwritten at the next build.
- Prefer a concrete negative example ("❌ X → ✅ Y") over an abstract principle — models follow
  those far more reliably.
