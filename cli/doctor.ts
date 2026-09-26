/**
 * `revab doctor` — find configuration problems before they become "the agent is broken".
 *
 * Runs the pure env checks from `utils/doctor.ts`, then adds the live probes that
 * need IO: is a `.env` present, is the gateway up, and does each manifest project's
 * repo path actually exist on this machine. Prints one report with a concrete fix per
 * finding, and exits non-zero on any failure so it can gate CI or an onboarding script.
 */
import { promises as fs } from "fs";
import path from "path";
import {
  overallStatus,
  runEnvChecks,
  type CheckResult,
  type CheckStatus,
} from "../utils/doctor.js";

export interface DoctorOptions {
  json?: boolean;
  cwd?: string;
}

const MARK: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

async function checkEnvFile(root: string): Promise<CheckResult> {
  const target = path.join(root, ".env");
  const present = await fs.access(target).then(() => true).catch(() => false);
  return present
    ? { name: ".env", status: "ok", detail: "present" }
    : {
        name: ".env",
        status: "fail",
        detail: "not found — every credential and base URL comes from it",
        fix: "Run `revab init` (copies .env.example), then fill it in.",
      };
}

/** Probe the gateway. Not running is a warning, not a failure — doctor often runs first. */
async function checkGateway(port: number): Promise<CheckResult> {
  const url = `http://127.0.0.1:${port}/health`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      return { name: "gateway", status: "warn", detail: `responded HTTP ${res.status}`, fix: "Restart with `revab start`." };
    }
    const body = (await res.json()) as { tools?: number };
    return { name: "gateway", status: "ok", detail: `up on :${port} with ${body.tools ?? "?"} tools` };
  } catch {
    return {
      name: "gateway",
      status: "warn",
      detail: `not reachable on :${port}`,
      fix: "Start it with `revab start` (only needed when you actually want to use the tools).",
    };
  }
}

/**
 * Verify each manifest project resolves to a real directory — the trust boundary is
 * only useful if what it points at exists.
 */
async function checkProjects(root: string): Promise<CheckResult[]> {
  const indexPath = path.join(root, "projects", "manifest.json");
  const raw = await fs.readFile(indexPath, "utf8").catch(() => null);
  if (!raw) {
    return [
      {
        name: "projects",
        status: "warn",
        detail: "no projects/manifest.json — no target project is configured yet",
        fix: "Run `revab init`, then add your project under projects/<name>/.",
      },
    ];
  }

  let names: string[];
  try {
    const parsed = JSON.parse(raw) as { projects?: unknown };
    // The index holds `{ "name": "my-project" }` entries (see ProjectSchema in
    // utils/manifest.ts); bare strings are tolerated for hand-edited files.
    names = Array.isArray(parsed.projects)
      ? parsed.projects
          .map((entry) =>
            typeof entry === "string" ? entry : (entry as { name?: unknown } | null)?.name,
          )
          .filter((n): n is string => typeof n === "string" && n.length > 0)
      : [];
  } catch {
    return [
      {
        name: "projects",
        status: "fail",
        detail: "projects/manifest.json is not valid JSON",
        fix: "Fix the JSON — the manifest is the trust boundary for every file/shell operation.",
      },
    ];
  }

  const results: CheckResult[] = [];
  for (const name of names) {
    const configPath = path.join(root, "projects", name, "project.json");
    const configRaw = await fs.readFile(configPath, "utf8").catch(() => null);
    if (!configRaw) {
      results.push({
        name: `project:${name}`,
        status: "fail",
        detail: `listed in the manifest but projects/${name}/project.json is missing`,
        fix: `Create projects/${name}/project.json, or remove "${name}" from projects/manifest.json.`,
      });
      continue;
    }
    let repoPath: string | undefined;
    let repoUrl: string | undefined;
    try {
      const cfg = JSON.parse(configRaw) as { projects?: Array<{ repoPath?: string; repoUrl?: string }> };
      const entry = cfg.projects?.[0];
      repoPath = entry?.repoPath;
      repoUrl = entry?.repoUrl;
    } catch {
      results.push({
        name: `project:${name}`,
        status: "fail",
        detail: `projects/${name}/project.json is not valid JSON`,
        fix: "Fix the JSON so the manifest can resolve this project.",
      });
      continue;
    }

    if (!repoPath && !repoUrl) {
      results.push({
        name: `project:${name}`,
        status: "fail",
        detail: "neither repoPath nor repoUrl is set",
        fix: `Set one in projects/${name}/project.json — nothing can run without a target repo.`,
      });
      continue;
    }
    if (repoPath) {
      const resolved = path.resolve(root, repoPath);
      const present = await fs.stat(resolved).then((s) => s.isDirectory()).catch(() => false);
      results.push(
        present
          ? { name: `project:${name}`, status: "ok", detail: resolved }
          : {
              name: `project:${name}`,
              status: "fail",
              detail: `repoPath does not exist: ${resolved}`,
              fix: `Fix repoPath in projects/${name}/project.json, or use repoUrl to clone on demand.`,
            },
      );
      continue;
    }
    results.push({ name: `project:${name}`, status: "ok", detail: `clone-on-demand from ${repoUrl}` });
  }
  return results;
}

/** Run every check. Returns true when nothing failed (warnings are acceptable). */
export async function runDoctor(options: DoctorOptions = {}): Promise<boolean> {
  const root = options.cwd ?? process.cwd();

  const results: CheckResult[] = [
    await checkEnvFile(root),
    ...runEnvChecks(process.env),
    ...(await checkProjects(root)),
    await checkGateway(Number(process.env.GATEWAY_MCP_PORT ?? 7300)),
  ];

  const status = overallStatus(results);

  if (options.json) {
    console.log(JSON.stringify({ status, checks: results }, null, 2));
    return status !== "fail";
  }

  console.log("revab doctor\n");
  const width = Math.max(...results.map((r) => r.name.length));
  for (const result of results) {
    console.log(`  ${MARK[result.status]} ${result.name.padEnd(width)}  ${result.detail}`);
    if (result.fix) console.log(`      → ${result.fix}`);
  }

  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;
  console.log(
    `\n${failed} failing, ${warned} warning, ${results.length - failed - warned} ok.` +
      (failed ? "\nFix the failures above — the agents cannot work around missing configuration." : ""),
  );
  return status !== "fail";
}
