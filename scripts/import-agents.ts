import { promises as fs } from "fs";
import path from "path";

/**
 * Import QE agent assets from another repository into this centralized structure.
 *
 * Usage: npm run import:agents -- <sourceRepoPath> [--dry-run]
 *
 * Mapping:
 *   *.chatmode.md            -> .github/chatmodes/
 *   *.prompt.md              -> .github/prompts/
 *   *.instructions.md        -> .github/instructions/
 *   skills/<x>/SKILL.md      -> skills/<x>/SKILL.md
 *   scripts/**               -> scripts/imported/<repoName>/
 *   utils/** | src/utils/**  -> utils/imported/<repoName>/
 *
 * Existing files are never overwritten — conflicts are reported for manual merge.
 * Files containing likely secrets are flagged and skipped.
 */
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".queue", "reports", "test-results"]);
const SECRET_PATTERN = /(api[_-]?key|token|password|secret)\s*[:=]\s*['"][A-Za-z0-9+/_\-]{16,}['"]/i;

interface PlannedCopy {
  from: string;
  to: string;
}

async function walk(dir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, results);
    else results.push(full);
  }
}

function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function classify(sourceRoot: string, file: string, repoName: string): string | null {
  const rel = path.relative(sourceRoot, file).replace(/\\/g, "/");
  const base = toKebab(path.basename(file));

  if (base.endsWith(".chatmode.md")) return path.join(".github", "chatmodes", base);
  if (base.endsWith(".prompt.md")) return path.join(".github", "prompts", base);
  if (base.endsWith(".instructions.md")) return path.join(".github", "instructions", base);
  if (/(^|\/)skills\/[^/]+\/skill\.md$/i.test(rel)) {
    const skillName = toKebab(path.basename(path.dirname(file)));
    return path.join("skills", skillName, "SKILL.md");
  }
  if (/(^|\/)scripts\//.test(rel)) {
    return path.join("scripts", "imported", repoName, rel.replace(/^.*?scripts\//, ""));
  }
  if (/(^|\/)(src\/)?utils\//.test(rel)) {
    return path.join("utils", "imported", repoName, rel.replace(/^.*?utils\//, ""));
  }
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const sourceArg = args.find((a) => !a.startsWith("--"));
  if (!sourceArg) {
    console.error("Usage: npm run import:agents -- <sourceRepoPath> [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const sourceRoot = path.resolve(sourceArg);
  const stat = await fs.stat(sourceRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`Source is not a directory: ${sourceRoot}`);
    process.exitCode = 1;
    return;
  }

  const repoName = toKebab(path.basename(sourceRoot));
  const files: string[] = [];
  await walk(sourceRoot, files);

  const planned: PlannedCopy[] = [];
  const flagged: string[] = [];
  const conflicts: string[] = [];

  for (const file of files) {
    const target = classify(sourceRoot, file, repoName);
    if (!target) continue;

    const content = await fs.readFile(file, "utf8").catch(() => "");
    if (SECRET_PATTERN.test(content)) {
      flagged.push(`${file} (possible secret — skipped, sanitize manually)`);
      continue;
    }

    const targetAbs = path.resolve(target);
    const exists = await fs
      .stat(targetAbs)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      conflicts.push(`${target} already exists (merge manually from ${file})`);
      continue;
    }
    planned.push({ from: file, to: targetAbs });
  }

  console.log(`\nImport plan from ${sourceRoot} (${planned.length} files):`);
  for (const copy of planned) console.log(`  + ${path.relative(process.cwd(), copy.to).replace(/\\/g, "/")}`);
  for (const conflict of conflicts) console.log(`  ! ${conflict}`);
  for (const flag of flagged) console.log(`  ⚠ ${flag}`);

  if (dryRun) {
    console.log("\nDry run — nothing copied. Re-run without --dry-run to apply.");
    return;
  }

  for (const copy of planned) {
    await fs.mkdir(path.dirname(copy.to), { recursive: true });
    await fs.copyFile(copy.from, copy.to);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const record = `\n### ${stamp}\nImported ${planned.length} files from \`${sourceRoot}\` (repo: ${repoName}). Conflicts: ${conflicts.length}, secret-flagged: ${flagged.length}.\n`;
  await fs.mkdir("knowledge", { recursive: true });
  await fs.appendFile(path.join("knowledge", "learnings.md"), record, "utf8");

  console.log(`\nDone. Copied ${planned.length} files. Recorded in knowledge/learnings.md.`);
  console.log("Next: review imported files, normalize frontmatter, and dedupe (see importer chat mode).");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
