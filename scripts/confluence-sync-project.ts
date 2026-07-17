import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../mcp-servers/shared/config.js";
import { apiGet, apiGetBinary, setAuthService, stripHtml } from "../mcp-servers/shared/http.js";
import { getProject, resolveProjectArtifactsDir } from "../utils/manifest.js";

setAuthService("confluence");

type LinkRef = {
  url: string;
  isConfluence: boolean;
  targetPageId: string | null;
};

type AttachmentInfo = {
  id: string;
  title: string;
  mediaType?: string;
  sizeBytes?: number;
  version?: number;
  updatedAt?: string;
  downloadPath?: string;
};

type StoredPage = {
  pageId: string;
  title: string;
  spaceKey?: string;
  url?: string;
  version?: number;
  updatedAt?: string;
  fetchedAt?: string;
  sourceKind?: "root" | "descendant" | "linked";
  discoveredFrom?: string;
  links?: LinkRef[];
  attachments?: AttachmentInfo[];
  text?: string;
};

type SyncOptions = {
  project: string;
  rootPageId: string;
  incremental: boolean;
  maxPages: number;
  downloadAttachments: boolean;
  maxAttachmentBytes?: number;
  minAttachmentBytes?: number;
  attachmentMediaTypes: Set<string>;
  attachmentExtensions: Set<string>;
};

type AttachmentFilter = {
  maxAttachmentBytes?: number;
  minAttachmentBytes?: number;
  attachmentMediaTypes: Set<string>;
  attachmentExtensions: Set<string>;
};

type AttachmentDecision = {
  allowed: boolean;
  reason: string;
};

type SyncSummary = {
  project: string;
  rootPageId: string;
  generatedAt: string;
  incremental: boolean;
  pagesVisited: number;
  pagesUpdated: number;
  pagesSkippedUnchanged: number;
  pagesFailed: number;
  linksFound: number;
  mediaCataloged: number;
  attachmentsDownloaded: number;
  attachmentsSkipped: number;
  errors: Array<{ pageId: string; stage: string; error: string }>;
  unresolvedLinkedPageIds: string[];
};

function isMissingConfluencePageError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return lower.includes("http 404") || lower.includes("no content found with id");
}

async function downloadAttachmentIfAllowed(
  baseUrl: string,
  attachmentsDir: string,
  pageId: string,
  attachment: AttachmentInfo,
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  const decision = shouldDownloadAttachment(attachment, {
    maxAttachmentBytes: options.maxAttachmentBytes,
    minAttachmentBytes: options.minAttachmentBytes,
    attachmentMediaTypes: options.attachmentMediaTypes,
    attachmentExtensions: options.attachmentExtensions,
  });
  if (!decision.allowed) {
    summary.attachmentsSkipped += 1;
    return;
  }
  if (!attachment.downloadPath || !attachment.downloadPath.startsWith("/")) {
    summary.attachmentsSkipped += 1;
    return;
  }
  const pageAttachDir = path.join(attachmentsDir, pageId);
  await fs.mkdir(pageAttachDir, { recursive: true });
  const target = path.join(pageAttachDir, safeFileName(attachment.title));
  const existing = await fs.stat(target).catch(() => null);
  if (existing && attachment.sizeBytes !== undefined && existing.size === attachment.sizeBytes) {
    return;
  }
  const buf = await apiGetBinary(baseUrl, attachment.downloadPath);
  await fs.writeFile(target, buf);
  summary.attachmentsDownloaded += 1;
}

function parseArgs(argv: string[]): SyncOptions {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    i += 1;
  }

  const project = String(flags.get("project") ?? "").trim();
  const rootPageId = String(flags.get("rootPageId") ?? "").trim();
  if (!project) throw new Error("Missing required argument: --project <name>");
  if (!rootPageId) throw new Error("Missing required argument: --rootPageId <id>");

  return {
    project,
    rootPageId,
    incremental: !(flags.get("full") === true),
    maxPages: Number(flags.get("maxPages") ?? 300),
    downloadAttachments: flags.get("downloadAttachments") === true,
    maxAttachmentBytes: flags.get("maxAttachmentBytes") ? Number(flags.get("maxAttachmentBytes")) : undefined,
    minAttachmentBytes: flags.get("minAttachmentBytes") ? Number(flags.get("minAttachmentBytes")) : undefined,
    attachmentMediaTypes: splitSet(String(flags.get("attachmentMediaTypes") ?? "")),
    attachmentExtensions: splitSet(String(flags.get("attachmentExtensions") ?? ""), true),
  };
}

function splitSet(raw: string, isExtension = false): Set<string> {
  if (!raw.trim()) return new Set<string>();
  const vals = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .map((v) => (isExtension && !v.startsWith(".") ? `.${v}` : v));
  return new Set(vals);
}

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function isImageAttachment(att: AttachmentInfo): boolean {
  const mt = (att.mediaType ?? "").toLowerCase();
  const ext = path.extname(att.title ?? "").toLowerCase();
  return mt.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext);
}

async function writePageMarkdown(
  pagesDir: string,
  attachmentsDir: string,
  record: StoredPage,
  fetchedAt: string
): Promise<void> {
  const mdPath = path.join(pagesDir, `${record.pageId}.md`);
  const lines: string[] = [];
  lines.push(`# ${record.title}`);
  lines.push("");
  lines.push(`- Source: Confluence page ${record.pageId}`);
  if (record.url) lines.push(`- URL: ${record.url}`);
  if (record.spaceKey) lines.push(`- Space: ${record.spaceKey}`);
  lines.push(`- Version: ${record.version ?? "unknown"}`);
  lines.push(`- Updated At: ${record.updatedAt ?? "unknown"}`);
  lines.push(`- Fetched At: ${fetchedAt}`);
  lines.push("");
  lines.push("## Content");
  lines.push("");
  lines.push((record.text && record.text.trim()) || "(No textual content extracted)");
  lines.push("");
  lines.push("## Attachments");
  lines.push("");

  const attachments = record.attachments ?? [];
  if (attachments.length === 0) {
    lines.push("- None");
  } else {
    for (const a of attachments) {
      const localTarget = path.join(attachmentsDir, record.pageId, safeFileName(a.title));
      const exists = await fs
        .stat(localTarget)
        .then(() => true)
        .catch(() => false);
      const rel = path.relative(path.dirname(mdPath), localTarget).replace(/\\/g, "/");
      lines.push(
        `- ${a.title} | mediaType=${a.mediaType ?? "unknown"} | size=${a.sizeBytes ?? "unknown"} | version=${a.version ?? "unknown"}`
      );
      if (exists) {
        lines.push(`  - Local file: [${a.title}](${rel})`);
        if (isImageAttachment(a)) {
          lines.push(`  - Preview: ![${a.title}](${rel})`);
        }
      } else {
        lines.push("  - Local file: not downloaded in current filters");
      }
    }
  }

  await fs.writeFile(mdPath, lines.join("\n"), "utf8");
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildAbsoluteConfluenceUrl(baseUrl: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `${trimTrailingSlash(baseUrl)}${href}`;
  return href;
}

function normalizeConfluenceUrl(baseUrl: string, href: string): string {
  const absolute = buildAbsoluteConfluenceUrl(baseUrl, href);
  // Keep the full space-qualified URL when present (e.g. /spaces/<SPACE>/pages/123/Title) —
  // the bare /pages/<id> form does not resolve in the browser without the space key.
  if (/\/spaces\/[^/]+\/pages\/\d+/.test(absolute)) {
    return absolute;
  }
  const targetPageId = extractTargetPageId(absolute);
  if (targetPageId) {
    return `${trimTrailingSlash(baseUrl)}/pages/${targetPageId}`;
  }
  return absolute;
}

function extractTargetPageId(url: string): string | null {
  const pathMatch = url.match(/\/pages\/(\d+)(?:\/|$)/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = url.match(/[?&]pageId=(\d+)/);
  return queryMatch ? queryMatch[1] : null;
}

function extractLinks(baseUrl: string, html: string): LinkRef[] {
  const out: LinkRef[] = [];
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1].trim());
  for (const href of hrefs) {
    const isConfluence = href.startsWith("/") || href.includes("/spaces/") || href.includes("/pages/");
    const normalizedUrl = isConfluence ? normalizeConfluenceUrl(baseUrl, href) : buildAbsoluteConfluenceUrl(baseUrl, href);
    out.push({
      url: normalizedUrl,
      isConfluence,
      targetPageId: isConfluence ? extractTargetPageId(normalizedUrl) : null,
    });
  }
  return out;
}

function normalizeStoredLinks(baseUrl: string, links: LinkRef[] | undefined): LinkRef[] {
  return (links ?? []).map((lk) => {
    const normalizedUrl = lk.isConfluence ? normalizeConfluenceUrl(baseUrl, lk.url) : buildAbsoluteConfluenceUrl(baseUrl, lk.url);
    return {
      url: normalizedUrl,
      isConfluence: lk.isConfluence,
      targetPageId: lk.isConfluence ? extractTargetPageId(normalizedUrl) : null,
    };
  });
}

export function shouldDownloadAttachment(attachment: AttachmentInfo, filters: AttachmentFilter): AttachmentDecision {
  const size = attachment.sizeBytes;
  const mediaType = (attachment.mediaType ?? "").toLowerCase();
  const ext = path.extname(attachment.title ?? "").toLowerCase();

  if (filters.minAttachmentBytes !== undefined && size !== undefined && size < filters.minAttachmentBytes) {
    return { allowed: false, reason: `size_below_min:${size}` };
  }
  if (filters.maxAttachmentBytes !== undefined && size !== undefined && size > filters.maxAttachmentBytes) {
    return { allowed: false, reason: `size_above_max:${size}` };
  }
  if (filters.attachmentMediaTypes.size > 0 && !filters.attachmentMediaTypes.has(mediaType)) {
    return { allowed: false, reason: `media_type_filtered:${mediaType || "unknown"}` };
  }
  if (filters.attachmentExtensions.size > 0 && !filters.attachmentExtensions.has(ext)) {
    return { allowed: false, reason: `extension_filtered:${ext || "none"}` };
  }
  return { allowed: true, reason: "allowed" };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function getChildren(baseUrl: string, pageId: string): Promise<Array<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  let start = 0;
  const limit = 100;
  while (true) {
    const data = await apiGet<{ results: Array<{ id: string }>; size?: number }>(
      baseUrl,
      `/rest/api/content/${encodeURIComponent(pageId)}/child/page`,
      { start, limit }
    );
    out.push(...(data.results ?? []));
    const size = data.size ?? data.results.length;
    if (size < limit) break;
    start += size;
  }
  return out;
}

async function getAttachments(baseUrl: string, pageId: string): Promise<AttachmentInfo[]> {
  const out: AttachmentInfo[] = [];
  let start = 0;
  const limit = 100;
  while (true) {
    const data = await apiGet<{
      results: Array<{
        id: string;
        title: string;
        version?: { number?: number; when?: string };
        extensions?: { mediaType?: string; fileSize?: number };
        _links?: { download?: string };
      }>;
      size?: number;
    }>(baseUrl, `/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`, {
      start,
      limit,
      expand: "version,extensions",
    });
    out.push(
      ...(data.results ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        mediaType: a.extensions?.mediaType,
        sizeBytes: a.extensions?.fileSize,
        version: a.version?.number,
        updatedAt: a.version?.when,
        downloadPath: a._links?.download,
      }))
    );
    const size = data.size ?? data.results.length;
    if (size < limit) break;
    start += size;
  }
  return out;
}

async function runSync(options: SyncOptions): Promise<SyncSummary> {
  await getProject(options.project);
  const baseUrl = env("CONFLUENCE_BASE_URL");
  const projectDir = await resolveProjectArtifactsDir(options.project);
  const pagesDir = path.join(projectDir, "downloads", "confluence", "pages");
  const attachmentsDir = path.join(projectDir, "downloads", "confluence", "attachments");
  const indexDir = path.join(projectDir, "downloads", "confluence", "index");
  await Promise.all([fs.mkdir(pagesDir, { recursive: true }), fs.mkdir(attachmentsDir, { recursive: true }), fs.mkdir(indexDir, { recursive: true })]);

  const now = new Date().toISOString();
  const oldIndex = await readJson<{
    pages: Array<{ pageId: string; version?: number; title: string; url?: string; spaceKey?: string; updatedAt?: string; sourceKind?: string; discoveredFrom?: string }>;
  }>(path.join(indexDir, "pages-index.json"));

  const knownVersions = new Map<string, number>();
  const mergedPages = new Map<string, StoredPage>();
  for (const row of oldIndex?.pages ?? []) {
    if (typeof row.version === "number") knownVersions.set(row.pageId, row.version);
    mergedPages.set(row.pageId, {
      pageId: row.pageId,
      title: row.title,
      version: row.version,
      url: row.url,
      spaceKey: row.spaceKey,
      updatedAt: row.updatedAt,
      sourceKind: row.sourceKind as StoredPage["sourceKind"],
      discoveredFrom: row.discoveredFrom,
    });
  }

  const queue: string[] = [options.rootPageId];
  const queued = new Set<string>(queue);
  const visited = new Set<string>();
  const sourceKind = new Map<string, StoredPage["sourceKind"]>([[options.rootPageId, "root"]]);
  const discoveredFrom = new Map<string, string>();
  const hierarchyEdges: Array<{ fromPageId: string; toPageId: string; edgeType: "child" }> = [];
  const linkEdges: Array<{ fromPageId: string; to: string; targetPageId: string | null; edgeType: "content-link" }> = [];
  const mediaCatalog: Array<{ sourcePageId: string; mediaType: string; identifier: string; capturedAt: string }> = [];

  const summary: SyncSummary = {
    project: options.project,
    rootPageId: options.rootPageId,
    generatedAt: now,
    incremental: options.incremental,
    pagesVisited: 0,
    pagesUpdated: 0,
    pagesSkippedUnchanged: 0,
    pagesFailed: 0,
    linksFound: 0,
    mediaCataloged: 0,
    attachmentsDownloaded: 0,
    attachmentsSkipped: 0,
    errors: [],
    unresolvedLinkedPageIds: [],
  };

  while (queue.length > 0 && visited.size < options.maxPages) {
    const pageId = queue.shift() as string;
    if (visited.has(pageId)) continue;
    visited.add(pageId);
    summary.pagesVisited += 1;

    try {
      const summaryPage = await apiGet<{
        id: string;
        title: string;
        version?: { number?: number; when?: string };
        space?: { key?: string };
        _links?: { webui?: string };
      }>(baseUrl, `/rest/api/content/${encodeURIComponent(pageId)}`, {
        expand: "version,space,_links",
      });

      const remoteVersion = summaryPage.version?.number;
      const previousVersion = knownVersions.get(pageId);
      const snapshotPath = path.join(pagesDir, `${pageId}.json`);
      const snapshot = await readJson<StoredPage>(snapshotPath);
      const isUnchanged = options.incremental && remoteVersion !== undefined && previousVersion === remoteVersion && !!snapshot;

      const childPages = await getChildren(baseUrl, pageId);
      for (const child of childPages) {
        const childId = String(child.id);
        hierarchyEdges.push({ fromPageId: pageId, toPageId: childId, edgeType: "child" });
        if (!queued.has(childId) && !visited.has(childId)) {
          queued.add(childId);
          queue.push(childId);
          sourceKind.set(childId, "descendant");
          discoveredFrom.set(childId, pageId);
        }
      }

      if (isUnchanged) {
        summary.pagesSkippedUnchanged += 1;
        const links = normalizeStoredLinks(baseUrl, snapshot?.links);
        const attachments = snapshot?.attachments ?? [];
        for (const lk of links) {
          linkEdges.push({ fromPageId: pageId, to: lk.url, targetPageId: lk.targetPageId, edgeType: "content-link" });
          if (lk.targetPageId && !queued.has(lk.targetPageId) && !visited.has(lk.targetPageId)) {
            queued.add(lk.targetPageId);
            queue.push(lk.targetPageId);
            sourceKind.set(lk.targetPageId, "linked");
            discoveredFrom.set(lk.targetPageId, pageId);
          }
        }
        for (const a of attachments) {
          mediaCatalog.push({
            sourcePageId: pageId,
            mediaType: a.mediaType ?? "attachment",
            identifier: a.title,
            capturedAt: now,
          });
          if (!options.downloadAttachments) continue;
          await downloadAttachmentIfAllowed(baseUrl, attachmentsDir, pageId, a, options, summary);
        }
        if (snapshot) {
          snapshot.links = links;
          snapshot.url = snapshot.url ? normalizeConfluenceUrl(baseUrl, snapshot.url) : snapshot.url;
          await fs.writeFile(path.join(pagesDir, `${pageId}.json`), JSON.stringify(snapshot, null, 2), "utf8");
          await writePageMarkdown(pagesDir, attachmentsDir, snapshot, now);
          mergedPages.set(pageId, snapshot);
        }
        continue;
      }

      const fullPage = await apiGet<{
        id: string;
        title: string;
        version?: { number?: number; when?: string; by?: { displayName?: string } };
        space?: { key?: string };
        _links?: { webui?: string };
        body?: { storage?: { value?: string } };
      }>(baseUrl, `/rest/api/content/${encodeURIComponent(pageId)}`, {
        expand: "version,space,_links,body.storage",
      });

      const storageHtml = fullPage.body?.storage?.value ?? "";
      const links = extractLinks(baseUrl, storageHtml);
      const attachments = await getAttachments(baseUrl, pageId);
      const text = stripHtml(storageHtml);
      const pageUrl = normalizeConfluenceUrl(baseUrl, fullPage._links?.webui ?? `/pages/${pageId}`);

      const record: StoredPage = {
        pageId,
        title: fullPage.title,
        spaceKey: fullPage.space?.key,
        url: pageUrl,
        version: fullPage.version?.number,
        updatedAt: fullPage.version?.when,
        fetchedAt: now,
        sourceKind: sourceKind.get(pageId) ?? "linked",
        discoveredFrom: discoveredFrom.get(pageId),
        links,
        attachments,
        text,
      };

      await fs.writeFile(path.join(pagesDir, `${pageId}.json`), JSON.stringify(record, null, 2), "utf8");
      // Preserve the raw storage-format HTML (keeps Confluence macros/markup like
      // <ac:structured-macro>, expand/tabs/panels) that stripHtml() discards for the .md/.json text.
      await fs.writeFile(path.join(pagesDir, `${pageId}.html`), storageHtml, "utf8");
      mergedPages.set(pageId, record);
      if (typeof record.version === "number") knownVersions.set(pageId, record.version);
      summary.pagesUpdated += 1;

      for (const lk of links) {
        linkEdges.push({ fromPageId: pageId, to: lk.url, targetPageId: lk.targetPageId, edgeType: "content-link" });
        if (lk.targetPageId && !queued.has(lk.targetPageId) && !visited.has(lk.targetPageId)) {
          queued.add(lk.targetPageId);
          queue.push(lk.targetPageId);
          sourceKind.set(lk.targetPageId, "linked");
          discoveredFrom.set(lk.targetPageId, pageId);
        }
      }

      for (const a of attachments) {
        mediaCatalog.push({
          sourcePageId: pageId,
          mediaType: a.mediaType ?? "attachment",
          identifier: a.title,
          capturedAt: now,
        });

        if (!options.downloadAttachments) continue;
        await downloadAttachmentIfAllowed(baseUrl, attachmentsDir, pageId, a, options, summary);
      }

      await writePageMarkdown(pagesDir, attachmentsDir, record, now);
    } catch (err) {
      summary.pagesFailed += 1;
      summary.errors.push({
        pageId,
        stage: "crawl",
        error: err instanceof Error ? err.message.slice(0, 280) : String(err).slice(0, 280),
      });
    }
  }

  summary.linksFound = linkEdges.length;
  summary.mediaCataloged = mediaCatalog.length;
  const unresolvedLinkedPageIds = new Set(
    summary.errors.filter((e) => e.stage === "crawl" && isMissingConfluencePageError(e.error)).map((e) => e.pageId)
  );
  summary.unresolvedLinkedPageIds = [...unresolvedLinkedPageIds].sort();

  const unresolvedLinkEdges = linkEdges.filter((e) => !!e.targetPageId && unresolvedLinkedPageIds.has(e.targetPageId));
  const unresolvedLinkLines = [...new Set(unresolvedLinkEdges.map((e) => `- from=${e.fromPageId} -> targetPageId=${e.targetPageId} via ${e.to}`))];

  const pagesIndex = {
    rootPageId: options.rootPageId,
    generatedAt: now,
    totalPagesCrawled: mergedPages.size,
    totalQueued: queued.size,
    maxTotalPagesLimit: options.maxPages,
    pages: [...mergedPages.values()]
      .map((p) => ({
        pageId: p.pageId,
        title: p.title,
        url: p.url,
        spaceKey: p.spaceKey,
        version: p.version,
        updatedAt: p.updatedAt,
        sourceKind: p.sourceKind,
        discoveredFrom: p.discoveredFrom,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };

  await Promise.all([
    fs.writeFile(path.join(indexDir, "pages-index.json"), JSON.stringify(pagesIndex, null, 2), "utf8"),
    fs.writeFile(
      path.join(indexDir, "links-graph.json"),
      JSON.stringify({ generatedAt: now, hierarchyEdges, contentLinkEdges: linkEdges, unresolvedTargetPageIds: summary.unresolvedLinkedPageIds }, null, 2),
      "utf8"
    ),
    fs.writeFile(path.join(indexDir, "media-index.json"), JSON.stringify({ generatedAt: now, items: mediaCatalog }, null, 2), "utf8"),
    fs.writeFile(path.join(indexDir, "sync-last.json"), JSON.stringify(summary, null, 2), "utf8"),
  ]);

  const reportPath = path.join(projectDir, "reports", `${now.slice(0, 10)}-confluence-sync-report.md`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    [
      "# Confluence Incremental Sync Report",
      "",
      `- Project: ${options.project}`,
      `- Root Page ID: ${options.rootPageId}`,
      `- Generated At: ${now}`,
      `- Incremental Mode: ${options.incremental}`,
      `- Pages Visited: ${summary.pagesVisited}`,
      `- Pages Updated: ${summary.pagesUpdated}`,
      `- Pages Skipped (unchanged): ${summary.pagesSkippedUnchanged}`,
      `- Pages Failed: ${summary.pagesFailed}`,
      `- Attachments Downloaded: ${summary.attachmentsDownloaded}`,
      `- Attachments Skipped: ${summary.attachmentsSkipped}`,
      "",
      "## Errors",
      "",
      ...(summary.errors.length > 0
        ? summary.errors.map((e) => `- pageId=${e.pageId} stage=${e.stage} error=${e.error}`)
        : ["- None"]),
      "",
      "## Unresolved Linked Pages (404)",
      "",
      ...(unresolvedLinkLines.length > 0 ? unresolvedLinkLines : ["- None"]),
    ].join("\n"),
    "utf8"
  );

  return summary;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runSync(options);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
