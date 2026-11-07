/**
 * Build the capability graph (docs/graph.md + docs/graph.json) from the agent specs, skills and
 * the tool registry.
 *
 *   npm run build:graph                       write both files
 *   npm run build:graph -- --check            fail if either file is stale, or if a finding is new
 *   npm run build:graph -- --update-baseline  accept the current findings (use only to ratchet down)
 */
import { promises as fs } from "fs";
import path from "path";
import { AGENTS } from "../prompts/agents/index.js";
import { captureAllTools } from "../mcp-servers/gateway/tools.js";
import { buildGraph, diffBaseline, renderGraphMarkdown } from "../utils/capabilityGraph.js";

const MD = path.resolve("docs/graph.md");
const JSON_OUT = path.resolve("docs/graph.json");
const BASELINE = path.resolve("docs/graph-baseline.json");

async function readBaseline(): Promise<string[]> {
  try {
    return JSON.parse(await fs.readFile(BASELINE, "utf8")) as string[];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const skillsDir = path.resolve("skills");
  const skills = [];
  for (const e of (await fs.readdir(skillsDir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    skills.push({ name: e.name, text: await fs.readFile(path.join(skillsDir, e.name, "SKILL.md"), "utf8") });
  }
  const tools = (await captureAllTools()).map((t) => ({ name: t.name, server: t.server }));
  const graph = buildGraph({ agents: AGENTS, skills, tools });

  if (args.has("--update-baseline")) {
    await fs.writeFile(BASELINE, JSON.stringify(graph.findings.map((f) => f.key), null, 2) + "\n");
    console.log(`build-graph: baseline now holds ${graph.findings.length} finding(s)`);
  }
  const baseline = await readBaseline();
  const md = renderGraphMarkdown(graph, baseline);
  const json = JSON.stringify(graph, null, 2) + "\n";

  if (args.has("--check")) {
    const problems: string[] = [];
    for (const [file, want] of [[MD, md], [JSON_OUT, json]] as const) {
      const have = await fs.readFile(file, "utf8").catch(() => "");
      if (have !== want) problems.push(`${path.relative(process.cwd(), file)} is stale — run \`npm run build:graph\``);
    }
    const { added, stale } = diffBaseline(graph.findings, baseline);
    for (const f of added) problems.push(`new graph finding: ${f.message}`);
    for (const k of stale) problems.push(`fixed finding still in docs/graph-baseline.json (remove it): ${k}`);
    if (problems.length) {
      console.error(`build-graph --check — ${problems.length} problem(s):\n`);
      for (const p of problems) console.error(`  ✖ ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log(`build-graph --check: graph up to date; ${graph.findings.length} accepted finding(s)`);
    return;
  }

  await fs.writeFile(MD, md);
  await fs.writeFile(JSON_OUT, json);
  console.log(`build-graph: wrote docs/graph.md and docs/graph.json (${graph.findings.length} finding(s))`);
}

main().then(() => process.exit(process.exitCode ?? 0), (err) => {
  console.error(err);
  process.exit(1);
});
