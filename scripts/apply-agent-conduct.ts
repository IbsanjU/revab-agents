/**
 * apply-agent-conduct.ts — echo the shared "Agent conduct" rules from
 * .github/copilot-instructions.md into each .github/agents/<name>.agent.md persona.
 *
 * The canonical source of these rules stays in copilot-instructions.md; the sections
 * appended here are deliberately short restatements at the point of use. Personas may
 * tighten but never loosen the shared rules.
 *
 * Idempotent: files already containing the version marker are skipped. Bump MARKER
 * (v1 -> v2) after revising the shared section if a re-apply is wanted.
 *
 * Usage:
 *   npm run agents:conduct            # apply
 *   npm run agents:conduct -- --dry-run   # preview what would be appended, write nothing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "<!-- shared-conduct:v1 -->";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDir = path.join(repoRoot, ".github", "agents");
const dryRun = process.argv.includes("--dry-run");

const boundaries: Record<string, string> = {
  planner: [
    "- Can: read everything, save plans to `knowledge/plans/`.",
    "- Cannot: execute any plan step itself.",
    "- Must not: finalize a plan with open critique blockers.",
  ].join("\n"),
  orchestrator: [
    "- Can: enqueue whitelisted task types with a `plan` payload.",
    "- Cannot: run long work inline (hard rule #5).",
    "- Must not: pass unresolved raw paths in payloads (hard rule #8).",
  ].join("\n"),
  researcher: [
    "- Can: read/search all sources, suggest-then-pull saves.",
    "- Cannot: write to Jira/Confluence/JTMF.",
    "- Must not: cite unfetched content.",
  ].join("\n"),
  "test-planner": [
    "- Can: generate plans/scenarios from cited sources.",
    "- Cannot: execute tests.",
    "- Must not: invent locators absent from the app model.",
  ].join("\n"),
  automation: [
    "- Can: scaffold/edit code inside the manifest-resolved target repo only.",
    "- Cannot: run anything against `revab-agents` itself (hard rule #7).",
    "- Must not: introduce BrowserStack where absent (hard rule #11).",
  ].join("\n"),
  reporter: [
    "- Can: run analyses, persist reports.",
    "- Cannot: transition Jira issues without the dryRun+approval flow.",
    "- Must not: reclassify failures without evidence.",
  ].join("\n"),
  documenter: [
    "- Can: draft pages/reports.",
    "- Cannot: publish to Confluence without dryRun preview + approval.",
    "- Must not: embed uncited claims.",
  ].join("\n"),
  importer: [
    "- Can: import agents/scripts via `npm run import:agents`.",
    "- Cannot: pull from paths outside the given source repo.",
    "- Must not: overwrite local customizations without a dry-run diff.",
  ].join("\n"),
  "self-improve": [
    "- Can: append learnings, propose persona/skill upgrades.",
    "- Cannot: change hard rules unilaterally.",
    "- Must not: store sensitive or ephemeral data.",
  ].join("\n"),
};

const completionChecklist = `
### Completion checklist (verify and state before declaring done)
1. Target project's own typecheck/lint passed (never this repo's — hard rule #7).
2. Every generated artifact carries its source citation (hard rule #9).
3. Execution conventions respected (\`detect-execution-convention\` decision, hard rule #11).
4. No writes outside the manifest-resolved repo path (hard rule #8); no external write skipped its dryRun preview (hard rule #10).
5. Learnings appended to \`knowledge/learnings.md\` (hard rule #4).
`;

const whenBlocked = `
### When blocked
Report in ≤4 lines: **Blocked on** (the step), **because** (rule/missing input), **options** (2–3 ways forward, cheapest first), **default** (usually: wait).
`;

const antiHallucination = `
### Anti-hallucination
- Never summarize a Jira issue, Confluence page, JTMF case, or file not actually fetched this session.
- Prefer "I could not find X in <sources searched>" over a plausible guess; name the empty sources.
- Quote ids/links only as returned by tools — never reconstruct URLs or keys from memory.
`;

const memoryHygiene = `
### Memory hygiene
Store only what is durable, generalizable, non-sensitive, and not trivially inferable from code.
Don't store one-off task details, ephemeral state, or anything the user asked to keep private.
Delete entries proven wrong instead of stacking corrections.
`;

const verbosity = `
### Verbosity
Lead with the answer/decision in 1–2 sentences; no preamble. Anything longer than the skill's
fixed Output structure goes into a persisted file (\`knowledge/reports/\`, \`projects/<name>/\`), linked not inlined.
`;

const executingAgents = new Set(["automation", "documenter", "importer", "orchestrator"]);
const blockedAgents = new Set(["planner", "orchestrator"]);
const verbosityAgents = new Set(["planner", "researcher", "reporter"]);

function buildSection(name: string): string {
  let section = `
${MARKER}
## Conduct
Shared conduct rules apply — see **Agent conduct** in \`.github/copilot-instructions.md\`
(tool discipline, escalation, verbosity, anti-hallucination, memory hygiene).
This persona may tighten but never loosen them.

### Boundaries
${boundaries[name]}
`;
  if (executingAgents.has(name)) section += completionChecklist;
  if (blockedAgents.has(name)) section += whenBlocked;
  if (name === "researcher") section += antiHallucination;
  if (name === "self-improve") section += memoryHygiene;
  if (verbosityAgents.has(name)) section += verbosity;
  return section;
}

let updated = 0;
let skipped = 0;
let missing = 0;

for (const name of Object.keys(boundaries)) {
  const file = path.join(agentsDir, `${name}.agent.md`);
  if (!fs.existsSync(file)) {
    console.warn(`missing: ${path.relative(repoRoot, file)}`);
    missing++;
    continue;
  }
  const current = fs.readFileSync(file, "utf8");
  if (current.includes(MARKER)) {
    console.log(`skip (already applied): ${name}.agent.md`);
    skipped++;
    continue;
  }
  const section = buildSection(name);
  if (dryRun) {
    console.log(`--- would append to ${name}.agent.md ---${section}`);
  } else {
    fs.writeFileSync(file, current.replace(/\s*$/, "\n") + section, "utf8");
    console.log(`updated: ${name}.agent.md`);
  }
  updated++;
}

console.log(
  `\n${dryRun ? "[dry-run] " : ""}done — ${updated} ${dryRun ? "pending" : "updated"}, ${skipped} skipped, ${missing} missing`
);
if (missing > 0) process.exitCode = 1;
