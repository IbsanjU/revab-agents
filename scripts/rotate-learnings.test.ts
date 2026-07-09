import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const MODULE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "rotate-learnings.ts");

async function freshRotateModule() {
  const url = `${pathToFileURL(MODULE_PATH).href}?t=${Date.now()}-${Math.random()}`;
  return import(url) as Promise<typeof import("./rotate-learnings.js")>;
}

async function withCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-rotate-test-"));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function bigEntry(date: string, sizeBytes = 500): string {
  return `### ${date}\n- ${"x".repeat(Math.max(0, sizeBytes - 20))}\n\n`;
}

test("rotateLearnings is a no-op below the size threshold", async () => {
  await withCwd(async (dir) => {
    await fs.mkdir(path.join(dir, "knowledge"), { recursive: true });
    await fs.writeFile(path.join(dir, "knowledge", "learnings.md"), `# Learnings\n\n${bigEntry("2026-07-01", 100)}`, "utf8");
    const mod = await freshRotateModule();
    const result = await mod.rotateLearnings(new Date("2026-07-15T00:00:00Z"));
    assert.equal(result.rotated, false);
    const content = await fs.readFile(path.join(dir, "knowledge", "learnings.md"), "utf8");
    assert.match(content, /2026-07-01/);
  });
});

test("rotateLearnings is a no-op when there is nothing to archive (no missing manifest)", async () => {
  await withCwd(async () => {
    const mod = await freshRotateModule();
    const result = await mod.rotateLearnings();
    assert.equal(result.rotated, false);
    assert.deepEqual(result.archivedMonths, []);
  });
});

test("rotateLearnings archives prior-month entries and keeps the current month in place", async () => {
  await withCwd(async (dir) => {
    await fs.mkdir(path.join(dir, "knowledge"), { recursive: true });
    const header = "# Learnings\n\nPersistent, dated session learnings.\n\n---\n\n";
    const body = header + bigEntry("2026-05-01", 5000) + bigEntry("2026-06-15", 4000) + bigEntry("2026-07-01", 300);
    await fs.writeFile(path.join(dir, "knowledge", "learnings.md"), body, "utf8");

    const mod = await freshRotateModule();
    const result = await mod.rotateLearnings(new Date("2026-07-20T00:00:00Z"));
    assert.equal(result.rotated, true);
    assert.deepEqual(result.archivedMonths, ["2026-05", "2026-06"]);

    const mainContent = await fs.readFile(path.join(dir, "knowledge", "learnings.md"), "utf8");
    assert.match(mainContent, /2026-07-01/);
    assert.doesNotMatch(mainContent, /2026-05-01/);
    assert.doesNotMatch(mainContent, /2026-06-15/);

    const mayArchive = await fs.readFile(path.join(dir, "knowledge", "learnings", "2026-05.md"), "utf8");
    assert.match(mayArchive, /2026-05-01/);
    const juneArchive = await fs.readFile(path.join(dir, "knowledge", "learnings", "2026-06.md"), "utf8");
    assert.match(juneArchive, /2026-06-15/);
  });
});

test("rotateLearnings appends to an existing archive file rather than overwriting it", async () => {
  await withCwd(async (dir) => {
    await fs.mkdir(path.join(dir, "knowledge", "learnings"), { recursive: true });
    await fs.writeFile(path.join(dir, "knowledge", "learnings", "2026-05.md"), "# Learnings archive — 2026-05\n\n### 2026-05-01\n- old note\n", "utf8");

    const header = "# Learnings\n\n---\n\n";
    const body = header + bigEntry("2026-05-10", 8500) + bigEntry("2026-07-01", 300);
    await fs.writeFile(path.join(dir, "knowledge", "learnings.md"), body, "utf8");

    const mod = await freshRotateModule();
    await mod.rotateLearnings(new Date("2026-07-20T00:00:00Z"));

    const mayArchive = await fs.readFile(path.join(dir, "knowledge", "learnings", "2026-05.md"), "utf8");
    assert.match(mayArchive, /old note/);
    assert.match(mayArchive, /2026-05-10/);
  });
});
