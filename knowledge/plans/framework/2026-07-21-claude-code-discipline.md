# Plan: Rebuild revab-agents with Claude Code's engineering discipline — model-agnostic

## Context

`revab-agents` (10 agents, 21 skills, 13 MCP servers) is well-intentioned but its agents **wander,
over-do things, and ignore the rules the user wrote** across different VS Code models. The goal is
to make the agents/prompts/skills **as clean and efficient as Claude Code itself** — but the result
must keep working with **all models** (Copilot, Cursor, Claude, …), *not* be locked to Claude.

Three explicit requirements from the user:
1. **Model-agnostic discipline** — behave like Claude Code, but run on any model. No `.claude/`-only packaging.
2. **"md → code style" prompts & instructions** — stop hand-maintaining loose markdown; drive prompts
   from a codified single source, the way Claude Code does.
3. **Copy Claude's tools / skills / utils / hard patterns** — study `claude-code-source-3rd-bk`
   (the recovered `@anthropic-ai/claude-code@2.1.88` source) and adapt its engineering into revab.

## What Claude Code actually does (patterns extracted from the source)

| Pattern | Where (in `claude-code-source-3rd-bk`) | Why it prevents wandering |
|---|---|---|
| **Prompts are code, not loose md** | every tool is a folder with `prompt.ts` exporting `getDescription()` (e.g. `src/tools/GrepTool/prompt.ts`) | one source, DRY, consistent tone; names are shared consts referenced across prompts |
| **Imperative, example-first tone** | `GrepTool/prompt.ts`: "ALWAYS use Grep… NEVER invoke grep as Bash", inline examples | short, front-loaded directives models actually follow — vs long prose they skim |
| **Rich zod `.describe()` on every field** | `GrepTool/GrepTool.ts` `inputSchema` | the model is told exactly how to use each arg → fewer wrong calls |
| **Semantic coercion utils** | `src/utils/semanticBoolean.ts`, `semanticNumber.ts` | tolerates sloppy model JSON (`"false"`→`false`) so tools don't break *across models* |
| **Content/registration split** | `src/skills/bundled/verifyContent.ts` (the md) + `verify.ts` (assembles body + args) | prompt text lives once; artifacts are generated, not hand-copied |
| **Skill = md + frontmatter, loaded generically** | `src/skills/loadSkillsDir.ts`, `parseFrontmatter` | revab already matches this — keep it |
| **Tight per-agent tool sets, agent frontmatter schema** | `src/tools/AgentTool/loadAgentsDir.ts` (name/description/tools/model) | minimal surface = fewer options to flail in |

### Root causes of revab's wandering (mapped to fixes above)

1. **Rules delegated to a file that isn't always loaded.** Every agent's *Conduct* block says the
   13 hard rules "load automatically" from `.github/copilot-instructions.md` — only true in default
   Copilot. Other models run the agent with **none of the rules present**. → Fix: rules physically
   inlined into each generated agent file (content/registration split), not referenced.
2. **Over-broad tools** (`jira/*`, 22-tool `automation.agent.md:159`). → Fix: minimal per-agent sets.
3. **Overlapping scopes / no enforced routing** (orchestrator holds every specialist's tools). →
   Fix: orchestrator gets only routing/read tools; specialists narrow; each declares "hand off to X".
4. **Copilot-only tool names** (`search/codebase`, `vscodeTasks/*`) don't resolve on other models. →
   Fix: portable tool vocabulary + upgraded MCP descriptions any model can follow.
5. **Prose-heavy, un-prioritized.** → Fix: fixed skeleton, imperative "Always/Never" front-loaded.

## Design: a codified prompt system for revab (model-agnostic)

Introduce **`prompts/` as the single source of truth**, mirroring Claude's content/registration split,
plus a generator that emits the model-facing markdown every host already reads:

```
prompts/
  shared/
    hard-rules.ts        # the 13 hard rules as one exported const (imperative, deduped)
    conduct.ts           # tool discipline, escalation, faithful-reporting, anti-hallucination
    skeleton.ts          # the fixed agent skeleton + helper to assemble a persona
  agents/
    orchestrator.ts      # per-agent spec: {name, role, owns, doesNot, flow, tools, handoff}
    researcher.ts        # …one file per agent
    …
  build.ts               # assembles specs + shared partials → writes the output files
scripts/build-prompts.ts # `npm run build:prompts` (also a --check mode for CI)
```

**Generated outputs (checked in, so every model sees real content — no runtime "auto-load"):**
- `.github/agents/<name>.agent.md` — each now **physically contains** its own rules (VS Code/Copilot).
- `AGENTS.md` (repo root) — the portable, tool-neutral instruction file most agentic clients read
  (Cursor, Claude Code via symlinked `CLAUDE.md`, others). Same content, one source.
- `.github/copilot-instructions.md` — regenerated from `shared/*` so it can never drift again.

This is the literal "md → code": prompts become **generated artifacts from typed specs**, the hard
rules live **once**, and each consumer file is self-contained → works with all models.

### Fixed agent skeleton (assembled by `skeleton.ts` for all 10)

```
name · one-line description with "use when / hand off when" · minimal explicit tools · model
# Role — one sentence
# You own / You do NOT (→ hand to <agent>)      ← kills overlap + wandering
# Flow — ≤6 numbered steps; deep detail lives in a named skill
# Always / Never — ≤6 imperative bullets, load-bearing rules INLINE (trust boundary, dry-run,
                    citation, no self-execution) — not by reference
# Hand off — next agent + what you pass
```

### Patterns copied from Claude into revab's own code

- **`utils/semanticBoolean.ts`, `utils/semanticNumber.ts`** — copied from the source; wrap the
  `dryRun`/boolean/number fields in every MCP tool's zod `inputSchema` so a model quoting `"false"`
  can't accidentally flip a dry-run guard. (Cross-model robustness — a real safety win.)
- **`prompt.ts` convention for MCP tools** — give each `mcp-servers/*/index.ts` tool a shared
  name const + an imperative, example-first `description` (audit + upgrade against the Grep exemplar),
  and a `.describe()` on **every** input field. Any model then calls them correctly.
- **`PROMPT_STYLE.md`** — the codified house style (skeleton, tone, "ALWAYS/NEVER", minimal tools,
  self-contained, examples-first) distilled from the source, so future prompts stay disciplined.
- **Skills** — already Claude-format; align each `description` to Claude's trigger-rich style
  ("Use when…; skip when…") so the right skill fires and agents stop improvising its steps inline.

### Enforced flow (structural, not prose)

```
planner (plan+approve) → orchestrator (route via delegation only)
   → researcher(read-only) → test-planner(cite→codegen) → automation(exec+codegen)
   → reporter(run+allure) → documenter(dryRun writes) → self-improve(learnings)
bsa: standalone intake → dryRun Jira bulk-create; never deletes
```
Orchestrator holds **no exec/write tools** → must delegate. Each specialist's "You do NOT" names
who takes over. This removes the capability overlap that lets any agent do everything.

## Locked decisions (defaults chosen — no further input needed to start)

- **Source format: TypeScript specs + generator.** `prompts/agents/*.ts` typed specs +
  `prompts/shared/*.ts`, assembled by `scripts/build-prompts.ts`. Matches Claude's own code,
  typechecked, fits the existing TS/npm toolchain.
- **Portable output: `AGENTS.md` + regenerated `.github/copilot-instructions.md`** from the one
  source (with `CLAUDE.md` as a thin pointer/symlink to `AGENTS.md` for zero-cost Claude support).
  Broadest cross-model reach; Copilot can never drift again.

## Roadmap (phased; each phase independently usable, all model-agnostic)

- **P0 — Commit roadmap** to `knowledge/plans/framework/2026-07-21-claude-code-discipline.md`.
- **P1 — Codified source + generator.** Build `prompts/shared/*` (hard-rules, conduct, skeleton) and
  `scripts/build-prompts.ts`; wire `npm run build:prompts` + `--check`. No behavior change yet — this
  is the machinery.
- **P2 — Regenerate instructions.** Emit `AGENTS.md` + regenerated `copilot-instructions.md` from the
  shared source; deduplicate. Rules now live once.
- **P3 — Pilot 2 agents.** Author `prompts/agents/orchestrator.ts` + `researcher.ts` to the skeleton
  (router + one specialist, minimal tools, inline rules); generate their `.agent.md`. Review the pattern.
- **P4 — Roll out remaining 8 agents** through the generator.
- **P5 — Copy Claude utils + upgrade tool descriptions.** Add `semanticBoolean/Number`, wrap MCP
  `dryRun`/bool/number fields, upgrade tool `description`s + field `.describe()`s; add `PROMPT_STYLE.md`.
- **P6 — Commands + README.** Portable slash/prompt entry points; README "Works with any model" section.

## Execution detail (makes the roadmap directly buildable)

### Per-agent minimal tool matrix (portable vocabulary, no wildcards)

Portable tool names (host-neutral): `Read Grep Glob Edit Write Bash Task WebFetch`. MCP tools are
named `mcp__<server>__<tool>`; hosts that use different tokens map these in one place, not per agent.

| Agent | Portable tools | MCP tools (enumerated, not `*`) | Notes |
|---|---|---|---|
| planner | Read, Grep, Glob | `mcp__jira__jira_search`, `mcp__confluence__confluence_search`, `mcp__artifacts__knowledge_search` | plans only; **no** exec/write |
| orchestrator | Read, **Task** | `mcp__jira__jira_search`, `mcp__artifacts__*` | routing only → must delegate |
| researcher | Read, Grep, Glob, WebFetch | jira/confluence/jtmf/github/git **read+search** only | never writes |
| test-planner | Read, Grep | `mcp__jira__*` (read), `mcp__jtmf__jtmf_search_tests`, `mcp__codegen__scaffold_feature` | cite→scaffold |
| automation | Read, Edit, Write, **Bash**, Grep | `mcp__codegen__*`, `mcp__playwright-runner__*`, `mcp__allure-report__*`, `mcp__git__*` (read) | target repo only |
| reporter | Read, **Bash** | `mcp__playwright-runner__run_bdd`, `mcp__allure-report__*`, `mcp__jira__jira_add_comment` | dryRun writes |
| documenter | Read, Edit, Write | `mcp__confluence__*` (dryRun), `mcp__media__*`, `mcp__jira__jira_get_issue` | dryRun writes |
| bsa | Read | `mcp__jira__*` (search/create/update/assign — **no delete**), `mcp__media__*` | dryRun-first |
| importer | Read, **Bash**, Write | `mcp__artifacts__*` | runs `import:agents` |
| self-improve | Read, Edit, **Bash** | `mcp__artifacts__*` | appends learnings; runs typecheck |

### Worked example (the spec → generated markdown pattern)

`prompts/agents/orchestrator.ts` (typed spec — the single source):
```ts
export const orchestrator: AgentSpec = {
  name: 'orchestrator',
  model: 'inherit',
  description: 'Routes QE work to specialists and aggregates results — use for any multi-step ' +
    'request; hand off to a specialist for the actual work.',
  role: 'You decompose a request, resolve the target project, and DELEGATE each step to a specialist.',
  owns:   ['routing', 'resolving the manifest `project`', 'aggregating specialist results'],
  doesNot:[['research/tickets', 'researcher'], ['write tests', 'automation'], ['run suites', 'reporter']],
  tools:  ['Read', 'Task', 'mcp__jira__jira_search', 'mcp__artifacts__knowledge_search'],
  flow: [
    'Resolve the `project` (ask once if ambiguous); onboard it if missing.',
    'Restate the goal as a ≤6-step plan naming the owning specialist per step.',
    'Delegate each step with the Task tool; never do a specialist’s work inline.',
    'Aggregate into one summary + next actions; append one learning.',
  ],
  handoff: 'Pass each specialist the project name, the plan path, and the step’s inputs.',
}
```
`build.ts` renders this + `shared/hard-rules.ts` + `shared/conduct.ts` through `skeleton.ts` into
`.github/agents/orchestrator.agent.md` — a self-contained file whose "Always/Never" section
**contains** the trust-boundary/dry-run/citation/no-self-exec rules inline (not referenced).

### Generator contract (`scripts/build-prompts.ts`)

- `npm run build:prompts` → regenerates every `.github/agents/*.agent.md`, `AGENTS.md`,
  `.github/copilot-instructions.md` from `prompts/**`. Each generated file starts with a
  `<!-- GENERATED FROM prompts/… — do not edit by hand -->` banner.
- `npm run build:prompts -- --check` → exits non-zero if any generated file is stale (CI guard in
  `.github/workflows/ci.yml`), so hand-edits and drift are caught.
- Deterministic output (stable ordering) so diffs are clean and reviewable.

## Files (representative — pattern repeats)

- New: `prompts/**`, `scripts/build-prompts.ts`, `AGENTS.md`, `PROMPT_STYLE.md`,
  `utils/semanticBoolean.ts`, `utils/semanticNumber.ts`.
- Regenerated (not hand-edited): `.github/agents/*.agent.md`, `.github/copilot-instructions.md`.
- Edited: `mcp-servers/*/index.ts` (descriptions, field `.describe()`, semantic wrappers),
  `package.json` (`build:prompts` script), skill `SKILL.md` descriptions (trigger-style tuning).

## Reuse (don't rebuild)

- `claude-code-source-3rd-bk`: `src/tools/GrepTool/prompt.ts` (prompt style), `src/utils/semanticBoolean.ts`
  / `semanticNumber.ts` (copy), `src/skills/bundled/verifyContent.ts`+`verify.ts` (content/registration split).
- revab: skills in `skills/*` (keep), `utils/manifest.ts` trust boundary + MCP dry-run defaults (unchanged),
  `knowledge/conventions.md`/`memory.md` (long-form the generated files link to).

## Verification

1. **Self-contained rules:** every `.github/agents/*.agent.md` physically contains its Always/Never
   rules; grep finds **no** agent body deferring its rules to `copilot-instructions.md`.
2. **Single source holds:** edit a hard rule in `prompts/shared/hard-rules.ts`, run `npm run build:prompts`
   → the change appears in all agent files + `AGENTS.md` + `copilot-instructions.md`; `--check` fails CI if stale.
3. **Model-agnostic:** the same `AGENTS.md`/agent content is plain markdown with no Claude-only or
   Copilot-only tokens; open one persona in two different VS Code models → both have the full rules.
4. **Flow holds:** "orchestrator: research epic X" → it **delegates** (no direct Jira call); researcher
   returns a cited brief and makes no writes.
5. **Boundaries hold:** automation refuses to touch `revab-agents` itself (rule 7); bsa refuses delete.
6. **Robustness:** an MCP write called with `dryRun:"false"` (string) is coerced safely; `npm run typecheck` green.
7. **Tool minimalism:** each agent's `tools:` lists only tools its body references; no wildcards.
