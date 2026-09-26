/**
 * Captures the tools each MCP server registers, so one definition can be served
 * two ways: as MCP (`POST /mcp`) and as plain REST (`POST /api/<server>/<tool>`).
 *
 * Servers register via `server.registerTool(name, config, handler)` and nothing
 * else, so a minimal shim standing in for `McpServer` is enough to record every
 * tool without touching a single server file.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beginCollecting, collectedServers } from "../shared/server.js";

/** The MCP content envelope every handler returns (`textResult`/`errorResult`). */
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface CapturedTool {
  /** Owning server, e.g. "jira" — the REST path segment. */
  server: string;
  /** Tool name, unique across all servers (verified at startup). */
  name: string;
  description: string;
  /** Raw zod shape as the server declared it. */
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;
}

type RegisterToolArgs = [
  string,
  { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  CapturedTool["handler"],
];

/**
 * Import every server module in collect mode and capture its tools.
 *
 * The dynamic imports are intentional: each module calls `startMcpHttpServer` as an
 * import side effect, so collect mode must be enabled before the first import.
 */
export async function captureAllTools(): Promise<CapturedTool[]> {
  beginCollecting();

  // Static list rather than a directory scan so a stray folder can't be loaded,
  // and so the set of hosted servers is reviewable in the diff.
  const modules = [
    "../jira/index.js",
    "../confluence/index.js",
    "../jtmf/index.js",
    "../github/index.js",
    "../git/index.js",
    "../artifacts/index.js",
    "../media/index.js",
    "../notify/index.js",
    "../playwright-runner/index.js",
    "../allure-report/index.js",
    "../codegen/index.js",
  ];
  for (const specifier of modules) {
    await import(specifier);
  }

  const tools: CapturedTool[] = [];
  for (const server of collectedServers()) {
    const captured: CapturedTool[] = [];
    const shim = {
      registerTool: (...args: RegisterToolArgs) => {
        const [name, config, handler] = args;
        captured.push({
          server: server.name,
          name,
          description: config.description ?? "",
          inputSchema: config.inputSchema ?? {},
          handler,
        });
      },
    };
    // The shim implements the only method the servers use.
    server.register(shim as unknown as McpServer);
    tools.push(...captured);
  }

  const seen = new Map<string, string>();
  for (const tool of tools) {
    const existing = seen.get(tool.name);
    if (existing) {
      // MCP tool names share one flat namespace — a duplicate would silently shadow.
      throw new Error(
        `Duplicate tool name "${tool.name}" registered by both "${existing}" and "${tool.server}". Tool names must be unique across all servers.`,
      );
    }
    seen.set(tool.name, tool.server);
  }

  return tools;
}
