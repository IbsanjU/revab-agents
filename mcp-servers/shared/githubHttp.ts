import { env, intEnv, optionalEnv } from "./config.js";
import { buildUrl, handleJson, type QueryParams } from "./http.js";

/**
 * GitHub REST API client -- separate auth from Atlassian's `authHeaders()` in http.ts
 * (GitHub uses a single PAT/App token, not basic/bearer email+token), but reuses the
 * same `buildUrl`/`handleJson` request plumbing.
 * Works against github.com by default; set GITHUB_API_BASE_URL for GitHub Enterprise
 * Server (e.g. `https://github.your-org.com/api/v3`).
 */
export const githubBase = () => optionalEnv("GITHUB_API_BASE_URL") ?? "https://api.github.com";

/** Default org to scope searches to when a call doesn't specify one (optional). */
export const defaultGithubOrg = () => optionalEnv("GITHUB_ORG");

function githubAuthHeaders(accept: string): Record<string, string> {
  const token = env("GITHUB_TOKEN");
  const authScheme = "Bearer";
  return {
    Authorization: [authScheme, token].join(" "),
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** GET a JSON resource from the GitHub REST/Search API. */
export async function githubGet<T = unknown>(
  path: string,
  params?: QueryParams,
  accept: string = "application/vnd.github+json"
): Promise<T> {
  const url = buildUrl(githubBase(), path, params);
  const res = await fetch(url, { headers: githubAuthHeaders(accept) });
  return handleJson<T>(res, url);
}

export const githubMcpPort = () => intEnv("GITHUB_MCP_PORT", 7320);
