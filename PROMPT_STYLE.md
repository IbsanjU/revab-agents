# Prompt style — how revab-agents writes agents, prompts, and tool descriptions

Distilled from Claude Code's own source (`claude-code-source-3rd-bk`) and adapted here. The point
is behavioral: agents that follow this style stay on-task across **any** model instead of
wandering, over-doing, or ignoring rules. Follow it for every new agent, skill, and MCP tool.

## 1. Prompts are code, not loose markdown

Agents are **generated**, not hand-written. Author a typed spec in `prompts/agents/<name>.ts`, then
run `npm run build:prompts`. The generator inlines the shared rules and conduct into every output
file (`.github/agents/*.agent.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md`), so
the rules are physically present for whatever model loads them — never "auto-loaded" from a file one
host happens to inject. **Never hand-edit a generated file** (each carries a `GENERATED` banner).

Rules and conduct live once, in `prompts/shared/hard-rules.ts` and `prompts/shared/conduct.ts`.
Change them there; the change propagates to all files. `npm run build:prompts -- --check` (in CI)
fails if any generated file drifts from the source.

## 2. Self-contained personas

Every agent must carry its own load-bearing rules. Do not write "see the shared rules file" — the
skeleton inlines the non-negotiable rules (#7 trust boundary, #8, #9 citation, #10 dry-run, #13
planner-first) and a compact conduct block into each persona. A persona may *tighten* a shared rule,
never loosen it.

## 3. Minimal, explicit tools

List only the tools an agent actually uses — **no wildcards** (`jira/*` becomes the specific
`mcp__jira__jira_search`, `mcp__jira__jira_get_issue`, …). Fewer tools = fewer equally-weighted
options = less flailing. If an agent needs a capability it shouldn't own, that's a hand-off, not a
new tool grant.

## 4. Clear ownership + hand-off boundaries

Each spec states **You own** and **You do NOT (→ hand off to X)**. This removes the scope overlap
that lets any agent quietly do another's job. The orchestrator holds no execution/write tools, so it
must delegate.

## 5. Imperative, example-first, front-loaded

- Lead with the directive: "ALWAYS use X / NEVER do Y", then a one-line example.
- Put the most important rule first; models attend to the top.
- Keep flows to ≤6 numbered steps — a decision path, not an exhaustive playbook. Deep procedure
  lives in a **skill** the agent names, loaded on demand.
- Flat lists only — never nest bullets.

## 6. Tool descriptions the model can't misread

For every MCP tool in `mcp-servers/*/index.ts`:

- Give the tool an imperative `description` with the key usage rule and an example (see
  `GrepTool/prompt.ts` in the source as the exemplar).
- Put a `.describe()` on **every** input field — say what it's for and its default.
- Wrap boolean/number fields with `semanticBoolean` / `semanticNumber` (`utils/`) so a model that
  quotes a value (`"dryRun":"false"`) is coerced correctly instead of erroring or silently
  defeating a guard.

## 7. Skills carry the depth

A skill (`skills/*/SKILL.md`) is a reusable playbook composing existing tools — no new I/O. Give it
a trigger-rich description ("Use when …; skip when …") so the right skill fires and agents stop
improvising its steps inline.
