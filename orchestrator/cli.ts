import { enqueue, status, reclaimStale } from "./queue.js";
import { listTaskTypes } from "../agents/registry.js";

/**
 * Orchestrator CLI.
 *   npm run task -- enqueue run-bdd '{"tags":"@smoke"}'
 *   npm run task -- status
 *   npm run task -- types
 *   npm run task -- reclaim [staleMs]
 */
async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "enqueue": {
      const [type, payloadJson] = rest;
      if (!type) {
        console.error("Usage: npm run task -- enqueue <type> ['{\"key\":\"value\"}']");
        process.exitCode = 1;
        return;
      }
      const payload = payloadJson ? (JSON.parse(payloadJson) as Record<string, unknown>) : {};
      const task = await enqueue(type, payload);
      console.log(`Enqueued task ${task.id} (${task.type}). Start a worker with: npm run worker`);
      break;
    }
    case "status": {
      console.log(JSON.stringify(await status(), null, 2));
      break;
    }
    case "types": {
      for (const { type, description } of listTaskTypes()) {
        console.log(`${type.padEnd(18)} ${description}`);
      }
      break;
    }
    case "reclaim": {
      const staleMs = rest[0] ? parseInt(rest[0], 10) : undefined;
      const result = await reclaimStale(staleMs);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.log("Commands:\n  enqueue <type> [jsonPayload]  add a task\n  status                        queue overview\n  types                         list task types\n  reclaim [staleMs]             requeue/fail stale running tasks now");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
