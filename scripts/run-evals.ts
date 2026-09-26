/**
 * Eval runner — answers "did that prompt change actually help, or just feel better?"
 *
 *   npm run eval              # structural capability evals (deterministic, CI-safe)
 *   npm run eval -- --list    # also print the behavioral cases to run by hand/LLM
 *
 * Structural evals check the typed specs against `evals/capabilities.ts`: the tools
 * each agent must and must not hold, plus framework-wide invariants (no wildcard
 * grants, every agent has hand-off edges, rules inlined not referenced). They are
 * deterministic and run in CI — they catch the class of regression where a prompt
 * "improvement" silently removes a capability an agent needs.
 *
 * Behavioral evals (`evals/behavior/*.md`) are the other half: a fixed task plus a
 * rubric of must/must-not, judged per run by a human or an LLM. They are printed,
 * not auto-scored — scoring them requires actually driving an agent, which happens
 * in the editor, not in this process. Record outcomes in the case file so a change
 * can be compared before/after instead of guessed at.
 */
import { promises as fs } from "fs";
import path from "path";
import { AGENTS } from "../prompts/agents/index.js";
import { runCapabilityEvals, runGlobalEvals, type EvalFailure } from "../evals/capabilities.js";

const BEHAVIOR_DIR = path.resolve("evals", "behavior");

function report(title: string, failures: EvalFailure[]): void {
  if (!failures.length) {
    console.log(`  ${title}: pass`);
    return;
  }
  console.log(`  ${title}: ${failures.length} failure(s)`);
  for (const f of failures) {
    console.log(`    ✗ [${f.agent}] ${f.kind}: ${f.detail}`);
  }
}

async function listBehavioralCases(): Promise<void> {
  let files: string[];
  try {
    files = (await fs.readdir(BEHAVIOR_DIR)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    console.log("\nNo behavioral cases yet (evals/behavior/).");
    return;
  }
  console.log(`\nBehavioral cases (${files.length}) — run each against its agent and score the rubric:`);
  for (const file of files) {
    const raw = await fs.readFile(path.join(BEHAVIOR_DIR, file), "utf8");
    const title = /^#\s+(.+)$/m.exec(raw)?.[1] ?? file;
    console.log(`  - ${file}: ${title}`);
  }
  console.log(`\nOpen a case file for its task prompt and must/must-not rubric.`);
}

async function main(): Promise<void> {
  console.log(`Running capability evals against ${AGENTS.length} agent specs...\n`);

  const capabilityFailures = runCapabilityEvals(AGENTS);
  const globalFailures = runGlobalEvals(AGENTS);

  report("per-agent capabilities", capabilityFailures);
  report("framework invariants", globalFailures);

  if (process.argv.includes("--list")) {
    await listBehavioralCases();
  }

  const total = capabilityFailures.length + globalFailures.length;
  if (total) {
    console.error(
      `\neval: ${total} failure(s). Fix the spec in prompts/agents/, run \`npm run build:prompts\`, and re-run.`,
    );
    process.exit(1);
  }
  console.log("\neval: all structural evals pass.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
