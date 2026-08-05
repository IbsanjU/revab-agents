/**
 * The renderer: turns an `AgentSpec` + shared rules into the model-facing files.
 *
 * Every agent file is SELF-CONTAINED — its non-negotiable rules and conduct are
 * inlined, so the persona behaves the same on any model even if no separate
 * instruction file is loaded. The portable→host tool mapping lives here, once,
 * instead of being duplicated per agent.
 */

import type { AgentSpec, ToolName } from "../types.js";
import { AGENT_CONDUCT } from "./conduct.js";
import { coreRules } from "./hard-rules.js";

export const GENERATED_BANNER = (source: string): string =>
  `<!-- GENERATED FROM ${source} — edit the source, then run \`npm run build:prompts\`. Do not edit by hand. -->`;

/**
 * Map the portable tool vocabulary to the tokens VS Code's custom-agents system
 * (code.visualstudio.com/docs/agent-customization/custom-agents, the `#toolset/tool`
 * scheme shipped in v1.106+) actually understands, verified against its live tool
 * reference (code.visualstudio.com/docs/agents/reference/ai-features-cheat-sheet) —
 * NOT guessed. `execute/runTask` and `read/getTaskOutput` do not exist on that
 * reference; `execute/createAndRunTask` is the only task-running tool. MCP tools
 * (`mcp__server__tool`) become the host's `server/tool` form (confirmed by the docs'
 * own `<server name>/*` wildcard example).
 */
function toHostTool(tool: ToolName): string[] {
  if (tool.startsWith("mcp__")) {
    const [, server, ...rest] = tool.split("__");
    return [`${server}/${rest.join("__")}`];
  }
  switch (tool) {
    case "Read":
      return ["read/readFile"];
    case "Grep":
      return ["search/textSearch"];
    case "Glob":
      return ["search/fileSearch", "search/listDirectory"];
    case "Edit":
      return ["edit/editFiles"];
    case "Write":
      return ["edit/editFiles", "edit/createFile"];
    case "Bash":
      return [
        "execute/runInTerminal",
        "execute/getTerminalOutput",
        "execute/createAndRunTask",
        "read/terminalLastCommand",
        "read/problems",
      ];
    case "WebFetch":
      return ["web/fetch"];
    case "Task":
      // Real dispatch tool (v1.106+): paired with the `agents:` frontmatter field
      // (see renderAgentMarkdown) that names which custom agents are dispatchable.
      return ["agent"];
    default:
      return [];
  }
}

function hostToolList(tools: ToolName[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tools) {
    for (const mapped of toHostTool(t)) {
      if (!seen.has(mapped)) {
        seen.add(mapped);
        out.push(mapped);
      }
    }
  }
  return out;
}

function titleCase(name: string): string {
  return name
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

/** Compact conduct block inlined into every agent. */
function conductBlock(): string {
  return AGENT_CONDUCT.map(
    (s) => `**${s.title}.** ${s.short.join(" ")}`,
  ).join("\n");
}

/** The non-negotiable rules block, inlined verbatim into every agent. */
function nonNegotiableBlock(): string {
  return coreRules()
    .map((r) => `- **#${r.n} ${r.title}** — ${r.short}`)
    .join("\n");
}

/**
 * Render one agent to its `.github/agents/<name>.agent.md` content.
 * `siblingNames` is every OTHER agent's `spec.name` (i.e. `AGENTS` minus this one) —
 * used only when this spec holds `Task`, to populate the real `agents:` frontmatter
 * field VS Code's custom-agents system uses to authorize subagent dispatch.
 *
 * Every persona except `orchestrator` sets `user-invocable: false` (hidden from the
 * chat agent dropdown/picker — VS Code custom-agents docs: "control whether the agent
 * appears in the agents dropdown in chat") and `disable-model-invocation: true`
 * (blocks generic agent-initiated dispatch from anywhere else) — orchestrator's own
 * `agents:` list explicitly overrides that per-agent per the same docs ("Explicitly
 * listing an agent in the `agents` array overrides `disable-model-invocation: true`"),
 * so it can still dispatch every specialist even though nothing else can, and the user
 * never sees a specialist in the picker — only `orchestrator`.
 */
export function renderAgentMarkdown(spec: AgentSpec, siblingNames: string[] = []): string {
  const hostTools = hostToolList(spec.tools);
  const toolsFrontmatter = hostTools.map((t) => `'${t}'`).join(", ");
  const portableTools = spec.tools.map((t) => `\`${t}\``).join(", ");
  const usesTask = spec.tools.includes("Task");
  const isOrchestrator = spec.name === "orchestrator";

  const parts: string[] = [];
  parts.push("---");
  parts.push(`name: ${spec.name}`);
  parts.push(`description: '${spec.description.replace(/'/g, "’")}'`);
  parts.push(`tools: [${toolsFrontmatter}]`);
  if (usesTask) {
    parts.push(`agents: [${siblingNames.map((n) => `'${n}'`).join(", ")}]`);
  }
  if (!isOrchestrator) {
    parts.push(`user-invocable: false`);
    parts.push(`disable-model-invocation: true`);
  }
  parts.push("---");
  parts.push(GENERATED_BANNER(`prompts/agents/${spec.name}.ts`));
  parts.push("");
  parts.push(`# ${titleCase(spec.name)} agent`);
  parts.push("");
  parts.push(`**Role.** ${spec.role}`);
  parts.push("");

  parts.push("## You own");
  parts.push(bullets(spec.owns));
  parts.push("");

  parts.push("## You do NOT — hand off instead");
  parts.push(
    bullets(spec.doesNot.map((d) => `${d.what} → **${d.to}**`)),
  );
  parts.push("");

  parts.push("## Tools (only these — nothing else)");
  parts.push(portableTools);
  if (usesTask) {
    parts.push("");
    parts.push(
      "You delegate with the **Task** (VS Code: `agent`) tool. This file's `agents:` frontmatter names every specialist below as a real dispatch target on VS Code's custom-agents system (v1.106+) — this is an actual tool call, not just a naming convention. On a host with neither, name the target agent and hand the work back to the user to route — never do the specialist's work yourself.",
    );
  }
  parts.push("");

  parts.push("## Flow");
  parts.push(spec.flow.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  parts.push("");

  parts.push("## Always");
  const always = [...spec.always ?? []];
  parts.push(
    bullets([
      ...always,
      "Follow the non-negotiable rules below — they are inlined here on purpose; do not assume a separate rules file is loaded.",
    ]),
  );
  parts.push("");
  parts.push("### Non-negotiable rules");
  parts.push(nonNegotiableBlock());
  parts.push("");

  if (spec.never && spec.never.length) {
    parts.push("## Never");
    parts.push(bullets(spec.never));
    parts.push("");
  }

  if (spec.skills && spec.skills.length) {
    parts.push("## Skills (use these — don't improvise their steps)");
    parts.push(spec.skills.map((s) => `\`${s}\``).join(", "));
    parts.push("");
  }

  parts.push("## Conduct");
  parts.push(conductBlock());
  parts.push("");

  parts.push("## Hand off");
  parts.push(spec.handoff);
  parts.push("");

  return parts.join("\n");
}

/**
 * Render one agent to its `.claude/agents/<name>.md` content — a native Claude Code
 * subagent. Every persona gets one (see `prompts/build.ts`), generated from the same
 * spec as `.github/agents/<name>.agent.md` so the two hosts never drift apart. The
 * portable tool vocabulary (`types.ts`) already matches Claude Code's own tool names
 * 1:1 (`Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch`, `mcp__server__tool`,
 * and `Task` — aliased to the current `Agent` tool by Claude Code itself), so no
 * host-tool mapping is needed here — unlike `renderAgentMarkdown`'s Copilot mapping.
 *
 * `orchestrator` is the one persona meant to run as the ROOT session
 * (`claude --agent orchestrator`), not as a dispatch target — it keeps its `Task`
 * tool so it can dispatch every other file here via `subagent_type: "<name>"`; every
 * other persona is a pure dispatch target and never itself calls Task.
 */
export function renderClaudeSubagentMarkdown(spec: AgentSpec): string {
  const isOrchestrator = spec.name === "orchestrator";

  const parts: string[] = [];
  parts.push("---");
  parts.push(`name: ${spec.name}`);
  parts.push(`description: '${spec.description.replace(/'/g, "’")}'`);
  parts.push(`tools: ${spec.tools.join(", ")}`);
  parts.push(`model: ${spec.model ?? "inherit"}`);
  parts.push("---");
  parts.push(GENERATED_BANNER(`prompts/agents/${spec.name}.ts`));
  parts.push("");
  parts.push(`# ${titleCase(spec.name)} agent`);
  parts.push("");
  parts.push(`**Role.** ${spec.role}`);
  parts.push("");

  parts.push("## You own");
  parts.push(bullets(spec.owns));
  parts.push("");

  parts.push("## You do NOT — hand off instead");
  parts.push(bullets(spec.doesNot.map((d) => `${d.what} → **${d.to}**`)));
  parts.push("");

  parts.push("## Tools (only these — nothing else)");
  parts.push(spec.tools.map((t) => `\`${t}\``).join(", "));
  parts.push("");

  parts.push("## Flow");
  parts.push(spec.flow.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  parts.push("");

  parts.push("## Always");
  parts.push(
    bullets([
      ...(spec.always ?? []),
      "Follow the non-negotiable rules below — they are inlined here on purpose; do not assume a separate rules file is loaded.",
    ]),
  );
  parts.push("");
  parts.push("### Non-negotiable rules");
  parts.push(nonNegotiableBlock());
  parts.push("");

  if (spec.never && spec.never.length) {
    parts.push("## Never");
    parts.push(bullets(spec.never));
    parts.push("");
  }

  if (spec.skills && spec.skills.length) {
    parts.push("## Skills (use these — don't improvise their steps)");
    parts.push(spec.skills.map((s) => `\`${s}\``).join(", "));
    parts.push("");
  }

  parts.push("## Conduct");
  parts.push(conductBlock());
  parts.push("");

  parts.push("## Hand off");
  parts.push(spec.handoff);
  parts.push("");
  if (isOrchestrator) {
    parts.push(
      "Run the whole session as this persona with `claude --agent orchestrator` — you ARE the root session, not a dispatch target; nothing dispatches into you. Delegate each step via the Task tool (`subagent_type: \"<name>\"` — one of the other `.claude/agents/*.md` personas alongside this file), exactly as described above.",
    );
  } else {
    parts.push(
      "You were dispatched by **orchestrator** via the Task tool (`subagent_type: \"" +
        spec.name +
        "\"`) — return your result to it. You do not talk to the user directly, and you never pick up another specialist's tools to finish work that isn't yours.",
    );
  }
  parts.push("");

  return parts.join("\n");
}

/** Render one agent as a section inside AGENTS.md (portable, host-neutral). */
export function renderAgentSection(spec: AgentSpec): string {
  const parts: string[] = [];
  parts.push(`### ${spec.name}`);
  parts.push("");
  parts.push(`_${spec.description}_`);
  parts.push("");
  parts.push(`- **Owns:** ${spec.owns.join("; ")}.`);
  parts.push(
    `- **Does NOT (hand off):** ${spec.doesNot.map((d) => `${d.what} → ${d.to}`).join("; ")}.`,
  );
  parts.push(`- **Tools:** ${spec.tools.map((t) => `\`${t}\``).join(", ")}.`);
  parts.push(`- **Flow:** ${spec.flow.map((s, i) => `${i + 1}) ${s}`).join(" ")}`);
  if (spec.skills?.length) {
    parts.push(`- **Skills:** ${spec.skills.map((s) => `\`${s}\``).join(", ")}.`);
  }
  parts.push(`- **Hands off:** ${spec.handoff}`);
  parts.push("");
  return parts.join("\n");
}
