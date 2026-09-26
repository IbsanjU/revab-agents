import { spawn } from "child_process";
import { env, intEnv, optionalEnv } from "./config.js";
import { buildUrl, handleJson, type QueryParams } from "./http.js";

/**
 * GitHub REST API client -- separate auth from Atlassian's `authHeaders()` in http.ts
 * (GitHub uses a single PAT/App token, not basic/bearer email+token), but reuses the
 * same `buildUrl`/`handleJson` request plumbing.
 * Works against github.com by default; set GITHUB_API_BASE_URL for GitHub Enterprise
 * Server (e.g. `https://github.your-org.com/api/v3`).
 *
 * Auth fallback: if `GITHUB_TOKEN` isn't configured, requests fall back to the `gh` CLI
 * (see `ghApiFallback` below), which uses whatever session the user already has from
 * `gh auth login` — nothing to put in `.env`. The fallback only reaches github.com, not
 * GitHub Enterprise Server; configure `GITHUB_TOKEN` for GHES.
 */
export const githubBase = () => optionalEnv("GITHUB_API_BASE_URL") ?? "https://api.github.com";

/** Default org to scope searches to when a call doesn't specify one (optional). */
export const defaultGithubOrg = () => optionalEnv("GITHUB_ORG");

/** True when a GITHUB_TOKEN is configured — the normal, preferred auth path. */
export function hasGithubToken(): boolean {
  return Boolean(optionalEnv("GITHUB_TOKEN"));
}

function githubAuthHeaders(accept: string): Record<string, string> {
  const token = env("GITHUB_TOKEN");
  const authScheme = "Bearer";
  return {
    Authorization: [authScheme, token].join(" "),
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Run the `gh` binary directly (argv array, shell:false) — no shell interpolation of query text. */
function runGh(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// Cached for the lifetime of this process — avoids re-checking `gh auth status` on every call.
let ghReadyCache: boolean | undefined;

/** One-time check that `gh` is installed and has an authenticated session. */
async function ghCliReady(): Promise<boolean> {
  if (ghReadyCache !== undefined) return ghReadyCache;
  try {
    const result = await runGh(["auth", "status"]);
    ghReadyCache = result.code === 0;
  } catch {
    ghReadyCache = false; // `gh` not installed / not on PATH
  }
  return ghReadyCache;
}

/**
 * Fallback path used only when GITHUB_TOKEN is absent: shell out to `gh api <endpoint>`,
 * which authenticates with whatever session `gh auth login` already set up locally. This
 * keeps GitHub search/read tools working on a machine that has the GitHub CLI logged in
 * but no PAT configured in .env.
 */
async function ghApiFallback<T>(path: string, params: QueryParams | undefined, accept: string): Promise<T> {
  const ready = await ghCliReady();
  if (!ready) {
    throw new Error(
      "GITHUB_TOKEN is not set, and the `gh` CLI fallback isn't available (either `gh` isn't " +
        "installed, or it has no authenticated session — run `gh auth login` in a terminal). " +
        "Set GITHUB_TOKEN in .env, or authenticate the GitHub CLI, to use GitHub search/read tools."
    );
  }
  const qs = Object.entries(params ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const endpoint = qs ? `${path}?${qs}` : path;
  const result = await runGh(["api", endpoint, "-H", `Accept: ${accept}`]);
  if (result.code !== 0) {
    throw new Error(`gh api ${endpoint} failed: ${result.stderr.trim() || "unknown error"}`);
  }
  return JSON.parse(result.stdout) as T;
}

/** GET a JSON resource from the GitHub REST/Search API — via a PAT, or the `gh` CLI fallback. */
export async function githubGet<T = unknown>(
  path: string,
  params?: QueryParams,
  accept: string = "application/vnd.github+json"
): Promise<T> {
  if (!hasGithubToken()) {
    return ghApiFallback<T>(path, params, accept);
  }
  const url = buildUrl(githubBase(), path, params);
  const res = await fetch(url, { headers: githubAuthHeaders(accept) });
  return handleJson<T>(res, url);
}

export const githubMcpPort = () => intEnv("GITHUB_MCP_PORT", 7320);

