/**
 * Environment diagnostics — the checks `revab doctor` runs.
 *
 * Most "the agents are broken" reports are really configuration problems: a missing
 * base URL, a token for the wrong service, a stale port, a target project whose
 * checkout has moved. Those fail deep inside a tool call as an opaque HTTP error,
 * which is exactly the situation where an agent starts guessing. This module turns
 * them into one up-front report naming the variable and the fix.
 *
 * Kept pure and IO-light (env in, results out) so every rule is unit-testable;
 * `cli/doctor.ts` does the printing and the live port/health probes.
 */

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  /** What was found. */
  detail: string;
  /** Present when not ok: the concrete next action. */
  fix?: string;
}

export type Env = Record<string, string | undefined>;

const REQUIRED_NODE_MAJOR = 20;

export function checkNodeVersion(version: string = process.version): CheckResult {
  const major = Number(/^v(\d+)/.exec(version)?.[1] ?? 0);
  if (major >= REQUIRED_NODE_MAJOR) {
    return { name: "node", status: "ok", detail: `${version} (>= ${REQUIRED_NODE_MAJOR} required)` };
  }
  return {
    name: "node",
    status: "fail",
    detail: `${version} is older than the required v${REQUIRED_NODE_MAJOR}`,
    fix: `Install Node ${REQUIRED_NODE_MAJOR}+ (see "engines" in package.json).`,
  };
}

/** Services that authenticate independently, each with its own token fallback chain. */
export const AUTH_SERVICES = ["JIRA", "CONFLUENCE", "JTMF"] as const;
export type AuthService = (typeof AUTH_SERVICES)[number];

/**
 * Resolve one service's auth exactly as `mcp-servers/shared/http.ts` does, so the
 * report matches runtime behavior instead of restating the documentation.
 */
export function checkServiceAuth(service: AuthService, env: Env): CheckResult {
  const token = env[`${service}_API_TOKEN`] || env.ATLASSIAN_API_TOKEN;
  const email = env[`${service}_EMAIL`] || env.ATLASSIAN_EMAIL;
  const explicitMode = env[`${service}_AUTH_MODE`] || env.ATLASSIAN_AUTH_MODE;
  const name = `${service.toLowerCase()} auth`;

  if (!token) {
    return {
      name,
      status: "fail",
      detail: "no API token configured",
      fix: `Set ${service}_API_TOKEN (per-service, recommended) or ATLASSIAN_API_TOKEN in .env.`,
    };
  }
  if (explicitMode && explicitMode !== "basic" && explicitMode !== "bearer") {
    return {
      name,
      status: "fail",
      detail: `invalid auth mode "${explicitMode}"`,
      fix: `Set ${service}_AUTH_MODE to "basic" (Cloud: email + token) or "bearer" (Server/DC: PAT), or unset it to infer.`,
    };
  }
  const mode = explicitMode ?? (email ? "basic" : "bearer");
  if (mode === "basic" && !email) {
    return {
      name,
      status: "fail",
      detail: "basic auth selected but no email configured",
      fix: `Set ${service}_EMAIL, or use a Personal Access Token (leave email unset to infer bearer).`,
    };
  }
  const source = env[`${service}_API_TOKEN`] ? "per-service token" : "shared ATLASSIAN token";
  return { name, status: "ok", detail: `${mode} via ${source}` };
}

/** Base URLs each server needs before it can make a single call. */
export function checkBaseUrls(env: Env): CheckResult[] {
  const required: Array<{ key: string; usedBy: string }> = [
    { key: "JIRA_BASE_URL", usedBy: "jira, jtmf" },
    { key: "CONFLUENCE_BASE_URL", usedBy: "confluence" },
  ];
  return required.map(({ key, usedBy }) => {
    const value = env[key];
    if (!value) {
      return {
        name: key.toLowerCase(),
        status: "fail" as const,
        detail: `not set — required by ${usedBy}`,
        fix: `Set ${key} in .env (e.g. https://your-org.atlassian.net).`,
      };
    }
    if (!/^https?:\/\//.test(value)) {
      return {
        name: key.toLowerCase(),
        status: "fail" as const,
        detail: `"${value}" is not an http(s) URL`,
        fix: `${key} must start with https:// — a bare host will fail every call.`,
      };
    }
    if (value.includes("your-org")) {
      return {
        name: key.toLowerCase(),
        status: "warn" as const,
        detail: `"${value}" still looks like the .env.example placeholder`,
        fix: `Replace ${key} with your real instance URL.`,
      };
    }
    return { name: key.toLowerCase(), status: "ok" as const, detail: value };
  });
}

/** Optional integrations — absent is fine, half-configured is not. */
export function checkOptionalIntegrations(env: Env): CheckResult[] {
  const results: CheckResult[] = [];

  if (!env.GITHUB_TOKEN) {
    results.push({
      name: "github auth",
      status: "warn",
      detail: "GITHUB_TOKEN unset — github_* tools fall back to the `gh` CLI session",
      fix: "Run `gh auth login`, or set GITHUB_TOKEN (required for GitHub Enterprise Server).",
    });
  } else {
    results.push({ name: "github auth", status: "ok", detail: "GITHUB_TOKEN set" });
  }

  const graph = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"];
  const graphSet = graph.filter((k) => env[k]);
  if (graphSet.length && graphSet.length < graph.length) {
    results.push({
      name: "email (graph)",
      status: "fail",
      detail: `partially configured — missing ${graph.filter((k) => !env[k]).join(", ")}`,
      fix: "Set every GRAPH_* var, or unset them all to fall back to SMTP.",
    });
  }

  return results;
}

/** A .env that still contains example placeholders will fail confusingly at runtime. */
export function checkPlaceholders(env: Env): CheckResult[] {
  const suspects: Array<[string, string]> = [
    ["JIRA_API_TOKEN", "jira-service-account-token"],
    ["CONFLUENCE_API_TOKEN", "confluence-service-account-token"],
    ["JTMF_API_TOKEN", "jtmf-service-account-token"],
    ["ATLASSIAN_API_TOKEN", "your-token-here"],
    ["GITHUB_TOKEN", "your-github-token-here"],
  ];
  return suspects
    .filter(([key, placeholder]) => env[key] === placeholder)
    .map(([key]) => ({
      name: key.toLowerCase(),
      status: "fail" as const,
      detail: "still set to the .env.example placeholder value",
      fix: `Replace ${key} with a real credential (or unset it if that service is unused).`,
    }));
}

/** Run every env-only check. Live probes (ports, health) are added by the CLI. */
export function runEnvChecks(env: Env): CheckResult[] {
  return [
    checkNodeVersion(),
    ...checkBaseUrls(env),
    ...AUTH_SERVICES.map((s) => checkServiceAuth(s, env)),
    ...checkPlaceholders(env),
    ...checkOptionalIntegrations(env),
  ];
}

/** `fail` if anything failed, else `warn` if anything warned, else `ok`. */
export function overallStatus(results: CheckResult[]): CheckStatus {
  if (results.some((r) => r.status === "fail")) return "fail";
  if (results.some((r) => r.status === "warn")) return "warn";
  return "ok";
}
