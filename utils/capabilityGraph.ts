/**
 * Capability graph: agents, skills, tools and lifecycle phases as one connected structure, built
 * only from files the repo already owns (agent specs, SKILL.md files, the tool registry). Nothing
 * here is hand-drawn, so it cannot drift: `npm run build:graph -- --check` fails when it does.
 *
 * A skill "mentions" a tool when its text names the tool in backticks. A mention is evidence, not
 * proof of a call (a skill may be describing a step it hands to another agent), so findings built
 * on mentions go through a baseline (docs/graph-baseline.json) that can only shrink.
 */
import type { AgentSpec } from "../prompts/types.js";

export interface SkillInput {
  name: string;
  text: string;
}
export interface ToolInput {
  name: string;
  server: string;
}
export interface GraphInput {
  agents: AgentSpec[];
  skills: SkillInput[];
  tools: ToolInput[];
}

/** Lifecycle phases and who covers them. Mirrors docs/lifecycle.md; dangling names are findings. */
export const LIFECYCLE: ReadonlyArray<{ phase: string; agents: string[]; skills: string[] }> = [
  { phase: "Define", agents: ["researcher", "bsa"], skills: ["search-across-sources", "qe-meeting-notes", "extract-requirements-from-image", "extract-requirements-from-video", "structure-project-data"] },
  { phase: "Plan", agents: ["planner", "test-planner"], skills: ["size-and-slice", "qe-program-coordination", "qe-raci-coverage-matrix", "qe-test-plan-builder", "build-test-plan-interactive", "test-design-techniques", "route-to-specialist"] },
  { phase: "Build", agents: ["automation"], skills: ["detect-execution-convention", "simplify"] },
  { phase: "Verify", agents: ["reporter", "automation"], skills: ["verify", "analyze-test-failures", "adversarial-review"] },
  { phase: "Review", agents: ["orchestrator"], skills: ["code-review", "security-review", "review-against-spec", "review-delegated-work", "adversarial-review"] },
  { phase: "Ship", agents: ["reporter"], skills: ["ship", "qe-signoff-report"] },
];

export type FindingKind =
  | "skill-tool-gap"
  | "agent-tool-gap"
  | "unheld-tool"
  | "unowned-skill"
  | "dangling-skill"
  | "dangling-tool"
  | "dangling-lifecycle";

export interface Finding {
  /** Stable identity used by the baseline. */
  key: string;
  kind: FindingKind;
  message: string;
}

export interface Graph {
  agents: Array<{ name: string; tools: string[]; skills: string[]; handoffTo: string[] }>;
  skills: Array<{ name: string; owners: string[]; mentionsTools: string[] }>;
  tools: Array<{ name: string; server: string; heldBy: string[]; mentionedBy: string[] }>;
  phases: Array<{ phase: string; agents: string[]; skills: string[] }>;
  findings: Finding[];
}

const GATEWAY_PREFIX = "mcp__gateway__";

/** Gateway tool name from an agent tool entry, or null for Read/Bash/Task and other hosts' tools. */
export function gatewayToolName(entry: string): string | null {
  return entry.startsWith(GATEWAY_PREFIX) ? entry.slice(GATEWAY_PREFIX.length) : null;
}

/** Tools named in backticks in the text, restricted to real tool names. */
export function mentionedTools(text: string, toolNames: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
    if (toolNames.has(m[1])) found.add(m[1]);
  }
  return [...found].sort();
}

/** Agents a handoff or a doesNot boundary points at (`**name**` in the handoff text, `to` fields). */
export function handoffTargets(agent: AgentSpec, agentNames: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const m of (agent.handoff ?? "").matchAll(/\*\*([a-z][a-z-]*)\*\*/g)) {
    if (agentNames.has(m[1]) && m[1] !== agent.name) out.add(m[1]);
  }
  for (const d of agent.doesNot) {
    if (agentNames.has(d.to) && d.to !== agent.name) out.add(d.to);
  }
  return [...out].sort();
}

export function buildGraph(input: GraphInput): Graph {
  const agentNames = new Set(input.agents.map((a) => a.name));
  const skillNames = new Set(input.skills.map((s) => s.name));
  const toolNames = new Set(input.tools.map((t) => t.name));
  const findings: Finding[] = [];

  const owners = new Map<string, string[]>();
  for (const a of input.agents) {
    for (const s of a.skills ?? []) {
      if (!skillNames.has(s)) {
        findings.push({ key: `dangling-skill:${a.name}:${s}`, kind: "dangling-skill", message: `${a.name} lists skill \`${s}\`, which does not exist` });
        continue;
      }
      owners.set(s, [...(owners.get(s) ?? []), a.name]);
    }
    for (const t of a.tools) {
      const g = gatewayToolName(t);
      if (g && !toolNames.has(g)) {
        findings.push({ key: `dangling-tool:${a.name}:${g}`, kind: "dangling-tool", message: `${a.name} holds \`${g}\`, which no server registers` });
      }
    }
  }

  for (const a of input.agents) {
    const held = new Set(a.tools.map(gatewayToolName).filter((x): x is string => !!x));
    const prose = [...a.owns, ...a.flow, ...(a.always ?? []), ...(a.never ?? []), a.handoff ?? ""].join("\n");
    for (const t of mentionedTools(prose, toolNames).filter((m) => !held.has(m))) {
      findings.push({ key: `agent-tool-gap:${a.name}:${t}`, kind: "agent-tool-gap", message: `${a.name}'s own instructions name \`${t}\`, which it does not hold` });
    }
  }

  const heldBy = new Map<string, string[]>();
  for (const a of input.agents) {
    for (const t of a.tools) {
      const g = gatewayToolName(t);
      if (g && toolNames.has(g)) heldBy.set(g, [...(heldBy.get(g) ?? []), a.name]);
    }
  }

  const mentionedBy = new Map<string, string[]>();
  const skills = [...input.skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const mentions = mentionedTools(s.text, toolNames);
      for (const t of mentions) mentionedBy.set(t, [...(mentionedBy.get(t) ?? []), s.name]);
      const own = [...(owners.get(s.name) ?? [])].sort();
      if (own.length === 0) {
        findings.push({ key: `unowned-skill:${s.name}`, kind: "unowned-skill", message: `skill \`${s.name}\` is listed by no agent` });
      }
      for (const o of own) {
        const agent = input.agents.find((a) => a.name === o)!;
        const held = new Set(agent.tools.map(gatewayToolName).filter((x): x is string => !!x));
        for (const t of mentions.filter((m) => !held.has(m))) {
          findings.push({
            key: `skill-tool-gap:${s.name}:${o}:${t}`,
            kind: "skill-tool-gap",
            message: `skill \`${s.name}\` (owner ${o}) names \`${t}\`, which ${o} does not hold`,
          });
        }
      }
      return { name: s.name, owners: own, mentionsTools: mentions };
    });

  const tools = [...input.tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const h = [...(heldBy.get(t.name) ?? [])].sort();
      if (h.length === 0) {
        findings.push({ key: `unheld-tool:${t.name}`, kind: "unheld-tool", message: `tool \`${t.name}\` (${t.server}) is held by no agent` });
      }
      return { name: t.name, server: t.server, heldBy: h, mentionedBy: [...(mentionedBy.get(t.name) ?? [])].sort() };
    });

  for (const p of LIFECYCLE) {
    for (const a of p.agents) {
      if (!agentNames.has(a)) findings.push({ key: `dangling-lifecycle:${p.phase}:agent:${a}`, kind: "dangling-lifecycle", message: `phase ${p.phase} names agent \`${a}\`, which does not exist` });
    }
    for (const s of p.skills) {
      if (!skillNames.has(s)) findings.push({ key: `dangling-lifecycle:${p.phase}:skill:${s}`, kind: "dangling-lifecycle", message: `phase ${p.phase} names skill \`${s}\`, which does not exist` });
    }
  }

  const agents = input.agents.map((a) => ({
    name: a.name,
    tools: a.tools.map(gatewayToolName).filter((x): x is string => !!x).sort(),
    skills: [...(a.skills ?? [])].sort(),
    handoffTo: handoffTargets(a, agentNames),
  }));

  findings.sort((x, y) => x.key.localeCompare(y.key));
  return {
    agents,
    skills,
    tools,
    phases: LIFECYCLE.map((p) => ({ phase: p.phase, agents: [...p.agents], skills: [...p.skills] })),
    findings,
  };
}

/** Accepted findings: finding key → why it is accepted. A blank reason is not an acceptance. */
export type Baseline = Record<string, string>;

/** Baseline keys whose reason is blank (an accepted finding must say why). */
export function unexplained(baseline: Baseline): string[] {
  return Object.entries(baseline).filter(([, why]) => !why.trim()).map(([k]) => k).sort();
}

/** Findings not yet accepted in the baseline, and baseline entries that no longer apply. */
export function diffBaseline(findings: Finding[], baseline: Baseline): { added: Finding[]; stale: string[] } {
  const known = new Set(Object.keys(baseline));
  const current = new Set(findings.map((f) => f.key));
  return {
    added: findings.filter((f) => !known.has(f.key)),
    stale: Object.keys(baseline).filter((k) => !current.has(k)).sort(),
  };
}

const id = (prefix: string, name: string) => `${prefix}_${name.replace(/[^a-zA-Z0-9]/g, "_")}`;

/** Deterministic Markdown (with Mermaid) for docs/graph.md. */
export function renderGraphMarkdown(g: Graph, baseline: Baseline): string {
  const L: string[] = [];
  L.push("# Capability graph", "");
  L.push("<!-- GENERATED by `npm run build:graph` from prompts/agents, skills/ and the tool registry. Do not edit. -->", "");
  L.push(
    `${g.agents.length} agents · ${g.skills.length} skills · ${g.tools.length} tools. A skill "mentions" a tool when its text names it in backticks; that is evidence of use, not proof, so every finding below is either fixed or accepted with a written reason in \`docs/graph-baseline.json\`, which may only shrink.`,
    ""
  );

  L.push("## Lifecycle and handoffs", "", "```mermaid", "flowchart LR");
  g.phases.forEach((p, i) => {
    L.push(`  ${id("ph", p.phase)}["${p.phase}<br/>${p.agents.join(", ")}"]`);
    if (i > 0) L.push(`  ${id("ph", g.phases[i - 1].phase)} --> ${id("ph", p.phase)}`);
  });
  L.push("```", "");
  L.push("```mermaid", "flowchart LR");
  for (const a of g.agents) L.push(`  ${id("a", a.name)}(["${a.name}"])`);
  for (const a of g.agents) for (const t of a.handoffTo) L.push(`  ${id("a", a.name)} -.-> ${id("a", t)}`);
  L.push("```", "");

  L.push("## Agents, skills and tools", "", "| Agent | Gateway tools | Skills | Hands off to |", "|---|---|---|---|");
  for (const a of g.agents) {
    L.push(`| ${a.name} | ${a.tools.length} | ${a.skills.map((s) => `\`${s}\``).join(", ") || "—"} | ${a.handoffTo.join(", ") || "—"} |`);
  }
  L.push("", "```mermaid", "flowchart LR");
  for (const a of g.agents) L.push(`  ${id("a", a.name)}(["${a.name}"])`);
  for (const s of g.skills) L.push(`  ${id("s", s.name)}["${s.name}"]`);
  for (const a of g.agents) for (const s of a.skills) L.push(`  ${id("a", a.name)} --> ${id("s", s)}`);
  L.push("```", "");

  L.push("## Findings", "");
  if (g.findings.length === 0) {
    L.push("None.", "");
  } else {
    L.push("| Kind | Finding | Status |", "|---|---|---|");
    for (const f of g.findings) L.push(`| ${f.kind} | ${f.message} | ${baseline[f.key] ? `accepted: ${baseline[f.key]}` : "**new**"} |`);
    L.push("");
  }

  L.push("## Tools by server", "");
  const byServer = new Map<string, typeof g.tools>();
  for (const t of g.tools) byServer.set(t.server, [...(byServer.get(t.server) ?? []), t]);
  L.push("| Server | Tools (held by) |", "|---|---|");
  for (const [server, ts] of [...byServer].sort((a, b) => a[0].localeCompare(b[0]))) {
    L.push(`| ${server} | ${ts.map((t) => `\`${t.name}\`${t.heldBy.length ? "" : " (unheld)"}`).join(", ")} |`);
  }
  L.push("");
  return L.join("\n");
}
