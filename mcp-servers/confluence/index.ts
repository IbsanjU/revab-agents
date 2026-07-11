import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { env, intEnv } from "../shared/config.js";
import { apiGet, apiGetBinary, apiPost, apiPut, apiDelete, stripHtml } from "../shared/http.js";

const base = () => env("CONFLUENCE_BASE_URL");

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
          "Get a Confluence page by id. Returns title, version and body converted to plain text.",
        inputSchema: {
          pageId: z.string().describe("Numeric page id"),
          raw: z.boolean().optional().describe("Return raw storage HTML instead of plain text"),
        },
      },
      async ({ pageId, raw }) => {
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
          return textResult({
            id: data.id,
            title: data.title,
            space: data.space?.key,
            version: data.version?.number,
            body: raw ? html : stripHtml(html),
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
          "Download an attachment to the repo (default downloads/confluence/). Use the downloadLink from confluence_get_attachments. Note: binary media (images/video) can be saved and referenced but not visually interpreted.",
        inputSchema: {
          downloadLink: z.string().describe("Relative download link starting with /download/..."),
          fileName: z.string().optional().describe("Override the saved file name"),
          targetDir: z.string().optional().describe("Repo-relative target dir (default downloads/confluence)"),
        },
      },
      async ({ downloadLink, fileName, targetDir }) => {
        try {
          if (!downloadLink.startsWith("/")) {
            throw new Error("downloadLink must be the relative link from confluence_get_attachments");
          }
          const buf = await apiGetBinary(base(), downloadLink);
          const root = path.resolve(process.cwd());
          const dir = path.resolve(root, targetDir ?? "downloads/confluence");
          if (dir !== root && !dir.startsWith(root + path.sep)) {
            throw new Error("targetDir escapes the repository root");
          }
          const name = path.basename(fileName ?? decodeURIComponent(downloadLink.split("?")[0]));
          await fs.mkdir(dir, { recursive: true });
          const target = path.join(dir, name);
          await fs.writeFile(target, buf);
          return textResult({
            savedTo: path.relative(root, target).replace(/\\/g, "/"),
            bytes: buf.length,
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
