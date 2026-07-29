# Plan: Codified, model-agnostic agent prompts so agents stop wandering

## Context

`revab-agents` (10 agents, 21 skills, 13 MCP servers) was well-intentioned but its agents **wandered,
over-did things, and ignored the rules we wrote** across different VS Code models. The goal is to make
the agents/prompts/skills clean and efficient, and to keep them working with **all models** (Copilot,
Cursor, and others) — not locked to any one host.

Requirements:
1. **Model-agnostic discipline** — behave predictably on any model. No host-specific packaging as the
   only artifact.
2. **"md → code" prompts & instructions** — stop hand-maintaining loose markdown; drive prompts from a
   codified single source.
3. **Reusable engineering** — a house style, robustness utils, and a generator that keeps everything
   in sync.

### Root causes of the wandering

1. **Rules delegated to a file that isn't always loaded.** Every agent's *Conduct* block said the 13
   hard rules "load automatically" from `.github/copilot-instructions.md` — only true in default
   Copilot. Other models ran the agent with **none of the rules present**. → Fix: rules physically
   inlined into each generated agent file.
2. **Over-broad tools** (`jira/*`, 22-tool `automation.agent.md`). → Fix: minimal per-agent sets.
3. **Overlapping scopes / no enforced routing** (orchestrator held every specialist's tools). → Fix:
   orchestrator gets only routing/read tools; specialists narrow; each declares "hand off to X".
4. **Host-only tool names** (`search/codebase`, `vscodeTasks/*`) don't resolve on other models. →
   Fix: portable tool vocabulary mapped to the host in one place.
5. **Prose-heavy, un-prioritized.** → Fix: fixed skeleton, imperative "Always/Never" front-loaded.

## Design: a codified prompt system

`prompts/` is the single source of truth; a generator emits the model-facing markdown every host reads:

```
prompts/
  types.ts             # AgentSpec type
  shared/
    hard-rules.ts      # the 13 hard rules as one exported source (imperative, deduped)
    conduct.ts         # tool discipline, escalation, faithful-reporting, anti-hallucination
    skeleton.ts        # the fixed agent skeleton + the portable→host tool mapping
  agents/*.ts          # one typed spec per persona
  build.ts             # assembles specs + shared partials → the output files
scripts/build-prompts.ts # npm run build:prompts (and --check for CI)
```

**Generated outputs (checked in, self-contained — no runtime "auto-load"):**
- `.github/agents/<name>.agent.md` — each **physically contains** its own rules.
- `AGENTS.md` — the portable, host-neutral instruction file any agentic tool can load.
- `.github/copilot-instructions.md` — regenerated from the same source so it can't drift.

### Fixed agent skeleton (all 10)

```
name · one-line description with "use when / hand off when" · minimal explicit tools · model
# Role — one sentence
# You own / You do NOT (→ hand to <agent>)      ← kills overlap + wandering
# Flow — ≤6 numbered steps; deep detail lives in a named skill
# Always / Never — ≤6 imperative bullets, load-bearing rules INLINE — not by reference
# Hand off — next agent + what you pass
```

### Robustness in revab's own code

- `utils/semanticBoolean.ts`, `utils/semanticNumber.ts` — coerce sloppy model JSON (`"false"`→`false`)
  so tools don't break across models; wrap the `dryRun`/boolean fields in the write servers.
- `PROMPT_STYLE.md` — the house style (skeleton, tone, minimal tools, self-contained, examples-first).
- Skills stay in `skills/*` (framework code references that path); surfaced from the generated docs.

### Enforced flow

```
planner (plan + approve) → orchestrator (route via delegation only)
   → researcher (read-only) → test-planner (cite → codegen) → automation (exec + codegen)
   → reporter (run + allure) → documenter (dryRun writes) → self-improve (learnings)
bsa: standalone intake → dryRun Jira bulk-create; never deletes
```
The orchestrator holds no exec/write tools → it must delegate. Each specialist's "You do NOT" names
who takes over.

## Roadmap (phased; each phase independently usable)

- **P0 — Commit roadmap** to `knowledge/plans/framework/2026-07-21-agent-prompt-discipline.md`.
- **P1 — Codified source + generator** (`prompts/**`, `scripts/build-prompts.ts`, `--check` in CI).
- **P2 — Regenerate instructions** (`AGENTS.md` + `copilot-instructions.md`); deduplicate.
- **P3 — Author all 10 agent specs** to the skeleton (minimal tools, inline rules).
- **P4 — Regenerate every persona file.**
- **P5 — Robustness utils + tool-description upgrade** (`semanticBoolean/Number`, field `.describe()`s).
- **P6 — Commands + README** "works with any model" section.

## Verification

1. **Self-contained rules:** every `.github/agents/*.agent.md` physically contains its Always/Never
   rules; grep finds **no** agent body deferring its rules to `copilot-instructions.md`.
2. **Single source holds:** edit a rule in `prompts/shared/hard-rules.ts`, run `npm run build:prompts`
   → it appears in all agent files + `AGENTS.md` + `copilot-instructions.md`; `--check` fails CI if stale.
3. **Model-agnostic:** the generated content is plain markdown with no host-only tokens.
4. **Flow holds:** "orchestrator: research epic X" → it delegates (no direct Jira call).
5. **Boundaries hold:** automation refuses to touch `revab-agents` itself; bsa refuses delete.
6. **Robustness:** an MCP write called with `dryRun:"false"` (string) is coerced safely; typecheck green.
7. **Tool minimalism:** each agent's `tools:` lists only tools its body references; no wildcards.
