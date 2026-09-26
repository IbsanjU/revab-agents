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
 * Map the portable tool vocabulary to the tokens the VS Code / Copilot host
 * understands (so the generated `.agent.md` still binds real tools there).
 * MCP tools (`mcp__server__tool`) become the host's `server/tool` form.
 */
function toHostTool(tool: ToolName): string[] {
  if (tool.startsWith("mcp__")) {
    const [, server, ...rest] = tool.split("__");
    return [`${server}/${rest.join("__")}`];
  }
  switch (tool) {
    case "Read":
    case "Grep":
    case "Glob":
      return ["search/codebase", "search"];
    case "Edit":
    case "Write":
      return ["edit/editFiles"];
    case "Bash":
      return [
        "execute/runInTerminal",
        "execute/getTerminalOutput",
        "execute/createAndRunTask",
        "execute/runTask",
        "read/getTaskOutput",
        "read/problems",
      ];
    case "WebFetch":
      return ["web/fetch"];
    case "Task":
      // No host tool token — delegation is described in the body instead.
      return [];
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

/** Render one agent to its `.github/agents/<name>.agent.md` content. */
export function renderAgentMarkdown(spec: AgentSpec): string {
  const hostTools = hostToolList(spec.tools);
  const toolsFrontmatter = hostTools.map((t) => `'${t}'`).join(", ");
  const portableTools = spec.tools.map((t) => `\`${t}\``).join(", ");
  const usesTask = spec.tools.includes("Task");

  const parts: string[] = [];
  parts.push("---");
  parts.push(`description: '${spec.description.replace(/'/g, "’")}'`);
  parts.push(`tools: [${toolsFrontmatter}]`);
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
      "You delegate with the **Task** tool. On a host without it, name the target agent and hand the work back to the user to route — never do the specialist's work yourself.",
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
