import { optionalEnv } from "./config.js";

export type AtlassianService = "jira" | "confluence" | "jtmf";

// Set once per process at server startup (see setAuthService below) — each of the jira/
// confluence/jtmf MCP servers is its own Node process, so this is never shared or mutated
// across services at runtime, just read by every authHeaders()/apiGet/... call after startup.
let currentService: AtlassianService | undefined;

/**
 * Declare which service (jira/confluence/jtmf) this process's HTTP calls authenticate as.
 * Call once at server startup, before any request handling — every MCP server's index.ts
 * does this immediately after its imports. Lets each service use its own token (a separate,
 * least-privilege service account) instead of one shared Atlassian credential.
 */
export function setAuthService(service: AtlassianService): void {
  currentService = service;
}

export type AuthMode = "basic" | "bearer";

/**
 * Resolve mode/email/token for the service set via setAuthService, preferring a
 * per-service override (a JIRA_, CONFLUENCE_, or JTMF_ prefixed var) and falling back to
 * the shared ATLASSIAN_ prefixed vars so a single-token .env setup keeps working unchanged.
 *
 * Auth mode: an explicit `<SERVICE>_AUTH_MODE` (or shared `ATLASSIAN_AUTH_MODE`) always wins.
 * When none is set, the mode is inferred from what's configured — a per-platform Personal
 * Access Token is used as the fallback:
 *   - email + token present  -> "basic"  (Cloud: email + API token)
 *   - token only (no email)  -> "bearer" (Server / Data Center: Personal Access Token)
 * So a PAT-only .env authenticates via bearer without also having to set AUTH_MODE, while
 * every existing basic (email + token) setup keeps resolving to basic exactly as before.
 */
function resolveAuthConfig(): { mode: AuthMode; token: string; email?: string } {
  if (!currentService) {
    throw new Error(
      "No Atlassian service configured for this process — call setAuthService('jira'|'confluence'|'jtmf') at server startup before making any request."
    );
  }
  const prefix = currentService.toUpperCase();
  const token = optionalEnv(`${prefix}_API_TOKEN`) ?? optionalEnv("ATLASSIAN_API_TOKEN");
  if (!token) {
    throw new Error(
      `Missing API token for "${currentService}": set ${prefix}_API_TOKEN (per-service, recommended) or ATLASSIAN_API_TOKEN (shared fallback) in .env.`
    );
  }
  const email = optionalEnv(`${prefix}_EMAIL`) ?? optionalEnv("ATLASSIAN_EMAIL");

  const explicitMode = optionalEnv(`${prefix}_AUTH_MODE`) ?? optionalEnv("ATLASSIAN_AUTH_MODE");
  if (explicitMode && explicitMode !== "basic" && explicitMode !== "bearer") {
    throw new Error(
      `Invalid auth mode "${explicitMode}" for "${currentService}": set ${prefix}_AUTH_MODE (or ATLASSIAN_AUTH_MODE) to "basic" (Cloud: email + API token) or "bearer" (Server/DC: Personal Access Token).`
    );
  }
  // No explicit mode -> infer, preferring a per-platform PAT (bearer) when no email is set.
  const mode: AuthMode = (explicitMode as AuthMode | undefined) ?? (email ? "basic" : "bearer");

  if (mode === "bearer") return { mode, token };
  if (!email) {
    throw new Error(
      `Missing email for "${currentService}" (basic auth mode): set ${prefix}_EMAIL (per-service) or ATLASSIAN_EMAIL (shared fallback) in .env — or use a Personal Access Token by setting ${prefix}_AUTH_MODE=bearer (bearer is also inferred automatically when no email is configured).`
    );
  }
  return { mode, token, email };
}

/**
 * Auth headers for the Atlassian REST API of whichever service this process declared via
 * setAuthService.
 * - basic  (Cloud): email + API token
 * - bearer (Server/DC): Personal Access Token
 */
export function authHeaders(): Record<string, string> {
  const { mode, token, email } = resolveAuthConfig();
  if (mode === "bearer") {
    return { Authorization: `Bearer ${token}` };
  }
  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${credentials}` };
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

/** Join a base URL + path and append query params. Shared across all HTTP-backed MCP servers. */
export function buildUrl(baseUrl: string, path: string, params?: QueryParams): string {
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Parse a JSON response, throwing a descriptive error on non-2xx status. Tolerates a 204/empty body. */
export async function handleJson<T>(res: Response, url: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\n${body.slice(0, 2000)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** GET a JSON resource from an authenticated Atlassian API. */
export async function apiGet<T = unknown>(baseUrl: string, path: string, params?: QueryParams): Promise<T> {
  const url = buildUrl(baseUrl, path, params);
  const res = await fetch(url, { headers: { ...authHeaders(), Accept: "application/json" } });
  return handleJson<T>(res, url);
}

/** POST a JSON body to an authenticated Atlassian API. */
export async function apiPost<T = unknown>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const url = buildUrl(baseUrl, path);
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleJson<T>(res, url);
}

/** PUT a JSON body to an authenticated Atlassian API. Many Jira update endpoints return 204 No Content. */
export async function apiPut(baseUrl: string, path: string, body: unknown): Promise<{ status: number }> {
  const url = buildUrl(baseUrl, path);
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(), Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\n${responseBody.slice(0, 2000)}`);
  }
  return { status: res.status };
}

/** DELETE a resource from an authenticated Atlassian API. Many delete endpoints return 204 No Content. */
export async function apiDelete(baseUrl: string, path: string): Promise<{ status: number }> {
  const url = buildUrl(baseUrl, path);
  const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\n${responseBody.slice(0, 2000)}`);
  }
  return { status: res.status };
}

/** GET a binary resource (attachment download). Returns a Buffer. */
export async function apiGetBinary(baseUrl: string, path: string, params?: QueryParams): Promise<Buffer> {
  const url = buildUrl(baseUrl, path, params);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Crude HTML -> plain text conversion (good enough for Confluence storage bodies). */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
