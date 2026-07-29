---
name: skillify
description: Capture a repeatable process this session performed into a new reusable skill (skills/<name>/SKILL.md), generic and parameterized. Use when the same multi-step process was done by hand — or is likely to recur — and no existing skill covers it, especially at self-improve time. Skip for a one-off sequence unlikely to repeat, or when an existing skill already fits (extend it instead).
---
# Skillify

Turns a repeatable process the session just did into a reusable playbook, so the next agent runs it
consistently instead of re-improvising. This is how the framework *improves* over time — the counterpart
to `capture-learning` (which stores facts; this stores procedures).

## Phase 1 — Decide if it's worth a skill
- Was this a **process** (an ordered sequence of steps composing existing tools), not a single fact? If a
  fact, use `capture-learning` instead.
- Is it likely to recur, and does **no existing skill** already cover it? Search `skills/` first — if one
  is close, extend that skill rather than adding a near-duplicate.
- A skill composes existing tools only — **no new I/O**. If it needs a new tool (shell/file/HTTP), that's
  an MCP tool (`mcp-servers/*`), not a skill.

## Phase 2 — Generalize the steps
Strip this session's specifics and rewrite the process so any project/input works:
- Parameterize names, keys, paths (`<project>`, `<epic-key>`) instead of hardcoding this run's values.
- Reference the actual tools/skills each step uses by name.
- Capture the *decisions* the user steered (what to check, what to skip, the order that mattered) — those
  are the valuable part, not just the happy path.

## Phase 3 — Write the skill
Create `skills/<kebab-name>/SKILL.md` with:
- **Frontmatter**: `name:` (matching the directory) and a trigger-rich `description:` — one line saying
  what it does, **"Use when …"**, and **"Skip when …"** so the right skill fires and agents stop
  improvising its steps inline.
- **Body**: a short imperative playbook — numbered phases, flat lists, each step naming the tool/skill it
  uses. Deep enough to follow without the original session, short enough to scan.

## Phase 4 — Wire it in
- Add the skill to the relevant agent's `skills:` list in `prompts/agents/<agent>.ts` (then
  `npm run build:prompts`) so that persona knows to reach for it.
- Note the new skill in `knowledge/learnings.md` via `capture-learning`.

## Rules
- Generic and parameterized — a skill hardcoded to one project/ticket is not reusable.
- Compose existing tools only; propose an MCP tool separately if new I/O is required.
- Don't duplicate an existing skill — extend it instead.
