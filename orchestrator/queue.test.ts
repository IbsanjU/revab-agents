import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";

/**
 * Tests for orchestrator/queue.ts — the file-based task queue, including the
 * stale-claim reclaim sweep (crashed-worker recovery).
 *
 * Each test points QUEUE_ROOT_DIR at a fresh throwaway directory and dynamically
 * re-imports the module (cache-busted) so its module-level QUEUE_ROOT constant is
 * recomputed and state from a previous test can't leak in.
 */

const QUEUE_MODULE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "queue.ts");

async function freshQueueModule() {
  const url = `${pathToFileURL(QUEUE_MODULE_PATH).href}?t=${Date.now()}-${Math.random()}`;
  return import(url) as Promise<typeof import("./queue.js")>;
}

async function withQueue<T>(fn: (mod: Awaited<ReturnType<typeof freshQueueModule>>, dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-queue-test-"));
  const prev = process.env.QUEUE_ROOT_DIR;
  process.env.QUEUE_ROOT_DIR = dir;
  try {
    const mod = await freshQueueModule();
    return await fn(mod, dir);
  } finally {
    if (prev === undefined) delete process.env.QUEUE_ROOT_DIR;
    else process.env.QUEUE_ROOT_DIR = prev;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("enqueue -> claimNext -> complete moves a task through the full lifecycle", async () => {
  await withQueue(async (mod) => {
    const enqueued = await mod.enqueue("typecheck", { foo: "bar" });
    assert.equal(enqueued.type, "typecheck");
    assert.deepEqual(enqueued.payload, { foo: "bar" });

    const claimed = await mod.claimNext();
    assert.ok(claimed);
    assert.equal(claimed?.id, enqueued.id);
    assert.ok(claimed?.startedAt, "claimNext should stamp startedAt");

    // A second claim attempt should see nothing pending — it's already running.
    assert.equal(await mod.claimNext(), null);

    await mod.complete(claimed!, { ok: true });
    const s = await mod.status();
    assert.equal((s.counts as Record<string, number>).done, 1);
    assert.equal((s.counts as Record<string, number>).running, 0);
  });
});

test("fail moves a task to the failed directory with an error message", async () => {
  await withQueue(async (mod) => {
    const enqueued = await mod.enqueue("run-bdd", { project: "sample" });
    const claimed = await mod.claimNext();
    await mod.fail(claimed!, new Error("boom"));
    const s = await mod.status();
    assert.equal((s.counts as Record<string, number>).failed, 1);
    const recent = s.recent as Array<{ id: string; error?: string }>;
    assert.ok(recent.some((t) => t.id === enqueued.id && t.error === "boom"));
  });
});

test("claimNext returns tasks in FIFO (oldest-first) order", async () => {
  await withQueue(async (mod) => {
    const first = await mod.enqueue("typecheck", { n: 1 });
    const second = await mod.enqueue("typecheck", { n: 2 });
    const claimedFirst = await mod.claimNext();
    const claimedSecond = await mod.claimNext();
    assert.equal(claimedFirst?.id, first.id);
    assert.equal(claimedSecond?.id, second.id);
  });
});

test("status reports zero counts on an empty queue", async () => {
  await withQueue(async (mod) => {
    const s = await mod.status();
    const counts = s.counts as Record<string, number>;
    assert.deepEqual(counts, { pending: 0, running: 0, done: 0, failed: 0 });
  });
});

test("reclaimStale leaves recently-claimed running tasks alone", async () => {
  await withQueue(async (mod) => {
    await mod.enqueue("typecheck", {});
    await mod.claimNext();
    const result = await mod.reclaimStale(10 * 60 * 1000);
    assert.deepEqual(result, { requeued: [], failed: [] });
    const s = await mod.status();
    assert.equal((s.counts as Record<string, number>).running, 1);
  });
});

test("reclaimStale requeues a task stuck in running past the stale threshold", async () => {
  await withQueue(async (mod, dir) => {
    const enqueued = await mod.enqueue("typecheck", {});
    const claimed = await mod.claimNext();
    // Simulate a crashed worker: backdate startedAt so the task looks abandoned.
    const runningFile = path.join(dir, "running", `${claimed!.id}.json`);
    const stale = { ...claimed!, startedAt: new Date(Date.now() - 60_000).toISOString() };
    await fs.writeFile(runningFile, JSON.stringify(stale, null, 2), "utf8");

    const result = await mod.reclaimStale(1000); // 1s threshold, task is 60s old
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.requeued, [enqueued.id]);

    const s = await mod.status();
    const counts = s.counts as Record<string, number>;
    assert.equal(counts.running, 0);
    assert.equal(counts.pending, 1);

    // The requeued task should be claimable again.
    const reclaimedTask = await mod.claimNext();
    assert.equal(reclaimedTask?.id, enqueued.id);
    assert.equal(reclaimedTask?.reclaimCount, 1);
  });
});

test("reclaimStale moves a task to failed after exceeding the max reclaim count", async () => {
  await withQueue(async (mod, dir) => {
    const enqueued = await mod.enqueue("typecheck", {});
    let claimed = await mod.claimNext();

    for (let i = 0; i < 4; i++) {
      const runningFile = path.join(dir, "running", `${claimed!.id}.json`);
      const stale = { ...claimed!, startedAt: new Date(Date.now() - 60_000).toISOString() };
      await fs.writeFile(runningFile, JSON.stringify(stale, null, 2), "utf8");
      await mod.reclaimStale(1000);
      claimed = await mod.claimNext();
      if (!claimed) break;
    }

    const s = await mod.status();
    const counts = s.counts as Record<string, number>;
    assert.equal(counts.failed, 1, "task should be abandoned to failed after exceeding max reclaims");
    const recent = s.recent as Array<{ id: string; error?: string }>;
    const failedTask = recent.find((t) => t.id === enqueued.id);
    assert.ok(failedTask?.error?.includes("abandoned"));
  });
});

test("requeue moves a running task back to pending with an incremented retryCount", async () => {
  await withQueue(async (mod, dir) => {
    await mod.enqueue("typecheck", { retryOnFailure: true });
    const claimed = await mod.claimNext();
    assert.ok(claimed);

    await mod.requeue(claimed!);
    assert.equal(claimed!.retryCount, 1);
    assert.equal(claimed!.startedAt, undefined, "requeue should clear startedAt");

    const running = await fs.readdir(path.join(dir, "running"));
    assert.equal(running.filter((f) => f.endsWith(".json")).length, 0);

    const reclaimed = await mod.claimNext();
    assert.equal(reclaimed?.id, claimed!.id, "requeued task should be claimable again");
    assert.equal(reclaimed?.retryCount, 1);
  });
});
