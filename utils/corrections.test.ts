import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { appendCorrection, markApplied, openByAgent, readCorrections, type CorrectionRecord } from "./corrections.js";

// The corrections module resolves its dir from cwd, so each case runs in a temp cwd.
const originalCwd = process.cwd();
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "corrections-"));
  process.chdir(tmp);
});

after(() => {
  process.chdir(originalCwd);
});

function draft(overrides: Partial<CorrectionRecord> = {}) {
  return {
    date: "2026-07-25",
    agent: "orchestrator",
    task: "run the smoke suite",
    observed: "ran npm test directly",
    expected: "enqueue via the queue CLI",
    rule: "use the terminal only for the queue CLI",
    severity: "high" as const,
    ...overrides,
  };
}

test("readCorrections returns [] when nothing has been logged", async () => {
  assert.deepEqual(await readCorrections(), []);
});

test("appendCorrection assigns sequential ids per day and defaults to open", async () => {
  const first = await appendCorrection(draft());
  const second = await appendCorrection(draft({ agent: "researcher" }));
  assert.equal(first.id, "2026-07-25-001");
  assert.equal(second.id, "2026-07-25-002");
  assert.equal(first.status, "open");
});

test("records round-trip through the jsonl log", async () => {
  await appendCorrection(draft());
  const records = await readCorrections();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.rule, "use the terminal only for the queue CLI");
});

test("openByAgent ranks the most-corrected agent first and hides applied records", async () => {
  await appendCorrection(draft({ agent: "bsa" }));
  await appendCorrection(draft({ agent: "orchestrator" }));
  const applied = await appendCorrection(draft({ agent: "orchestrator" }));
  await markApplied([applied.id]);

  const groups = openByAgent(await readCorrections());
  assert.equal(groups.length, 2);
  // bsa and orchestrator each have 1 open; ties break on severity, both high — but the
  // applied orchestrator record must not be counted.
  const orchestrator = groups.find((g) => g.agent === "orchestrator");
  assert.equal(orchestrator?.records.length, 1);
});

test("markApplied flips status and is idempotent", async () => {
  const record = await appendCorrection(draft());
  assert.equal(await markApplied([record.id]), 1);
  assert.equal(await markApplied([record.id]), 0, "already-applied records are not re-counted");
  const records = await readCorrections();
  assert.equal(records[0]?.status, "applied");
});

test("a malformed log line is skipped rather than sinking the log", async () => {
  const record = await appendCorrection(draft());
  const file = path.join(tmp, "knowledge", "corrections", "2026-07.jsonl");
  await fs.appendFile(file, "{ not valid json\n", "utf8");
  const records = await readCorrections();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, record.id);
});
