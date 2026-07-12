import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { env, intEnv } from "../shared/config.js";
import { apiGet, apiGetBinary, apiPost, apiPut, apiDelete, stripHtml, authHeaders } from "../shared/http.js";
import { resolveWithinRoot } from "../../utils/fsSafety.js";
import { buildSaveConfirmationPrompt } from "../../utils/saveSuggestion.js";
import { expandConfluenceMacros } from "../../utils/confluenceMacros.js";

const base = () => env("CONFLUENCE_BASE_URL");
const ROOT = path.resolve(process.cwd());
const DEFAULT_SAVE_DIR = "downloads/confluence";

interface ContentSearchResult {
  results: Array<{
    id: string;
    type: string;
    title: string;
    _links?: { webui?: string };
    space?: { key: string };
  }>;
}

startMcpHttpServer({
  name: "confluence",
  port: intEnv("CONFLUENCE_MCP_PORT", 7312),
  register(server) {
    server.registerTool(
      "confluence_search",
      {
        description:
          "Search Confluence pages. Accepts free text (uses siteSearch) or a raw CQL query.",
        inputSchema: {
          query: z.string().describe('Free text, e.g. "checkout test strategy", or raw CQL'),
          spaceKey: z.string().optional().describe("Limit to a space key"),
          isCql: z.boolean().optional().describe("Set true if query is raw CQL"),
          limit: z.number().optional().describe("Max results (default 15)"),
        },
      },
      async ({ query, spaceKey, isCql, limit }) => {
        try {
          const cql = isCql
            ? query
            : `siteSearch ~ "${query.replace(/"/g, '\\"')}"${spaceKey ? ` AND space = "${spaceKey}"` : ""} AND type = page`;
          const data = await apiGet<ContentSearchResult>(base(), "/rest/api/content/search", {
            cql,
            limit: limit ?? 15,
            expand: "space",
          });
          const compact = data.results.map((r) => ({
            id: r.id,
            title: r.title,
            space: r.space?.key,
            url: r._links?.webui,
          }));
          return textResult(compact);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_get_page",
      {
        description:
          "Get a Confluence page by id. Returns title, version and body in the requested format: " +
          "'text' (default, plain-text stripped), 'html' (raw storage HTML — needed for pages with " +
          "accordions, expand panels, or tabs), or 'structured' (accordions/expand/tabs macros expanded " +
          "into a readable nested plain-text outline instead of being flattened away).",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
          format: z.enum(["text", "html", "structured"]).optional().describe("Body format (default: text)"),
          raw: z.boolean().optional().describe("Deprecated alias for format: 'html'"),
        },
      },
      async ({ pageId, format, raw }) => {
        try {
          const data = await apiGet<{
            id: string;
            title: string;
            version?: { number: number };
            space?: { key: string };
            body?: { storage?: { value?: string } };
          }>(base(), `/rest/api/content/${encodeURIComponent(pageId)}`, {
            expand: "body.storage,version,space",
          });
          const html = data.body?.storage?.value ?? "";
          const effectiveFormat = raw ? "html" : format ?? "text";
          const body =
            effectiveFormat === "html"
              ? html
              : effectiveFormat === "structured"
                ? expandConfluenceMacros(html)
                : stripHtml(html);
          return textResult({
            id: data.id,
            title: data.title,
            space: data.space?.key,
            version: data.version?.number,
            format: effectiveFormat,
            body,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_get_children",
      {
        description: "List child pages of a Confluence page (for navigating page trees).",
        inputSchema: {
          pageId: z.string().describe("Numeric parent page id"),
          limit: z.number().optional(),
        },
      },
      async ({ pageId, limit }) => {
        try {
          const data = await apiGet<ContentSearchResult>(
            base(),
            `/rest/api/content/${encodeURIComponent(pageId)}/child/page`,
            { limit: limit ?? 50 }
          );
          const compact = data.results.map((r) => ({ id: r.id, title: r.title, url: r._links?.webui }));
          return textResult(compact);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_get_attachments",
      {
        description:
          "List attachments on a Confluence page (images, PDFs, videos, docs) with media type, size and download link.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
          limit: z.number().optional(),
        },
      },
      async ({ pageId, limit }) => {
        try {
          const data = await apiGet<{
            results: Array<{
              id: string;
              title: string;
              extensions?: { mediaType?: string; fileSize?: number };
              _links?: { download?: string };
            }>;
          }>(base(), `/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`, {
            limit: limit ?? 50,
          });
          const compact = data.results.map((a) => ({
            id: a.id,
            title: a.title,
            mediaType: a.extensions?.mediaType,
            sizeBytes: a.extensions?.fileSize,
            downloadLink: a._links?.download,
          }));
          return textResult(compact);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_download_attachment",
      {
        description:
          "Download an attachment to the repo (default downloads/confluence/, or downloads/confluence/<project>/ if project is given). Use the downloadLink from confluence_get_attachments. Note: binary media (images/video) can be saved and referenced but not visually interpreted — use the media MCP server's get_file_metadata/read_pdf_text/read_docx_text tools to inspect it further.",
        inputSchema: {
          downloadLink: z.string().describe("Relative download link starting with /download/..."),
          fileName: z.string().optional().describe("Override the saved file name"),
          project: z.string().optional().describe("Confirmed local project folder to nest under (ask the user first if unsure)"),
          targetDir: z.string().optional().describe("Repo-relative target dir (default downloads/confluence)"),
        },
      },
      async ({ downloadLink, fileName, project, targetDir }) => {
        try {
          if (!downloadLink.startsWith("/")) {
            throw new Error("downloadLink must be the relative link from confluence_get_attachments");
          }
          const buf = await apiGetBinary(base(), downloadLink);
          const baseDir = targetDir ?? DEFAULT_SAVE_DIR;
          const dir = resolveWithinRoot(ROOT, project ? path.join(baseDir, project) : baseDir);
          const name = path.basename(fileName ?? decodeURIComponent(downloadLink.split("?")[0]));
          await fs.mkdir(dir, { recursive: true });
          const target = path.join(dir, name);
          await fs.writeFile(target, buf);
          return textResult({
            savedTo: path.relative(ROOT, target).replace(/\\/g, "/"),
            bytes: buf.length,
          });
        } catch (err) {
          return errorResult(err);

        }
      }
    );

    server.registerTool(
      "confluence_upload_attachment",
      {
        description:
          "Upload a local file (e.g. a screenshot from the playwright MCP or a diagram from the media server's " +
          "create_diagram) as an attachment on a Confluence page, so it can be referenced with an <ac:image> tag. " +
          "dryRun (default true) previews the upload without sending it — always get explicit user confirmation first.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id to attach the file to"),
          filePath: z.string().describe("Path to the local file, relative to this repo"),
          fileName: z.string().optional().describe("Override the attachment file name (default: the local file's name)"),
          comment: z.string().optional().describe("Optional attachment version comment"),
          dryRun: z.boolean().optional().describe("If true (default), return the intended upload without sending it"),
        },
      },
      async ({ pageId, filePath, fileName, comment, dryRun }) => {
        try {
          const target = resolveWithinRoot(ROOT, filePath);
          const stat = await fs.stat(target);
          if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
          const name = path.basename(fileName ?? target);
          if (dryRun ?? true) {
            return textResult({
              dryRun: true,
              wouldUpload: { pageId, fileName: name, sizeBytes: stat.size, from: filePath },
              embedHint: `After uploading, reference it in the page body with: <ac:image><ri:attachment ri:filename="${name}" /></ac:image>`,
            });
          }
          const buf = await fs.readFile(target);
          const form = new FormData();
          form.append("file", new Blob([new Uint8Array(buf)]), name);
          if (comment) form.append("comment", comment);
          const url = `${base()}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`;
          const res = await fetch(url, {
            method: "POST",
            headers: { ...authHeaders(), "X-Atlassian-Token": "nocheck" },
            body: form,
          });
          if (!res.ok) {
            throw new Error(`Attachment upload failed: ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 500)}`);
          }
          const data = (await res.json()) as { results?: Array<{ id: string; title: string }> };
          return textResult({
            uploaded: data.results?.map((a) => ({ id: a.id, title: a.title })) ?? [],
            embedHint: `Reference it in the page body with: <ac:image><ri:attachment ri:filename="${name}" /></ac:image>`,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_get_comments",
      {
        description: "Get comments (memos/notes) on a Confluence page as plain text.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
          limit: z.number().optional(),
        },
      },
      async ({ pageId, limit }) => {
        try {
          const data = await apiGet<{
            results: Array<{ id: string; body?: { storage?: { value?: string } } }>;
          }>(base(), `/rest/api/content/${encodeURIComponent(pageId)}/child/comment`, {
            expand: "body.storage",
            limit: limit ?? 50,
          });
          const compact = data.results.map((c) => ({ id: c.id, text: stripHtml(c.body?.storage?.value ?? "") }));
          return textResult(compact);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_save_page",
      {
        description:
          "Pull a Confluence page to local disk: saves the raw storage HTML, a structured plain-text " +
          "outline (accordions/expand/tabs expanded), and a metadata JSON file. If `project` is omitted, " +
          "no files are written — the tool instead returns a suggested project folder name " +
          "(e.g. `downloads/confluence/PROJ-XXX`) so the agent can ask the user to confirm or override it " +
          "before saving. Re-call with an explicit `project` once confirmed.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
          project: z
            .string()
            .optional()
            .describe("Confirmed local folder name to save under (ask the user first if not provided)"),
          targetDir: z.string().optional().describe("Repo-relative base dir (default downloads/confluence)"),
        },
      },
      async ({ pageId, project, targetDir }) => {
        try {
          const data = await apiGet<{
            id: string;
            title: string;
            version?: { number: number };
            space?: { key: string };
            _links?: { webui?: string };
            body?: { storage?: { value?: string } };
          }>(base(), `/rest/api/content/${encodeURIComponent(pageId)}`, {
            expand: "body.storage,version,space",
          });
          const html = data.body?.storage?.value ?? "";
          const baseDir = targetDir ?? DEFAULT_SAVE_DIR;

          if (!project) {
            const prompt = buildSaveConfirmationPrompt(data.space?.key, baseDir);
            return textResult({
              needsConfirmation: true,
              page: { id: data.id, title: data.title, space: data.space?.key },
              ...prompt,
            });
          }

          const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
          const dir = resolveWithinRoot(ROOT, path.join(baseDir, project, `${data.id}-${slug}`));
          await fs.mkdir(dir, { recursive: true });

          const structured = expandConfluenceMacros(html);
          const meta = {
            id: data.id,
            title: data.title,
            space: data.space?.key,
            version: data.version?.number,
            url: data._links?.webui,
            savedAt: new Date().toISOString(),
          };

          await Promise.all([
            fs.writeFile(path.join(dir, "page.html"), html, "utf8"),
            fs.writeFile(path.join(dir, "page.structured.txt"), structured, "utf8"),
            fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8"),
          ]);

          return textResult({
            savedTo: path.relative(ROOT, dir).replace(/\\/g, "/"),
            files: ["page.html", "page.structured.txt", "meta.json"],
            meta,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_create_page",
      {
        description:
          "Create a new Confluence page (storage-format HTML body). dryRun (default true) previews the payload without sending it — always search first to avoid duplicates.",
        inputSchema: {
          spaceKey: z.string().describe("Space key to create the page in"),
          title: z.string().describe("Page title"),
          body: z.string().describe("Page body as Confluence storage-format HTML"),
          parentPageId: z.string().optional().describe("Optional parent page id to nest under"),
          dryRun: z.boolean().optional().describe("If true (default), return the payload without creating anything"),
        },
      },
      async ({ spaceKey, title, body, parentPageId, dryRun }) => {
        try {
          const payload = {
            type: "page",
            title,
            space: { key: spaceKey },
            ...(parentPageId ? { ancestors: [{ id: parentPageId }] } : {}),
            body: { storage: { value: body, representation: "storage" } },
          };
          if (dryRun ?? true) {
            return textResult({ dryRun: true, wouldCreate: payload });
          }
          const data = await apiPost(base(), "/rest/api/content", payload);
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_update_page",
      {
        description:
          "Update an existing Confluence page's title and/or body. Requires the page's current version number (from confluence_get_page) — Confluence rejects updates with a stale version. dryRun (default true) previews the payload without sending it.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
          currentVersion: z.number().describe("Current version number from confluence_get_page"),
          title: z.string().optional().describe("New title (defaults to unchanged if omitted, requires refetch)"),
          body: z.string().optional().describe("New body as Confluence storage-format HTML"),
          dryRun: z.boolean().optional().describe("If true (default), return the payload without updating anything"),
        },
      },
      async ({ pageId, currentVersion, title, body, dryRun }) => {
        try {
          if (!title && !body) throw new Error("Provide at least one of title or body to update");
          const payload = {
            type: "page",
            ...(title ? { title } : {}),
            version: { number: currentVersion + 1 },
            ...(body ? { body: { storage: { value: body, representation: "storage" } } } : {}),
          };
          if (dryRun ?? true) {
            return textResult({ dryRun: true, pageId, wouldUpdate: payload });
          }
          const data = await apiPut(base(), `/rest/api/content/${encodeURIComponent(pageId)}`, payload);
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_add_comment",
      {
        description:
          "Add a comment to a Confluence page. dryRun (default true) previews the payload without sending it.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id to comment on"),
          body: z.string().describe("Comment body as Confluence storage-format HTML"),
          dryRun: z.boolean().optional().describe("If true (default), return the payload without creating anything"),
        },
      },
      async ({ pageId, body, dryRun }) => {
        try {
          const payload = {
            type: "comment",
            container: { id: pageId, type: "page" },
            body: { storage: { value: body, representation: "storage" } },
          };
          if (dryRun ?? true) {
            return textResult({ dryRun: true, wouldCreate: payload });
          }
          const data = await apiPost(base(), "/rest/api/content", payload);
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_delete_page",
      {
        description:
          "Delete a Confluence page. Destructive and irreversible (moves to trash, depending on space settings). dryRun (default true) previews the deletion without applying it.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
          dryRun: z.boolean().optional().describe("If true (default), return the intended deletion without applying it"),
        },
      },
      async ({ pageId, dryRun }) => {
        try {
          if (dryRun ?? true) {
            return textResult({ dryRun: true, wouldDelete: pageId });
          }
          const { status } = await apiDelete(base(), `/rest/api/content/${encodeURIComponent(pageId)}`);
          return textResult({ deleted: pageId, status });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "confluence_extract_links",
      {
        description:
          "Extract structured references from a page: hyperlinks, linked Confluence pages, attachment/media references (images, video/multimedia macros), and Jira issue links.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
        },
      },
      async ({ pageId }) => {
        try {
          const data = await apiGet<{ body?: { storage?: { value?: string } } }>(
            base(),
            `/rest/api/content/${encodeURIComponent(pageId)}`,
            { expand: "body.storage" }
          );
          const html = data.body?.storage?.value ?? "";
          const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
            href: m[1],
            text: stripHtml(m[2]).slice(0, 120),
          }));
          const attachmentRefs = [...new Set([...html.matchAll(/ri:filename="([^"]+)"/gi)].map((m) => m[1]))];
          const linkedPages = [...new Set([...html.matchAll(/ri:content-title="([^"]+)"/gi)].map((m) => m[1]))];
          const jiraKeys = [...new Set([...html.matchAll(/ac:name="jira"[\s\S]*?<ac:parameter ac:name="key">([^<]+)</gi)].map((m) => m[1]))];
          const imageCount = (html.match(/<ac:image/gi) ?? []).length;
          const multimediaMacros = [...new Set(
            [...html.matchAll(/ac:name="(multimedia|widget|view-file|viewpdf|gallery|iframe)"/gi)].map((m) => m[1])
          )];
          return textResult({ links, linkedPages, attachmentRefs, jiraKeys, imageCount, multimediaMacros });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
