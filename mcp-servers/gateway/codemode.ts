/**
 * Code Mode for the gateway: two tools instead of seventy-eight.
 *
 *   codemode_search   find tools and get their TypeScript declarations
 *   codemode_execute  run JavaScript that calls them as `codemode.<tool>(input)`
 *
 * Served on its own endpoint (`POST /mcp/code`) so a client can load these two small
 * definitions instead of every tool's schema, and let one script chain many calls without a
 * model round trip each. The normal `/mcp` surface is unchanged.
 *
 * The rule that keeps this safe: a call from code is never more powerful than a direct call.
 * It goes through the same input validation, and writes are restricted further (below).
 */
import { z } from "zod";
import { classifyTool } from "../../utils/toolClassification.js";
import { generateTypes, searchTools } from "../../utils/codemode/typegen.js";
import { runInSandbox, type ToolCaller } from "../../utils/codemode/sandbox.js";
import { errorResult, textResult } from "../shared/server.js";
import type { CapturedTool, McpToolResult } from "./tools.js";

export interface CodeModeOptions {
  timeoutMs: number;
  maxCalls: number;
  maxOutputChars: number;
}

export const DEFAULT_OPTIONS: CodeModeOptions = {
  timeoutMs: 60_000,
  maxCalls: 100,
  maxOutputChars: 24_000,
};

/**
 * A tool's result as code should see it: parsed JSON when the text is JSON, otherwise the text
 * itself. (REST wraps plain text as `{ message }`, which made file contents arrive as an object
 * in one case and a parsed value in another; code gets the string, or the parsed value.)
 */
const unwrap = (result: McpToolResult): unknown => {
  const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Where to go when a tool cannot run from code: the same tool, called directly. */
const directCallHint = (tool: CapturedTool): string =>
  `Call it directly (POST /api/${tool.server}/${tool.name}, or from a client connected to /mcp) after the user approves.`;

/** A write tool can run from code only as a dry-run preview, and only if it has a dryRun input. */
export const codeAccess = (tool: CapturedTool): { callableFromCode: boolean; note?: string } => {
  if (classifyTool(tool.name) !== "write") return { callableFromCode: true };
  if ("dryRun" in tool.inputSchema) {
    return { callableFromCode: true, note: "write tool: from code it only previews (dryRun is forced to true); apply it with a direct call after approval" };
  }
  return { callableFromCode: false, note: `write tool with no dryRun mode: not callable from code. ${directCallHint(tool)}` };
};

/**
 * Build the function the sandbox uses to call tools.
 *
 * Writes from code are held to a stricter rule than direct writes, because nobody reviews
 * the script's individual calls: a write-classified tool is only callable if it has a
 * `dryRun` input, and `dryRun` is forced to true. Code can therefore preview a bulk change
 * for the user to approve, but cannot apply it. Applying happens as a direct tool call after
 * approval, exactly as without Code Mode. Write tools with no dry-run mode are refused.
 */
export function createToolCaller(tools: CapturedTool[], maxCalls: number): ToolCaller & { calls: () => number } {
  const byName = new Map(tools.map((t) => [t.name, t]));
  let calls = 0;
  const caller = async (name: string, args: unknown): Promise<string> => {
    try {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool "${name}". Use codemode_search to find tools.`);
      if (++calls > maxCalls) throw new Error(`Call limit reached (${maxCalls} tool calls per execution).`);

      let input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
      if (classifyTool(name) === "write") {
        if (!("dryRun" in tool.inputSchema)) {
          throw new Error(
            `"${name}" changes state and has no dryRun mode, so it cannot be called from code. ${directCallHint(tool)}`,
          );
        }
        input = { ...input, dryRun: true };
      }

      const parsed = z.object(tool.inputSchema).safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        throw new Error(`Invalid input for ${name}: ${issues}`);
      }
      const result = await tool.handler(parsed.data as Record<string, unknown>);
      const body = unwrap(result);
      if (result.isError) {
        throw new Error(typeof body === "string" ? body : JSON.stringify(body));
      }
      return JSON.stringify({ ok: body ?? null });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  return Object.assign(caller, { calls: () => calls });
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}\n… truncated ${text.length - max} characters. Return less, or filter in code.`;

export function buildCodeModeTools(tools: CapturedTool[], options: Partial<CodeModeOptions> = {}): CapturedTool[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const search: CapturedTool = {
    server: "codemode",
    name: "codemode_search",
    description:
      "Find gateway tools by keyword and get their TypeScript declarations. Call this first, then write code for " +
      "codemode_execute against the declarations returned. Returns the tool names, risk (read or write), and types.",
    inputSchema: {
      query: z.string().describe("Keywords, e.g. 'jira sprint backlog' or 'confluence page'"),
      limit: z.number().int().positive().max(25).optional().describe("Max tools to return (default 8)"),
    },
    handler: async (args) => {
      try {
        const { query, limit } = args as { query: string; limit?: number };
        const matches = searchTools(tools, query, limit ?? 8);
        if (matches.length === 0) {
          return textResult({ matches: [], hint: "No tools matched. Try fewer or different keywords." });
        }
        return textResult({
          matches: matches.map((t) => ({ name: t.name, server: t.server, risk: classifyTool(t.name), ...codeAccess(t) })),
          declarations: generateTypes(matches),
          usage: "codemode_execute({ code: \"async () => { return await codemode.<tool>({ ... }); }\" })",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };

  const execute: CapturedTool = {
    server: "codemode",
    name: "codemode_execute",
    description:
      "Run JavaScript (an async arrow function, or a bare body that uses `return`) that calls gateway tools as " +
      "`await codemode.<tool>({ ...input })`. Use codemode_search first to get exact tool names and input types. " +
      "Chain calls, loop, filter and aggregate in code, and return only what is needed: the final return value and " +
      "console.log output are all that come back. No network, filesystem or process access. " +
      "Write tools can only run in dryRun mode from code; apply changes with a direct call after approval.",
    inputSchema: {
      code: z.string().describe("JavaScript: `async () => { ... return value; }` or a body with `return`"),
    },
    handler: async (args) => {
      const { code } = args as { code: string };
      const caller = createToolCaller(tools, opts.maxCalls);
      const run = await runInSandbox(code, caller, { timeoutMs: opts.timeoutMs });
      const payload = {
        ...(run.error === undefined ? { result: run.result ?? null } : { error: run.error }),
        ...(run.logs.length > 0 ? { logs: run.logs } : {}),
        toolCalls: caller.calls(),
      };
      const text = truncate(JSON.stringify(payload, null, 2), opts.maxOutputChars);
      return run.error === undefined
        ? { content: [{ type: "text" as const, text }] }
        : { content: [{ type: "text" as const, text }], isError: true };
    },
  };

  return [search, execute];
}
