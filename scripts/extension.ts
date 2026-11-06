/**
 * Package, install and uninstall the VS Code extension.
 *
 *   npm run extension:package                      build → bundle agents → revab-agents-<ver>.vsix
 *   npm run extension:install                      package, then `code --install-extension`
 *   npm run extension:uninstall [-- --dry-run] [--purge-config] [--keep-gateway]
 *
 * Uninstall removes the extension and stops the gateway it started. With --purge-config it also
 * removes the config entries revab wrote into THIS checkout (`gateway`/`gateway-code` in
 * `.vscode/mcp.json` and `.mcp.json`, `revab.*` and the tool approvals in `.vscode/settings.json`,
 * and the `.revab/` runtime folder). It never touches `.env`, `knowledge/`, `projects/` or any
 * other server or setting. Use --dry-run to see exactly what would change.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import {
  chatAgentEntries,
  extensionId,
  removeGatewayEntries,
  removeRevabSettings,
  vsixFileName,
} from "../utils/extensionConfig.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const ROOT = path.resolve(option("root") ?? process.cwd());
const EXT = path.join(ROOT, "extension");
const DRY = flag("dry-run");
const shell = process.platform === "win32";

const say = (symbol: string, message: string) => console.log(`  ${symbol} ${message}`);

function run(command: string, commandArgs: string[], cwd: string): number {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell });
  return result.status ?? 1;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

interface ExtPackage {
  name: string;
  version: string;
  publisher: string;
  contributes: { chatAgents?: Array<{ path: string }> } & Record<string, unknown>;
}

/** Build the extension, bundle the generated agents into it, and produce the .vsix. */
function packageExtension(): string {
  console.log("Packaging the extension");
  if (run("npm", ["run", "build"], EXT) !== 0) throw new Error("extension build failed");

  // The agents are generated from prompts/agents/*.ts into .github/agents; the extension ships a
  // copy so they appear in every window. Copied here (not committed) so there is one source.
  const source = path.join(ROOT, ".github", "agents");
  const target = path.join(EXT, "agents");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const files = readdirSync(source).filter((f) => f.endsWith(".agent.md"));
  if (files.length === 0) throw new Error(`no agent files in ${source} — run \`npm run build:prompts\` first`);
  for (const f of files) copyFileSync(path.join(source, f), path.join(target, f));
  say("✓", `bundled ${files.length} agents`);

  const pkgPath = path.join(EXT, "package.json");
  const pkg = readJson<ExtPackage>(pkgPath);
  const entries = chatAgentEntries(files);
  if (JSON.stringify(pkg.contributes.chatAgents) !== JSON.stringify(entries)) {
    pkg.contributes.chatAgents = entries;
    writeJson(pkgPath, pkg);
    say("✓", "updated contributes.chatAgents in extension/package.json (commit this)");
  }

  const out = vsixFileName(pkg);
  const status = run(
    "npx",
    ["--yes", "@vscode/vsce", "package", "--no-dependencies", "--allow-missing-repository", "--skip-license", "-o", out],
    EXT,
  );
  if (status !== 0) throw new Error("vsce package failed");
  const vsix = path.join(EXT, out);
  say("✓", `built ${vsix}`);
  return vsix;
}

function codeCommand(): string {
  return option("code") ?? "code";
}

function install(): void {
  const vsix = packageExtension();
  console.log("\nInstalling");
  const status = run(codeCommand(), ["--install-extension", vsix, "--force"], ROOT);
  if (status !== 0) {
    say("!", `could not run \`${codeCommand()}\`. Install it by hand: Extensions view → ⋯ → Install from VSIX… → ${vsix}`);
    process.exitCode = 1;
    return;
  }
  const home = ROOT;
  console.log(
    `\nDone. Reload VS Code, then:\n` +
      `  1. Set "revab.home" to ${home} (or just open that folder once).\n` +
      `  2. Put credentials in ${path.join(home, ".env")} (copy .env.example), then run "revab: Run doctor".\n` +
      `  3. Pick "orchestrator" in the Chat agent dropdown.`,
  );
}

async function healthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function editJson(file: string, edit: (value: Record<string, unknown>) => { value: Record<string, unknown>; removed: string[] }): void {
  if (!existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  let parsed: Record<string, unknown>;
  try {
    parsed = readJson<Record<string, unknown>>(file);
  } catch {
    say("!", `${rel} is not valid JSON (comments?) — left alone; remove revab's entries by hand`);
    return;
  }
  const { value, removed } = edit(parsed);
  if (removed.length === 0) return say("·", `${rel}: nothing of revab's to remove`);
  if (!DRY) writeJson(file, value);
  say(DRY ? "~" : "✓", `${rel}: ${DRY ? "would remove" : "removed"} ${removed.join(", ")}`);
}

async function uninstall(): Promise<void> {
  console.log(`Uninstalling${DRY ? " (dry run: nothing will change)" : ""}\n`);
  const pkg = readJson<ExtPackage>(path.join(EXT, "package.json"));
  const port = Number(option("port") ?? process.env.GATEWAY_MCP_PORT ?? 7300);

  // 1. Stop the gateway this extension started (by pid file); one started elsewhere is not ours to kill.
  if (!flag("keep-gateway")) {
    const pidFile = path.join(ROOT, ".revab", "gateway.pid");
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : NaN;
    if (Number.isInteger(pid) && pid > 1) {
      if (DRY) say("~", `would stop the gateway (pid ${pid})`);
      else {
        try {
          process.kill(pid);
          say("✓", `stopped the gateway (pid ${pid})`);
        } catch {
          say("·", `gateway pid ${pid} was not running`);
        }
      }
    } else if (await healthy(port)) {
      say("!", `a gateway is running on :${port} but was not started by the extension — stop it where you started it`);
    } else {
      say("·", "no gateway running");
    }
  }

  // 2. Remove the extension.
  const id = extensionId(pkg);
  if (DRY) say("~", `would run: ${codeCommand()} --uninstall-extension ${id}`);
  else {
    const status = run(codeCommand(), ["--uninstall-extension", id], ROOT);
    say(status === 0 ? "✓" : "!", status === 0 ? `uninstalled ${id}` : `could not run \`${codeCommand()}\`; remove it from the Extensions view`);
  }

  // 3. Optionally remove what revab wrote into this checkout.
  if (flag("purge-config")) {
    console.log("");
    editJson(path.join(ROOT, ".vscode", "mcp.json"), (v) => {
      const r = removeGatewayEntries(v, "servers");
      return { value: r.config, removed: r.removed };
    });
    editJson(path.join(ROOT, ".mcp.json"), (v) => {
      const r = removeGatewayEntries(v, "mcpServers");
      return { value: r.config, removed: r.removed };
    });
    const settingsFile = path.join(ROOT, ".vscode", "settings.json");
    if (existsSync(settingsFile)) {
      const { captureAllTools } = await import("../mcp-servers/gateway/tools.js");
      process.env.JIRA_BASE_URL ??= "https://example.atlassian.net";
      const names = new Set((await captureAllTools()).map((t) => t.name));
      names.add("codemode_search");
      names.add("codemode_execute");
      editJson(settingsFile, (v) => {
        const r = removeRevabSettings(v, names);
        return { value: r.settings, removed: r.removed };
      });
    }
    const runtime = path.join(ROOT, ".revab");
    if (existsSync(runtime)) {
      if (!DRY) rmSync(runtime, { recursive: true, force: true });
      say(DRY ? "~" : "✓", `${DRY ? "would remove" : "removed"} .revab/ (gateway pid and log)`);
    }
    const bundled = path.join(EXT, "agents");
    if (existsSync(bundled)) {
      if (!DRY) rmSync(bundled, { recursive: true, force: true });
      say(DRY ? "~" : "✓", `${DRY ? "would remove" : "removed"} extension/agents/ (build output)`);
    }
  }

  console.log(
    `\nLeft untouched: .env, knowledge/, projects/, and any "revab.*" setting in your USER settings` +
      ` (delete those in Settings if you set revab.home globally).` +
      (flag("purge-config") ? "" : `\nRe-run with --purge-config to also remove revab's entries from this checkout's config files.`),
  );
}

async function main(): Promise<void> {
  const [command] = args.filter((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
  switch (command) {
    case "package":
      packageExtension();
      return;
    case "install":
      install();
      return;
    case "uninstall":
      await uninstall();
      return;
    default:
      console.error("Usage: tsx scripts/extension.ts <package|install|uninstall> [--dry-run] [--purge-config] [--keep-gateway] [--root <dir>] [--code <cmd>]");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
