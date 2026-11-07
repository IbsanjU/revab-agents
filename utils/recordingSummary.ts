/**
 * Summarize one playwright-playbook session recording (`.playwright-recorder/<session>/`) for failure
 * analysis. Recordings hold sensitive data (typed values, headers, bodies, cookies), so this reads
 * only what failure analysis needs and deliberately leaves the rest out:
 *
 *   used:     manifest.json, network.ndjson, browser-events.ndjson, interactions.ndjson
 *   never:    request/response headers and bodies, typed values, storage-state.json, the HAR, the trace
 *
 * URLs are reduced to origin + path (no query string, which often carries tokens) and console text is
 * truncated and scrubbed of token-shaped strings.
 */
import { promises as fs } from "fs";
import path from "path";

export interface RecordingSummary {
  session: { status: string; startedAt?: string; endedAt?: string; error?: string; counts: Record<string, number> };
  network: { total: number; failed: Array<{ method: string; url: string; status?: number; failure?: string; count: number }>; bodiesSkipped: Record<string, number> };
  console: { errors: Array<{ text: string; count: number }>; warnings: number };
  webErrors: string[];
  pageCrashes: number;
  interactions: { total: number; byType: Record<string, number>; last: Array<{ type: string; target?: string; page?: string }> };
  /** Things that make this recording less trustworthy as evidence. */
  caveats: string[];
}

const MAX_LINES = 200_000;
const TEXT_LIMIT = 200;

/** Scrub token-shaped strings; truncate. */
export function scrub(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hex]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEXT_LIMIT);
}

/** origin + path only: query strings and fragments often carry tokens. */
export function stripUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0].slice(0, TEXT_LIMIT);
  }
}

async function readNdjson(file: string): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; missing: boolean }> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return { rows: [], truncated: false, missing: true };
  }
  const lines = text.split("\n");
  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(0, MAX_LINES)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* a partially written last line from a killed session is expected */
    }
  }
  return { rows, truncated: lines.length > MAX_LINES, missing: false };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export async function summarizeRecording(dir: string): Promise<RecordingSummary> {
  const caveats: string[] = [];
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
  } catch {
    caveats.push("manifest.json is missing or unreadable, so the session status is unknown");
  }
  const counts = (manifest.counts as Record<string, number> | undefined) ?? {};
  const status = str(manifest.status) ?? "unknown";
  if (status !== "complete") caveats.push(`session status is \`${status}\`, not complete: it may be missing its end`);
  if ((counts["write-error"] ?? 0) > 0) caveats.push(`${counts["write-error"]} event(s) failed to write: the recording has gaps`);

  const [net, ev, ia] = await Promise.all([
    readNdjson(path.join(dir, "network.ndjson")),
    readNdjson(path.join(dir, "browser-events.ndjson")),
    readNdjson(path.join(dir, "interactions.ndjson")),
  ]);
  for (const [name, r] of [["network.ndjson", net], ["browser-events.ndjson", ev], ["interactions.ndjson", ia]] as const) {
    if (r.missing) caveats.push(`${name} is missing`);
    if (r.truncated) caveats.push(`${name} was cut at ${MAX_LINES} lines`);
  }

  const failedMap = new Map<string, RecordingSummary["network"]["failed"][number]>();
  const bodiesSkipped: Record<string, number> = {};
  for (const e of net.rows) {
    const status = num(e.status);
    const failure = str(e.failure);
    const skipped = str(e.responseBodySkipped);
    if (skipped) bodiesSkipped[skipped] = (bodiesSkipped[skipped] ?? 0) + 1;
    if (failure || (status !== undefined && status >= 400)) {
      const url = stripUrl(str(e.url) ?? "");
      const method = str(e.method) ?? "?";
      const key = `${method} ${url} ${status ?? ""} ${failure ?? ""}`;
      const cur = failedMap.get(key);
      if (cur) cur.count++;
      else failedMap.set(key, { method, url, status, failure: failure ? scrub(failure) : undefined, count: 1 });
    }
  }
  const failed = [...failedMap.values()].sort((a, b) => b.count - a.count).slice(0, 20);

  const errorMap = new Map<string, number>();
  let warnings = 0;
  const webErrors: string[] = [];
  let pageCrashes = 0;
  for (const e of ev.rows) {
    const type = str(e.type);
    if (type === "console") {
      const level = str(e.level);
      if (level === "error") {
        const t = scrub(str(e.text) ?? "");
        errorMap.set(t, (errorMap.get(t) ?? 0) + 1);
      } else if (level === "warning") warnings++;
    } else if (type === "web-error") {
      if (webErrors.length < 5) webErrors.push(scrub((str(e.error) ?? "").split("\n")[0]));
    } else if (type === "page-crashed") pageCrashes++;
  }
  const errors = [...errorMap].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 10);

  const byType: Record<string, number> = {};
  for (const e of ia.rows) {
    const t = str(e.type) ?? "?";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  // Last actions only name the element (accessible name / text / tag). Typed values live in `data` and are never read.
  const last = ia.rows.slice(-5).map((e) => {
    const t = (e.target ?? {}) as Record<string, unknown>;
    const name = str(t.accessibleName) ?? str(t.text) ?? str(t.tagName);
    return { type: str(e.type) ?? "?", target: name ? scrub(name).slice(0, 60) : undefined, page: str(e.frameUrl) ? stripUrl(str(e.frameUrl)!) : undefined };
  });

  return {
    session: { status, startedAt: str(manifest.startedAt), endedAt: str(manifest.endedAt), error: str(manifest.error) ? scrub(str(manifest.error)!) : undefined, counts },
    network: { total: net.rows.length, failed, bodiesSkipped },
    console: { errors, warnings },
    webErrors,
    pageCrashes,
    interactions: { total: ia.rows.length, byType, last },
    caveats,
  };
}

/** The recording directory inside `base`: `base` itself if it holds a manifest, else its newest session. */
export async function findRecordingDir(base: string): Promise<string | null> {
  const has = async (d: string) => fs.stat(path.join(d, "manifest.json")).then((s) => s.mtimeMs, () => null);
  if ((await has(base)) !== null) return base;
  let entries: string[];
  try {
    entries = await fs.readdir(base);
  } catch {
    return null;
  }
  let best: { dir: string; t: number } | null = null;
  for (const name of entries) {
    const d = path.join(base, name);
    const t = await has(d);
    if (t !== null && (!best || t > best.t)) best = { dir: d, t };
  }
  return best?.dir ?? null;
}
