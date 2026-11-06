/**
 * revab agents — VS Code extension.
 *
 * Install this one extension and the QE agents and tools are available in every window,
 * whichever folder is open:
 *  - the orchestrator and specialist agents are bundled (`contributes.chatAgents`),
 *  - the gateway's tools are registered with the editor's MCP support,
 *  - one shared gateway runs in the background, so closing a window does not take the tools
 *    away from the others. It runs from a framework checkout named by `revab.home` (or an open
 *    folder that is one), or, with no checkout at all, from the gateway bundled in this
 *    extension and a home folder in the extension's own storage.
 *
 * On approval prompts, honestly: per-call confirmation is a VS Code security setting owned by
 * the user/workspace. An extension can *suggest* sensible defaults — and
 * `revab.applyApprovalDefaults` writes them, auto-approving read-only tools while leaving
 * every write confirmed — but it cannot and should not silently disable confirmation.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  bundledLaunch,
  gatewayLaunch,
  parsePid,
  resolveHome,
  resolveRuntime,
  runtimePaths,
  tailLines,
  type FsLike,
  type Runtime,
} from "./home.js";
import { MARKER, parseInstalledVersion, planSeed, type SeedFs } from "./seed.js";
import {
  SECRETS,
  agentToolRefs,
  agentsLosing,
  buildGatewayEnv,
  describeEnv,
  nextDisabledList,
  sharedSecretHeaders,
} from "./settings.js";

const OUTPUT = vscode.window.createOutputChannel("revab agents");
/** Newest mtime among the TypeScript sources the gateway is built from. */
function newestSourceMtimeMs(home: string): number {
  let newest = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  for (const d of ["cli", "mcp-servers", "utils", "prompts"]) walk(`${home}/${d}`);
  return newest;
}

const realFs: FsLike = {
  exists: (p) => fs.existsSync(p),
  read: (p) => fs.readFileSync(p, "utf8"),
  mtimeMs: (p) => fs.statSync(p).mtimeMs,
  newestSourceMtimeMs,
};

let status: vscode.StatusBarItem;
let secretStore: vscode.SecretStorage | undefined;
const mcpChanged = new vscode.EventEmitter<void>();

function config() {
  const c = vscode.workspace.getConfiguration("revab");
  return {
    home: c.get<string>("home", ""),
    port: c.get<number>("gateway.port", 7300),
    autoStart: c.get<boolean>("gateway.autoStart", true),
    nodePath: c.get<string>("nodePath", "node") || "node",
    command: c.get<string>("gateway.command", "").trim(),
    environment: c.get<unknown>("environment", {}),
    disabled: c.get<unknown>("tools.disabled", []),
  };
}

/** Every stored credential. Values stay in memory only long enough to be handed to a process. */
async function readSecrets(): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  if (!secretStore) return out;
  for (const { key } of SECRETS) out[key] = await secretStore.get(key);
  return out;
}

/** fetch against the gateway, sending the shared secret when one is configured. */
async function gatewayFetch(port: number, path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, { headers: sharedSecretHeaders(await readSecrets()) });
}

let extensionPath = "";
let bundledHome = "";

/** The bundled gateway file, when this build of the extension ships one. */
function bundleFile(): string | undefined {
  const file = path.join(extensionPath, "bundle", "revab.cjs");
  return fs.existsSync(file) ? file : undefined;
}

function runtime(): Runtime {
  return resolveRuntime({
    configured: config().home,
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    bundledHome,
    bundleFile: bundleFile(),
    fs: realFs,
  });
}

/** The working directory the gateway uses, in either mode. */
function homeDir(): string | undefined {
  const r = runtime();
  return r.mode === "none" ? undefined : r.home;
}

const seedFs: SeedFs = {
  exists: (p) => fs.existsSync(p),
  walk: (dir) => {
    const out: string[] = [];
    const visit = (d: string, prefix: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) visit(path.join(d, e.name), `${prefix}${e.name}/`);
        else out.push(`${prefix}${e.name}`);
      }
    };
    if (fs.existsSync(dir)) visit(dir, "");
    return out;
  },
};

/** Create or refresh the bundled home from the shipped templates. Never deletes or overwrites user data. */
function ensureSeeded(home: string): void {
  const templates = path.join(extensionPath, "resources", "home");
  const version = (JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf8")) as { version: string }).version;
  fs.mkdirSync(home, { recursive: true });
  const installedVersion = parseInstalledVersion(safeRead(path.join(home, MARKER)));
  const actions = planSeed({ templates, home, version, installedVersion, fs: seedFs });
  for (const a of actions) {
    fs.mkdirSync(path.dirname(a.to), { recursive: true });
    fs.copyFileSync(a.from, a.to);
  }
  if (actions.length > 0 || installedVersion !== version) {
    fs.writeFileSync(path.join(home, MARKER), `${JSON.stringify({ version }, null, 2)}\n`);
    OUTPUT.appendLine(`[revab] home ${installedVersion ? "updated" : "created"} at ${home} (${actions.length} file(s))`);
  }
}

function setStatus(state: "running" | "stopped" | "starting"): void {
  const icon = state === "running" ? "$(check)" : state === "starting" ? "$(sync~spin)" : "$(circle-slash)";
  status.text = `${icon} revab`;
  status.tooltip = `revab gateway: ${state} (click to show tools)`;
  status.show();
}

/** Probe the gateway's health endpoint; returns the hosted tool count when up. */
async function probe(port: number): Promise<number | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as { tools?: number };
    return body.tools ?? 0;
  } catch {
    return undefined;
  }
}

/** Ask for the framework folder, validate it, and save it as a user setting. */
async function chooseHome(): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Use as revab-agents folder",
    title: "Choose your revab-agents checkout",
  });
  const dir = picked?.[0]?.fsPath;
  if (!dir) return undefined;
  const resolved = resolveHome({ configured: dir, workspaceFolders: [], fs: realFs });
  if (!resolved.home) {
    vscode.window.showErrorMessage(`revab: ${resolved.problem ?? "that folder is not a revab-agents checkout."}`);
    return undefined;
  }
  await vscode.workspace.getConfiguration("revab").update("home", resolved.home, vscode.ConfigurationTarget.Global);
  return resolved.home;
}

async function startGateway(): Promise<void> {
  const { port, nodePath, command } = config();

  // One shared gateway: if any window (or a terminal) already started it, use that one.
  const existing = await probe(port);
  if (existing !== undefined) {
    OUTPUT.appendLine(`[revab] gateway already running on :${port} (${existing} tools)`);
    setStatus("running");
    return;
  }

  let resolved = runtime();
  if (resolved.mode === "none") {
    const message = resolved.problem ?? "revab: this build has no bundled gateway. Choose your revab-agents folder so the gateway knows where to run.";
    const choice = await vscode.window.showWarningMessage(message, "Choose folder");
    if (choice !== "Choose folder") return setStatus("stopped");
    const dir = await chooseHome();
    if (!dir) return setStatus("stopped");
    resolved = { mode: "checkout", home: dir, source: "setting" };
  }
  const root = resolved.home;
  if (resolved.mode === "bundled") {
    try {
      ensureSeeded(root);
    } catch (err) {
      vscode.window.showErrorMessage(`revab: could not prepare ${root}: ${err instanceof Error ? err.message : String(err)}`);
      return setStatus("stopped");
    }
  }
  OUTPUT.appendLine(`[revab] mode: ${resolved.mode === "bundled" ? "bundled gateway (no checkout needed)" : "framework checkout"}; home ${root}`);

  // Credentials and tool choices reach the gateway as environment variables. Only names are logged.
  const built = buildGatewayEnv({
    plain: config().environment,
    secrets: await readSecrets(),
    disabled: config().disabled,
    port,
  });
  if (built.rejected.length > 0) {
    const lines = built.rejected.map((r) => `${r.key} ${r.reason}`);
    OUTPUT.appendLine(`[revab] revab.environment entries ignored:\n  ${lines.join("\n  ")}`);
    vscode.window.showWarningMessage(`revab: ${built.rejected.length} entr${built.rejected.length === 1 ? "y" : "ies"} in revab.environment ignored (${built.rejected.map((r) => r.key).join(", ")}). See the revab output.`);
  }

  let launch;
  try {
    launch = command
      ? { command: command.split(" ")[0]!, args: command.split(" ").slice(1), cwd: root, env: {} as Record<string, string> }
      : resolved.mode === "bundled"
        ? bundledLaunch(resolved.bundle, root, port, nodePath)
        : gatewayLaunch(root, port, realFs, nodePath);
    launch.env = built.env;
    if (launch.note) OUTPUT.appendLine(`[revab] ${launch.note}`);
  } catch (err) {
    vscode.window.showErrorMessage(`revab: ${err instanceof Error ? err.message : String(err)}`);
    return setStatus("stopped");
  }

  const paths = runtimePaths(root);
  fs.mkdirSync(paths.dir, { recursive: true });
  const logFd = fs.openSync(paths.log, "a");
  setStatus("starting");
  OUTPUT.appendLine(`[revab] starting: ${launch.command} ${launch.args.join(" ")} (cwd ${launch.cwd})`);
  OUTPUT.appendLine(`[revab] environment passed: ${describeEnv(built.env).join(", ")}`);

  // Detached with output going to a file: the gateway outlives this window, so the other
  // windows keep their tools, and nobody depends on this window's output channel.
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  let spawnError: Error | undefined;
  let earlyExit: number | null | undefined;
  child.on("error", (err) => (spawnError = err));
  child.on("exit", (code) => (earlyExit = code));
  if (child.pid) fs.writeFileSync(paths.pid, String(child.pid));
  child.unref();
  fs.closeSync(logFd);

  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    const tools = await probe(port);
    if (tools !== undefined) {
      OUTPUT.appendLine(`[revab] gateway up on :${port} with ${tools} tools (pid ${child.pid})`);
      setStatus("running");
      return;
    }
    // Another window may have won the race for the port; that is success too, not a failure.
    if (spawnError || earlyExit !== undefined) break;
  }
  setStatus("stopped");
  let detail = spawnError ? spawnError.message : "";
  try {
    detail ||= tailLines(fs.readFileSync(paths.log, "utf8"));
  } catch {
    /* no log yet */
  }
  OUTPUT.appendLine(`[revab] gateway did not come up. ${detail}`);
  vscode.window
    .showWarningMessage(`revab: the gateway did not start. ${detail.split("\n").pop() ?? ""}`.trim(), "Run doctor", "Open log")
    .then((choice) => {
      if (choice === "Run doctor") void vscode.commands.executeCommand("revab.doctor");
      if (choice === "Open log") void vscode.commands.executeCommand("revab.openLog");
    });
}

/** Stop the gateway this extension started (by pid file). One started elsewhere is left alone. */
async function stopGateway(): Promise<void> {
  const root = homeDir();
  const pid = root ? parsePid(safeRead(runtimePaths(root).pid)) : undefined;
  if (!pid) {
    const up = await probe(config().port);
    vscode.window.showInformationMessage(
      up === undefined
        ? "revab: the gateway is not running."
        : "revab: the gateway was started outside this extension (a terminal, for example) — stop it where you started it.",
    );
    return setStatus(up === undefined ? "stopped" : "running");
  }
  try {
    process.kill(pid);
  } catch (err) {
    OUTPUT.appendLine(`[revab] could not signal pid ${pid}: ${String(err)}`);
  }
  if (root) fs.rmSync(runtimePaths(root).pid, { force: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await probe(config().port)) === undefined) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  setStatus((await probe(config().port)) === undefined ? "stopped" : "running");
}

function safeRead(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Run a `revab` sub-command in a terminal so its output is readable and re-runnable. Bundled mode has no
 * checkout to run from: it runs the bundled CLI itself, in the home folder. In a checkout, `npm run revab`
 * runs the CLI from source, so no build is needed.
 */
function runCliInTerminal(title: string, subcommand: string): void {
  const r = runtime();
  const root = r.mode === "none" ? undefined : r.home;
  const terminal = vscode.window.createTerminal({ name: title, ...(root ? { cwd: root } : {}) });
  terminal.show();
  terminal.sendText(r.mode === "bundled" ? `"${config().nodePath}" "${r.bundle}" ${subcommand}` : `npm run --silent revab -- ${subcommand}`);
}

const runDoctor = (): void => runCliInTerminal("revab doctor", "doctor");

/** Installs faster-whisper into a private environment (the speech-to-text tool needs it). */
const setupSpeechToText = (): void => runCliInTerminal("revab speech-to-text setup", "whisper-setup");

/** Reveal the home folder, where `.env`, `projects/` and `knowledge/` live, in the OS file manager. */
async function openHome(): Promise<void> {
  const r = runtime();
  if (r.mode === "none") return void vscode.window.showInformationMessage("revab: no framework folder is set yet.");
  if (r.mode === "bundled") ensureSeeded(r.home);
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(r.home));
}

async function showTools(): Promise<void> {
  const { port } = config();
  const tools = await probe(port);
  if (tools === undefined) {
    const choice = await vscode.window.showInformationMessage("revab: gateway is not running.", "Start it");
    if (choice === "Start it") await startGateway();
    return;
  }
  const res = await gatewayFetch(port, "/api/tools");
  const body = (await res.json()) as { tools: Array<{ name: string; server: string; description: string }> };
  const picked = await vscode.window.showQuickPick(
    body.tools.map((t) => ({ label: t.name, description: t.server, detail: t.description })),
    { title: `revab — ${tools} tools`, matchOnDetail: true },
  );
  if (picked) OUTPUT.appendLine(`[revab] ${picked.label} (${picked.description}): ${picked.detail}`);
}

async function openLog(): Promise<void> {
  const root = homeDir();
  if (!root) return void vscode.window.showInformationMessage("revab: no framework folder is set yet.");
  const log = runtimePaths(root).log;
  if (!fs.existsSync(log)) return void vscode.window.showInformationMessage("revab: no gateway log yet.");
  await vscode.window.showTextDocument(vscode.Uri.file(log));
}

/**
 * Write approval defaults into workspace settings: read-only tools auto-approved, every
 * write left requiring confirmation. The read/write split comes from the gateway (`risk` on
 * /api/tools), not a copy kept here.
 */
async function applyApprovalDefaults(): Promise<void> {
  const { port } = config();
  if ((await probe(port)) === undefined) {
    vscode.window.showWarningMessage("revab: start the gateway first so its tool list can be read.");
    return;
  }
  const res = await gatewayFetch(port, "/api/tools");
  const body = (await res.json()) as { tools: Array<{ name: string; risk?: "read" | "write" }> };
  const reads = body.tools.filter((t) => t.risk === "read").map((t) => t.name);
  const writes = body.tools.filter((t) => t.risk !== "read").map((t) => t.name);

  const choice = await vscode.window.showInformationMessage(
    `revab: auto-approve ${reads.length} read-only tools? ${writes.length} write tools will still ask every time.`,
    { modal: true },
    "Apply to workspace",
  );
  if (choice !== "Apply to workspace") return;

  const map: Record<string, boolean> = {};
  for (const name of reads) map[name] = true;
  for (const name of writes) map[name] = false;
  try {
    await vscode.workspace
      .getConfiguration("chat")
      .update("tools.autoApprove", map, vscode.ConfigurationTarget.Workspace);
    OUTPUT.appendLine(`[revab] approval defaults written: ${reads.length} auto-approved, ${writes.length} confirmed`);
    vscode.window.showInformationMessage("revab: approval defaults written to workspace settings.");
  } catch (err) {
    OUTPUT.appendLine(`[revab] could not write approval defaults: ${String(err)}`);
    vscode.window.showWarningMessage(
      "revab: this VS Code version doesn't accept that approval setting — approve tools via the prompt's \"Always allow\" instead.",
    );
  }
}

/** Offer a restart after a change that only takes effect when the gateway starts. */
async function restartIfOwned(reason: string): Promise<void> {
  const root = homeDir();
  const owned = root ? parsePid(safeRead(runtimePaths(root).pid)) !== undefined : false;
  if (!(await probe(config().port))) return;
  if (!owned) {
    vscode.window.showInformationMessage(`revab: ${reason} Restart the gateway where you started it (it was not started by this extension).`);
    return;
  }
  const choice = await vscode.window.showInformationMessage(`revab: ${reason} Restart the gateway now?`, "Restart");
  if (choice === "Restart") await vscode.commands.executeCommand("revab.restart");
}

async function setCredentials(): Promise<void> {
  if (!secretStore) return;
  const configured = new Set((await Promise.all(SECRETS.map(async (s) => ((await secretStore!.get(s.key)) ? s.key : undefined)))).filter(Boolean) as string[]);
  const pick = await vscode.window.showQuickPick(
    SECRETS.map((s) => ({ label: s.label, description: configured.has(s.key) ? "$(check) set" : "not set", detail: `${s.key} — ${s.hint}`, key: s.key })),
    { title: "revab: Set credentials", placeHolder: "Which credential? Values are stored encrypted, never in settings." },
  );
  if (!pick) return;
  const value = await vscode.window.showInputBox({
    title: pick.label,
    prompt: pick.detail,
    password: true,
    ignoreFocusOut: true,
    placeHolder: configured.has(pick.key) ? "Enter a new value to replace the stored one" : "Paste the value",
  });
  if (value === undefined || value.trim() === "") return;
  await secretStore.store(pick.key, value.trim());
  mcpChanged.fire();
  OUTPUT.appendLine(`[revab] stored ${pick.key} (secret)`);
  await restartIfOwned(`${pick.key} saved.`);
}

async function clearCredentials(): Promise<void> {
  if (!secretStore) return;
  const set = (await Promise.all(SECRETS.map(async (s) => ((await secretStore!.get(s.key)) ? s : undefined)))).filter(
    (s): s is (typeof SECRETS)[number] => s !== undefined,
  );
  if (set.length === 0) return void vscode.window.showInformationMessage("revab: no stored credentials.");
  const picks = await vscode.window.showQuickPick(
    set.map((s) => ({ label: s.label, detail: s.key, key: s.key })),
    { title: "revab: Clear credentials", canPickMany: true, placeHolder: "Select the credentials to delete" },
  );
  if (!picks || picks.length === 0) return;
  for (const p of picks) await secretStore.delete(p.key);
  mcpChanged.fire();
  OUTPUT.appendLine(`[revab] cleared ${picks.map((p) => p.key).join(", ")}`);
  await restartIfOwned("Credentials cleared.");
}

/** Names only, never values. */
async function showCredentials(): Promise<void> {
  const secrets = await readSecrets();
  const built = buildGatewayEnv({ plain: config().environment, secrets, disabled: config().disabled, port: config().port });
  const names = describeEnv(built.env).filter((n) => n !== "GATEWAY_MCP_PORT");
  OUTPUT.appendLine(`[revab] configured: ${names.join(", ") || "(nothing)"}`);
  OUTPUT.show(true);
  vscode.window.showInformationMessage(
    names.length > 0
      ? `revab: ${names.length} value(s) configured in the extension (names in the revab output). Anything in <checkout>/.env also applies.`
      : "revab: nothing configured in the extension. The gateway still reads <checkout>/.env.",
  );
}

/** The agents this extension ships, and the tools each lists. */
function readAgents(): Array<{ name: string; tools: string[] }> {
  const dir = path.join(extensionPath, "agents");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".agent.md"))
      .map((f) => ({ name: f.replace(/\.agent\.md$/, ""), tools: agentToolRefs(fs.readFileSync(`${dir}/${f}`, "utf8")) }));
  } catch {
    return [];
  }
}

async function chooseTools(): Promise<void> {
  const { port } = config();
  if ((await probe(port)) === undefined) {
    const choice = await vscode.window.showInformationMessage("revab: start the gateway first so its tool list can be read.", "Start it");
    if (choice === "Start it") await startGateway();
    return;
  }
  const res = await gatewayFetch(port, "/api/tools");
  if (!res.ok) return void vscode.window.showErrorMessage(`revab: the gateway refused the tool list (HTTP ${res.status}). Is the shared secret set?`);
  const body = (await res.json()) as {
    tools: Array<{ name: string; server: string; description: string; risk?: string }>;
    disabled?: Array<{ name: string; server: string }>;
  };
  const all = [
    ...body.tools.map((t) => ({ ...t, on: true })),
    ...(body.disabled ?? []).map((t) => ({ name: t.name, server: t.server, description: "(currently disabled)", risk: undefined, on: false })),
  ].sort((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name));

  const items: Array<vscode.QuickPickItem & { tool?: string }> = [];
  let lastServer = "";
  for (const t of all) {
    if (t.server !== lastServer) {
      items.push({ label: t.server, kind: vscode.QuickPickItemKind.Separator });
      lastServer = t.server;
    }
    items.push({ label: t.name, description: t.risk === "write" ? "write" : t.risk === "read" ? "read-only" : "", detail: t.description, picked: t.on, tool: t.name });
  }
  const picks = await vscode.window.showQuickPick(items, {
    title: `revab: Choose tools — checked tools are enabled (${all.length})`,
    canPickMany: true,
    matchOnDetail: true,
  });
  if (!picks) return;

  const checked = new Set(picks.map((p) => p.tool).filter((t): t is string => !!t));
  const unchecked = all.filter((t) => !checked.has(t.name)).map((t) => t.name);
  const previous = Array.isArray(config().disabled) ? (config().disabled as unknown[]).filter((e): e is string => typeof e === "string") : [];
  const next = nextDisabledList(previous, new Set(all.map((t) => t.name)), unchecked);

  const newlyOff = new Set(unchecked.filter((n) => !previous.includes(n)));
  const losses = agentsLosing(newlyOff, readAgents());
  if (losses.length > 0) {
    const detail = losses.map((l) => `• ${l.agent} loses ${l.lost.join(", ")}`).join("\n");
    const confirm = await vscode.window.showWarningMessage(
      "revab: disabling these tools removes capabilities from agents that list them.",
      { modal: true, detail: `${detail}\n\nThe agents keep working but cannot do those steps.` },
      "Disable anyway",
    );
    if (confirm !== "Disable anyway") return;
  }
  await vscode.workspace.getConfiguration("revab").update("tools.disabled", next, vscode.ConfigurationTarget.Global);
  mcpChanged.fire();
  await restartIfOwned(`${next.length} tool(s)/pattern(s) disabled.`);
}

/**
 * Register the gateway with the editor's MCP support: the full tool list as `gateway` and
 * the two-tool Code Mode endpoint as `gateway-code`. The labels match the server names the
 * bundled agents reference (`gateway/<tool>`). Definitions must be class instances, and the
 * provider id must also be declared under `contributes.mcpServerDefinitionProviders`.
 */
function registerMcp(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    mcpChanged,
    vscode.lm.registerMcpServerDefinitionProvider("revab.gateway", {
      onDidChangeMcpServerDefinitions: mcpChanged.event,
      provideMcpServerDefinitions: async () => {
        const { port, disabled } = config();
        const headers = sharedSecretHeaders(await readSecrets());
        // A new version makes the editor notice that the tool list changed and refresh it.
        const version = `port-${port}-${Array.isArray(disabled) ? disabled.length : 0}-${Object.keys(headers).length}`;
        return [
          new vscode.McpHttpServerDefinition("gateway", vscode.Uri.parse(`http://127.0.0.1:${port}/mcp`), headers, version),
          new vscode.McpHttpServerDefinition("gateway-code", vscode.Uri.parse(`http://127.0.0.1:${port}/mcp/code`), headers, version),
        ];
      },
    }),
  );
  OUTPUT.appendLine("[revab] registered gateway and gateway-code with VS Code MCP");
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  secretStore = context.secrets;
  extensionPath = context.extensionPath;
  bundledHome = path.join(context.globalStorageUri.fsPath, "home");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "revab.showTools";
  context.subscriptions.push(status, OUTPUT);
  setStatus("stopped");

  context.subscriptions.push(
    vscode.commands.registerCommand("revab.start", startGateway),
    vscode.commands.registerCommand("revab.stop", stopGateway),
    vscode.commands.registerCommand("revab.restart", async () => {
      await stopGateway();
      await startGateway();
    }),
    vscode.commands.registerCommand("revab.doctor", runDoctor),
    vscode.commands.registerCommand("revab.setupSpeechToText", setupSpeechToText),
    vscode.commands.registerCommand("revab.openHome", openHome),
    vscode.commands.registerCommand("revab.showTools", showTools),
    vscode.commands.registerCommand("revab.openLog", openLog),
    vscode.commands.registerCommand("revab.chooseHome", async () => {
      if (await chooseHome()) await startGateway();
    }),
    vscode.commands.registerCommand("revab.applyApprovalDefaults", applyApprovalDefaults),
    vscode.commands.registerCommand("revab.setCredentials", setCredentials),
    vscode.commands.registerCommand("revab.clearCredentials", clearCredentials),
    vscode.commands.registerCommand("revab.showCredentials", showCredentials),
    vscode.commands.registerCommand("revab.chooseTools", chooseTools),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("revab.gateway.port") || e.affectsConfiguration("revab.tools.disabled")) mcpChanged.fire();
      if (e.affectsConfiguration("revab.environment") || e.affectsConfiguration("revab.tools.disabled")) {
        void restartIfOwned("Settings changed.");
      }
    }),
  );

  registerMcp(context);

  // Keep the status bar honest across windows: the gateway may be started or stopped from anywhere.
  const timer = setInterval(async () => {
    const up = await probe(config().port);
    setStatus(up === undefined ? "stopped" : "running");
  }, 5000);
  timer.unref?.(); // never the reason a process stays alive
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  if (config().autoStart) await startGateway();
}

/** Deliberately does not stop the gateway: it is shared by every window. Use "revab: Stop gateway". */
export function deactivate(): void {
  /* nothing to tear down; the shared gateway keeps running */
}
