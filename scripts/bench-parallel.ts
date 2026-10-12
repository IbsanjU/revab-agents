/**
 * Does parallel dispatch actually save time? Measure it instead of asserting it.
 *
 *   npm run bench:parallel                 # simulated agents, no gateway needed
 *   npm run bench:parallel -- --live       # also time real gateway calls (needs `revab start`)
 *
 * The simulated run models N independent steps that each take `--latency` ms.
 * Sequential time is the sum; parallel time is roughly the slowest step. The live run
 * times the same `knowledge_search` call N times one-after-another vs all at once,
 * through the gateway's REST door. Both are honest about what they do NOT measure:
 * model thinking time, which dominates a real agent run and is outside this script.
 * Parallel also costs tokens (every branch pays for its own context), so a speedup
 * here is wall-clock only.
 */
import { performance } from "node:perf_hooks";
import { authHeaders, gatewayBase } from "../cli/call.js";

export interface Timing {
  label: string;
  sequentialMs: number;
  parallelMs: number;
  speedup: number;
}

export function speedup(sequentialMs: number, parallelMs: number): number {
  return parallelMs > 0 ? Math.round((sequentialMs / parallelMs) * 100) / 100 : 0;
}

/** Time `task` run `n` times in sequence and then `n` times at once. */
export async function compare(label: string, n: number, task: () => Promise<unknown>): Promise<Timing> {
  const s0 = performance.now();
  for (let i = 0; i < n; i++) await task();
  const sequentialMs = performance.now() - s0;

  const p0 = performance.now();
  await Promise.all(Array.from({ length: n }, () => task()));
  const parallelMs = performance.now() - p0;

  return {
    label,
    sequentialMs: Math.round(sequentialMs),
    parallelMs: Math.round(parallelMs),
    speedup: speedup(sequentialMs, parallelMs),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main(): Promise<void> {
  const n = flag("steps", 4);
  const latency = flag("latency", 300);
  const results: Timing[] = [await compare(`simulated: ${n} independent steps × ${latency}ms`, n, () => sleep(latency))];

  if (process.argv.includes("--live")) {
    const base = gatewayBase();
    const call = async () => {
      const res = await fetch(`${base}/api/artifacts/knowledge_search`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ query: "orchestrator" }),
      });
      await res.text();
    };
    try {
      results.push(await compare(`live gateway: ${n} × knowledge_search`, n, call));
    } catch {
      console.error(`Could not reach the gateway at ${base}. Start it with \`revab start\`.`);
      process.exitCode = 1;
    }
  }

  console.table(results);
  console.log(
    "Wall-clock only. A real agent run is dominated by model time, and every parallel branch pays for its own context —\n" +
      "so expect less speedup than the table suggests on dependent steps, and more tokens on any step."
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  void main();
}
