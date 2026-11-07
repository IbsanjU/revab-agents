/**
 * Opt-in tool-call log: one JSON line per gateway tool call, so behavior evals can check what an agent
 * actually did without any model in the loop. Set GATEWAY_CALL_LOG to a file path to enable it.
 *
 * Records tool name, server, risk, the `dryRun` flag, success and duration. It never records argument
 * values or results (they hold tickets, tokens and personal data), and a logging failure can never fail
 * a tool call. Only gateway tools are seen: terminal commands and file edits are not.
 */
import { appendFileSync, mkdirSync } from "fs";
import path from "path";
import type { CapturedTool } from "./tools.js";
import { classifyTool, type ToolRisk } from "../../utils/toolClassification.js";

export interface CallRecord {
  t: string;
  tool: string;
  server: string;
  risk: ToolRisk;
  /** The coerced `dryRun` argument when the tool has one. */
  dryRun?: boolean;
  ok: boolean;
  ms: number;
}

export interface MarkRecord {
  mark: string;
  t: string;
}

function append(file: string, record: CallRecord | MarkRecord): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
  } catch {
    /* logging must never break a tool call */
  }
}

export function appendMark(file: string, id: string): void {
  append(file, { mark: id, t: new Date().toISOString() });
}

/** Wrap every tool's handler so its calls are logged. Returns the tools unchanged when no file is set. */
export function withCallLog(tools: CapturedTool[], file: string | undefined): CapturedTool[] {
  if (!file) return tools;
  return tools.map((tool) => ({
    ...tool,
    handler: async (args: Record<string, unknown>) => {
      const started = Date.now();
      let ok = false;
      try {
        const result = await tool.handler(args);
        ok = !result.isError;
        return result;
      } finally {
        append(file, {
          t: new Date(started).toISOString(),
          tool: tool.name,
          server: tool.server,
          risk: classifyTool(tool.name),
          ...(typeof args?.dryRun === "boolean" ? { dryRun: args.dryRun } : {}),
          ok,
          ms: Date.now() - started,
        });
      }
    },
  }));
}
