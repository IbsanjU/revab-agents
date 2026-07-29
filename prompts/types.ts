/**
 * Typed specs that drive every generated agent/instruction file.
 *
 * This is the "md → code" core: prompts are no longer hand-maintained markdown.
 * Each agent is a typed `AgentSpec`; `prompts/build.ts` renders the specs +
 * shared rule sources (`shared/hard-rules.ts`, `shared/conduct.ts`) through
 * `shared/skeleton.ts` into the model-facing files (`.github/agents/*.agent.md`,
 * `AGENTS.md`, `.github/copilot-instructions.md`).
 *
 * Editing a rule in one place regenerates it, physically inlined, into every
 * consumer file — so the rules are present for ANY model, not "auto-loaded" by
 * one host. See knowledge/plans/framework/2026-07-21-agent-prompt-discipline.md.
 */

/** Host-neutral tool vocabulary. MCP tools use the `mcp__<server>__<tool>` form. */
export type PortableTool =
  | "Read"
  | "Grep"
  | "Glob"
  | "Edit"
  | "Write"
  | "Bash"
  | "Task"
  | "WebFetch";

export type McpTool = `mcp__${string}__${string}`;
export type ToolName = PortableTool | McpTool;

/** A capability the agent hands to another agent instead of doing itself. */
export type HandoffBoundary = {
  /** What the agent must NOT do (e.g. "write test code"). */
  what: string;
  /** The agent that owns it instead (e.g. "automation"). */
  to: string;
};

export interface AgentSpec {
  /** kebab-case; matches the generated file name and the `name:` frontmatter. */
  name: string;
  /** `"inherit"` (default) or a specific model id, if a role truly needs one. */
  model?: "inherit" | string;
  /** One line: what it does + "use when …; hand off … when …". */
  description: string;
  /** One sentence stating the role. */
  role: string;
  /** What this agent owns (the only things it should be doing). */
  owns: string[];
  /** Capabilities it must refuse and delegate — kills scope overlap/wandering. */
  doesNot: HandoffBoundary[];
  /** Minimal, explicit tool list (no wildcards). Portable + MCP names. */
  tools: ToolName[];
  /** ≤6 numbered steps — a decision path, not an exhaustive playbook. */
  flow: string[];
  /** Agent-specific ALWAYS bullets (on top of the shared non-negotiable rules). */
  always?: string[];
  /** Agent-specific NEVER bullets. */
  never?: string[];
  /** Named skills that hold the deep procedure this agent invokes. */
  skills?: string[];
  /** Who takes over next, and what this agent passes them. */
  handoff: string;
}
