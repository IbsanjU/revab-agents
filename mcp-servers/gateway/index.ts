/**
 * Gateway — every MCP tool, one process, two protocols.
 *
 * Running 11 servers on 11 ports is the main barrier to shipping this to a team:
 * it needs 11 processes, 11 port registrations, and an editor that supports MCP at
 * all. The gateway hosts them all on a single port and exposes each tool twice:
 *
 *   POST /mcp                      — Streamable-HTTP MCP (what .vscode/mcp.json uses)
 *   POST /api/<server>/<tool>      — plain JSON REST, for any client when MCP is
 *                                    unavailable (no org enablement, a CI job, curl,
 *                                    a non-MCP editor)
 *   GET  /api/tools                — discovery: every tool, its server, and its schema
 *   GET  /health                   — liveness + tool count
 *
 * Both surfaces call the SAME handler, so the manifest trust boundary, dryRun-first
 * defaults, and input coercion apply identically — REST is a different door to the
 * same room, never a bypass.
 *
 * Run with: npm run serve:gateway   (individual `npm run serve:<name>` still work)
 */
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { intEnv, optionalEnv } from "../shared/config.js";
import { captureAllTools, type CapturedTool } from "./tools.js";

const PORT = intEnv("GATEWAY_MCP_PORT", 7300);

/** Same shared-secret guard the individual servers use (see shared/server.ts). */
function sharedSecretGuard(req: Request, res: Response, next: NextFunction): void {
  const secret = optionalEnv("MCP_SHARED_SECRET");
  if (!secret) return next();
  const provided = req.header("x-mcp-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Unauthorized: missing or invalid x-mcp-secret header" });
    return;
  }
  next();
}

/**
 * Unwrap the MCP content envelope for REST callers.
 * Handlers return `{ content: [{ type: "text", text }] }` where the text is JSON for
 * structured results and prose for errors — REST clients want the payload itself.
 */
function toRestBody(result: { content?: Array<{ text?: string }>; isError?: boolean }): unknown {
  const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export function buildApp(tools: CapturedTool[]): express.Express {
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, name: "gateway", tools: tools.length });
  });

  app.get("/api/tools", sharedSecretGuard, (_req: Request, res: Response) => {
    res.json({
      tools: tools.map((t) => ({
        server: t.server,
        name: t.name,
        description: t.description,
        endpoint: `/api/${t.server}/${t.name}`,
        inputs: Object.entries(t.inputSchema).map(([field, schema]) => ({
          field,
          description: schema.description ?? "",
          optional: schema.isOptional?.() ?? false,
        })),
      })),
    });
  });

  // --- MCP surface ---------------------------------------------------------
  app.post("/mcp", sharedSecretGuard, async (req: Request, res: Response) => {
    try {
      const server = new McpServer({ name: "revab-gateway", version: "0.1.0" });
      for (const tool of tools) {
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.inputSchema },
          tool.handler as never,
        );
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[gateway] MCP request failed:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server)" },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // --- REST surface --------------------------------------------------------
  const byRoute = new Map(tools.map((t) => [`${t.server}/${t.name}`, t]));

  app.post("/api/:server/:tool", sharedSecretGuard, async (req: Request, res: Response) => {
    const key = `${req.params.server}/${req.params.tool}`;
    const tool = byRoute.get(key);
    if (!tool) {
      res.status(404).json({
        error: `Unknown tool "${key}". GET /api/tools lists every available tool and its schema.`,
      });
      return;
    }
    // Validate with the tool's own zod shape, so REST callers get the same
    // coercion (semanticBoolean/semanticNumber) and the same rejections as MCP.
    const parsed = z.object(tool.inputSchema).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid input",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    try {
      const result = await tool.handler(parsed.data as Record<string, unknown>);
      res.status(result.isError ? 502 : 200).json(toRestBody(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[gateway] ${key} failed:`, message);
      res.status(500).json({ error: message });
    }
  });

  return app;
}

/** Boot the gateway. Exported so the `revab start` CLI can reuse it. */
export async function startGateway(): Promise<void> {
  const tools = await captureAllTools();
  const app = buildApp(tools);
  const servers = new Set(tools.map((t) => t.server)).size;
  app.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[gateway] ${tools.length} tools from ${servers} servers on http://localhost:${PORT} (loopback only)\n` +
        `[gateway]   MCP   POST /mcp\n` +
        `[gateway]   REST  POST /api/<server>/<tool>   (GET /api/tools to discover)`,
    );
  });
}

/**
 * Start only when this module IS the entrypoint. A substring check on argv[1] is not
 * enough — a test file such as `gateway/gateway.test.ts` also contains "gateway", and
 * importing it would then bind a real port and hang the run. Compare resolved paths.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  startGateway().catch((err) => {
    console.error("[gateway] failed to start:", err);
    process.exit(1);
  });
}
