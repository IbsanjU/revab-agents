# Code Mode

Two tools instead of seventy-eight: the model searches for the tools it needs, then writes a small script that calls them. This page records what was learned from the reference implementations, what was decided for this repo, how it works, and what is not yet proven.

## What was learned

Facts below come from the sources named, read on 2026-10-30 through a fetch agent that summarized them. Items marked **unconfirmed** were not checked against the source directly.

### Cloudflare Code Mode (`cloudflare/agents`, `packages/codemode`)

- **Idea.** Models write code against a typed API better than they emit one tool call at a time. The MCP tools are converted to a TypeScript API, the model writes JavaScript, and the code runs in a sandbox that can only call back into the host.
- **Shape.** The model sees one tool taking `{ code: string }` whose description carries the generated types (`declare const codemode: { ... }`). Their hosted Cloudflare MCP server goes further and exposes just two tools, `search` and `execute`, so the 2,500-endpoint API never enters the model's context.
- **Sandbox.** A V8 isolate (a Dynamic Worker) per execution, no filesystem, no environment variables, and `fetch()` blocked by default. Tool calls cross an RPC boundary; credentials stay on the host. Default timeout 60 s, enforced inside the isolate.
- **Numbers.** Their blog reports a 99.9% input-token reduction for the Cloudflare API (about 1,000 tokens for two tools versus over a million for one tool per endpoint). Counts were made with an OpenAI tokenizer, and the post quotes two figures for the "before" case (1.17 million and over 2 million). No latency figures are published.
- **Caveats they state.** The package is marked experimental, JavaScript only, and full support for several MCP servers at once is future work.
- **Unconfirmed.** Whether the Worker executor's timeout can stop a synchronous infinite loop (the report inferred it cannot); the contents of several source files.

### Claude API programmatic tool calling

- **Idea.** The model writes Python in a code execution container that calls your tools as async functions. Intermediate results stay out of the model's context.
- **Request shape.** Add `{"type": "code_execution_20260120", "name": "code_execution"}` and put `"allowed_callers": ["code_execution_20260120"]` on each tool that code may call. A tool call made from code arrives as a `tool_use` block with a `caller` field; you answer with `tool_result` blocks and pass the `container` id back.
- **Limits.** `allowed_callers` is not a security boundary. Containers have no internet access. A newer tool version, `code_execution_20260521`, exists and is interchangeable in `allowed_callers`. Reported savings are about 38% fewer billed input tokens on a 75-tool benchmark, and cost rose about 8% on a sequential benchmark, so measure before enabling it broadly.
- **Not usable for this gateway.** The page says MCP connector tools are not supported from code. Code Mode on the gateway is therefore the route for MCP tools, and programmatic tool calling is the route for tools you define directly in an API request.
- **Unconfirmed.** Several limits came from a summary of the page rather than its verbatim text (timeouts, memory limits, pricing); the two docs pages disagree on which `capabilities` field to check; the page contradicts itself on the pending-call timeout (about 4 minutes versus 270 s).

## Decision

Build Cloudflare's pattern on the gateway, because the gateway already hosts every tool behind one process, validates input with each tool's zod schema, and classifies tools as read or write.

| Option | Verdict |
|---|---|
| Adopt `@cloudflare/codemode` directly | No. Its executor needs Cloudflare Workers; this gateway is a local Node process. |
| Anthropic programmatic tool calling | Not for the gateway (MCP tools unsupported there). Worth using separately for direct API integrations. |
| Reimplement the pattern on the gateway | **Chosen.** Small, local, and reuses the existing guards. |

## How it works

```
model ── codemode_search { query } ──▶ matching tools + TypeScript declarations
model ── codemode_execute { code } ──▶ worker thread ─ vm context ─ codemode.<tool>(input)
                                                         │ (string RPC)
                                       gateway main thread: validate → classify → handler
```

- **Endpoint.** `POST /mcp/code` serves exactly two tools. `POST /mcp` is unchanged. Both are also reachable over REST as `/api/codemode/<tool>`, so `revab call codemode_execute '{"code":"..."}'` works without MCP.
- **`codemode_search`** ranks tools by keyword (name hits count more than description hits) and returns names, risk, and generated declarations for just those tools.
- **`codemode_execute`** takes an async arrow function or a bare body that uses `return`. Only the return value, `console.log` output and a call count come back; output is truncated at 24,000 characters with a note.
- **Configuration.** `CODEMODE_TIMEOUT_MS` (default 60000) and `CODEMODE_MAX_CALLS` (default 100 tool calls per execution).

To use it from VS Code, add a second entry next to the existing gateway one in `.vscode/mcp.json`:

```json
"gateway-code": { "type": "http", "url": "http://localhost:7300/mcp/code" }
```

Register it instead of `gateway`, not alongside it, or the model sees both surfaces and the saving disappears.

## Safety model

The rule: **a call from code is never more powerful than a direct call.**

1. **Same validation.** Every call is parsed with the tool's own zod schema, as over REST and MCP.
2. **Writes are preview-only from code.** A write-classified tool is callable only if it has a `dryRun` input, and `dryRun` is forced to `true`, whatever the script passes. Write tools with no dry-run mode are refused. A script can therefore prepare a bulk change for the user to approve but cannot apply it; applying is a direct call after approval, as before.
3. **`codemode_execute` is classified as a write.** Clients that auto-approve read-only tools will still ask before running a script, because the script is the thing worth reviewing. `codemode_search` is read-only.
4. **No recursion.** The code tools are not in the callable set.
5. **Budgets.** A call limit, an output limit, a memory cap (128 MB) and a wall-clock timeout.
6. **Sandbox.** A `node:vm` context with string `eval`, `Function` constructors and WebAssembly disabled, holding only `codemode` and `console`; inside a worker thread with an empty environment. Credentials live in the main thread where handlers run. The timeout terminates the worker, so a synchronous infinite loop is killed.

What this does **not** claim: `node:vm` is not a security boundary against a determined attacker. The defenses are layered and tested against the known constructor-chain escapes, but the sandbox is defense in depth behind the policy above. Run the gateway as an unprivileged user.

The host function the sandbox calls is never exposed to model code (naive exposure leaks `process` through `.constructor`; this was reproduced). It is captured by a bootstrap closure and only ever returns strings.

## Measured

`npm run bench:codemode` (token counts estimated as characters ÷ 4):

| Surface | Tools | ≈ Tokens |
|---|---|---|
| `/mcp` (every tool) | 78 | 15,094 |
| `/mcp/code` | 2 | 376 |
| `/mcp/code` plus one `codemode_search` result | 2 | 2,207 |

Definitions are about 40× smaller up front and 85% smaller after one search. This is the saving on tool *definitions* only. A real task also pays for the search result, the script, and the final output, and savings from keeping large intermediate results out of context depend on the task.

## Not yet proven

- **No live-model run.** The sandbox, policy and endpoints are tested; whether a model reliably writes correct scripts from the declarations has not been measured. The behavior eval `evals/behavior/code-mode-uses-dry-run.md` describes how to check.
- **No latency comparison** against one-call-per-tool on a real task.
- **Real Jira/Confluence results** are untested in this environment (no credentials). The shape of a tool's result is whatever that tool returns; scripts should log it once before relying on field names.
- **Tool output types are `unknown`.** The servers declare inputs only, so the model learns result shapes by running code, which costs a call. Adding output schemas to the highest-use tools would remove that.
- **Agents.** No agent persona is granted the code tools yet. Granting `codemode_search` and `codemode_execute` to a specialist is a spec change with an eval, and should follow a live-model check.
- **Anthropic programmatic tool calling** is documented here but not integrated anywhere in this repo.
