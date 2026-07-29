/**
 * Correction log CLI — capture what you corrected, so it stops recurring.
 *
 *   npm run correction -- log --agent orchestrator --task "dispatch a bdd run" \
 *     --observed "ran npm test directly" \
 *     --expected "enqueue via npm run task -- enqueue run-bdd" \
 *     --rule "Use the terminal only for the queue CLI" [--severity high]
 *   npm run correction -- list            # open corrections, most-corrected agent first
 *   npm run correction -- applied <id...> # mark folded into a spec
 *
 * Workflow: log it → fold the `rule` into that agent's `prompts/agents/<name>.ts`
 * as a concrete Never/Always bullet → `npm run build:prompts` → mark applied →
 * add an eval case so a regression is caught. See skills/capture-correction/SKILL.md.
 */
import {
  appendCorrection,
  markApplied,
  openByAgent,
  readCorrections,
  type CorrectionSeverity,
} from "../utils/corrections.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function requireFlag(name: string): string {
  const value = flag(name);
  if (!value) {
    console.error(`Missing required --${name}. See: npm run correction -- log --help`);
    process.exit(1);
  }
  return value;
}

async function cmdLog(): Promise<void> {
  const severity = (flag("severity") ?? "medium") as CorrectionSeverity;
  if (!["low", "medium", "high"].includes(severity)) {
    console.error(`Invalid --severity "${severity}" (expected low|medium|high).`);
    process.exit(1);
  }
  const record = await appendCorrection({
    date: flag("date") ?? new Date().toISOString().slice(0, 10),
    agent: requireFlag("agent"),
    task: requireFlag("task"),
    observed: requireFlag("observed"),
    expected: requireFlag("expected"),
    rule: requireFlag("rule"),
    severity,
  });
  console.log(`Logged ${record.id} for "${record.agent}" (${record.severity}).`);
  console.log(`Next: fold this rule into prompts/agents/${record.agent}.ts, then:`);
  console.log(`  npm run build:prompts && npm run correction -- applied ${record.id}`);
}

async function cmdList(): Promise<void> {
  const records = await readCorrections();
  const groups = openByAgent(records);
  const applied = records.filter((r) => r.status === "applied").length;

  if (!groups.length) {
    console.log(`No open corrections (${records.length} logged, ${applied} applied).`);
    return;
  }
  console.log(`Open corrections — fix the top agent first (${applied} already applied):\n`);
  for (const { agent, records: list } of groups) {
    console.log(`${agent} — ${list.length} open`);
    for (const r of list) {
      console.log(`  [${r.id}] (${r.severity}) ${r.rule}`);
      console.log(`      task: ${r.task}`);
      console.log(`      did: ${r.observed}`);
      console.log(`      want: ${r.expected}`);
    }
    console.log("");
  }
}

async function cmdApplied(ids: string[]): Promise<void> {
  if (!ids.length) {
    console.error("Usage: npm run correction -- applied <id> [<id>...]");
    process.exit(1);
  }
  const changed = await markApplied(ids);
  console.log(`Marked ${changed} correction(s) applied.`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "log":
      return cmdLog();
    case "list":
      return cmdList();
    case "applied":
      return cmdApplied(rest.filter((a) => !a.startsWith("--")));
    default:
      console.log("Usage: npm run correction -- <log|list|applied>");
      console.log("  log      --agent <name> --task <t> --observed <o> --expected <e> --rule <r> [--severity low|medium|high]");
      console.log("  list     show open corrections grouped by agent");
      console.log("  applied  <id...>  mark corrections as folded into a spec");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
