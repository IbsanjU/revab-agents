# Lessons

Atomic, evidence-backed behaviours the framework has learned. Free-form notes stay in `learnings.md`; a lesson goes here when it has a **trigger** and an **action** and you can cite where it was observed.

Each lesson is a block of `key: value` lines separated by a blank line. **Confidence is computed, not written**: `(1 - 0.7^support) * 0.5^contradict`. Record a repeat with `npm run lessons -- reinforce <id> --evidence "<where>"` (add `--against` for a contradiction) rather than adding a near-duplicate. At 3 supporting observations and no contradiction a lesson is ready to promote into a skill or `prompts/shared/conduct.ts`: `npm run lessons -- promote`. Format and rules: `skills/capture-learning/SKILL.md`.

scope is `global`, or `project:<name>` so a project's lesson cannot leak into another.

id: exercise-the-real-path
trigger: when a feature talks to something outside the process (a subprocess, a browser, a bundler, an editor API)
action: run it for real once, end to end, before calling it done; a test against a stub passing proves only the stub
scope: global
domain: verification
support: 3
contradict: 0
evidence: PR #17 whisper-setup reported success while installing into the system Python and PyAV 19 crashed every transcription, both found only by running it; playwright-mcp-vscode PR #3 redirect bypass found only by driving a real browser; extension phase 2 ran a stale dist/ gateway that ignored new settings (memory.md)
last: 2026-11-07

id: stacked-pr-closes-on-base-delete
trigger: when a PR is opened with another PR's branch as its base
action: expect it to be closed (not merged) when the base is merged and its branch deleted; target the default branch once the base is in, or re-land
scope: global
domain: workflow
support: 1
contradict: 0
evidence: PR #19 closed unmerged after #18 merged; re-landed as #20
last: 2026-11-07

id: count-from-the-registry
trigger: when reporting how many tools, skills or agents exist
action: count from the live registry the program uses, not a regex over source; test files register fakes and inflate the number
scope: global
domain: accuracy
support: 1
contradict: 0
evidence: first graph prototype reported 79 tools including a test-only `jira_delete_issue`; captureAllTools() gives the real 78 (PR #20)
last: 2026-11-07

id: ratchet-do-not-switch-off
trigger: when a new check fails on existing code
action: baseline the current findings with a written reason each and make the check fail only on new ones or on a fixed one left behind; never loosen the rule or skip the check
scope: global
domain: quality-gates
support: 1
contradict: 0
evidence: capability graph baseline 76 findings, triaged to 40 with reasons (PR #20, #21)
last: 2026-11-07

id: grant-tools-by-need
trigger: when an agent is missing a tool a skill names
action: first ask whether the step belongs to another agent or the skill text is only naming who should do it; grant only when the owner genuinely performs the step, with a capability eval and a because
scope: global
domain: agent-design
support: 1
contradict: 0
evidence: graph triage cut 76 findings to 40 mostly by granting 7 agents the reads they needed and rewording 3 skills (PR #21)
last: 2026-11-07

id: scale-the-writing-not-the-approval
trigger: when adding right-sizing or fast paths to a gated workflow
action: reduce how much is written for a small request but keep every approval gate; make the safety floor explicit (risky work is only ever up-tiered)
scope: global
domain: planning
support: 1
contradict: 0
evidence: size-and-slice skill and planner `always` rules, mutation-checked capability evals (PR #22)
last: 2026-11-07
