/**
 * revab agents — VS Code extension.
 *
 * Install this one extension and the QE agents and tools are available in every window,
 * whichever folder is open:
 *  - the orchestrator and specialist agents are bundled (`contributes.chatAgents`),
 *  - the gateway's tools are registered with the editor's MCP support,
 *  - one shared gateway runs in the background, started detached from the framework
 *    checkout named by `revab.home`, so closing a window does not take the tools away from
 *    the others.
 *
 * On approval prompts, honestly: per-call confirmation is a VS Code security setting owned by
 * the user/workspace. An extension can *suggest* sensible defaults — and
 * `revab.applyApprovalDefaults` writes them, auto-approving read-only tools while leaving
 * every write confirmed — but it cannot and should not silently disable confirmation.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { gatewayLaunch, parsePid, resolveHome, runtimePaths, tailLines, type FsLike } from "./home.js";

const OUTPUT = vscode.window.createOutputChannel("revab agents");
const realFs: FsLike = { exists: (p) => fs.existsSync(p), read: (p) => fs.readFileSync(p, "utf8") };

let status: vscode.StatusBarItem;
const mcpChanged = new vscode.EventEmitter<void>();

function config() {
  const c = vscode.workspace.getConfiguration("revab");
  return {
    home: c.get<string>("home", ""),
    port: c.get<number>("gateway.port", 7300),
    autoStart: c.get<boolean>("gateway.autoStart", true),
    nodePath: c.get<string>("nodePath", "node") || "node",
    command: c.get<string>("gateway.command", "").trim(),
  };
}

function home() {
  return resolveHome({
    configured: config().home,
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    fs: realFs,
  });
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

  let resolved = home();
  if (!resolved.home) {
    const message = resolved.problem ?? "revab: choose your revab-agents folder so the gateway knows where to run.";
    const choice = await vscode.window.showWarningMessage(message, "Choose folder");
    if (choice !== "Choose folder") return setStatus("stopped");
    const dir = await chooseHome();
    if (!dir) return setStatus("stopped");
    resolved = { home: dir, source: "setting" };
  }
  const root = resolved.home!;

  let launch;
  try {
    launch = command
      ? { command: command.split(" ")[0]!, args: command.split(" ").slice(1), cwd: root, env: { GATEWAY_MCP_PORT: String(port) } }
      : gatewayLaunch(root, port, realFs, nodePath);
  } catch (err) {
    vscode.window.showErrorMessage(`revab: ${err instanceof Error ? err.message : String(err)}`);
    return setStatus("stopped");
  }

  const paths = runtimePaths(root);
  fs.mkdirSync(paths.dir, { recursive: true });
  const logFd = fs.openSync(paths.log, "a");
  setStatus("starting");
  OUTPUT.appendLine(`[revab] starting: ${launch.command} ${launch.args.join(" ")} (cwd ${launch.cwd})`);

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
  const root = home().home;
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

/** Run `revab doctor` in a terminal so its output is readable and re-runnable. */
function runDoctor(): void {
  const root = home().home;
  const terminal = vscode.window.createTerminal({ name: "revab doctor", ...(root ? { cwd: root } : {}) });
  terminal.show();
  terminal.sendText("npx revab doctor");
}

async function showTools(): Promise<void> {
  const { port } = config();
  const tools = await probe(port);
  if (tools === undefined) {
    const choice = await vscode.window.showInformationMessage("revab: gateway is not running.", "Start it");
    if (choice === "Start it") await startGateway();
    return;
  }
  const res = await fetch(`http://127.0.0.1:${port}/api/tools`);
  const body = (await res.json()) as { tools: Array<{ name: string; server: string; description: string }> };
  const picked = await vscode.window.showQuickPick(
    body.tools.map((t) => ({ label: t.name, description: t.server, detail: t.description })),
    { title: `revab — ${tools} tools`, matchOnDetail: true },
  );
  if (picked) OUTPUT.appendLine(`[revab] ${picked.label} (${picked.description}): ${picked.detail}`);
}

async function openLog(): Promise<void> {
  const root = home().home;
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
  const res = await fetch(`http://127.0.0.1:${port}/api/tools`);
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
      provideMcpServerDefinitions: () => {
        const { port } = config();
        const version = `port-${port}`;
        return [
          new vscode.McpHttpServerDefinition("gateway", vscode.Uri.parse(`http://127.0.0.1:${port}/mcp`), {}, version),
          new vscode.McpHttpServerDefinition("gateway-code", vscode.Uri.parse(`http://127.0.0.1:${port}/mcp/code`), {}, version),
        ];
      },
    }),
  );
  OUTPUT.appendLine("[revab] registered gateway and gateway-code with VS Code MCP");
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
    vscode.commands.registerCommand("revab.showTools", showTools),
    vscode.commands.registerCommand("revab.openLog", openLog),
    vscode.commands.registerCommand("revab.chooseHome", async () => {
      if (await chooseHome()) await startGateway();
    }),
    vscode.commands.registerCommand("revab.applyApprovalDefaults", applyApprovalDefaults),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("revab.gateway.port")) mcpChanged.fire();
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
