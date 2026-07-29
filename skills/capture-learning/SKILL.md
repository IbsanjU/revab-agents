---
name: capture-learning
description: Turn a raw session observation into a durable, GENERIC learning and file it in the right place (knowledge/learnings.md, conventions.md, memory.md, or a skill). Use whenever a session surfaces something worth keeping — a new org quirk, a failed approach, a decided convention — especially at self-improve time. Skip for one-off task state that won't be true next month.
---
# Capture learning

Writes what a session learned so future sessions start smarter — but **generic by construction**, never
a one-off note. This is the framework's learn-over-time loop: agents read `knowledge/` at session start,
so a learning is only worth storing if it will still be true, and useful, beyond the task that produced it.

## Phase 1 — Generalize before you store
Rewrite the raw observation into its reusable form **first**:
- Strip the one-off specifics (this ticket, this run, today's date-as-state) and keep the rule behind them.
- Parameterize: "PROJ-123's board id is 42" → "a project's board id comes from `jira_get_boards`, not a
  guess"; "the login test flaked" → "auth tests need an explicit wait on the session cookie, not a sleep".
- State it as an instruction or fact a stranger could apply, not a diary entry.

Apply the bar (memory hygiene): keep it only if it is **durable** (won't be false next month),
**generalizable** (applies beyond this task), **non-sensitive** (no tokens/credentials/personal data),
and **not trivially re-derivable** from the code itself. If it fails the bar, don't store it.

## Phase 2 — Pick the destination
| Destination | What belongs there |
|---|---|
| `knowledge/learnings.md` | Dated, durable learnings: org quirks, failed approaches, patterns that worked. |
| `knowledge/conventions.md` | A decided, ongoing convention the whole framework should follow. |
| `knowledge/memory.md` | A changed framework fact (new port, tool name, setup step) future sessions must start with. |
| a **skill** (`skillify`) | A repeatable *process* — promote it to `skills/<name>/SKILL.md` instead of prose. |
| nowhere | One-off task state, ephemeral status, or anything re-derivable — drop it. |

## Phase 3 — Dedup and consolidate
Before writing, `knowledge_search` (artifacts server) for an existing entry on the same fact.
- If one exists: **update or consolidate** it — don't append a near-duplicate.
- If it contradicts an older entry: fix the older one (delete entries proven wrong; don't stack corrections).

## Phase 4 — Write it
Append a dated, factual, flat entry (`### YYYY-MM-DD`, one line per learning). Via the artifacts
`knowledge_append` tool or a direct edit. Keep it short — a rule, not a story.

## Rules
- Generic or nothing: if you can't state it in reusable form, it isn't a learning yet.
- Never store secrets, personal data, or anything the user asked to keep private.
- A recalled learning reflects what was true when written — before acting on one that names a specific
  file/selector/endpoint/flag, verify it still matches current state.
