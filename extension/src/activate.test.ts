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
const outputLines: string[] = [];
const secretStore = new Map<string, string>();
const answers: {
  quickPick?: (items: Array<Record<string, unknown>>) => unknown;
  inputBox?: () => string | undefined;
  warning?: (message: string) => string | undefined;
} = {};
const settings: Record<string, unknown> = {
  "revab.home": REPO,
  "revab.gateway.port": PORT,
  "revab.gateway.autoStart": true,
  "revab.tools.disabled": [],
  "revab.environment": {},
};

class Definition {
  constructor(public label: string, public uri: { toString(): string }, public headers: object, public version?: string) {}
}
const disposable = { dispose() {} };
const stub = {
  window: {
    createOutputChannel: () => ({ appendLine: (l: string) => void outputLines.push(l), append() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", tooltip: "", command: "" }),
    showInformationMessage: async (m: string) => void messages.push(m),
    showWarningMessage: async (m: string) => (messages.push(m), answers.warning?.(m)),
    showErrorMessage: async (m: string) => void messages.push(m),
    showOpenDialog: async () => undefined,
    showQuickPick: async (items: Array<Record<string, unknown>>) => answers.quickPick?.(items),
    showInputBox: async () => answers.inputBox?.(),
    showTextDocument: async () => undefined,
    createTerminal: () => ({ show() {}, sendText() {} }),
  },
  workspace: {
    workspaceFolders: [] as unknown[],
    getConfiguration: (section: string) => ({
      get: (key: string, fallback: unknown) => settings[`${section}.${key}`] ?? fallback,
      update: async (key: string, value: unknown) => void (settings[`${section}.${key}`] = value),
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
  QuickPickItemKind: { Separator: -1, Default: 0 },
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

let ext: { activate(c: { subscriptions: unknown[]; secrets: typeof secrets }): Promise<void>; deactivate(): void };
const secrets = {
  get: async (k: string) => secretStore.get(k),
  store: async (k: string, v: string) => void secretStore.set(k, v),
  delete: async (k: string) => void secretStore.delete(k),
  onDidChange: () => disposable,
};
const context = { subscriptions: [] as unknown[], secrets };

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
  const defs = (await providers[0]!.provider.provideMcpServerDefinitions()) as unknown as Definition[];
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


// ---- phase 2: credentials and tool selection ----------------------------------------------

const SECRET = "s3cret-value-DO-NOT-LOG";
const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { headers, signal: AbortSignal.timeout(3000) });
const run = (id: string) => (commands.get(id) as () => Promise<void>)();

test("a stored credential reaches the gateway: it enforces the shared secret and the extension sends it", async () => {
  settings["revab.home"] = REPO;
  answers.quickPick = (items) => items.find((i) => String(i.detail).startsWith("MCP_SHARED_SECRET"));
  answers.inputBox = () => SECRET;
  await run("revab.setCredentials");
  assert.equal(secretStore.get("MCP_SHARED_SECRET"), SECRET, "stored in SecretStorage");
  assert.equal(JSON.stringify(settings).includes(SECRET), false, "never written to settings");

  await run("revab.restart");
  assert.equal((await get("/api/tools")).status, 401, "the gateway now requires the secret");
  assert.equal((await get("/api/tools", { "x-mcp-secret": SECRET })).status, 200);

  const defs = (await providers[0]!.provider.provideMcpServerDefinitions()) as unknown as Definition[];
  assert.ok(defs.every((d) => (d.headers as Record<string, string>)["x-mcp-secret"] === SECRET), "MCP definitions carry the header");
});

test("the secret never appears in the output channel, messages, or the gateway log", async () => {
  await run("revab.showCredentials");
  const everything = [outputLines.join("\n"), messages.join("\n"), fs.readFileSync(path.join(REPO, ".revab", "gateway.log"), "utf8")].join("\n");
  assert.equal(everything.includes(SECRET), false);
  assert.match(outputLines.join("\n"), /MCP_SHARED_SECRET \(secret\)/, "named, not shown");
});

test("revab.environment is an allowlist: dangerous variables and pasted tokens are refused by name", async () => {
  settings["revab.environment"] = { JIRA_BASE_URL: "https://x.atlassian.net", NODE_OPTIONS: "--require /evil.js", JIRA_API_TOKEN: "pasted-in-settings" };
  messages.length = 0;
  outputLines.length = 0;
  await run("revab.restart");
  const warned = messages.join("\n");
  assert.match(warned, /NODE_OPTIONS/);
  assert.match(warned, /JIRA_API_TOKEN/);
  const log = outputLines.join("\n");
  assert.equal(log.includes("--require /evil.js") || log.includes("pasted-in-settings"), false, "values are never printed");
  assert.match(log, /JIRA_BASE_URL/);
  settings["revab.environment"] = {};
});

test("disabled tools are gone from the gateway, and the gateway reports them", async () => {
  settings["revab.tools.disabled"] = ["jira_search", "confluence/*"];
  await run("revab.restart");
  const body = (await (await get("/api/tools", { "x-mcp-secret": SECRET })).json()) as {
    tools: Array<{ name: string; server: string }>;
    disabled: Array<{ name: string }>;
  };
  const still = body.tools.filter((t) => t.name === "jira_search" || t.server === "confluence").map((t) => t.name);
  assert.deepEqual(still, [], `these should be disabled but are present (log tail: ${fs.readFileSync(path.join(REPO, ".revab", "gateway.log"), "utf8").split("\n").slice(-6).join(" | ")})`);
  assert.ok(body.disabled.some((t) => t.name === "jira_search"), `disabled list: ${JSON.stringify(body.disabled)}`);
  assert.ok(body.tools.some((t) => t.name === "jira_get_issue"), "other tools remain");
});

test("the tool picker warns about agents that lose a tool, and a cancel changes nothing", async () => {
  settings["revab.tools.disabled"] = ["confluence/*"];
  await run("revab.restart");
  // Uncheck knowledge_search, which several agents list.
  answers.quickPick = (items) => items.filter((i) => i.tool !== undefined && i.tool !== "knowledge_search");
  let warning = "";
  answers.warning = (m) => ((warning = m), undefined); // user cancels
  const before = JSON.stringify(settings["revab.tools.disabled"]);
  await run("revab.chooseTools");
  assert.match(warning, /removes capabilities from agents/);
  assert.equal(JSON.stringify(settings["revab.tools.disabled"]), before, "cancelling must not save");
});

test("confirming the picker saves the choice and keeps a hand-written pattern", async () => {
  answers.warning = () => "Disable anyway";
  await run("revab.chooseTools");
  const saved = settings["revab.tools.disabled"] as string[];
  assert.ok(saved.includes("knowledge_search"));
  assert.ok(saved.includes("confluence/*"), "the pattern the picker cannot show is preserved");
});

test("clearing a credential removes it", async () => {
  answers.quickPick = (items) => items.filter((i) => String(i.detail).startsWith("MCP_SHARED_SECRET"));
  await run("revab.clearCredentials");
  assert.equal(secretStore.has("MCP_SHARED_SECRET"), false);
});

test("final cleanup: stop the gateway the extension started", async () => {
  settings["revab.tools.disabled"] = [];
  await run("revab.stop");
  assert.equal(await health(), false);
});
