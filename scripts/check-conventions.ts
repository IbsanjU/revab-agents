/**
 * Conventions checker — enforces five framework rules the framework's own
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
 *     be reachable from the editor — either registered directly in .vscode/mcp.json or
 *     hosted by the gateway (mcp-servers/gateway/tools.ts).
 *
 *  4. Input coercion: every boolean/number field in MCP input schemas must use
 *     semantic wrappers to safely coerce quoted scalar values from models.
 *
 *  5. Freshness cues: the personas whose work depends on Jira/Confluence/doc inputs
 *     (automation, bsa, documenter, orchestrator, planner, reporter, researcher,
 *     test-planner) must explicitly mention verifying source freshness (stale docs,
 *     last-updated/version checks) so plans/tickets/tests/docs never get built from
 *     silently outdated requirements.
 *
 *  7. No organization-specific terms: if a local, untracked `.revab/denylist.txt` exists, no tracked
 *     text may contain a listed term (see utils/denylist.ts). Without the file the rule does nothing.
 *
 *  6. No external AI provider: no provider SDK in any package.json and no hosted-model endpoint or
 *     provider key variable in code/config. The models are whatever the user's own editor runs.
 *
 * Run with: npm run check:conventions
 * Exits non-zero (and prints every violation) if any rule is broken.
 */
import { promises as fs } from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { findExternalAiUsage } from "../utils/noExternalAi.js";
import { parseDenylist, findDenied } from "../utils/denylist.js";

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

  // Servers the gateway imports — these are reachable through the single gateway entry.
  const gatewaySource = await fs.readFile(path.resolve("mcp-servers/gateway/tools.ts"), "utf8").catch(() => "");
  const gatewayHosted = new Set(
    [...gatewaySource.matchAll(/"\.\.\/([\w-]+)\/index\.js"/g)].map((m) => m[1]),
  );

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

    // A server is reachable from the editor either through its own entry in mcp.json
    // or via the gateway, which hosts every server in `mcp-servers/gateway/tools.ts`.
    // Requiring an individual entry once the gateway exists would force the duplicate
    // registrations the gateway was built to remove.
    const registeredDirectly = new RegExp(`"${entry.name}"\\s*:`).test(mcpJson);
    const hostedByGateway = gatewayHosted.has(entry.name);
    if (!registeredDirectly && !hostedByGateway) {
      violations.push({
        file: ".vscode/mcp.json",
        message: `MCP server "${entry.name}" is neither registered directly nor hosted by the gateway — add it to mcp-servers/gateway/tools.ts, or give it its own entry`,
      });
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
 * Rule 4 (input coercion): every boolean/number field in an MCP tool's inputSchema must be
 * wrapped with `semanticBoolean`/`semanticNumber` (utils/).
 *
 * Models across hosts sometimes emit quoted scalars — `"dryRun":"false"`, `"maxResults":"25"`.
 * A bare `z.boolean()` rejects that outright (the call fails and the model starts guessing),
 * and `z.coerce.boolean()` is worse: JS truthiness turns the string "false" into `true`, which
 * would silently defeat a dryRun guard on a destructive tool. The wrappers coerce correctly
 * while still advertising a plain boolean/number to the model.
 */
async function checkInputCoercion(): Promise<Violation[]> {
  const violations: Violation[] = [];
  const serversDir = path.resolve("mcp-servers");
  let entries;
  try {
    entries = await fs.readdir(serversDir, { withFileTypes: true });
  } catch {
    return violations;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "shared") continue;
    const indexFile = path.join(serversDir, entry.name, "index.ts");
    let source: string;
    try {
      source = await fs.readFile(indexFile, "utf8");
    } catch {
      continue;
    }
    const rel = `mcp-servers/${entry.name}/index.ts`;

    for (const [kind, pattern, wrapper] of [
      ["boolean", /z\.boolean\(\)/g, "semanticBoolean"],
      ["number", /z\.number\(\)/g, "semanticNumber"],
    ] as const) {
      for (const match of source.matchAll(pattern)) {
        const start = match.index ?? 0;
        // Wrapped call sites read `semanticBoolean(z.boolean()...` — look just behind the match.
        const preceding = source.slice(Math.max(0, start - wrapper.length - 1), start);
        if (preceding.endsWith(`${wrapper}(`)) continue;
        const line = source.slice(0, start).split("\n").length;
        violations.push({
          file: `${rel}:${line}`,
          message: `Unwrapped \`z.${kind}()\` — wrap it with \`${wrapper}(...)\` so a quoted value from a model coerces instead of erroring (or, for booleans, silently defeating a dryRun guard)`,
        });
      }
    }
  }
  return violations;
}

/**
 * Rule 5 (freshness cues): relevant personas must explicitly mention freshness checks
 * (stale docs, last-updated/version verification) so planning/execution/reporting does
 * not rely on outdated requirements.
 */
async function checkAgentFreshnessCues(): Promise<Violation[]> {
  const violations: Violation[] = [];
  const agentsDir = path.resolve(".github", "agents");
  const requiredAgents = [
    "automation.agent.md",
    "bsa.agent.md",
    "documenter.agent.md",
    "orchestrator.agent.md",
    "planner.agent.md",
    "reporter.agent.md",
    "researcher.agent.md",
    "test-planner.agent.md",
  ];
  const cue = /(fresh|freshness|stale|last[-\s]?updated|\bversion\b|current state)/i;

  let hasAgentsDir = true;
  try {
    await fs.access(agentsDir);
  } catch {
    hasAgentsDir = false;
  }
  if (!hasAgentsDir) return violations;

  for (const file of requiredAgents) {
    const filePath = path.join(agentsDir, file);
    const rel = path.relative(process.cwd(), filePath);
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      violations.push({ file: rel, message: "Missing required agent file for freshness enforcement" });
      continue;
    }
    if (!cue.test(content)) {
      violations.push({
        file: rel,
        message: "Missing explicit freshness/staleness cue (e.g., stale docs, last-updated/version verification)",
      });
    }
  }
  return violations;
}

async function checkNoExternalAi(): Promise<Violation[]> {
  const files: Array<{ path: string; text: string }> = [];
  const skip = new Set(["node_modules", "dist", ".git", ".revab", "knowledge", "docs", "evals"]);
  async function walk(dir: string): Promise<void> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (skip.has(e.name) || e.name.endsWith(".test.ts") || e.name === "noExternalAi.ts" || e.name === "package-lock.json") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|mjs|js|json|md|example)$/.test(e.name) || e.name === ".env.example") files.push({ path: path.relative(process.cwd(), p), text: await fs.readFile(p, "utf8") });
    }
  }
  await walk(process.cwd());
  return findExternalAiUsage(files).map((message) => ({ file: message.split(":")[0], message: message.slice(message.indexOf(":") + 2) }));
}

/**
 * Rule 7: nothing organization-specific in the repo. The terms come from a local, untracked
 * `.revab/denylist.txt` (they would be identifying if committed). No file, no check.
 */
async function checkDenylist(): Promise<Violation[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(".revab", "denylist.txt"), "utf8");
  } catch {
    return [];
  }
  const { entries, errors } = parseDenylist(raw);
  const out: Violation[] = errors.map((message) => ({ file: ".revab/denylist.txt", message }));
  if (!entries.length) return out;
  const files: Array<{ path: string; text: string }> = [];
  // Tracked files only: generated, ignored build output is not "in the repo".
  let tracked: string[] | null = null;
  try {
    tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  } catch {
    tracked = null;
  }
  if (tracked) {
    for (const rel of tracked) {
      if (rel === "package-lock.json" || !/\.(ts|mjs|js|json|md|yml|yaml|txt|example|html|css)$/.test(rel) && !path.basename(rel).startsWith(".")) continue;
      files.push({ path: rel, text: await fs.readFile(path.resolve(rel), "utf8").catch(() => "") });
    }
  } else {
    const skip = new Set(["node_modules", "dist", ".git", ".revab", ".queue", ".workspaces"]);
    async function walk(dir: string): Promise<void> {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (skip.has(e.name) || e.name === "package-lock.json") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(ts|mjs|js|json|md|yml|yaml|txt|example|html|css)$/.test(e.name) || e.name.startsWith(".")) {
          files.push({ path: path.relative(process.cwd(), p), text: await fs.readFile(p, "utf8").catch(() => "") });
        }
      }
    }
    await walk(process.cwd());
  }
  for (const h of findDenied(files, entries)) {
    out.push({ file: h.path, message: `line ${h.line} contains a term from your local denylist (entry: ${h.entry})` });
  }
  return out;
}

async function main(): Promise<void> {
  const violations = [
    ...(await checkSkillFrontmatter()),
    ...(await checkRegistryProjectGuard()),
    ...(await checkDocsDrift()),
    ...(await checkInputCoercion()),
    ...(await checkAgentFreshnessCues()),
    ...(await checkNoExternalAi()),
    ...(await checkDenylist()),
  ];

  if (violations.length === 0) {
    console.log(
      "check:conventions — OK (skill frontmatter + registry project guards + docs/tool lists + input coercion + agent freshness cues + no external AI provider all valid)"
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
