import { claimNext, complete, fail, requeue, reclaimStale, type Task } from "./queue.js";
import { handlers } from "../agents/registry.js";
import { intEnv, optionalEnv } from "../mcp-servers/shared/config.js";
import { log, logError } from "../utils/logger.js";
import { sendTeams, sendEmail } from "../utils/notify.js";

/**
 * Async worker: polls the file queue and runs tasks concurrently (up to WORKER_CONCURRENCY).
 * - Enforces a per-task timeout (WORKER_TASK_TIMEOUT_MS) so a hung run fails fast.
 * - Retries a failed task once when its payload opts in with `retryOnFailure: true`.
 * - Sends an opt-in completion notification (Teams or Outlook email) when the payload
 *   carries `notify` — e.g. `{"notify":"teams"}` or `{"notify":{"channel":"email","to":["qa@co.com"]}}`.
 *   This is the one place notifications are sent without a dryRun preview (explicitly
 *   opted in at enqueue time); interactive sends go through the notify MCP server instead.
 * - Periodically sweeps for stale "running" tasks left behind by a crashed worker
 *   and requeues (or eventually fails) them — see orchestrator/queue.ts reclaimStale().
 * Start with: npm run worker
 */
const CONCURRENCY = intEnv("WORKER_CONCURRENCY", 2);
const POLL_MS = intEnv("WORKER_POLL_MS", 2000);
const STALE_MS = intEnv("WORKER_STALE_MS", 10 * 60 * 1000);
const STALE_SWEEP_MS = intEnv("WORKER_STALE_SWEEP_MS", 60 * 1000);
const TASK_TIMEOUT_MS = intEnv("WORKER_TASK_TIMEOUT_MS", 30 * 60 * 1000);
const MAX_RETRIES = 1;

let active = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Task timed out after ${ms}ms: ${label}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Send an opt-in completion notification for a finished task. Failures are logged, never thrown. */
async function notifyCompletion(task: Task, outcome: "completed" | "failed", detail: string): Promise<void> {
  const notify = task.payload.notify;
  if (!notify) return;
  const channel = typeof notify === "string" ? notify : (notify as { channel?: string }).channel;
  const project = typeof task.payload.project === "string" ? task.payload.project : undefined;
  const plan = typeof task.payload.plan === "string" ? task.payload.plan : undefined;
  const title = `Task ${outcome}: ${task.type}${project ? ` (${project})` : ""}`;
  const facts: Record<string, string> = { task: task.id, type: task.type };
  if (project) facts.project = project;
  if (plan) facts.plan = plan;
  try {
    if (channel === "teams") {
      await sendTeams({ title, text: detail, facts });
    } else if (channel === "email") {
      const configured = (notify as { to?: string[] }).to;
      const fallback = optionalEnv("NOTIFY_EMAIL_TO");
      const to = configured && configured.length > 0 ? configured : fallback ? fallback.split(",").map((s) => s.trim()) : [];
      if (to.length === 0) throw new Error("email notification requested but no recipients (payload.notify.to or NOTIFY_EMAIL_TO)");
      await sendEmail({ to, subject: title, body: `${detail}\n\n${JSON.stringify(facts, null, 2)}` });
    } else {
      throw new Error(`Unknown notify channel: ${String(channel)} (expected "teams" or "email")`);
    }
    log("worker", `task ${task.id} notification sent via ${channel}`);
  } catch (err) {
    logError("worker", `task ${task.id} notification failed`, err);
  }
}

async function runTask(task: Task): Promise<void> {
  const handler = handlers[task.type];
  log("worker", `task ${task.id} (${task.type}) started`);
  try {
    if (!handler) throw new Error(`Unknown task type: ${task.type}. Known: ${Object.keys(handlers).join(", ")}`);
    const result = await withTimeout(handler.run(task.payload), TASK_TIMEOUT_MS, `${task.id} (${task.type})`);
    await complete(task, result);
    log("worker", `task ${task.id} (${task.type}) completed`);
    await notifyCompletion(task, "completed", `Task ${task.id} (${task.type}) completed successfully.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (task.payload.retryOnFailure === true && (task.retryCount ?? 0) < MAX_RETRIES) {
      await requeue(task);
      log("worker", `task ${task.id} (${task.type}) failed, requeued for retry ${task.retryCount}/${MAX_RETRIES}: ${message}`);
      return;
    }
    await fail(task, err);
    logError("worker", `task ${task.id} (${task.type}) failed`, err);
    await notifyCompletion(task, "failed", `Task ${task.id} (${task.type}) failed: ${message}`);
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

log("worker", `started (concurrency=${CONCURRENCY}, poll=${POLL_MS}ms, taskTimeout=${TASK_TIMEOUT_MS}ms). Task types: ${Object.keys(handlers).join(", ")}`);
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
