/**
 * `revab init` — get a teammate from clone to running without reading the README.
 *
 * Scaffolds the three things that are otherwise manual and easy to get subtly wrong:
 * a `.env` seeded from `.env.example`, the gateway registered in `.vscode/mcp.json`
 * (one entry instead of twelve), and a project folder to copy. Never overwrites an
 * existing file unless `--force` is passed — a clobbered `.env` costs real credentials.
 */
import { promises as fs } from "fs";
import path from "path";

export interface InitOptions {
  force?: boolean;
  cwd?: string;
}

type Outcome = "created" | "skipped" | "updated";

function report(outcome: Outcome, target: string, note?: string): void {
  const mark = outcome === "skipped" ? "·" : "✓";
  console.log(`  ${mark} ${outcome.padEnd(7)} ${target}${note ? ` — ${note}` : ""}`);
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true).catch(() => false);
}

/** Seed `.env` from `.env.example` so every knob is present and documented. */
async function ensureEnv(root: string, force: boolean): Promise<void> {
  const target = path.join(root, ".env");
  const example = path.join(root, ".env.example");
  if ((await exists(target)) && !force) {
    report("skipped", ".env", "already exists (use --force to overwrite)");
    return;
  }
  if (!(await exists(example))) {
    report("skipped", ".env", "no .env.example found to copy");
    return;
  }
  await fs.copyFile(example, target);
  report("created", ".env", "fill in base URLs and tokens, then run `revab doctor`");
}

/**
 * Register the gateway in `.vscode/mcp.json`. Existing per-server entries are left
 * alone — they still work, and removing another developer's config isn't init's call.
 */
async function ensureMcpConfig(root: string, port: number): Promise<void> {
  const target = path.join(root, ".vscode", "mcp.json");
  const gateway = { type: "http", url: `http://localhost:${port}/mcp` };
  // The official @playwright/mcp browser server is NOT hosted by our gateway, so it
  // needs its own entry (started by `npm run serve:playwright`).
  const playwright = { type: "http", url: "http://localhost:7315/mcp" };

  if (!(await exists(target))) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      JSON.stringify({ servers: { gateway, playwright } }, null, 2) + "\n",
      "utf8",
    );
    report("created", ".vscode/mcp.json", "gateway + playwright registered");
    return;
  }

  const raw = await fs.readFile(target, "utf8");
  let config: { servers?: Record<string, unknown> };
  try {
    config = JSON.parse(raw) as { servers?: Record<string, unknown> };
  } catch {
    report("skipped", ".vscode/mcp.json", "existing file is not valid JSON — fix it, then re-run");
    return;
  }
  config.servers ??= {};
  if (config.servers.gateway) {
    report("skipped", ".vscode/mcp.json", "gateway already registered");
    return;
  }
  config.servers = { gateway, ...config.servers };
  await fs.writeFile(target, JSON.stringify(config, null, 2) + "\n", "utf8");
  report("updated", ".vscode/mcp.json", "gateway added alongside existing entries");
}

/** Ensure the manifest index exists so the trust boundary has something to resolve. */
async function ensureManifest(root: string): Promise<void> {
  const target = path.join(root, "projects", "manifest.json");
  if (await exists(target)) {
    report("skipped", "projects/manifest.json", "already exists");
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Entries are objects, matching ProjectSchema in utils/manifest.ts — a bare string
  // array fails validation and would leave a new checkout unable to resolve anything.
  await fs.writeFile(
    target,
    JSON.stringify({ projects: [{ name: "my-project" }] }, null, 2) + "\n",
    "utf8",
  );
  report("created", "projects/manifest.json", "add your project entries here");
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const port = Number(process.env.GATEWAY_MCP_PORT ?? 7300);

  console.log("revab init\n");
  await ensureEnv(root, options.force ?? false);
  await ensureMcpConfig(root, port);
  await ensureManifest(root);

  console.log(`
Next:
  1. Fill in .env — base URLs and one token per service (or a shared ATLASSIAN token).
  2. revab doctor          verify the configuration before blaming the agents.
  3. revab start           run the gateway (all tools, MCP + REST, one process).
  4. Add your project under projects/<name>/ and list it in projects/manifest.json.
`);
}
