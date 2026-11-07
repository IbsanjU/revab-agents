/**
 * Behavior evals with no AI provider: you run a case in VS Code Copilot Chat; the gateway call log and
 * the rubric score it. See docs/behavior-evals.md.
 *
 *   npm run eval:behavior -- list                      cases, automatic checks, last recorded result
 *   npm run eval:behavior -- pack [--out file]         paste-in instructions for every case
 *   npm run eval:behavior -- mark <id>                 start a case: marks the call log
 *   npm run eval:behavior -- score <id> --model "<picker name>" [--pass M1,N2] [--fail M3] [--notes "..."]
 */
import { promises as fs } from "fs";
import path from "path";
import { appendMark } from "../mcp-servers/gateway/callLog.js";
import { BEHAVIOR_CHECKS } from "../evals/behaviorChecks.js";
import {
  evaluateChecks, manualItems, parseBehaviorEval, parseLog, parseRefs, recordRun, renderPack, segmentFor, verdictOf,
  type BehaviorEval,
} from "../utils/behaviorEvals.js";

const DIR = path.resolve("evals/behavior");
const LOG = path.resolve(process.env.GATEWAY_CALL_LOG ?? ".revab/calls.jsonl");

async function load(): Promise<BehaviorEval[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(files.map(async (f) => parseBehaviorEval(f.replace(/\.md$/, ""), await fs.readFile(path.join(DIR, f), "utf8"))));
}

const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<void> {
  const [cmd = "list", ...args] = process.argv.slice(2);
  const evals = await load();
  const byId = new Map(evals.map((e) => [e.id, e]));
  const need = (id: string | undefined): BehaviorEval => {
    const e = id ? byId.get(id) : undefined;
    if (!e) throw new Error(`unknown eval \`${id ?? ""}\`; run \`npm run eval:behavior -- list\``);
    return e;
  };

  if (cmd === "list") {
    for (const e of evals) {
      const text = await fs.readFile(path.join(DIR, `${e.id}.md`), "utf8");
      const rows = [...text.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|[^|]*\|\s*(PASS|FAIL|PENDING)\s*\|/gm)];
      const last = rows.length ? `${rows[rows.length - 1][2]} (${rows[rows.length - 1][1]})` : "never run";
      console.log(`${e.id.padEnd(40)} ${e.agent.split(" ")[0].padEnd(13)} ${String((BEHAVIOR_CHECKS[e.id] ?? []).length).padStart(2)} auto, ${String(manualItems(e).length).padStart(2)} judged  ${last}`);
    }
  } else if (cmd === "pack") {
    const out = renderPack(evals, (id) => BEHAVIOR_CHECKS[id] ?? []);
    const to = flag(args, "--out");
    if (to) { await fs.mkdir(path.dirname(path.resolve(to)), { recursive: true }); await fs.writeFile(to, out + "\n"); console.log(`wrote ${to}`); } else console.log(out);
  } else if (cmd === "mark") {
    const e = need(args[0]);
    appendMark(LOG, e.id);
    console.log(`marked \`${e.id}\` in ${path.relative(process.cwd(), LOG)}. Now run it in Copilot Chat as agent **${e.agent}**.`);
  } else if (cmd === "score") {
    const e = need(args[0]);
    const model = flag(args, "--model");
    if (!model) throw new Error('--model "<the model shown in the Copilot picker>" is required: a result is only meaningful with the model that produced it');
    const log = parseLog(await fs.readFile(LOG, "utf8").catch(() => ""));
    const calls = segmentFor(log, e.id);
    if (!calls) throw new Error(`no mark for \`${e.id}\` in ${LOG}; run \`mark ${e.id}\` before the case`);
    const items = manualItems(e);
    const valid = new Set(items.map((i) => i.ref));
    const passed = parseRefs(flag(args, "--pass"), valid);
    const failed = parseRefs(flag(args, "--fail"), valid);
    const machine = evaluateChecks(calls, BEHAVIOR_CHECKS[e.id] ?? []);
    const { verdict, unjudged } = verdictOf(machine, items, passed, failed);

    console.log(`${e.id}: ${calls.length} gateway call(s) recorded`);
    for (const m of machine) console.log(`  ${m.pass ? "✓" : "✖"} ${m.check.why} — ${m.detail}`);
    for (const r of failed) console.log(`  ✖ ${r} ${items.find((i) => i.ref === r)!.text}`);
    if (unjudged.length) console.log(`  · not yet judged: ${unjudged.join(", ")}`);
    console.log(`result: ${verdict}`);

    const problems = [...machine.filter((m) => !m.pass).map((m) => m.detail), ...failed.map((r) => `${r} failed`)];
    const notes = [flag(args, "--notes"), problems.length ? problems.join("; ") : undefined, unjudged.length ? `unjudged: ${unjudged.join(" ")}` : undefined].filter(Boolean).join(" · ");
    const file = path.join(DIR, `${e.id}.md`);
    await fs.writeFile(file, recordRun(await fs.readFile(file, "utf8"), { date: new Date().toISOString().slice(0, 10), host: `VS Code Copilot / ${model}`, result: verdict, notes }));
    console.log(`recorded in evals/behavior/${e.id}.md`);
    if (verdict === "FAIL") process.exitCode = 1;
  } else {
    throw new Error(`unknown command \`${cmd}\`; use list | pack | mark | score`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
