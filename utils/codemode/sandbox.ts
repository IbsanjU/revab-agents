/**
 * Run model-written JavaScript with access to nothing except an RPC proxy for tools.
 *
 * Layers, from the inside out:
 *  1. A `node:vm` context created with string-eval and wasm disabled, containing only
 *     `codemode` and `console`. Nothing from the host realm is reachable by reference:
 *     the RPC callback is captured by a bootstrap closure and then removed, and it only
 *     ever returns strings, so a model cannot walk `.constructor` chains to host `Function`.
 *  2. A worker thread with an empty environment and a memory cap. Credentials live in the
 *     gateway's main thread (where tool handlers run), not in the sandbox's `process.env`.
 *  3. A wall-clock timeout enforced by terminating the worker, which also stops a
 *     synchronous infinite loop that an in-isolate timer never could.
 *
 * `node:vm` is not a security boundary against a determined attacker, and this is not
 * presented as one. The primary safety property is policy: every tool call from code goes
 * through the same validation, read/write classification and dry-run rules as a direct
 * call (see `mcp-servers/gateway/codemode.ts`). The sandbox limits what injected code can
 * do beyond that; run the gateway as an unprivileged user.
 */
import { Worker } from "node:worker_threads";

export interface SandboxOptions {
  timeoutMs?: number;
  maxLogLines?: number;
  maxLogChars?: number;
  memoryMb?: number;
}

export interface SandboxResult {
  /** JSON-serializable return value of the code, if it completed. */
  result?: unknown;
  error?: string;
  logs: string[];
}

/** (name, args) → JSON string of `{ ok: value }` or `{ error: message }`. Must not throw. */
export type ToolCaller = (name: string, args: unknown) => Promise<string>;

/** Make model output runnable: strip markdown fences, accept an async arrow or a bare body. */
export function normalizeCode(raw: string): string {
  let code = raw.trim();
  const fenced = /^```(?:[a-zA-Z]+)?\s*\n([\s\S]*?)\n?```$/.exec(code);
  if (fenced) code = fenced[1]!.trim();
  code = code.replace(/;+\s*$/, "");
  if (/^async\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(code)) return `(${code})()`;
  return `(async () => {\n${code}\n})()`;
}

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const pending = new Map();
let nextId = 1;
parentPort.on("message", (m) => {
  const resolve = pending.get(m.id);
  if (resolve) { pending.delete(m.id); resolve(m.payload); }
});
// Returns a string, never rejects, so no host-realm Error object ever reaches model code.
const hostCall = (name, argsJson) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  parentPort.postMessage({ type: "call", id, name: String(name), args: String(argsJson) });
});
const hostLog = (text) => parentPort.postMessage({ type: "log", text: String(text) });

const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
const bootstrap = vm.runInContext(
  "(function (call, log) {" +
  "  const fmt = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };" +
  "  const line = (prefix) => (...a) => log(prefix + a.map(fmt).join(' '));" +
  "  globalThis.console = { log: line(''), info: line(''), debug: line(''), warn: line('[warn] '), error: line('[error] ') };" +
  "  globalThis.codemode = new Proxy({}, { get: (_t, name) => typeof name === 'string' ? async (input) => {" +
  "    const reply = JSON.parse(await call(name, JSON.stringify(input === undefined ? {} : input)));" +
  "    if ('error' in reply) throw new Error(reply.error);" +
  "    return reply.ok;" +
  "  } : undefined });" +
  "})",
  context
);
bootstrap(hostCall, hostLog);

(async () => {
  try {
    const value = await vm.runInContext(workerData.code, context, { timeout: workerData.timeoutMs });
    const json = JSON.stringify(value === undefined ? null : value);
    parentPort.postMessage({ type: "done", result: json });
  } catch (e) {
    let message;
    try { message = String(e && e.message !== undefined ? e.message : e); } catch { message = "Unknown error"; }
    parentPort.postMessage({ type: "done", error: message });
  }
})();
`;

export function runInSandbox(code: string, callTool: ToolCaller, options: SandboxOptions = {}): Promise<SandboxResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxLogLines = options.maxLogLines ?? 200;
  const maxLogChars = options.maxLogChars ?? 2_000;
  const logs: string[] = [];

  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      env: {},
      workerData: { code: normalizeCode(code), timeoutMs },
      resourceLimits: { maxOldGenerationSizeMb: options.memoryMb ?? 128 },
    });
    let settled = false;
    const finish = (result: Omit<SandboxResult, "logs">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve({ ...result, logs });
    };
    const timer = setTimeout(() => finish({ error: `Execution timed out after ${timeoutMs}ms` }), timeoutMs);

    worker.on("message", (m: { type: string; id?: number; name?: string; args?: string; text?: string; result?: string; error?: string }) => {
      if (m.type === "log") {
        if (logs.length < maxLogLines) logs.push((m.text ?? "").slice(0, maxLogChars));
      } else if (m.type === "call") {
        // After settling, answer nothing: the worker is being terminated.
        void callTool(m.name ?? "", safeParse(m.args)).then((payload) => {
          if (!settled) worker.postMessage({ id: m.id, payload });
        });
      } else if (m.type === "done") {
        if (m.error !== undefined) finish({ error: m.error });
        else finish({ result: m.result === undefined ? undefined : (JSON.parse(m.result) as unknown) });
      }
    });
    worker.on("error", (err) => finish({ error: err instanceof Error ? err.message : String(err) }));
    worker.on("exit", (exitCode) => {
      if (!settled) finish({ error: `Sandbox exited unexpectedly (code ${exitCode}), possibly out of memory` });
    });
  });
}

function safeParse(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
}
