/**
 * Generates (or, with --check, verifies) every model-facing agent/instruction
 * file from the typed source in `prompts/**`.
 *
 *   npm run build:prompts            # write all generated files
 *   npm run build:prompts -- --check # exit non-zero if any file is stale (CI guard)
 *
 * The generated files (.github/agents/*.agent.md, AGENTS.md,
 * .github/copilot-instructions.md, CLAUDE.md) are checked in so every host sees
 * real, self-contained content — but they must never be hand-edited. Edit the
 * source under `prompts/` and re-run this. See
 * knowledge/plans/framework/2026-07-21-claude-code-discipline.md.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { renderAll } from "../prompts/build.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const files = renderAll();
  const stale: string[] = [];
  let written = 0;

  for (const file of files) {
    const abs = path.join(REPO_ROOT, file.path);
    const current = await fs.readFile(abs, "utf8").catch(() => null);
    // Normalize trailing newline so a single terminal newline never counts as drift.
    const desired = file.content.endsWith("\n") ? file.content : file.content + "\n";

    if (current === desired) continue;

    if (check) {
      stale.push(file.path);
      continue;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, desired, "utf8");
    written++;
    console.log(`  wrote ${file.path}`);
  }

  if (check) {
    if (stale.length) {
      console.error(
        `build-prompts --check: ${stale.length} file(s) are stale:\n` +
          stale.map((s) => `  - ${s}`).join("\n") +
          `\nRun \`npm run build:prompts\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`build-prompts --check: all ${files.length} generated files up to date.`);
    return;
  }

  console.log(
    `build-prompts: ${written} file(s) written, ${files.length - written} already up to date.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
