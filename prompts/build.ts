/**
 * Renders every model-facing file from the typed specs + shared rule sources.
 *
 * Outputs (all carry a GENERATED banner; never hand-edit them):
 *   - .github/agents/<name>.agent.md   — self-contained persona (VS Code / Copilot)
 *   - AGENTS.md                        — portable, host-neutral instructions (any agent tool)
 *   - .github/copilot-instructions.md  — regenerated from the same source (Copilot)
 *
 * `renderAll()` returns the full set as {path, content}; the CLI writes or checks them.
 */

import { AGENTS } from "./agents/index.js";
import { AGENT_CONDUCT } from "./shared/conduct.js";
import { HARD_RULES } from "./shared/hard-rules.js";
import {
  GENERATED_BANNER,
  renderAgentMarkdown,
  renderAgentSection,
} from "./shared/skeleton.js";

export interface GeneratedFile {
  path: string;
  content: string;
}

const INTRO = `revab-agents is a centralized multi-agent QE automation framework: local MCP servers (Jira, Confluence, JTMF, Artifacts, Media, GitHub, Git, Notify, Playwright-runner, Allure-report, Codegen) on localhost, an async file-queue orchestrator, agent personas, and skills. **This repo is framework-only** — it never executes tests against itself; all test authoring/execution/reporting happens in a **target project** resolved from the \`projects/\` manifest and operated on via MCP tools.`;

const SESSION_START = `Read \`knowledge/memory.md\` first (canonical framework facts, tool names, pending setup), then \`knowledge/learnings.md\` (prior session learnings). Both are the framework's memory.`;

const BOUNDARY = [
  "**MCP tool** (new I/O: shell exec, external file access, HTTP) → `mcp-servers/*`.",
  "**Skill** (a reusable prompt playbook composing existing tools, no new I/O) → `skills/*/SKILL.md`.",
  "**Agent** (a persona orchestrating skills/tools for a role) → author the spec in `prompts/agents/*.ts`, then `npm run build:prompts` (never hand-edit the generated `.agent.md`).",
];

const COMMANDS = [
  "`npm run serve:mcp` — start all MCP servers.",
  "`npm run worker` — start the async task worker.",
  "`npm run task -- enqueue <type> '<json>'` / `-- status` / `-- types` (project-scoped types require `{\"project\":\"<name>\"}`).",
  "`npm run build:prompts` — regenerate all agent/instruction files from `prompts/**` (`-- --check` fails on drift).",
  "`npm run import:agents -- <sourceRepoPath> [--dry-run]` — import assets from another repo.",
  "`npm run typecheck` — validate this framework's TypeScript (never runs target-project tests).",
];

function renderHardRulesFull(): string {
  return HARD_RULES.map((r) => `${r.n}. **${r.title}** — ${r.full}`).join("\n");
}

function renderConductFull(): string {
  return AGENT_CONDUCT.map((s) => {
    const body = (s.full ?? s.short).map((b) => `- ${b}`).join("\n");
    return `### ${s.title}\n${body}`;
  }).join("\n\n");
}

function renderAgentFlow(): string {
  return [
    "```",
    "planner (plan + approve) → orchestrator (route via delegation only)",
    "   → researcher (read-only) → test-planner (cite → codegen) → automation (exec + codegen)",
    "   → reporter (run + allure) → documenter (dryRun writes) → self-improve (learnings)",
    "bsa: standalone intake (chat/Excel/CSV/doc/image) → dryRun Jira bulk-create; never deletes",
    "```",
    "",
    "The orchestrator holds no execution/write tools — it must delegate. Each specialist's \"You do NOT\" section names who takes over, so no agent quietly does another's job.",
  ].join("\n");
}

/** The shared instruction body used by both AGENTS.md and copilot-instructions.md. */
function renderInstructionBody(): string {
  const agentSections = AGENTS.map(renderAgentSection).join("\n");
  return [
    "## Overview",
    INTRO,
    "",
    "## Session start",
    SESSION_START,
    "",
    "## Hard rules",
    renderHardRulesFull(),
    "",
    "## Agent conduct (applies to every persona; personas may tighten, never loosen)",
    renderConductFull(),
    "",
    "## Agent flow",
    renderAgentFlow(),
    "",
    "## Agents",
    agentSections,
    "## Skill / MCP tool / agent boundary",
    BOUNDARY.map((b) => `- ${b}`).join("\n"),
    "",
    "## Commands",
    COMMANDS.map((c) => `- ${c}`).join("\n"),
    "",
  ].join("\n");
}

export function renderAll(): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  for (const spec of AGENTS) {
    files.push({
      path: `.github/agents/${spec.name}.agent.md`,
      content: renderAgentMarkdown(spec),
    });
  }

  const body = renderInstructionBody();

  files.push({
    path: "AGENTS.md",
    content: [
      GENERATED_BANNER("prompts/**"),
      "",
      "# revab-agents — agent instructions (portable, model-agnostic)",
      "",
      "These instructions are the single source of truth for how the QE agents behave. They are host-neutral: any agentic coding tool (Copilot, Cursor, and others) can load this file. The per-persona files in `.github/agents/` and `.github/copilot-instructions.md` are generated from the same `prompts/**` source.",
      "",
      body,
    ].join("\n"),
  });

  files.push({
    path: ".github/copilot-instructions.md",
    content: [
      GENERATED_BANNER("prompts/**"),
      "",
      "# revab-agents — Copilot instructions",
      "",
      "Generated from `prompts/**` (same source as `AGENTS.md` and every `.github/agents/*.agent.md`). Edit the source, then run `npm run build:prompts`.",
      "",
      body,
    ].join("\n"),
  });

  return files;
}
