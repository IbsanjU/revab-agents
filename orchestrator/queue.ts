import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * File-based async task queue.
 * Tasks move through folders: .queue/pending -> .queue/running -> .queue/done | .queue/failed.
 * File renames make claiming near-atomic; no external broker needed.
 *
 * QUEUE_ROOT_DIR is overridable (env var) so tests can point at a throwaway directory
 * instead of the repo's real `.queue/`.
 */
const QUEUE_ROOT = path.resolve(process.env.QUEUE_ROOT_DIR ?? ".queue");
const DIRS = {
  pending: path.join(QUEUE_ROOT, "pending"),
  running: path.join(QUEUE_ROOT, "running"),
  done: path.join(QUEUE_ROOT, "done"),
  failed: path.join(QUEUE_ROOT, "failed"),
} as const;

/** A task is considered abandoned (crashed worker) if it's been "running" longer than this, in ms. */
const DEFAULT_STALE_MS = 10 * 60 * 1000;
/** After this many reclaims, stop requeuing and move the task to failed instead (avoid infinite loops). */
const MAX_RECLAIMS = 3;

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
  /** Number of times this task has been reclaimed from a stale "running" state. */
  reclaimCount?: number;
}

async function ensureDirs(): Promise<void> {
  await Promise.all(Object.values(DIRS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function writeTask(dir: string, task: Task): Promise<void> {
  await fs.writeFile(path.join(dir, `${task.id}.json`), JSON.stringify(task, null, 2), "utf8");
}

/** Monotonic per-process counter appended to task ids so filename sort order (used by
 *  claimNext for FIFO) stays correct even for multiple tasks enqueued in the same millisecond. */
let sequence = 0;

/** Add a task to the queue. Returns the task id. */
export async function enqueue(type: string, payload: Record<string, unknown> = {}): Promise<Task> {
  await ensureDirs();
  const seq = (sequence++).toString().padStart(6, "0");
  const task: Task = { id: `${Date.now()}-${seq}-${randomUUID().slice(0, 8)}`, type, payload, createdAt: new Date().toISOString() };
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

/**
 * Reclaim tasks stuck in "running" past `staleMs` (e.g. a worker crashed mid-task).
 * Tasks reclaimed fewer than MAX_RECLAIMS times go back to "pending" (their startedAt
 * is cleared so claimNext picks them up again); tasks that have already been reclaimed
 * MAX_RECLAIMS times are moved to "failed" instead, to avoid an infinite requeue loop.
 * Returns the list of task ids that were reclaimed or failed.
 */
export async function reclaimStale(staleMs: number = DEFAULT_STALE_MS): Promise<{ requeued: string[]; failed: string[] }> {
  await ensureDirs();
  const requeued: string[] = [];
  const failedIds: string[] = [];
  const files = (await fs.readdir(DIRS.running)).filter((f) => f.endsWith(".json"));
  const now = Date.now();

  for (const file of files) {
    const runningPath = path.join(DIRS.running, file);
    let task: Task;
    try {
      task = JSON.parse(await fs.readFile(runningPath, "utf8")) as Task;
    } catch {
      continue; // file vanished/raced with another process; skip
    }
    const startedAt = task.startedAt ? Date.parse(task.startedAt) : NaN;
    if (Number.isNaN(startedAt) || now - startedAt < staleMs) continue;

    const reclaimCount = (task.reclaimCount ?? 0) + 1;
    task.reclaimCount = reclaimCount;

    // Claim the stale file first (rename off it) so concurrent reclaim sweeps don't double-handle it.
    const claimPath = `${runningPath}.reclaiming`;
    try {
      await fs.rename(runningPath, claimPath);
    } catch {
      continue; // another sweep already grabbed it
    }

    if (reclaimCount > MAX_RECLAIMS) {
      task.finishedAt = new Date().toISOString();
      task.error = `Task abandoned: exceeded ${MAX_RECLAIMS} stale-claim reclaims (last worker likely crashed).`;
      await writeTask(DIRS.failed, task);
      await fs.rm(claimPath, { force: true });
      failedIds.push(task.id);
    } else {
      task.startedAt = undefined;
      await writeTask(DIRS.pending, task);
      await fs.rm(claimPath, { force: true });
      requeued.push(task.id);
    }
  }

  return { requeued, failed: failedIds };
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
