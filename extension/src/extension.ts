/**
 * revab agents — VS Code extension.
 *
 * Removes the manual setup between "open the workspace" and "use the agents": it
 * starts the gateway (one process hosting every tool) and registers it with VS Code's
 * MCP support, so nobody has to run servers by hand or hand-edit `.vscode/mcp.json`.
 *
 * On approval prompts, honestly: per-call confirmation is a VS Code security setting
 * owned by the user/workspace. An extension can *suggest* sensible defaults — and
 * `revab.applyApprovalDefaults` writes them, auto-approving read-only tools while
 * leaving every write confirmed — but it cannot and should not silently disable
 * confirmation. Writes stay behind a prompt, and behind the framework's dryRun-first
 * guard regardless of what the editor approves.
 */
import { type ChildProcess, spawn } from "child_process";
import * as vscode from "vscode";

const OUTPUT = vscode.window.createOutputChannel("revab agents");

let gateway: ChildProcess | undefined;
let status: vscode.StatusBarItem;

function config() {
  const c = vscode.workspace.getConfiguration("revab");
  return {
    port: c.get<number>("gateway.port", 7300),
    autoStart: c.get<boolean>("gateway.autoStart", true),
    command: c.get<string>("gateway.command", "npx revab start"),
  };
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal }).finally(
      () => clearTimeout(timer),
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as { tools?: number };
    return body.tools ?? 0;
  } catch {
    return undefined;
  }
}

async function startGateway(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("revab: open a workspace folder first.");
    return;
  }
  const { port, command } = config();

  // Someone may already be running it in a terminal — don't fight over the port.
  const existing = await probe(port);
  if (existing !== undefined) {
    OUTPUT.appendLine(`[revab] gateway already running on :${port} (${existing} tools)`);
    setStatus("running");
    return;
  }

  setStatus("starting");
  OUTPUT.appendLine(`[revab] starting: ${command} (cwd ${root})`);
  const [cmd, ...args] = command.split(" ");
  gateway = spawn(cmd, args, { cwd: root, shell: true, env: { ...process.env, GATEWAY_MCP_PORT: String(port) } });

  gateway.stdout?.on("data", (d: Buffer) => OUTPUT.append(d.toString()));
  gateway.stderr?.on("data", (d: Buffer) => OUTPUT.append(d.toString()));
  gateway.on("exit", (code) => {
    OUTPUT.appendLine(`[revab] gateway exited (code ${code ?? "null"})`);
    gateway = undefined;
    setStatus("stopped");
  });

  // Give it a moment, then confirm it actually came up rather than assuming.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    const tools = await probe(port);
    if (tools !== undefined) {
      OUTPUT.appendLine(`[revab] gateway up on :${port} with ${tools} tools`);
      setStatus("running");
      return;
    }
  }
  setStatus("stopped");
  vscode.window
    .showWarningMessage(
      "revab: the gateway did not report healthy. Run doctor to diagnose.",
      "Run doctor",
      "Show log",
    )
    .then((choice) => {
      if (choice === "Run doctor") void vscode.commands.executeCommand("revab.doctor");
      if (choice === "Show log") OUTPUT.show();
    });
}

function stopGateway(): void {
  if (!gateway) {
    OUTPUT.appendLine("[revab] no gateway process owned by this window");
    setStatus("stopped");
    return;
  }
  gateway.kill();
  gateway = undefined;
  setStatus("stopped");
}

/** Run `revab doctor` in a terminal so its output is readable and re-runnable. */
function runDoctor(): void {
  const terminal = vscode.window.createTerminal({ name: "revab doctor", cwd: workspaceRoot() });
  terminal.show();
  terminal.sendText("npx revab doctor");
}

async function showTools(): Promise<void> {
  const { port } = config();
  const tools = await probe(port);
  if (tools === undefined) {
    const choice = await vscode.window.showInformationMessage(
      "revab: gateway is not running.",
      "Start it",
    );
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

/**
 * Write approval defaults into workspace settings: read-only tools auto-approved,
 * every write left requiring confirmation.
 *
 * The read/write split comes from the gateway (`risk` on /api/tools), not a copy
 * kept here — one classification, one place to fix it. This only *suggests* defaults
 * by writing settings the user can see and change; it never disables confirmation
 * globally, and writes stay behind both the prompt and the dryRun-first guard.
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
  for (const name of writes) map[name] = false; // explicit, so the intent is visible

  try {
    await vscode.workspace
      .getConfiguration("chat")
      .update("tools.autoApprove", map, vscode.ConfigurationTarget.Workspace);
    OUTPUT.appendLine(`[revab] approval defaults written: ${reads.length} auto-approved, ${writes.length} confirmed`);
    vscode.window.showInformationMessage("revab: approval defaults written to workspace settings.");
  } catch (err) {
    // The setting id varies across VS Code versions; never fail activation over it.
    OUTPUT.appendLine(`[revab] could not write approval defaults: ${String(err)}`);
    vscode.window.showWarningMessage(
      "revab: this VS Code version doesn't accept that approval setting — approve tools via the prompt's \"Always allow\" instead.",
    );
  }
}

/**
 * Register the gateway with VS Code's MCP support when the API is available, so no
 * hand-edited `.vscode/mcp.json` is required. Guarded because this API is still
 * evolving across VS Code versions — a missing API must degrade to the config file,
 * not break activation.
 */
function registerMcp(context: vscode.ExtensionContext): void {
  const api = (vscode as unknown as {
    lm?: { registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable };
  }).lm;

  if (!api?.registerMcpServerDefinitionProvider) {
    OUTPUT.appendLine(
      "[revab] this VS Code build has no MCP provider API — using .vscode/mcp.json instead (run `npx revab init` to add the gateway entry).",
    );
    return;
  }
  try {
    const { port } = config();
    const disposable = api.registerMcpServerDefinitionProvider("revab.gateway", {
      provideMcpServerDefinitions: () => [
        { label: "revab gateway", uri: vscode.Uri.parse(`http://127.0.0.1:${port}/mcp`) },
      ],
    });
    context.subscriptions.push(disposable);
    OUTPUT.appendLine("[revab] registered the gateway with VS Code MCP");
  } catch (err) {
    OUTPUT.appendLine(`[revab] MCP registration failed, falling back to .vscode/mcp.json: ${String(err)}`);
  }
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
      stopGateway();
      await startGateway();
    }),
    vscode.commands.registerCommand("revab.doctor", runDoctor),
    vscode.commands.registerCommand("revab.showTools", showTools),
    vscode.commands.registerCommand("revab.applyApprovalDefaults", applyApprovalDefaults),
  );

  registerMcp(context);

  if (config().autoStart) await startGateway();
}

export function deactivate(): void {
  stopGateway();
}
