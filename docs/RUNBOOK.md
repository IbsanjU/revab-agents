# Runbook: run this framework as-is, and extend it

This is the operational companion to [`multi-agent-architecture.md`](./multi-agent-architecture.md).
That document explains *how* delegation, parallelism, and background execution work.
This one is the numbered list of commands to actually run the framework in this repo,
worked end to end, plus how to add to it. Every command below is copy-pasteable from the
repo root. The worked example in §4 was actually run against this repo on 2026-07-30 (see
the transcript quoted there) — it is not a hypothetical.

## 1. Prerequisites

- Node.js 20+ (`package.json` `engines.node`).
- Either host you intend to drive personas with:
  - **Claude Code CLI** — `claude --version` should print something. This runbook was
    tested against `2.1.220 (Claude Code)`.
  - **VS Code** with GitHub Copilot Chat, v1.106 or later (the version that introduced
    the `.github/agents` custom-agents system this repo generates files for).
- Real Jira/Confluence/JTMF/GitHub credentials if you want MCP-backed steps
  (researcher, documenter, reporter, bsa) to do more than report "blocked on config" —
  see `.env.example`. None of this is required to prove the delegation mechanism itself
  works (§4 doesn't need them).

## 2. First-time setup

```bash
npm install
npx revab init          # writes .env, .vscode/mcp.json, projects/manifest.json
# edit .env — set JIRA_BASE_URL, CONFLUENCE_BASE_URL, and one token per service
npx revab doctor         # tells you exactly what's still missing, and how to fix it
npm run build:prompts    # generate .github/agents/*.agent.md and .claude/agents/*.md from prompts/agents/*.ts
```

`build:prompts` is not optional — the agent files that either host reads
(`.github/agents/*.agent.md`, `.claude/agents/*.md`) are generated output. If you clone
this repo fresh they're already checked in and up to date, but run it again any time you
edit a spec, and `npm run build:prompts -- --check` in CI to catch drift.

The MCP gateway is only needed for MCP-backed steps (real Jira/Confluence/etc. calls);
the delegation mechanism itself (orchestrator → specialist) works without it, as §4
demonstrates:

```bash
npx revab start          # terminal 1 — the gateway, all tools on :7300. Leave running.
npm run worker           # terminal 2 — only if you enqueue async tasks (run-bdd, generate-report)
```

## 3. Run it, per host

### 3a. Claude Code

```bash
cd revab-agents          # this repo's root — .claude/agents/ is discovered from here
claude --agent orchestrator
```

This makes the root session **be** the orchestrator persona: its system prompt, tool
restrictions (`Read`, `Bash`, `Task`, `mcp__jira__jira_search`,
`mcp__artifacts__knowledge_search`), and model replace Claude Code's defaults entirely.
The startup header shows `@orchestrator` to confirm it's active. From here, just describe
what you need — the orchestrator dispatches to `researcher`, `test-planner`, `automation`,
`reporter`, `documenter`, `planner`, `bsa`, `importer`, or `self-improve` via the `Task`
tool (`.claude/agents/<name>.md`), never doing their job itself (see the `## Never` rule in
`prompts/agents/orchestrator.ts`).

You can also invoke a specialist directly without going through orchestrator, from a
plain `claude` session (no `--agent` flag) in this repo:

```bash
claude -p "Use the researcher subagent to find existing test coverage for 'my-project'"
```

### 3b. VS Code

1. Open this repo as a VS Code workspace.
2. Reload the window so `.vscode/mcp.json`'s `gateway` entry connects (needs
   `npx revab start` running — §2).
3. Open Copilot Chat, and pick **orchestrator** from the agent dropdown (it reads
   `.github/agents/orchestrator.agent.md`).
4. Describe the work. `orchestrator.agent.md`'s frontmatter carries
   `agents: ['planner', 'researcher', 'test-planner', 'automation', 'reporter',
   'documenter', 'bsa', 'importer', 'self-improve']` plus `'agent'` in its `tools:` list —
   VS Code's own requirement for a custom agent to actually dispatch named subagents
   (see `multi-agent-architecture.md` §2).

### 3c. Verify the VS Code / Copilot dispatch yourself

**Status as of 2026-07-30: documented but not independently re-tested from this repo's
CI/agent sandbox.** That environment has no VS Code binary, no display server, and no way
to complete Copilot's interactive OAuth login — a real attempt was made via GitHub
Copilot CLI (`npm install -g @github/copilot`, same `.github/agents/*.agent.md` format
and `agents:` dispatch mechanism, different frontend from VS Code's GUI) and it failed
outright with `Error: No authentication information found` — the sandbox's `GH_TOKEN`/
`GITHUB_TOKEN` are placeholder values for a different integration, not a real
Copilot-scoped credential, and this failure happened even with no `--agent` flag at all,
so it isn't specific to custom agents. There was no path to a real Copilot completion
from that environment, full stop.

Use one of these two to actually confirm it yourself, and please update this file (or
`multi-agent-architecture.md` §2/§4/§6) with what you observe — right or wrong, it should
stop saying "not independently re-tested" once someone has:

**Option A — VS Code GUI, closest to real usage:**

1. Open this repo in VS Code with Copilot Chat v1.106+.
2. **Check the agent dropdown first, before anything else**: it should list only
   `orchestrator`. Every specialist (`researcher`, `test-planner`, `automation`,
   `reporter`, `documenter`, `planner`, `bsa`, `importer`, `self-improve`) sets
   `user-invocable: false` in its generated `.github/agents/<name>.agent.md` frontmatter
   specifically to keep it out of this list — if any of them show up, that's a real bug to
   report (check the file's frontmatter actually has `user-invocable: false` and that
   VS Code/Copilot Chat is new enough to honor it).
3. Pick **orchestrator** from the chat agent dropdown.
4. Send this prompt (deliberately mirrors the Claude Code test in §4, so the two results
   are directly comparable):

   ```
   Use 'my-project'. I have two independent needs: (1) research existing test
   coverage for the login flow, and (2) draft an approval plan for onboarding a
   second test environment. Dispatch researcher and planner IN PARALLEL if you
   can. Tell me exactly which subagents you dispatched and whether it happened
   in parallel or sequentially.
   ```

5. Watch for: does the chat UI show a subagent/agent invocation for `researcher` and one
   for `planner` (VS Code surfaces running subagents in the response); does the final
   answer name both; does it happen as one coordinated turn or two separate exchanges. If
   `orchestrator` instead reads Confluence/Jira directly or writes a file itself, that's
   the exact regression this framework's design is meant to prevent — see
   `evals/behavior/orchestrator-delegates.md`.

**Option B — GitHub Copilot CLI, scriptable and easy to paste back verbatim:**

If you have a GitHub Copilot subscription, this is faster to run and share than a GUI
screenshot — it reads the identical `.github/agents/*.agent.md` files:

```bash
npm install -g @github/copilot
export GITHUB_TOKEN=<your real GitHub token with the "Copilot Requests" permission>
cd revab-agents
copilot --agent orchestrator -p "Use 'my-project'. Dispatch researcher and planner
IN PARALLEL to (1) research login-flow test coverage and (2) draft a second-
environment onboarding plan. Tell me exactly which subagents you dispatched and
whether it was parallel or sequential." --allow-all-tools
```

Compare the output to the Claude Code transcript quoted in §4 — same prompt shape, same
`my-project` stub, so the two are meant to be an apples-to-apples comparison of the two
hosts' dispatch mechanisms.

## 4. Worked example: parallel dispatch, end to end

This reproduces, step for step, a real run against this repo. `my-project` is the stub
project already checked into `projects/manifest.json` — it has no real repo/Jira/Confluence
linked, so the specialists will correctly report "blocked on config" rather than
fabricating results. That's the point: it proves the *dispatch mechanism*, independent of
whether your real Jira/Confluence credentials are configured yet.

```bash
cd revab-agents
claude --agent orchestrator -p "Use 'my-project'. I have two independent needs:
(1) research existing test coverage for the login flow, and (2) draft an approval
plan for onboarding a second test environment. Dispatch researcher and planner IN
PARALLEL — both Task/Agent calls in the same turn. Tell me whether you dispatched
them in one turn or sequentially."
```

**What actually happened** (verbatim, this exact run):

> Both researcher and planner agents were dispatched in a single turn via a single
> `<function_calls>` block (not sequentially). They executed in parallel and have both
> now reported.

- `researcher` correctly reported `my-project` has zero test coverage, an empty repo
  path, and named the three things needed before coverage could even be assessed
  (link a repo, define login-flow requirements, scaffold test structure) — it did not
  invent test results.
- `planner` drafted a full onboarding plan (12 phased steps, risks, success criteria) and
  **stopped before saving it**, asking four clarifying questions first — because
  hard rule 13 (planner-first) and the dry-run-first rule require an approved plan before
  anything executes or gets written. `git status --short` after the run was empty: no
  file was written without approval.

To see the tool-scoping enforcement directly (not just the orchestrator's own claim about
it), dispatch a specialist and ask it to self-report:

```bash
claude -p "Call Agent(subagent_type: 'researcher') and ask it: 'Without calling any
tools, tell me exactly which tools you have right now, and whether you have Write,
Edit, or a Task/Agent dispatch tool.' Return exactly what it says."
```

Expect it to report only its declared read-only tools (`Read`, `Grep`, `Glob`,
`WebFetch` for `researcher` — plus whichever MCP tools are actually connected in your
session) and explicitly no `Write`/`Edit`/dispatch tool. If your run reports something
broader than `.claude/agents/researcher.md`'s `tools:` line, something is misconfigured —
that mismatch is exactly the failure class this whole framework's tool-scoping exists to
prevent.

## 4a. Worked example: orchestrator as manager (routing + review), not a worker

This confirms orchestrator uses `route-to-specialist` before dispatching and
`review-delegated-work` before aggregating — not just delegating once and passing
whatever comes back straight through.

```bash
claude --agent orchestrator -p "Use 'my-project'. I need to know what test coverage
exists for the login flow. Before you dispatch anything, tell me which specialist
you're routing this to and why (per the route-to-specialist skill). After the
specialist returns, explicitly run the review-delegated-work check on its result and
tell me the outcome, before giving me your final summary."
```

**What actually happened** (verbatim, this exact run, 2026-08-05):

> **Specialist routing:** Researcher — *"This is a read-only discovery task requiring me
> to search across multiple sources... The researcher agent is designed exactly for
> this."*

Then, after dispatch, the review ran as an explicit table (scope / citations /
completeness / accuracy), each row checked against the researcher's actual citations
(e.g. `project.json:3-4`, `app-model.md:1-7`) — outcome **APPROVED** — before the final
summary was produced. `git status --short` was empty afterward.

## 5. Extend the framework

All of the following start the same way: **edit the spec, never the generated file.**
`.github/agents/*.agent.md` and `.claude/agents/*.md` both carry a
`<!-- GENERATED FROM ... -->` banner for this reason.

### Add a new agent persona

1. Create `prompts/agents/<name>.ts` exporting an `AgentSpec` (see any existing file —
   `prompts/agents/researcher.ts` is a good short one to copy).
2. Register it in `prompts/agents/index.ts`'s `AGENTS` array.
3. Run `npm run build:prompts` — this produces both
   `.github/agents/<name>.agent.md` and `.claude/agents/<name>.md`, and adds it to every
   other persona's sibling roster automatically (`renderAgentMarkdown`'s `siblingNames`
   parameter in `prompts/build.ts`) — you do not hand-maintain that list anywhere.
4. If the orchestrator should be able to dispatch it, no extra step is needed: orchestrator's
   `agents:`/sibling list is derived from `AGENTS` minus itself, so a new entry is
   automatically dispatchable from both hosts once step 3 runs.
5. If this agent has capabilities that must never regress (a tool it needs, a tool it must
   never hold), add a `CapabilityExpectation` in `evals/capabilities.ts` and run `npm run eval`.
6. Run the full gate before committing: `npm run build:prompts -- --check && npm run
   typecheck && npm run check:conventions && npm run eval && npm test`.

### Add a new MCP tool to an existing server

Add `server.registerTool(...)` in `mcp-servers/<server>/index.ts` (reuse helpers from
`mcp-servers/shared/`). If it touches a target project's repo, take a `project` argument
and resolve the path via `utils/manifest.ts` — never accept a raw path. Document the new
tool name in `README.md` and `knowledge/memory.md`; `npm run check:conventions` fails CI
if either is missing it.

### Add a new MCP server

New folder under `mcp-servers/`, call `startMcpHttpServer(...)`, register its port in
`.vscode/mcp.json`, `.env.example`, and add a `serve:<name>` script in `package.json`. Host
it through the gateway (`mcp-servers/gateway/tools.ts`) rather than giving it its own
`.vscode/mcp.json` entry, to avoid double-registering every tool in the editor.

### Add a new async queue task type (the non-LLM fallback path)

Add a handler to `agents/registry.ts`'s `handlers` map — see the existing `run-bdd`/
`generate-report`/`typecheck`/`import-agents` entries for the shape. Remember: this queue
runs deterministic npm scripts, not an LLM persona — it exists as the fallback for a host
with neither a `Task`-style tool nor VS Code's `agent` tool, and it's a completely
different mechanism from persona dispatch (see `multi-agent-architecture.md` §5c). Update
`knowledge/memory.md`'s orchestrator/queue bullet to mention the new type.

### Add a new skill

`skills/<name>/SKILL.md` with valid frontmatter (`name` matching the directory,
non-empty `description` — `npm run check:conventions` enforces this). A skill composes
existing tools; it isn't new I/O (that's an MCP tool) and it isn't a new persona.

## 6. Troubleshooting

| Symptom | Check |
| --- | --- |
| A generated agent file looks stale / hand-edited drift | `npm run build:prompts -- --check` — lists exactly which files are out of date; run `npm run build:prompts` (no `--check`) to fix |
| `claude --agent orchestrator` fails to find the agent | Confirm you're in (or under) the repo root — Claude Code discovers `.claude/agents/` by walking up from cwd; confirm `.claude/agents/orchestrator.md` exists |
| Orchestrator does a specialist's job itself instead of delegating | Check which host you're on and whether its dispatch mechanism is actually active (§2/§6 of `multi-agent-architecture.md`) — if neither `Task`/`Agent` nor VS Code's `agent` tool is available, the spec requires it to stop and name the specialist, not do the work; if it did the work anyway, that's a regression — file it against the exact rubric in `evals/behavior/orchestrator-delegates.md` |
| MCP tool calls fail to connect | `curl http://localhost:7300/health` should return `{"ok":true,"tools":76}`; if not, run `npx revab start` (gateway) or `npx revab doctor` |
| A queue task never completes | `npm run task -- status`; confirm `npm run worker` is actually running in a separate terminal |
| Capability eval fails after a spec edit | `npm run eval` names exactly which tool/statement is missing and why (`evals/capabilities.ts`'s `because` field is written for this) |
| A specialist shows up in VS Code's agent dropdown (should be hidden) | Check its `.github/agents/<name>.agent.md` has `user-invocable: false` — regenerate with `npm run build:prompts` if missing; see `multi-agent-architecture.md` §8 |
| You corrected the same agent for a similar reason more than once | `npm run correction -- log ...` prints a `⚠ REPEATED PATTERN` notice the moment that happens — act on it in that turn (`skills/capture-correction/SKILL.md` Phase 3.5), don't wait for `self-improve`'s end-of-session pass |

## Sources

Command references in this file come from `package.json`'s `scripts`, `README.md`, and
`prompts/build.ts`/`prompts/shared/skeleton.ts` in this exact repo — not from general
documentation. The Claude Code CLI usage (`claude --agent`, `Task`/`Agent` dispatch,
`subagent_type`) is cross-referenced against
[Create custom subagents](https://code.claude.com/docs/en/sub-agents); see
`multi-agent-architecture.md`'s Sources section for the complete list.
