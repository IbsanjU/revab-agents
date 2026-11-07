# Behavior evals without an AI provider

This framework has **no dependency on an external AI provider**: no provider SDK, no hosted-model endpoint, no provider key. The model is whichever one your own editor runs (VS Code Copilot Chat, Claude Code). `npm run check:conventions` enforces it (rule 6: it fails on a provider package in any `package.json`, or on a hosted-model endpoint or provider key variable in code or config).

So behavior evals cannot call a model to run themselves. Instead you run each case in your editor, and the repo scores it from two things it can trust: the **gateway call log** and **your verdict** on what a log cannot show.

## Run a case

1. **Once:** start the gateway with the call log on: `GATEWAY_CALL_LOG=.revab/calls.jsonl npm run revab -- start`. In the VS Code extension, add `GATEWAY_CALL_LOG` to `revab.environment` and restart the gateway.
2. `npm run eval:behavior -- pack --out .revab/pack.md` writes paste-in instructions for every case (or `list` to see them with their last result).
3. For a case: `npm run eval:behavior -- mark <id>`, then in Copilot Chat (agent mode) pick the agent the case names and paste its prompt.
4. When it finishes: `npm run eval:behavior -- score <id> --model "<the model shown in the picker>" --pass M1,M2,N1,... --fail N2`.

`score` first runs the automatic checks on the calls made since the `mark`, then combines them with your verdicts. `M1…` are the rubric's *must* items and `N1…` its *must not* items, numbered as `pack` and `score` print them. The result is appended to the case's `## Runs` table with the model you named.

| Result | Meaning |
|---|---|
| **PASS** | every automatic check passed and every item is judged and passed |
| **FAIL** | an automatic check failed, or you marked an item failed. A person's "pass" cannot override the log. Exit code 1 |
| **PENDING** | automatic checks passed but some items are not judged yet |

## What the log can and cannot prove

The log records, per gateway tool call: tool, server, risk, the `dryRun` flag, success and duration. **Never argument values or results** (they hold tickets and tokens), and a logging failure can never fail a tool call. The automatic checks (`evals/behaviorChecks.ts`) are limited to what that supports: a tool that must or must not be called, no write with `dryRun: false`, no write at all, and "A was called before B". Everything else in a rubric (did it state the approval rule plainly, did it invent acceptance criteria, did it size the request correctly) stays your judgement.

**Not visible:** terminal commands, file edits, and which sub-agent made a call (a delegated call shows up in the same log). Cases that depend on those are all judgement, and say so (`0 auto` in `list`).

## What was and was not verified

Verified: the parser on all ten real cases, each check kind, the segmenting of the log by `mark`, scoring and the result row (PENDING, PASS, FAIL, replacing each kind of placeholder), that the log holds no argument or result values, and an end-to-end run against a real gateway: `mark`, real `git_log` calls, `score` produced a PENDING with the automatic checks passing, and a case with a missing call scored FAIL with exit code 1.

Not verified: a real Copilot Chat session. Every case still reads "no run recorded" until you run it. How often a given Copilot model passes is something only those runs can tell, and one run of one model is not a pass rate.
