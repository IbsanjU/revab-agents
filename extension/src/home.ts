/**
 * Finding the framework checkout and deciding how to launch its gateway.
 *
 * Kept free of any `vscode` import so it can be unit tested. The gateway reads `.env`,
 * `projects/`, `knowledge/` and `skills/` from its working directory, so it must run inside
 * a revab-agents checkout; these helpers decide which one, regardless of which folder the
 * editor window happens to have open.
 */
import * as path from "node:path";

export interface FsLike {
  exists(p: string): boolean;
  read(p: string): string;
}

/** A directory is a framework checkout if its package.json names it and it has the agent specs. */
export function isFrameworkHome(dir: string, fs: FsLike): boolean {
  try {
    const pkg = JSON.parse(fs.read(path.join(dir, "package.json"))) as { name?: string };
    return pkg.name === "revab-agents" && fs.exists(path.join(dir, "prompts", "agents"));
  } catch {
    return false;
  }
}

export type HomeResolution =
  | { home: string; source: "setting" | "workspace"; problem?: undefined }
  | { home?: undefined; source: "none"; problem?: string };

/** The `revab.home` setting wins; otherwise the first open folder that is itself a checkout. */
export function resolveHome(input: {
  configured: string | undefined;
  workspaceFolders: string[];
  fs: FsLike;
}): HomeResolution {
  const configured = input.configured?.trim();
  if (configured) {
    if (isFrameworkHome(configured, input.fs)) return { home: configured, source: "setting" };
    return {
      source: "none",
      problem: `revab.home is set to "${configured}", but that is not a revab-agents checkout (no package.json named revab-agents with prompts/agents).`,
    };
  }
  for (const folder of input.workspaceFolders) {
    if (isFrameworkHome(folder, input.fs)) return { home: folder, source: "workspace" };
  }
  return { source: "none" };
}

export interface Launch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * How to start the gateway: the compiled CLI if `npm run build` has been run, otherwise the
 * TypeScript sources through tsx. Plain `node` with no shell and no `npx`, so paths with
 * spaces work and nothing is downloaded at launch. `process.execPath` is deliberately not
 * used: inside the editor it is the editor binary, not node.
 */
export function gatewayLaunch(home: string, port: number, fs: FsLike, nodePath = "node"): Launch {
  const env = { GATEWAY_MCP_PORT: String(port) };
  const dist = path.join(home, "dist", "cli", "index.js");
  if (fs.exists(dist)) return { command: nodePath, args: [dist, "start"], cwd: home, env };
  if (fs.exists(path.join(home, "node_modules", "tsx"))) {
    return { command: nodePath, args: ["--import", "tsx", path.join(home, "cli", "index.ts"), "start"], cwd: home, env };
  }
  throw new Error(`Dependencies are not installed in ${home}. Run \`npm install\` there, then start the gateway again.`);
}

/** Where the extension keeps the running gateway's pid and log, inside the checkout. */
export function runtimePaths(home: string): { dir: string; pid: string; log: string } {
  const dir = path.join(home, ".revab");
  return { dir, pid: path.join(dir, "gateway.pid"), log: path.join(dir, "gateway.log") };
}

export function parsePid(text: string | undefined): number | undefined {
  const n = Number((text ?? "").trim());
  return Number.isInteger(n) && n > 1 ? n : undefined;
}

/** The last few non-empty lines of a log, for an error message. */
export function tailLines(text: string, count = 6): string {
  return text.split(/\r?\n/).filter((l) => l.trim()).slice(-count).join("\n");
}
