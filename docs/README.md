# docs/

Deep-dive documentation that sits below the top-level `README.md`. The root `README.md`
tells you how to run the framework day to day; these two files explain *how the
multi-agent system actually works* and give you a step-by-step runbook to operate and
extend it.

| File | What it's for |
| --- | --- |
| [`multi-agent-architecture.md`](./multi-agent-architecture.md) | The multi-agent system itself: what a "persona" is, how delegation is wired on each real host (Claude Code, VS Code), what's real dispatch vs. prose, parallel execution, background/async execution, nesting limits, and the hard numeric limits that apply. Every claim is cited to the primary source it came from and dated; anything not independently re-verified in this repo is labeled as such. |
| [`RUNBOOK.md`](./RUNBOOK.md) | Operational: first-time setup, how to actually run this framework as-is on each host, a complete worked end-to-end example (dispatch two specialists in parallel and read the result), how to extend the framework (new agent/tool/skill/task type), and troubleshooting. |

**Provenance note.** Everything in `multi-agent-architecture.md` about Claude Code and VS
Code platform behavior (parallel dispatch, background execution, nesting depth, session
limits, tool scoping) was pulled from each product's own current documentation on
2026-07-30 and, where practical, independently re-tested against this exact repo with a
real `claude` CLI session rather than assumed. Where a claim could not be independently
re-tested (VS Code's parallel-subagent execution, tool-scoping enforcement, and the
hide-from-picker frontmatter added 2026-08-05), the document says so explicitly instead of
presenting it as verified — a real attempt was made via GitHub Copilot CLI (same
agent-file format, different frontend from VS Code's GUI) and it failed on missing
Copilot-scoped authentication, not on anything specific to this repo's agent files.
`RUNBOOK.md` §3c has a ready-to-run prompt for whoever next has real VS Code/Copilot
access to close that gap. Claude Code claims were re-verified again on 2026-08-05
alongside the new orchestrator-as-manager and repeated-correction-pattern changes.
