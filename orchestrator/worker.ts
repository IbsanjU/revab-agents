import { claimNext, complete, fail, reclaimStale, type Task } from "./queue.js";
import { handlers } from "../agents/registry.js";
import { intEnv } from "../mcp-servers/shared/config.js";
import { log, logError } from "../utils/logger.js";

/**
 * Async worker: polls the file queue and runs tasks concurrently (up to WORKER_CONCURRENCY).
 * Also periodically sweeps for stale "running" tasks left behind by a crashed worker
 * and requeues (or eventually fails) them — see orchestrator/queue.ts reclaimStale().
 * Start with: npm run worker
 */
const CONCURRENCY = intEnv("WORKER_CONCURRENCY", 2);
const POLL_MS = intEnv("WORKER_POLL_MS", 2000);
const STALE_MS = intEnv("WORKER_STALE_MS", 10 * 60 * 1000);
const STALE_SWEEP_MS = intEnv("WORKER_STALE_SWEEP_MS", 60 * 1000);

let active = 0;

async function runTask(task: Task): Promise<void> {
  const handler = handlers[task.type];
  log("worker", `task ${task.id} (${task.type}) started`);
  try {
    if (!handler) throw new Error(`Unknown task type: ${task.type}. Known: ${Object.keys(handlers).join(", ")}`);
    const result = await handler.run(task.payload);
    await complete(task, result);
    log("worker", `task ${task.id} (${task.type}) completed`);
  } catch (err) {
    await fail(task, err);
    logError("worker", `task ${task.id} (${task.type}) failed`, err);
  }
}

async function tick(): Promise<void> {
  while (active < CONCURRENCY) {
    const task = await claimNext();
    if (!task) break;
    active += 1;
    void runTask(task).finally(() => {
      active -= 1;
    });
  }
}

log("worker", `started (concurrency=${CONCURRENCY}, poll=${POLL_MS}ms). Task types: ${Object.keys(handlers).join(", ")}`);
setInterval(() => {
  tick().catch((err) => logError("worker", "poll failed", err));
}, POLL_MS);

setInterval(() => {
  reclaimStale(STALE_MS)
    .then(({ requeued, failed }) => {
      if (requeued.length) log("worker", `reclaimed stale tasks: ${requeued.join(", ")}`);
      if (failed.length) log("worker", `abandoned stale tasks (max reclaims exceeded): ${failed.join(", ")}`);
    })
    .catch((err) => logError("worker", "stale reclaim sweep failed", err));
}, STALE_SWEEP_MS);
