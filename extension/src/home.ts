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
  /** Modification time of one file, in ms. */
  mtimeMs?(p: string): number;
  /** Newest modification time among the project's TypeScript sources, in ms. */
  newestSourceMtimeMs?(home: string): number;
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

export type Runtime =
  | { mode: "checkout"; home: string; source: "setting" | "workspace" }
  | { mode: "bundled"; home: string; bundle: string }
  | { mode: "none"; problem?: string };

/**
 * Where the gateway runs, in priority order:
 *  1. `revab.home`, when set (a bad value is reported, never silently replaced);
 *  2. an open folder that is itself a framework checkout;
 *  3. the extension's own bundled gateway and home folder, so no clone is needed.
 */
export function resolveRuntime(input: {
  configured: string | undefined;
  workspaceFolders: string[];
  /** The extension's own data folder for bundled mode. */
  bundledHome: string;
  /** Path of the bundled gateway file, or undefined when this build has none (a source checkout run from F5). */
  bundleFile: string | undefined;
  fs: FsLike;
}): Runtime {
  const checkout = resolveHome({ configured: input.configured, workspaceFolders: input.workspaceFolders, fs: input.fs });
  if (checkout.home) return { mode: "checkout", home: checkout.home, source: checkout.source };
  if (checkout.problem) return { mode: "none", problem: checkout.problem };
  if (input.bundleFile) return { mode: "bundled", home: input.bundledHome, bundle: input.bundleFile };
  return { mode: "none" };
}

/** Launch the bundled gateway: plain node on one file; the home folder is its working directory. */
export function bundledLaunch(bundle: string, home: string, port: number, nodePath = "node"): Launch {
  return { command: nodePath, args: [bundle, "start"], cwd: home, env: { GATEWAY_MCP_PORT: String(port) } };
}

export interface Launch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Why this launch was chosen, when that is worth telling the user (for example a stale build). */
  note?: string;
}

/** True when sources were edited after the compiled CLI was built, e.g. after a `git pull`. */
export function distIsStale(home: string, fs: FsLike): boolean {
  const dist = path.join(home, "dist", "cli", "index.js");
  if (!fs.mtimeMs || !fs.newestSourceMtimeMs || !fs.exists(dist)) return false;
  return fs.newestSourceMtimeMs(home) > fs.mtimeMs(dist);
}

/**
 * How to start the gateway: the compiled CLI if it is current, otherwise the TypeScript sources
 * through tsx. A stale build is skipped on purpose: after a `git pull` it would silently run the
 * old gateway, ignoring new settings such as disabled tools. Plain `node` with no shell and no `npx`, so paths with
 * spaces work and nothing is downloaded at launch. `process.execPath` is deliberately not
 * used: inside the editor it is the editor binary, not node.
 */
export function gatewayLaunch(home: string, port: number, fs: FsLike, nodePath = "node"): Launch {
  const env = { GATEWAY_MCP_PORT: String(port) };
  const dist = path.join(home, "dist", "cli", "index.js");
  const haveTsx = fs.exists(path.join(home, "node_modules", "tsx"));
  const fromSources: Launch = {
    command: nodePath,
    args: ["--import", "tsx", path.join(home, "cli", "index.ts"), "start"],
    cwd: home,
    env,
  };
  if (fs.exists(dist)) {
    if (!distIsStale(home, fs)) return { command: nodePath, args: [dist, "start"], cwd: home, env };
    if (haveTsx) return { ...fromSources, note: "dist/ is older than the sources, so the gateway runs from source. Run `npm run build` to use the compiled build." };
    return { command: nodePath, args: [dist, "start"], cwd: home, env, note: "dist/ is older than the sources and tsx is not installed; run `npm run build`." };
  }
  if (haveTsx) return fromSources;
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
