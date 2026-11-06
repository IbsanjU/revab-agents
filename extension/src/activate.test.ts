/**
 * Drives the real extension code against a stub of the `vscode` API (there is no editor in
 * CI), including a real detached gateway process. It checks what the extension does, not how
 * VS Code reacts: that part (agent dropdown, MCP provider acceptance) needs a real editor.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 7394;

const commands = new Map<string, (...a: unknown[]) => unknown>();
const providers: Array<{ id: string; provider: { provideMcpServerDefinitions(): Array<Record<string, unknown>> } }> = [];
const messages: string[] = [];
const settings: Record<string, unknown> = { "revab.home": REPO, "revab.gateway.port": PORT, "revab.gateway.autoStart": true };

class Definition {
  constructor(public label: string, public uri: { toString(): string }, public headers: object, public version?: string) {}
}
const disposable = { dispose() {} };
const stub = {
  window: {
    createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", tooltip: "", command: "" }),
    showInformationMessage: async (m: string) => void messages.push(m),
    showWarningMessage: async (m: string) => void messages.push(m),
    showErrorMessage: async (m: string) => void messages.push(m),
    showOpenDialog: async () => undefined,
    showQuickPick: async () => undefined,
    showTextDocument: async () => undefined,
    createTerminal: () => ({ show() {}, sendText() {} }),
  },
  workspace: {
    workspaceFolders: [] as unknown[],
    getConfiguration: (section: string) => ({
      get: (key: string, fallback: unknown) => settings[`${section}.${key}`] ?? fallback,
      update: async () => undefined,
    }),
    onDidChangeConfiguration: () => disposable,
  },
  commands: {
    registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => (commands.set(id, fn), disposable),
    executeCommand: async () => undefined,
  },
  lm: {
    registerMcpServerDefinitionProvider: (id: string, provider: never) => (providers.push({ id, provider }), disposable),
  },
  McpHttpServerDefinition: Definition,
  Uri: { parse: (s: string) => ({ toString: () => s, fsPath: s }), file: (p: string) => ({ fsPath: p }) },
  EventEmitter: class {
    event = () => disposable;
    fire() {}
    dispose() {}
  },
  StatusBarAlignment: { Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
};

const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  return request === "vscode" ? stub : originalLoad.call(this, request, ...rest);
};

const pidFile = path.join(REPO, ".revab", "gateway.pid");
const health = async () => {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
};

let ext: { activate(c: { subscriptions: unknown[] }): Promise<void>; deactivate(): void };
const context = { subscriptions: [] as unknown[] };

before(async () => {
  process.env.JIRA_BASE_URL ??= "https://example.atlassian.net";
  ext = (await import("./extension.js")) as unknown as typeof ext;
});

after(() => {
  for (const d of context.subscriptions as Array<{ dispose?: () => void }>) d.dispose?.();
  try {
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    if (pid > 1) process.kill(pid);
  } catch {
    /* already gone */
  }
  fs.rmSync(pidFile, { force: true });
});

test("activation registers both MCP servers as class instances, labelled as the agents reference them", async () => {
  await ext.activate(context);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]!.id, "revab.gateway", "must match contributes.mcpServerDefinitionProviders");
  const defs = providers[0]!.provider.provideMcpServerDefinitions() as unknown as Definition[];
  assert.ok(defs.every((d) => d instanceof Definition), "plain objects are not accepted by the editor");
  assert.deepEqual(defs.map((d) => [d.label, String(d.uri)]), [
    ["gateway", `http://127.0.0.1:${PORT}/mcp`],
    ["gateway-code", `http://127.0.0.1:${PORT}/mcp/code`],
  ]);
});

test("auto-start launches one detached gateway from revab.home and records its pid", async () => {
  assert.equal(await health(), true, "the gateway should be up after activate");
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.ok(pid > 1);
  assert.doesNotThrow(() => process.kill(pid, 0), "the recorded process is alive");
});

test("a second window reuses the running gateway instead of starting another", async () => {
  const before = fs.readFileSync(pidFile, "utf8");
  await (commands.get("revab.start") as () => Promise<void>)();
  assert.equal(fs.readFileSync(pidFile, "utf8"), before, "pid must not change");
});

test("closing a window (deactivate) leaves the shared gateway running", async () => {
  ext.deactivate();
  assert.equal(await health(), true);
});

test("revab.stop stops the gateway the extension started", async () => {
  await (commands.get("revab.stop") as () => Promise<void>)();
  assert.equal(await health(), false);
  assert.equal(fs.existsSync(pidFile), false, "pid file removed");
});

test("a bad revab.home is reported, and nothing is spawned", async () => {
  settings["revab.home"] = path.join(REPO, "does-not-exist");
  messages.length = 0;
  await (commands.get("revab.start") as () => Promise<void>)();
  assert.match(messages.join("\n"), /not a revab-agents checkout/);
  assert.equal(await health(), false);
});
