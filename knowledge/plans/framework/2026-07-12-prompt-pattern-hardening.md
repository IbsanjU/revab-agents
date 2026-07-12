# Plan: prompt-pattern hardening (framework)

**Status**: approved (user requested "Implement the plan" for the reviewed proposal)
**Project**: framework (revab-agents itself)

## Goal

Adopt production-grade prompt-engineering *patterns* (tool discipline, output
contracts, good/bad examples, refusal scripts, verbosity calibration, completion
checklists, anti-hallucination anchors, memory hygiene, per-agent can/cannot lists)
into this framework's shared instructions and skills — without copying any external
prompt text verbatim. Success: `check:conventions`, `typecheck`, and `npm test` stay
green; every skill has an explicit **Output** contract; shared conduct rules exist in
`.github/copilot-instructions.md` for all nine agent personas.

## Steps

1. Save this plan (planner — rule #13 traceability).
2. Add an **Output** section to every `skills/*/SKILL.md` that lacks one
   (analyze-test-failures, build-test-plan-interactive, consolidate-project-report,
   detect-execution-convention, search-across-sources, update-jira-epic,
   upload-to-jtmf). `extract-requirements-from-image`/`-video` already have one.
3. Add Good/Bad contrastive example pairs for hard rules #8 (trust boundary),
   #9 (citation), and #10 (dryRun confirmation) to `.github/copilot-instructions.md`.
4. Add a shared **Agent conduct** section to `.github/copilot-instructions.md`:
   tool-preference ordering + parallelism, "When blocked" template, verbosity
   calibration, per-agent completion checklists, researcher anti-hallucination
   anchor, self-improve memory-hygiene criteria, per-agent can/cannot/must-not table.
   (Placed here rather than in `.github/agents/*.agent.md` because this execution
   environment cannot access that directory; personas there can adopt/extend these
   shared sections in a later local session.)
5. Append learnings to `knowledge/learnings.md`.
6. Validate: `npm run check:conventions`, `npm run typecheck`, `npm test`.

## Affected project(s)

- framework only (no target project touched; no test execution anywhere).

## Writes

- Local file edits in this repo only. No Jira/Confluence/JTMF/notify writes, so no
  dryRun previews are needed.

## Risks & mitigations

- Docs-drift lint failure if new text mentions unregistered tool names → only
  reference tool names already present in README.md and knowledge/memory.md.
- Skill frontmatter lint → only append sections, never touch frontmatter.
- Agent-persona edits deferred (environment restriction) → documented in step 4 and
  in learnings so a follow-up session can propagate the shared sections into
  `.github/agents/*.agent.md` if desired.

## Rollback

- Pure git revert of the commit(s); no external system state to undo.

## Deliberation

- Iteration 1: original proposal edited nine agent files directly; blocked by the
  execution environment's `.github/agents/` restriction. Revised to centralize the
  same content in `.github/copilot-instructions.md` (which the proposal itself
  recommends for shared rules), keyed per agent.
- Iteration 2: checked scope creep — dropped any idea of adding new lint checks for
  Output sections (not requested); kept changes docs-only. No open blockers.
