import { env, optionalEnv } from "./config.js";

/**
 * Auth headers for Atlassian REST APIs.
 * - basic  (Cloud): email + API token
 * - bearer (Server/DC): Personal Access Token
 */
export function authHeaders(): Record<string, string> {
  const mode = optionalEnv("ATLASSIAN_AUTH_MODE") ?? "basic";
  if (mode === "bearer") {
    return { Authorization: `Bearer ${env("ATLASSIAN_API_TOKEN")}` };
  }
  const credentials = Buffer.from(
    `${env("ATLASSIAN_EMAIL")}:${env("ATLASSIAN_API_TOKEN")}`
  ).toString("base64");
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

/** Parse a JSON response, throwing a descriptive error on non-2xx status. */
export async function handleJson<T>(res: Response, url: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\n${body.slice(0, 2000)}`);
  }
  return (await res.json()) as T;
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
