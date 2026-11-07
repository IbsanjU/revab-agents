---
name: size-and-slice
description: Size a request (trivial / small / standard / large) so the plan carries only the ceremony its blast radius deserves, and for a large one slice the work into steps that each stand alone, with dependencies and parallelism marked. Use as the first move of every planner run, before drafting. Skip when the user supplied a finished, approved plan to execute.
---
# Size and slice

Ceremony should scale with blast radius. A one-line config fix does not need a deliberation
appendix; a migration across projects does. This skill picks the tier, states it so the user can
override, and for a large request cuts the work into steps an agent can execute without reading the
others.

## Step 1 — Size it
Score three signals and take the **highest** tier any of them reaches.

| Tier | Steps / projects | Writes | Ambiguity |
|---|---|---|---|
| **trivial** | one read-only lookup, or one fully-specified single-file edit | none external | none |
| **small** | 2–3 steps, one project | local files only, or one dry-run-able write | clear once the code/ticket is read |
| **standard** | 4–8 steps, or 2+ agents | external writes (Jira, Confluence, JTMF) behind dryRun | one real choice to make |
| **large** | 9+ steps, 2+ projects, or a migration | several external writes, or anything destructive | open questions that change the approach |

**Up-tier, never down:** a step that crosses the trust boundary (hard rule 8), adds a project to the
manifest, deletes or overwrites something, or depends on a doc or ticket you could not confirm is
current is at least **standard**, whatever its size.

State the result in one line before anything else: `Size: standard (4 steps, 2 agents, Jira write)
— say "smaller" or "larger" to override.` If the user overrides, use their tier, but never below an
up-tier floor.

## Step 2 — What each tier produces
- **trivial**: no plan. Hard rule 13 already exempts it; hand straight to the orchestrator and say so.
- **small**: a compact plan (Goal · Steps · Writes · Rollback), one critique pass, user approval
  in chat, saved as a short file so the task payload can still carry `"plan"`.
- **standard**: the full plan, up to three critique passes, Deliberation appendix, user approval.
- **large**: the full plan **plus** the slices in Step 3, approved as a whole. Execution still
  stops at the first external write for its dry-run confirmation (hard rule 10).

The two human gates are the same at every tier above trivial: **approve the plan**, then **confirm
the first external write's dry-run output**. The tier changes how much you write, never whether you
ask.

## Step 3 — Slice a large request
Each slice is one agent's unit of work and finishes in one task, so a failure is cheap to re-run.
For every slice give:
- **Id and title** (`S1 Export tickets`).
- **Owner**: the agent, plus the skill or tool it will use.
- **Brief**: everything an agent needs without reading other slices — inputs, the `project`, links.
- **Depends on**: slice ids, or none.
- **Parallel?** `yes` only when it has no dependency on another slice's output *and* no shared write
  target; otherwise `no`.
- **Done when**: one checkable condition (a count, a file, a passing check), not "looks good".
- **Rollback**: how to undo it, or `none needed` for a read-only slice.

End with a one-line dependency summary (`S1 → S2; S3 ∥ S4; S5 after S2+S4`) so the orchestrator can
dispatch the parallel ones in a single turn.

## Rules
- **Don't pad.** A tier's list is a ceiling, not a checklist. Skip any plan section with nothing
  honest to put in it.
- **No hidden down-sizing.** If you shrink a request to fit a tier, say what you dropped.
- **Unknown size → ask once** with the tiers as options, recommended one first; if unanswered,
  proceed with the recommended tier and record it as an assumption.
