import express from "express";
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { optionalEnv } from "./config.js";

export interface McpHttpServerOptions {
  /** Server name shown to MCP clients. */
  name: string;
  version?: string;
  port: number;
  /** Register tools on the McpServer instance. Called once per request (stateless mode). */
  register: (server: McpServer) => void;
}

/** Wrap any value as an MCP text tool result. */
export function textResult(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

/** Wrap an error as an MCP tool error result. */
export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/**
 * Start a stateless Streamable-HTTP MCP server bound to 127.0.0.1 (loopback only —
 * these servers carry credentials for external systems and must never be reachable
 * from the network). If MCP_SHARED_SECRET is set in .env, every /mcp request must
 * also carry it in an `x-mcp-secret` header (defense-in-depth against other local
 * processes); .vscode/mcp.json passes it via the server's `headers` entry.
 * Register it in .vscode/mcp.json as { "type": "http", "url": "http://localhost:<port>/mcp" }.
 */
export function startMcpHttpServer(opts: McpHttpServerOptions): void {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const sharedSecretGuard = (req: Request, res: Response, next: NextFunction) => {
    const secret = optionalEnv("MCP_SHARED_SECRET");
    if (!secret) return next();
    const provided = req.header("x-mcp-secret") ?? "";
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or invalid x-mcp-secret header" },
        id: null,
      });
      return;
    }
    next();
  };

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, name: opts.name });
  });

  app.post("/mcp", sharedSecretGuard, async (req: Request, res: Response) => {
    try {
      const server = new McpServer({ name: opts.name, version: opts.version ?? "0.1.0" });
      opts.register(server);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[${opts.name}] request failed:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode: no SSE resumption / session termination.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server)" },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(opts.port, "127.0.0.1", () => {
    console.log(`[${opts.name}] MCP server listening on http://localhost:${opts.port}/mcp (loopback only)`);
  });
}
