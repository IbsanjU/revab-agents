---
name: build-capability
description: Research a topic and turn it into a new reusable capability — a skill, an MCP tool, or a util — then validate it and wire it into the agents that should use it. Use when the framework is missing an ability ("we should be able to X", a repeated manual workaround, a new tool/practice to adopt). Skip when an existing skill/tool already covers it (extend that instead) or when the need is a one-off.
---
# Build capability

The framework's growth loop: go from "we can't do X" to a validated, adopted capability —
without every request turning into another prose file nobody uses. Research first, route the
result to the **right kind of artifact**, prove it works, then wire it into the agents that
need it.

Complements `skillify` (captures a process the session *already did*); this one **researches
and designs** something the framework doesn't have yet.

## Phase 0 — Frame the request
State in one line each: the **capability** ("federate search across X"), the **goal** it
serves, the **consumers** (which agents/skills would use it), and the **trigger** (when it
should fire). If you can't name a consumer, stop — an unused capability is cost, not value.

## Phase 1 — Check it doesn't exist
Search `skills/`, `mcp-servers/*/index.ts`, and `utils/` plus `knowledge_search` for prior
art. If something is close, **extend it** — a near-duplicate skill splits the trigger space
and makes both fire unreliably. Say what you found and why it's insufficient.

## Phase 2 — Research
Use the researcher's sources, not intuition: `knowledge/` and prior plans first, then the
systems of record, then `github_search_code`/`github_search_repos` for how it's actually
implemented elsewhere (label public findings **external**), then docs. Collect:
- the standard approach and its failure modes,
- constraints in this framework (trust boundary, dry-run, no self-execution),
- concrete examples of inputs and expected outputs.
Cite every source. Paraphrase external material — never paste large verbatim blocks.

## Phase 3 — Route by type (the important step)
Pick exactly one destination; the wrong one is why frameworks rot:

| If the capability is… | It becomes… | Because |
|---|---|---|
| An ordered **process** composing existing tools, no new I/O | a **skill** — `skills/<name>/SKILL.md` | prompt-level playbook, loaded on demand |
| New **I/O**: shell, filesystem, HTTP, an external API | an **MCP tool** — `mcp-servers/<server>/index.ts` | only servers may perform I/O; needs a zod schema + dry-run if it writes |
| Shared **logic** used by tools/scripts | a **util** — `utils/<name>.ts` | code reuse (hard rule #1), unit-testable |
| A recurring **command** sequence | a **script** — `scripts/<name>.ts` + npm script | operator-facing, not agent-facing |
| A change in **judgment/behavior** | a rule in `prompts/shared/` or an agent spec | no new artifact needed |

If it spans types, split it: the I/O part is a tool, the procedure around it is a skill.

## Phase 4 — Design spec (before writing anything)
Write a short spec and get agreement: purpose · trigger ("use when… / skip when…") ·
inputs & outputs · steps · failure modes · which hard rules constrain it (dry-run? citation?
manifest?). For a write-capable MCP tool, `dryRun: true` is mandatory by default.

## Phase 5 — Build it
Follow `PROMPT_STYLE.md`: imperative and example-first; a trigger-rich `description`; every
zod field `.describe()`d; booleans/numbers wrapped with `semanticBoolean`/`semanticNumber`;
flat lists; deep detail in the skill, not in an agent body.

## Phase 6 — Validate before adoption (the gate)
Nothing is adopted until it passes:
- Run it on **2–3 real example inputs**, including one edge/failure case. Show the outputs.
- New MCP tool → unit tests for schema validation and the dry-run default; `npm run typecheck`.
- New skill → walk it end-to-end once and confirm each step's tool actually exists.
- Add a case to `evals/` (structural in `capabilities.ts`, behavioral in `behavior/`) and run
  `npm run eval`.
If it fails, fix or abandon it — do not wire a failing capability into agents.

## Phase 7 — Adopt across the framework
Cheap, because agents are generated:
- Add the skill to each consumer's `skills:` list in `prompts/agents/<agent>.ts`; grant a new
  MCP tool only to the agents that genuinely need it (no wildcards).
- `npm run build:prompts`, then `npm run check:conventions` (docs/tool-list drift) and
  `npm run eval`.
- Update README's skill/tool list and `knowledge/memory.md` if it changes framework facts.
- Record it with `capture-learning` — what it is, when to use it, what it replaced.

## Rules
- Generic and parameterized: no project/ticket/org hardcoded into a capability.
- One capability, one artifact of one type — split rather than blur.
- A skill never performs new I/O; propose an MCP tool for that instead.
- Never adopt an unvalidated capability, and never grant a tool "just in case".
