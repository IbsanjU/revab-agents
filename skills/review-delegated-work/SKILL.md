---
name: review-delegated-work
description: Review a specialist's returned result against ITS OWN rules before folding it into a summary or reporting it onward — the manager's check on a direct report's work, not a rubber stamp. Use after every Task/subagent dispatch returns, before aggregating. Skip only for a trivial read-only lookup with an obviously correct, self-evident answer.
---
# Review delegated work

Delegating isn't finished when a specialist replies — a manager who forwards whatever
comes back without reading it isn't managing. This is the orchestrator's independent
check on each specialist's output, run **by the orchestrator, on someone else's work** —
it does not replace that specialist's own `self-check` pass on itself; both apply.

## The pass

Run this against the step you delegated and the result you got back, not a generic
checklist:

1. **Scope** — Did the specialist stay in its own lane? Check its "You do NOT" list: did
   it do another specialist's job, or touch a tool outside the list in its own
   `.claude/agents/<name>.md` / `.github/agents/<name>.agent.md`? A specialist that
   quietly expanded its own scope is the same failure class this whole framework's
   delegation design exists to prevent — don't wave it through because the extra work
   happened to be useful.
2. **Actually answered the delegated step** — Does the result address the specific step
   you handed off, or a related-but-different thing the specialist found more
   interesting? A well-written answer to the wrong question is still a fail.
3. **Citations (rule #9)** — Does every claim/generated artifact carry a real, checkable
   source? A confident-sounding result with no citations is a red flag, not evidence of
   thoroughness.
4. **Dry-run / writes (rule #10)** — If the step involved any external write
   (Jira/Confluence/JTMF), was it previewed with `dryRun: true` and explicitly approved
   for that exact payload — never a blanket earlier "yes" stretched to cover this one?
5. **Faithful reporting** — Did the specialist say "blocked" or "couldn't find X"
   plainly where that's what happened, or does the result read like success is implied
   by omission? Compare what it claims against what it's actually citing.
6. **Fit for aggregation** — Is this ready to fold into your summary as-is, or does it
   expose a follow-up step (dispatch again, to the same or a different specialist)
   before you can report anything useful to the user?

## Output

One of two shapes, always stated explicitly — never silent:

- **Pass** — one line naming what passed, then fold the result into the aggregate
  summary.
- **Follow-up needed** — name exactly what's missing/wrong (using the numbered checks
  above) and what happens next: dispatch back to the **same** specialist with the
  specific gap named (never quietly fix it yourself — that's doing their job), dispatch
  a different specialist for a step this exposed, or escalate to the user if the gap is
  a missing input only they can supply.

## Rules

- Never rubber-stamp a result because it's confident-sounding or arrived fast — read it
  against the checklist above every time a dispatch returns.
- Never fix a specialist's gap yourself (write the missing citation, silently correct a
  scope violation, complete an unfinished write) — that reproduces the exact failure this
  framework's delegation design exists to prevent. Send it back with the gap named, or
  escalate.
- A specialist's own `self-check` pass is not a substitute for this — it catches what the
  specialist itself can see; this catches what only the requester of the step can judge
  (did it actually answer what was asked, does it fit with the other steps' results).
- If the same specialist fails this check on the same kind of gap repeatedly, that's a
  `capture-correction` case against that specialist's spec, not something to keep
  manually patching around at review time.
