# Multi-agent architecture

How delegation, parallelism, and background execution actually work in this framework,
on each host it targets. Every platform-level claim below (not about this repo's own
code) is cited to its primary source. Facts marked **[verified in this repo]** were
independently re-tested against this exact codebase with a real `claude` CLI session on
2026-07-30, not assumed from the docs. Facts marked **[not independently re-tested]**
come from vendor documentation only, because this environment has no way to drive the
relevant UI (there is no VS Code editor available here) — don't treat those as weaker
claims about what the vendor ships, only as claims this repo hasn't itself confirmed. A
real attempt was made on 2026-07-30 to close that gap via GitHub Copilot CLI (same
`.github/agents/*.agent.md` format, different frontend from VS Code's GUI): it failed
outright with `Error: No authentication information found` — this environment's
`GH_TOKEN`/`GITHUB_TOKEN` are placeholders for a different integration, not a real
Copilot-scoped credential, and no VS Code binary or display server exists here either.
**[`RUNBOOK.md` §3c](./RUNBOOK.md#3c-verify-the-vs-code--copilot-dispatch-yourself)** has
a copy-pasteable prompt (both a VS Code GUI version and a Copilot-CLI version) for
whoever next has real Copilot access to close this out — please update the labels below
once someone has.

## 1. Vocabulary

- **Persona / spec** — one agent's definition, authored once as a typed `AgentSpec` in
  `prompts/agents/<name>.ts` (role, owned scope, hand-off boundaries, tool list, flow).
  This is the single source of truth; nothing else is hand-edited.
- **Generated agent file** — the persona rendered into a format a specific host reads:
  `.github/agents/<name>.agent.md` (VS Code / GitHub Copilot) and `.claude/agents/<name>.md`
  (Claude Code). Both are produced by `npm run build:prompts` from the same spec — see
  `prompts/build.ts` and `prompts/shared/skeleton.ts`.
- **Dispatch** — one persona invoking another as a subagent, as an actual tool call the
  host executes, not just naming it in prose.
- **Host** — the running program interpreting these files: Claude Code (CLI/desktop/web)
  or VS Code with GitHub Copilot Chat (v1.106+, "custom agents").

## 2. The two real hosts, side by side

| Concept | Claude Code | VS Code (Copilot custom agents, v1.106+) |
| --- | --- | --- |
| Persona file | `.claude/agents/<name>.md` | `.github/agents/<name>.agent.md` |
| Frontmatter identity field | `name` | `name` |
| Dispatch tool | `Task` (renamed `Agent` as of Claude Code v2.1.63; `Task(...)` still works as an alias in settings/agent definitions) | `agent` toolset, backed by the single tool `agent/runSubagent` |
| What authorizes *which* subagents a parent can reach | `Agent(agent_type, ...)` allow-list syntax inside that parent's own `tools:` list, e.g. `tools: Agent(researcher, documenter), Read, Bash` — or bare `Agent`/`Task` to allow spawning any subagent | `agents: [...]` frontmatter field listing subagent names by their `name:` value (or `'*'` for all, `[]` for none) |
| Invoked by | `Task`/`Agent` tool call with a `subagent_type` (or a plain agent name) | the `agent/runSubagent` tool, described in prose in the parent's own instructions |
| Run the whole session as a persona | `claude --agent <name>` — the named subagent's system prompt, tools, and model replace the session's default entirely | not documented as an equivalent CLI flag; VS Code personas are chosen from the chat agent dropdown per conversation |
| This repo's orchestrator file | `.claude/agents/orchestrator.md` — keeps `Task`, has no `agents:`-equivalent restriction (Claude's allow-list syntax lives in the *caller's* `tools:`, which we leave open — see §7) | `.github/agents/orchestrator.agent.md` — `tools: [..., 'agent']` plus `agents: ['planner', 'researcher', 'test-planner', 'automation', 'reporter', 'documenter', 'bsa', 'importer', 'self-improve']` |
| Default nesting (subagent → its own subagent) | 3 layers below the main conversation, as of Claude Code v2.1.219+ | **off** — `chat.subagents.allowInvocationsFromSubagents` defaults to `false` |
| Tool scoping enforcement | Hard-enforced by the host — **[verified in this repo]**, see §6 | Documented as enforced by the host tool grant system — **[not independently re-tested]**, see §6 |

Sources: Claude Code — [Create custom subagents](https://code.claude.com/docs/en/sub-agents),
[Run agents in parallel](https://code.claude.com/docs/en/agents). VS Code — [Custom agents in
VS Code](https://code.visualstudio.com/docs/agent-customization/custom-agents),
[Subagents in Visual Studio Code](https://code.visualstudio.com/docs/agents/subagents),
[VS Code chat tools reference](https://code.visualstudio.com/docs/agents/reference/ai-features-cheat-sheet).

## 3. Autonomy: what changed and why it matters

Before the fix this document describes, the orchestrator persona had a real `Task` tool
listed in its portable spec, but:

- The generated Claude Code file (`.claude/agents/`) didn't exist for `orchestrator`
  itself, so `claude --agent orchestrator` — the way to actually run this framework's
  root persona on Claude Code — had nothing to load.
- The generated VS Code file had no `name:` field and no `agents:` field, so even though
  VS Code's custom-agents system supports real subagent dispatch (the `agent` tool +
  `agents:` allow-list), nothing in the generated file told VS Code which agents
  `orchestrator` was allowed to reach. Two of the mapped tool identifiers
  (`execute/runTask`, `read/getTaskOutput`) also didn't exist as real VS Code tools.
- The result, observed directly: on a host where tool scoping wasn't hard-enforced, the
  orchestrator persona did a specialist's job itself (read a file, called Confluence,
  wrote a draft) instead of delegating, because no real, working delegation mechanism was
  wired up for it to use.

Both generated files now carry a real dispatch mechanism (§2). This was independently
re-tested end to end in this repo — see §4 and §5 for the actual transcripts.

## 4. Parallel dispatch

### Claude Code

The parallel-research pattern is explicitly documented: *"For independent investigations,
spawn multiple subagents to work simultaneously... Each subagent explores its area
independently, then Claude synthesizes the findings. This works best when the research
paths don't depend on each other."* (["Create custom subagents" §
"Run parallel research"](https://code.claude.com/docs/en/sub-agents#common-patterns)).
Mechanically, this means issuing more than one `Task`/`Agent` tool call within the same
assistant turn (the same `<function_calls>` block) instead of one call, waiting for the
result, then the next.

**[verified in this repo]** Ran, against this exact repo:

```
claude --agent orchestrator -p "Use 'my-project'. I have two independent needs:
(1) research existing test coverage for the login flow, and (2) draft an approval
plan for onboarding a second test environment. Dispatch researcher and planner IN
PARALLEL — both Task/Agent calls in the same turn. Tell me whether you dispatched
them in one turn or sequentially."
```

Result (verbatim from the transcript):

> **Dispatch confirmation:** Both researcher and planner agents were dispatched in a
> single turn via a single `<function_calls>` block (not sequentially). They executed in
> parallel and have both now reported.

Both subagents produced real, distinct output (researcher correctly reported the stub
`my-project` has zero test coverage and no linked repo; planner drafted a full onboarding
plan with open questions) and the planner correctly withheld writing the plan file
pending user approval — no untracked files were created (`git status --short` was empty
after the run), consistent with hard rule 13 (planner-first) and the "dry-run first for
writes" rule.

**Numeric limits that bound this** (Claude Code):

- **Concurrent subagent limit**: 20 running subagents per session by default. Spawning a
  21st fails with `Concurrent subagent limit reached` until one finishes. Configurable via
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (Claude Code v2.1.217+). Sessions with
  `ultracode` effort active are exempt.
- **Session subagent limit**: 200 subagents total per session by default (every spawn
  counts, including nested and background ones). Configurable via
  `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` (v2.1.212+, no upper bound, can't be disabled).
  `/clear` resets the count.

Source: [Create custom subagents — "Session subagent limit" /
"Concurrent subagent limit"](https://code.claude.com/docs/en/sub-agents#session-subagent-limit).

### VS Code

*"VS Code can now run multiple subagents in parallel. Fire off multiple tasks at once,
get results faster, and save premium requests in the process."* — [VS Code blog, "Your
Home for Multi-Agent Development" (2026-02-05)](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development).
**[not independently re-tested]** — this is an announcement post, not a technical
reference; it states the capability exists but doesn't publish a concurrency number or
exact trigger syntax, and this environment has no VS Code UI to confirm it against this
repo's generated files directly. Practically: give `orchestrator.agent.md`'s body an
instruction naming which of its steps are independent (mirroring the Claude Code
guidance below), and let VS Code's own coordinator behavior parallelize them. Use
[`RUNBOOK.md` §3c](./RUNBOOK.md#3c-verify-the-vs-code--copilot-dispatch-yourself) to test
this directly against this repo's `orchestrator.agent.md`.

### What this framework's orchestrator spec now says

`prompts/agents/orchestrator.ts`'s `always` list instructs it to dispatch independent
steps in parallel (one turn, multiple dispatch calls) and only sequence steps where one
step's output feeds the next — the same distinction the Claude Code docs draw. This is
spec text, inlined into both generated files, not a host-specific mechanism.

## 5. Background / async execution — three unrelated mechanisms

There are three different things that could be called "background" here. Don't conflate
them — they solve different problems and none of them substitute for the others.

### 5a. Claude Code background subagents

*"Background subagents run concurrently while you continue working."* As of Claude Code
v2.1.198, subagents run in the background **by default**; Claude runs one in the
foreground only when it needs the result before continuing. A subagent's own frontmatter
can force this with `background: true`; a user can press **Ctrl+B** to background a
running task, or ask Claude to run something in the background explicitly.

A background subagent gets a **reduced, fixed built-in tool set** — regardless of what
its `tools:` frontmatter says, Claude Code strips it down to: `Read`, `Grep`, `Glob`,
`Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`,
`TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`,
`SendMessage`, and `Artifact` — plus every MCP tool it was granted. A permission prompt a
background subagent hits surfaces in the main session naming which subagent is asking
(as of v2.1.186); before that version it auto-denied instead. Its results reach the main
conversation as a completion notification in a later turn (v2.1.211+) — the main
conversation reports "still running" if asked about progress before that arrives.

Two environment variables govern this globally:

- `CLAUDE_CODE_FORK_SUBAGENT=1` — makes every subagent (fork or named) run in the
  background, and the `background` frontmatter field stops mattering.
- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` — disables background execution entirely, and
  takes precedence over the fork-mode variable above.

Source: [Create custom subagents — "Run subagents in foreground or
background"](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background).

Separately, Claude Code also has **agent view** (`claude agents`) for running whole
*sessions* (not subagents inside one session) in the background and monitoring them from
one screen, and experimental **agent teams** (multiple coordinated sessions with a shared
task list, disabled by default) and **dynamic workflows** (a script driving many
subagents and cross-checking results, for work too large for one turn's coordination).
This framework doesn't currently use either — they're a different coordination style, not
a drop-in replacement for the orchestrator → specialist pattern described here. Source:
[Run agents in parallel](https://code.claude.com/docs/en/agents).

### 5b. VS Code background execution

Narratively described in the same Feb 2026 blog post as running "on your machine (CLI)"
in an "unattended (async)" style with worktree isolation, and as something you can
"monitor... or let it run as you work on something else." **[not independently
re-tested]** — no concurrency numbers, trigger syntax, or frontmatter fields were found
published for this in VS Code's technical reference pages at the time of writing; treat
it as a real but less fully documented capability on that host.

### 5c. This repo's own async queue (unrelated to either of the above)

`orchestrator/queue.ts` + `orchestrator/worker.ts` is a **file-based task queue** this
framework built before either host had subagent support, and it still exists as the
delegation fallback for a host with neither a Task-style tool nor VS Code's `agent` tool.
It only knows four whitelisted, deterministic task types (`run-bdd`, `generate-report`,
`typecheck`, `import-agents` — see `agents/registry.ts`), run by `npm run worker` polling
`.queue/pending`. It cannot run an LLM persona (researcher, documenter, etc.) — those
task types don't exist in the registry, which is exactly the gap that made the original
bug possible: on a host with no real dispatch mechanism *and* no matching queue task type,
the orchestrator had nothing legitimate to fall back to. The current spec (`prompts/agents/orchestrator.ts`,
`## Never`) makes this explicit: it must stop and name the specialist for the user to
invoke by hand rather than do that specialist's job itself.

### 5d. GitHub Copilot coding agent — a different product, not part of this framework

Worth naming so it's never confused with the above: GitHub's **Copilot coding agent** is
a cloud-based, asynchronous background agent — assign it a GitHub Issue (or `@copilot`
mention, or the agents panel on GitHub.com), and it works in an ephemeral GitHub
Actions-backed environment, opens a draft PR, and requests review. Hard limits: 59
minutes maximum execution time per session, one branch and exactly one PR per task
assignment, single-repository scope. Source:
[About Copilot coding agent](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent).
This is **not** wired into `.github/agents/*.agent.md` in this repo, and the fetched
GitHub docs page made no mention of `.github/agents` custom agent files or the
`target: github-copilot` frontmatter value relating to it — if you want this framework's
personas usable from the cloud coding agent specifically, that integration doesn't exist
yet and would need to be designed and tested separately; don't assume `target:
github-copilot` alone wires it up.

## 6. Tool scoping enforcement

**Claude Code — [verified in this repo].** Dispatched the `researcher` subagent directly
and asked it to self-report its own tool access. It reported exactly `Read`, `Grep`,
`Glob`, `WebFetch` — the four non-MCP tools in its spec — and explicitly noted it had
neither `Write`/`Edit` nor a dispatch tool, i.e. it could not do a specialist's job outside
its lane and could not itself spawn further subagents. This matches `.claude/agents/researcher.md`'s
`tools:` frontmatter exactly. The MCP tools listed in its persona (Jira/Confluence/JTMF/
GitHub/git) were absent from its *actual* runtime tool schema in this test — because
those MCP servers weren't running/connected in this ad hoc session (no `.mcp.json` wiring
active here), not because Claude Code failed to enforce anything; connecting them via
`npx revab start` + the gateway would make them available, at which point the same
enforcement would apply to them too.

**VS Code — [not independently re-tested].** VS Code's own documentation describes the
`tools:` frontmatter as an authoritative allow-list (*"Custom agents let you specify
exactly which tools are available for each task"*, and read-only agents are recommended
specifically *"to prevent unintended modifications"*), and independently, a filed VS Code
issue (microsoft/vscode-copilot-release#12647) shows a user who declared `editFiles` in
their custom chat mode but found file-editing still unavailable at runtime — i.e. there
is at least one documented case of the declared tool list and the actual runtime tool
list disagreeing. This repo has no VS Code UI available to test against directly (and a
same-session attempt via GitHub Copilot CLI failed on authentication — see the top of
this document), so treat VS Code's tool-scoping enforcement as *documented* but not
independently confirmed here. [`RUNBOOK.md` §3c](./RUNBOOK.md#3c-verify-the-vs-code--copilot-dispatch-yourself)
has a prompt you can use to check this directly (ask a dispatched specialist to
self-report its own tools, the same way the Claude Code test in this section did) —
re-verify it yourself in your own VS Code + Copilot install before relying on it for
anything security-sensitive.

## 7. Nesting depth and fork mode (Claude Code)

- **Default nesting depth**: 3 layers below the main conversation (main → L1 → L2 → L3),
  as of Claude Code v2.1.219. At the depth limit, Claude Code withholds the `Agent`/`Task`
  tool from every subagent except a fork, so a subagent at the limit does the delegated
  work itself and returns one summary instead of spawning further. Configurable via
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (v2.1.217+); set to `1` to disable nesting
  entirely.
- **This framework's own depth**: orchestrator (main thread, via `--agent orchestrator`)
  → one specialist (`.claude/agents/<name>.md`) is a single layer. None of the 9
  specialist specs hold `Task`/`Agent` in their tools, so none of them can nest further
  regardless of the platform default — this is enforced twice over, by our own spec design
  and by the platform's tool-scoping.
- **`Agent(agent_type)` allow-list**: a parent running as the main thread via `claude
  --agent` can restrict which subagent types it's allowed to spawn with
  `tools: Agent(worker, researcher), Read, Bash` syntax. This repo's orchestrator currently
  lists bare `Task` (equivalent to unrestricted `Agent`), not an explicit allow-list of the
  9 specialist names — see the note in §9 for why, and how to tighten it if you want that
  extra guard rail.
- **Fork mode** (`/subtask`, `CLAUDE_CODE_FORK_SUBAGENT`) spawns a subagent that inherits
  the *entire* parent conversation instead of starting fresh, useful for a side task that
  needs too much background to re-explain. This framework doesn't currently use it — the
  whole point of the orchestrator/specialist split is that each specialist starts from a
  clean, minimal context (the delegation prompt only), which a fork would defeat. Not
  recommended for this framework's personas without a specific reason.

Source: [Create custom subagents — "Let subagents spawn their own subagents" /
"Restrict which subagents can be spawned" / "Fork the current conversation"](https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents).

## 8. User-facing visibility: only `orchestrator` is selectable

The intent: a user picking an agent from a chat UI should only ever see `orchestrator` —
every specialist should still be dispatchable *by* orchestrator, just not directly
pickable *by a person* browsing the agent list.

**VS Code — implemented, [not independently re-tested].** Every specialist's
`.github/agents/<name>.agent.md` now sets two real, documented frontmatter fields
(`renderAgentMarkdown` in `prompts/shared/skeleton.ts`):

- `user-invocable: false` — *"Optional boolean flag to control whether the agent appears
  in the agents dropdown in chat (default is `true`)."*
- `disable-model-invocation: true` — *"Optional boolean flag to prevent the agent from
  being invoked as a subagent by other agents (default is `false`)."*

`orchestrator.agent.md` sets neither (stays visible, stays the only pickable entry), and
its `agents: [...]` list explicitly names every specialist — which the docs state
overrides `disable-model-invocation: true` on the target (*"Explicitly listing an agent in
the `agents` array overrides `disable-model-invocation: true`"*), so orchestrator can still
reach every specialist even though nothing else (including the user's own picker) can.
This wasn't re-tested against a live VS Code instance for the same reason as everything
else in §6/§9 below — no VS Code UI in this environment. Use
[`RUNBOOK.md` §3c](./RUNBOOK.md#3c-verify-the-vs-code--copilot-dispatch-yourself) to
confirm the dropdown actually only shows `orchestrator`.

**Claude Code — confirmed NOT possible, by design, as of this writing.** Read the complete
"Supported frontmatter fields" table in
[Create custom subagents](https://code.claude.com/docs/en/sub-agents#write-subagent-files)
end to end: `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`,
`maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`,
`color`, `initialPrompt` — no visibility/picker field exists. The docs are explicit that
every subagent, built-in or custom, is discoverable: *"Claude Code scans `.claude/agents/`
and `~/.claude/agents/` recursively"* and appears in the `@`-mention typeahead the same
way. `permissions.deny: ["Agent(<name>)"]` (["Disable specific
subagents"](https://code.claude.com/docs/en/sub-agents#disable-specific-subagents)) blocks
a subagent from being used **at all** — including by `orchestrator` itself — so it isn't a
"hide from user, keep for orchestrator" switch, it's an on/off switch with no middle
setting. **Don't invent a frontmatter field for this** — there isn't one. The practical
mitigation is procedural, not technical: tell users the intended entry point is `claude
--agent orchestrator` (§3a of `RUNBOOK.md`); if someone `@`-mentions a specialist directly
anyway, that specialist's own spec still enforces its scope/tool boundaries exactly as it
would under orchestrator, so direct use is off the intended path but not unsafe.

## 9. Known gaps / deliberately not done

- **Claude Code's `Agent(agent_type)` allow-list is not applied to `orchestrator`'s own
  `tools:` frontmatter** (`.claude/agents/orchestrator.md` lists bare `Task`). This means
  Claude Code's *own* extra guard rail — restricting which subagent types the root session
  can spawn — isn't switched on; the only thing stopping the orchestrator from spawning an
  arbitrary built-in agent (like `general-purpose`) is its spec's own prose ("delegate to
  the named specialist"), not a platform-enforced allow-list. Tightening this to `tools:
  Agent(researcher, test-planner, automation, reporter, documenter, planner, bsa, importer,
  self-improve), Read, Bash, mcp__jira__jira_search, mcp__artifacts__knowledge_search`
  would close that gap; it wasn't done here because the portable `AgentSpec.tools` type
  (`prompts/types.ts`) has no representation for a parameterized `Agent(...)` allow-list —
  adding one is a reasonable follow-up if you want it enforced rather than just stated.
- **VS Code's tool-scoping enforcement is unverified from this environment** (§6) — verify
  it yourself before relying on it.
- **`target: github-copilot` and the cloud coding agent relationship is unconfirmed** (§5d)
  — don't assume setting it wires this framework into GitHub's cloud coding agent.
- **VS Code parallel/background execution has no published technical reference** at the
  time of writing (§4, §5b) — only an announcement blog post. Re-check VS Code's docs
  before depending on specific behavior there.

## 10. Professional inter-agent communication

Anthropic's own engineering writeup on their multi-agent Research system
([anthropic.com/engineering/multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system))
is the primary source this framework's delegation and review skills follow — quoted, not
paraphrased away:

- **A delegation prompt needs four parts, every time**: *"Each subagent needs an
  objective, an output format, guidance on the tools and sources to use, and clear task
  boundaries."* The explicit failure mode from skipping this: *"we started by allowing the
  lead agent to give simple, short instructions like 'research the semiconductor
  shortage,' but found these instructions often were vague enough that subagents
  misinterpreted the task or performed the exact same searches as other agents."* This is
  why `route-to-specialist` (`skills/route-to-specialist/SKILL.md`) has orchestrator name
  both the owning specialist AND the likely skill before dispatch, not just "go research
  this."
- **Avoid the telephone game**: minimize how much raw context gets relayed hop to hop
  between chained specialists (researcher → test-planner → automation → reporter →
  documenter) — pass the specific citation/file path/decision forward, not "see what the
  last one said." Anthropic's own appendix: *"Subagents call tools to store their work in
  external systems, then pass lightweight references back to the coordinator."*
- **Decompose by context boundary, not by arbitrary phase.** Split work where the pieces
  are genuinely independent (parallel dispatch, §4) — don't split a single tightly-coupled
  task into steps that just have to pass everything back and forth anyway.
- **Effort should scale with task complexity**: *"Simple fact-finding requires just 1
  agent with 3-10 tool calls... complex research might use more than 10 subagents with
  clearly divided responsibilities."* This framework's `route-to-specialist` similarly
  warns against forcing one specialist to cover two steps, or splitting one simple step
  across two specialists.
- **A subagent reports to the dispatcher, not the user.** Every specialist spec's `##
  Hand off` section states exactly what it passes to the next stage; `orchestrator`'s
  `review-delegated-work` skill (§ below) is the check that what came back is actually fit
  to aggregate before the user ever sees it — the orchestrator is the only persona that
  talks to the user.

## 11. The learning loop: teacher, not rubber stamp

A single correction is already captured in real time by every persona's shared conduct
(`prompts/shared/conduct.ts`, "Learning from corrections") via the `capture-correction`
skill — that part predates this section. What's new: **a second occurrence of the same
pattern is now flagged automatically, at log time, not discovered later.**

`npm run correction -- log` (`scripts/correction.ts`) now checks, immediately after
appending a record, whether the agent it was logged against has 2+ open corrections, and
if so prints a `⚠ REPEATED PATTERN` notice naming the prior rule(s) — **[verified in this
repo]**, tested with two real CLI invocations against a scratch agent name (cleaned up
afterward, not committed):

```
⚠ REPEATED PATTERN: this is open correction #2 for "<agent>".
Prior open rule(s) for this agent:
  [<id>] <prior rule text>
If the rule you just logged is the SAME underlying pattern (not a coincidence), don't leave
this queued for later — fold the generalized rule into prompts/agents/<agent>.ts in THIS
turn...
If the same rule/theme is repeating across DIFFERENT agents too... that's a framework-wide
gap — it belongs in prompts/shared/conduct.ts..., not copy-pasted into each agent's spec.
```

`skills/capture-correction/SKILL.md`'s new Phase 3.5 tells whoever is logging to act on
that notice in the same turn, not defer it — a single-agent repeat goes into that agent's
own `prompts/agents/<name>.ts`; a repeat across *different* agents goes into
`prompts/shared/conduct.ts` once, generic, rather than being copy-pasted per agent.
`self-improve`'s spec (`prompts/agents/self-improve.ts`) now names this explicitly as
something it owns — editing the shared conduct layer for a cross-agent pattern, not only
individual agent specs — and its description was rewritten to state the framing directly:
*"The framework's teacher: reviews sessions, spots repeated correction patterns across
agents, persists durable learnings, and proposes agent/skill/script upgrades."* The rule
folded in is always required to read as generic (an imperative any agent could follow),
with at most a short parenthetical example naming the topic that surfaced it — never a
rule that only makes sense for that one topic.

## Sources

- [Run agents in parallel](https://code.claude.com/docs/en/agents) — Claude Code
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Claude Code
- [Custom agents in VS Code](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [Subagents in Visual Studio Code](https://code.visualstudio.com/docs/agents/subagents)
- [VS Code chat tools reference (ai-features-cheat-sheet)](https://code.visualstudio.com/docs/agents/reference/ai-features-cheat-sheet)
- [Your Home for Multi-Agent Development (VS Code blog, 2026-02-05)](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
- [About Copilot coding agent](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent) — GitHub
- microsoft/vscode-copilot-release issue #12647 (tool-scoping runtime disagreement report)
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — Anthropic engineering
- This repo, `claude` CLI v2.1.220, tested 2026-07-30 and 2026-08-05 (see §3, §4, §6, §11 for the exact prompts and transcripts)
