import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * File-based async task queue.
 * Tasks move through folders: .queue/pending -> .queue/running -> .queue/done | .queue/failed.
 * File renames make claiming near-atomic; no external broker needed.
 */
const QUEUE_ROOT = path.resolve(".queue");
const DIRS = {
  pending: path.join(QUEUE_ROOT, "pending"),
  running: path.join(QUEUE_ROOT, "running"),
  done: path.join(QUEUE_ROOT, "done"),
  failed: path.join(QUEUE_ROOT, "failed"),
} as const;

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

async function ensureDirs(): Promise<void> {
  await Promise.all(Object.values(DIRS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function writeTask(dir: string, task: Task): Promise<void> {
  await fs.writeFile(path.join(dir, `${task.id}.json`), JSON.stringify(task, null, 2), "utf8");
}

/** Add a task to the queue. Returns the task id. */
export async function enqueue(type: string, payload: Record<string, unknown> = {}): Promise<Task> {
  await ensureDirs();
  const task: Task = { id: `${Date.now()}-${randomUUID().slice(0, 8)}`, type, payload, createdAt: new Date().toISOString() };
  await writeTask(DIRS.pending, task);
  return task;
}

/** Claim the oldest pending task (moves it to running). Returns null if queue is empty. */
export async function claimNext(): Promise<Task | null> {
  await ensureDirs();
  const files = (await fs.readdir(DIRS.pending)).filter((f) => f.endsWith(".json")).sort();
  for (const file of files) {
    const from = path.join(DIRS.pending, file);
    const to = path.join(DIRS.running, file);
    try {
      await fs.rename(from, to); // atomic claim; fails if another worker got it first
    } catch {
      continue;
    }
    const task = JSON.parse(await fs.readFile(to, "utf8")) as Task;
    task.startedAt = new Date().toISOString();
    await writeTask(DIRS.running, task);
    return task;
  }
  return null;
}

/** Mark a running task as done with a result. */
export async function complete(task: Task, result: unknown): Promise<void> {
  task.finishedAt = new Date().toISOString();
  task.result = result;
  await writeTask(DIRS.done, task);
  await fs.rm(path.join(DIRS.running, `${task.id}.json`), { force: true });
}

/** Mark a running task as failed with an error message. */
export async function fail(task: Task, error: unknown): Promise<void> {
  task.finishedAt = new Date().toISOString();
  task.error = error instanceof Error ? error.message : String(error);
  await writeTask(DIRS.failed, task);
  await fs.rm(path.join(DIRS.running, `${task.id}.json`), { force: true });
}

/** Queue status: counts per state plus recent finished tasks. */
export async function status(): Promise<Record<string, unknown>> {
  await ensureDirs();
  const counts: Record<string, number> = {};
  for (const [state, dir] of Object.entries(DIRS)) {
    counts[state] = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).length;
  }
  const recent: Task[] = [];
  for (const dir of [DIRS.done, DIRS.failed]) {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort().slice(-5);
    for (const file of files) {
      recent.push(JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as Task);
    }
  }
  recent.sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""));
  return { counts, recent: recent.slice(-10) };
}
