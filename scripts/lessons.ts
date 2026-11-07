/**
 * knowledge/lessons.md tooling.
 *
 *   npm run lessons -- list                      lessons by confidence, with what should happen next
 *   npm run lessons -- check                     validate the file (non-zero on a problem)
 *   npm run lessons -- promote                   only the lessons ready to fold into a skill or the conduct rules
 *   npm run lessons -- reinforce <id> --evidence "PR #9" [--against]   record another observation
 */
import { promises as fs } from "fs";
import path from "path";
import { renderList, reinforce, validateLessons, verdict, confidence } from "../utils/lessons.js";

const FILE = path.resolve("knowledge/lessons.md");

async function main(): Promise<void> {
  const [cmd = "list", ...rest] = process.argv.slice(2);
  const text = await fs.readFile(FILE, "utf8").catch(() => "");
  const { lessons, problems } = validateLessons(text);

  if (cmd === "check") {
    if (problems.length) {
      console.error(`lessons check — ${problems.length} problem(s):\n`);
      for (const p of problems) console.error(`  ✖ knowledge/lessons.md:${p.line} ${p.id}: ${p.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`lessons check — OK (${lessons.length} lesson(s))`);
    return;
  }
  if (problems.length) {
    console.error("lessons.md has problems; run `npm run lessons -- check`.");
    process.exitCode = 1;
    return;
  }
  if (cmd === "list") {
    console.log(renderList(lessons));
  } else if (cmd === "promote") {
    const ready = lessons.filter((l) => verdict(l).verdict === "promote");
    if (!ready.length) console.log("nothing ready to promote");
    for (const l of ready) console.log(`${l.id} (conf ${confidence(l).toFixed(2)}, scope ${l.scope})\n  ${l.trigger}\n  ${l.action}\n  → ${verdict(l).why}\n  evidence: ${l.evidence}\n`);
  } else if (cmd === "reinforce") {
    const id = rest[0];
    const ev = rest.indexOf("--evidence");
    const evidence = ev >= 0 ? rest[ev + 1] : undefined;
    if (!id || !evidence) throw new Error('usage: lessons reinforce <id> --evidence "<where observed>" [--against]');
    const next = reinforce(text, id, evidence, new Date().toISOString().slice(0, 10), rest.includes("--against"));
    await fs.writeFile(FILE, next);
    const after = validateLessons(next).lessons.find((l) => l.id === id)!;
    console.log(`${id}: support ${after.support}, against ${after.contradict}, confidence ${confidence(after).toFixed(2)} → ${verdict(after).verdict}`);
  } else {
    throw new Error(`unknown command \`${cmd}\``);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
