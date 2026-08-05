---
name: route-to-specialist
description: Decide which specialist agent owns a step of the plan — and which of that specialist's own skills it should reach for — before delegating, instead of the orchestrator improvising or doing the step itself. Use for every step in the orchestrator's plan, especially a request that could plausibly belong to more than one specialist. Skip when the user already named the exact specialist to use.
---
# Route to specialist

The orchestrator's whole value is picking the right owner for each step, not doing the
step. This skill is the decision procedure — a manager routing work to the right
direct report, not guessing or defaulting to "I'll just do it myself."

## Step 1 — Match the step to a specialist, by verb + object, not by vibe

| The step is about… | Verb signal | Owner | Do NOT send to |
|---|---|---|---|
| Reading/understanding an epic, ticket, doc, or existing code/git history | "find", "what exists", "research", "understand", "gather" | **researcher** | test-planner (writes plans, doesn't just gather) |
| Turning requirements into a test plan or Gherkin scenarios | "write a plan", "design test cases", "cover" | **test-planner** | researcher (read-only, never authors a plan) |
| Implementing or running Playwright/Cucumber code | "implement", "scaffold", "automate" | **automation** | test-planner (plans, doesn't implement) |
| Running a suite and explaining failures | "run", "why did X fail", "classify failures" | **reporter** | automation (implements, doesn't own run+report) |
| Writing or updating Confluence pages / `.md` docs | "document", "write up", "update the page" | **documenter** | researcher (never writes) |
| A destructive or multi-step change that needs an approved plan before anything executes | "set up", "migrate", "onboard", "roll out" | **planner** first, always, before any of the above are dispatched | any specialist directly — hard rule #13 |
| Requirements arriving as chat text / Excel / CSV / a doc or image, not existing tickets | "these are the requirements", "turn this into tickets" | **bsa** (standalone entry point, not part of the linear pipeline) | researcher (bsa creates tickets; researcher only reads them) |
| Bringing in agents/skills/scripts from another repo | "import", "bring over" | **importer** | — |
| The framework's own learnings, corrections, or spec upgrades | "remember this", "fix the framework", session wrap-up | **self-improve** | any project-scoped specialist |

If a step's verb doesn't match any row, don't force it onto the nearest-sounding
specialist — that's a capability gap. Say so and route to `build-capability` instead of
guessing.

## Step 2 — Common overlaps, resolved explicitly

- **"Check test coverage for X"** — ambiguous between researcher (what coverage exists
  today) and test-planner (design new coverage). Read the verb: "check"/"what's covered"
  → researcher first; only route to test-planner once the gap researcher found needs new
  scenarios written.
- **"Fix the failing test"** — reporter classifies *why* it failed; automation makes the
  code change. Two steps, two owners — don't collapse them into one dispatch.
  Reporter's classification is automation's required input, so sequence them (reporter →
  automation), never dispatch automation first hoping it infers the failure reason.
  See `review-delegated-work` for confirming reporter's output is actually usable
  before automation starts.
- **"Update the epic with results"** — this is a Jira write, not documentation; small
  writes route through `researcher`'s hand-off to bsa/documenter per its own spec, not
  automatically to documenter. Check which system the write targets before assuming
  "update" means Confluence.
- **A step with no dependency on any other step's output** — a candidate for **parallel
  dispatch** (see `prompts/agents/orchestrator.ts`'s `always` list and
  `docs/multi-agent-architecture.md` §4): route it and dispatch it in the same turn as
  other independent steps, don't artificially sequence steps that don't need to be.

## Step 3 — Once the specialist is chosen, name the likely skill too

Every specialist's own generated file (`.claude/agents/<name>.md` /
`.github/agents/<name>.agent.md`) lists its `## Skills` — the reusable playbooks it's
told to use rather than improvise. Before dispatching, check that list and, if one
clearly applies, name it in the delegation prompt as a hint (e.g. "use the
`search-across-sources` skill" when the step is a topic search, not a known key). This
is a hint, not an order — the specialist still owns its own tool/skill choice within its
lane; naming it up front just saves it a discovery step and catches an obvious mismatch
before dispatch (e.g. don't hint a skill that specialist doesn't actually have listed).

## Output

For each step in the plan, one line: `<step> → <specialist> (skill: <name-or-none>)`.
If a step doesn't fit any specialist, say so explicitly instead of forcing a fit.

## Rules

- Never invent a specialist or skill name that isn't in the actual roster
  (`prompts/agents/index.ts`'s `AGENTS` list / each specialist's own `## Skills` section).
- If two specialists both plausibly own a step, split it into two steps with two owners —
  don't pick one to do both.
- A step with no fitting specialist is a capability gap, not a reason to do it yourself or
  force it onto the closest-sounding one — route to `build-capability`.
- This skill decides *who*; it never does the step's actual work.
