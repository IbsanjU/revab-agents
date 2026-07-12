/**
 * Conventions checker — enforces three framework rules the framework's own
 * conventions depend on (see knowledge/conventions.md):
 *
 *  1. Every skills/<name>/SKILL.md has valid frontmatter: a `---`-delimited block
 *     with a non-empty `name` (matching its directory) and non-empty `description`.
 *  2. Every handler in agents/registry.ts that resolves a project's repo path via
 *     `resolveProjectRepoPath(...)` must first validate `payload.project` (via
 *     `requireProject(payload)` or an equivalent explicit check) — a handler must
 *     never resolve an on-disk path without having required/validated the project
 *     name that drives it.
 *
 *  3. Docs drift: every `registerTool("name", ...)` in mcp-servers/<server>/index.ts
 *     must be documented in README.md and knowledge/memory.md, and every server must
 *     be registered in .vscode/mcp.json.
 *
 *  4. Agent conduct drift: every .github/agents/<name>.agent.md must carry the current
 *     shared-conduct marker (applied via `npm run agents:conduct`), and the persona set
 *     must match the "Per-agent boundaries" list in .github/copilot-instructions.md
 *     (every listed persona has a matching .agent.md file, and vice versa).
 *
 * Run with: npm run check:conventions
 * Exits non-zero (and prints every violation) if any rule is broken.
 */
import { promises as fs } from "fs";
import path from "path";

interface Violation {
  file: string;
  message: string;
}

async function checkSkillFrontmatter(): Promise<Violation[]> {
  const violations: Violation[] = [];
  const skillsDir = path.resolve("skills");
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return violations; // no skills/ directory — nothing to check
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
    const rel = path.relative(process.cwd(), skillFile);
    let content: string;
    try {
      content = await fs.readFile(skillFile, "utf8");
    } catch {
      violations.push({ file: rel, message: `Missing SKILL.md in skills/${entry.name}/` });
      continue;
    }

    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match) {
      violations.push({ file: rel, message: "Missing or malformed --- frontmatter block" });
      continue;
    }

    const frontmatter = match[1];
    const nameMatch = /^name:\s*(.+)$/m.exec(frontmatter);
    const descMatch = /^description:\s*(.+)$/m.exec(frontmatter);

    if (!nameMatch || !nameMatch[1].trim()) {
      violations.push({ file: rel, message: "Frontmatter missing a non-empty `name` field" });
    } else if (nameMatch[1].trim() !== entry.name) {
      violations.push({
        file: rel,
        message: `Frontmatter \`name: ${nameMatch[1].trim()}\` does not match directory name \`${entry.name}\``,
      });
    }

    if (!descMatch || !descMatch[1].trim()) {
      violations.push({ file: rel, message: "Frontmatter missing a non-empty `description` field" });
    }
  }

  return violations;
}

/** Extract each top-level `"<task-type>": { ... }` handler block's source text from registry.ts. */
function extractHandlerBlocks(source: string): Map<string, string> {
  const handlers = new Map<string, string>();
  const handlerStart = /(?:"([^"]+)"|(\w+)):\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = handlerStart.exec(source))) {
    const name = match[1] ?? match[2];
    const openIndex = match.index + match[0].length - 1; // index of the opening `{`
    let depth = 1;
    let i = openIndex + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    handlers.set(name, source.slice(openIndex, i));
  }
  return handlers;
}

async function checkRegistryProjectGuard(): Promise<Violation[]> {
  const violations: Violation[] = [];
  const registryFile = path.resolve("agents", "registry.ts");
  const rel = path.relative(process.cwd(), registryFile);
  let content: string;
  try {
    content = await fs.readFile(registryFile, "utf8");
  } catch {
    return violations; // no registry — nothing to check
  }

  const handlersBlockMatch = /export const handlers: Record<string, TaskHandler> = \{([\s\S]*)\n\};/.exec(content);
  if (!handlersBlockMatch) {
    violations.push({ file: rel, message: "Could not locate `export const handlers = { ... }` block to check" });
    return violations;
  }

  const blocks = extractHandlerBlocks(handlersBlockMatch[1]);
  for (const [name, body] of blocks) {
    const resolvesProject = /resolveProjectRepoPath\s*\(/.test(body);
    if (!resolvesProject) continue;
    const guardsProject = /requireProject\s*\(\s*payload\s*\)/.test(body) || /payload\.project\b/.test(body);
    if (!guardsProject) {
      violations.push({
        file: rel,
        message: `Handler "${name}" calls resolveProjectRepoPath(...) without first requiring/validating payload.project`,
      });
    }
  }

  return violations;
}

/**
 * Rule 3 (docs drift): every tool registered via `server.registerTool("name", ...)` in
 * mcp-servers/<server>/index.ts must be mentioned in both README.md and
 * knowledge/memory.md, and every mcp-servers/<server>/ must appear in .vscode/mcp.json.
 * Keeps the three documented tool lists from drifting away from the code.
 */
async function checkDocsDrift(): Promise<Violation[]> {
  const violations: Violation[] = [];
  const serversDir = path.resolve("mcp-servers");
  let entries;
  try {
    entries = await fs.readdir(serversDir, { withFileTypes: true });
  } catch {
    return violations;
  }

  let readme = "";
  let memory = "";
  let mcpJson = "";
  try {
    readme = await fs.readFile(path.resolve("README.md"), "utf8");
    memory = await fs.readFile(path.resolve("knowledge", "memory.md"), "utf8");
    mcpJson = await fs.readFile(path.resolve(".vscode", "mcp.json"), "utf8");
  } catch {
    return violations; // docs not present — nothing to check against
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "shared") continue;
    const indexFile = path.join(serversDir, entry.name, "index.ts");
    const rel = path.relative(process.cwd(), indexFile);
    let source: string;
    try {
      source = await fs.readFile(indexFile, "utf8");
    } catch {
      continue;
    }

    if (!new RegExp(`"${entry.name}"\\s*:`).test(mcpJson)) {
      violations.push({ file: ".vscode/mcp.json", message: `MCP server "${entry.name}" is not registered` });
    }

    const toolNames = [...source.matchAll(/registerTool\(\s*\r?\n?\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const tool of toolNames) {
      if (!readme.includes(tool)) {
        violations.push({ file: "README.md", message: `Tool \`${tool}\` (${rel}) is not documented` });
      }
      if (!memory.includes(tool)) {
        violations.push({ file: "knowledge/memory.md", message: `Tool \`${tool}\` (${rel}) is not documented` });
      }
    }
  }

  return violations;
}

/**
 * Rule 4 (agent conduct drift): every .github/agents/<name>.agent.md must contain the
 * current shared-conduct version marker (kept in scripts/apply-agent-conduct.ts and
 * applied via `npm run agents:conduct`), and the persona set must stay in sync with the
 * "Per-agent boundaries" list in .github/copilot-instructions.md.
 */
async function checkAgentConduct(): Promise<Violation[]> {
  const violations: Violation[] = [];
  const agentsDir = path.resolve(".github", "agents");
  let entries;
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return violations; // no .github/agents/ directory — nothing to check
  }

  // Keep the expected marker in lockstep with apply-agent-conduct.ts (version bumps included).
  let marker = "<!-- shared-conduct:v1 -->";
  try {
    const applyScript = await fs.readFile(path.resolve("scripts", "apply-agent-conduct.ts"), "utf8");
    const markerMatch = /const MARKER = "([^"]+)"/.exec(applyScript);
    if (markerMatch) marker = markerMatch[1];
  } catch {
    // fall back to the default marker
  }

  const agentNames = entries
    .filter((e) => e.isFile() && e.name.endsWith(".agent.md"))
    .map((e) => e.name.replace(/\.agent\.md$/, ""));

  for (const name of agentNames) {
    const rel = path.join(".github", "agents", `${name}.agent.md`);
    let content: string;
    try {
      content = await fs.readFile(path.join(agentsDir, `${name}.agent.md`), "utf8");
    } catch {
      continue;
    }
    if (!content.includes(marker)) {
      violations.push({
        file: rel,
        message: `Missing shared-conduct marker \`${marker}\` — run \`npm run agents:conduct\` locally and commit the result`,
      });
    }
  }

  let instructions: string;
  try {
    instructions = await fs.readFile(path.resolve(".github", "copilot-instructions.md"), "utf8");
  } catch {
    return violations; // no copilot-instructions.md — skip the parity check
  }

  const boundariesSection = /### Per-agent boundaries[^\n]*\n([\s\S]*?)(?:\n#|$)/.exec(instructions);
  if (!boundariesSection) return violations;
  const listedPersonas = [...boundariesSection[1].matchAll(/^- \*\*([\w-]+)\*\*/gm)].map((m) => m[1]);

  for (const persona of listedPersonas) {
    if (!agentNames.includes(persona)) {
      violations.push({
        file: path.join(".github", "agents", `${persona}.agent.md`),
        message: `Persona "${persona}" is listed under "Per-agent boundaries" in .github/copilot-instructions.md but has no .agent.md file`,
      });
    }
  }
  for (const name of agentNames) {
    if (!listedPersonas.includes(name)) {
      violations.push({
        file: ".github/copilot-instructions.md",
        message: `Agent "${name}" (.github/agents/${name}.agent.md) is missing from the "Per-agent boundaries" list`,
      });
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const violations = [
    ...(await checkSkillFrontmatter()),
    ...(await checkRegistryProjectGuard()),
    ...(await checkDocsDrift()),
    ...(await checkAgentConduct()),
  ];

  if (violations.length === 0) {
    console.log(
      "check:conventions — OK (skill frontmatter + registry project guards + docs/tool lists + agent conduct markers all valid)"
    );
    return;
  }

  console.error(`check:conventions — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  ✖ ${v.file}: ${v.message}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
