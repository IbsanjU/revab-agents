/**
 * Rotates old dated entries out of knowledge/learnings.md into monthly archive files
 * (knowledge/learnings/<YYYY-MM>.md), so the main file agents read at session start
 * doesn't grow unbounded and bloat context over time.
 *
 * Policy (see knowledge/conventions.md):
 *  - Entries are headed by "### YYYY-MM-DD" lines.
 *  - The current calendar month's entries always stay in knowledge/learnings.md.
 *  - Older entries are archived once the main file exceeds ROTATE_THRESHOLD_BYTES —
 *    running this below the threshold is a safe no-op.
 *
 * Run with: npm run knowledge:rotate
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const LEARNINGS_PATH = path.resolve("knowledge", "learnings.md");
const ARCHIVE_DIR = path.resolve("knowledge", "learnings");
const ROTATE_THRESHOLD_BYTES = 8000;

interface Entry {
  month: string; // YYYY-MM
  text: string; // full "### YYYY-MM-DD\n...body..." block, including trailing blank line(s)
}

function parseEntries(body: string): { header: string; entries: Entry[] } {
  const headingPattern = /^### (\d{4}-\d{2})-\d{2}\s*$/gm;
  const starts: Array<{ index: number; month: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingPattern.exec(body))) {
    starts.push({ index: m.index, month: m[1] });
  }

  if (starts.length === 0) {
    return { header: body, entries: [] };
  }

  const header = body.slice(0, starts[0].index);
  const entries: Entry[] = starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : body.length;
    return { month: s.month, text: body.slice(s.index, end) };
  });
  return { header, entries };
}

export async function rotateLearnings(now: Date = new Date()): Promise<{ rotated: boolean; archivedMonths: string[] }> {
  let raw: string;
  try {
    raw = await fs.readFile(LEARNINGS_PATH, "utf8");
  } catch {
    return { rotated: false, archivedMonths: [] };
  }

  if (Buffer.byteLength(raw, "utf8") < ROTATE_THRESHOLD_BYTES) {
    return { rotated: false, archivedMonths: [] };
  }

  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
  const { header, entries } = parseEntries(raw);
  const toKeep = entries.filter((e) => e.month === currentMonth);
  const toArchive = entries.filter((e) => e.month !== currentMonth);

  if (toArchive.length === 0) {
    return { rotated: false, archivedMonths: [] };
  }

  const byMonth = new Map<string, string[]>();
  for (const entry of toArchive) {
    const list = byMonth.get(entry.month) ?? [];
    list.push(entry.text);
    byMonth.set(entry.month, list);
  }

  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  const archivedMonths: string[] = [];
  for (const [month, texts] of byMonth) {
    const archivePath = path.join(ARCHIVE_DIR, `${month}.md`);
    const existing = await fs.readFile(archivePath, "utf8").catch(() => `# Learnings archive — ${month}\n`);
    const updated = existing.trimEnd() + "\n\n" + texts.join("").trimEnd() + "\n";
    await fs.writeFile(archivePath, updated, "utf8");
    archivedMonths.push(month);
  }

  const remaining = header.trimEnd() + "\n\n" + toKeep.map((e) => e.text).join("").trimEnd() + "\n";
  await fs.writeFile(LEARNINGS_PATH, remaining, "utf8");

  return { rotated: true, archivedMonths: archivedMonths.sort() };
}

async function main(): Promise<void> {
  const result = await rotateLearnings();
  if (!result.rotated) {
    console.log(
      `knowledge/learnings.md is under the ${ROTATE_THRESHOLD_BYTES}-byte rotation threshold (or has nothing to archive) — no changes made.`
    );
    return;
  }
  console.log(`Archived entries from ${result.archivedMonths.join(", ")} into knowledge/learnings/<month>.md.`);
}

// Only auto-run when executed directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
