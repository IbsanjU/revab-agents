import { claimNext, complete, fail, type Task } from "./queue.js";
import { handlers } from "../agents/registry.js";
import { intEnv } from "../mcp-servers/shared/config.js";
import { log, logError } from "../utils/logger.js";

/**
 * Async worker: polls the file queue and runs tasks concurrently (up to WORKER_CONCURRENCY).
 * Start with: npm run worker
 */
const CONCURRENCY = intEnv("WORKER_CONCURRENCY", 2);
const POLL_MS = intEnv("WORKER_POLL_MS", 2000);

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
