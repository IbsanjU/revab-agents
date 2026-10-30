/**
 * How much of the model's context do tool definitions cost, with and without Code Mode?
 *
 *   npm run bench:codemode
 *
 * Starts the gateway in-process, asks each MCP endpoint for `tools/list` exactly as a client
 * would, and reports the size of what the model would have to load. Token counts are a rough
 * estimate (characters / 4); real tokenizers differ, so treat the ratio as the result and the
 * absolute numbers as approximate. It measures definitions only, not a whole task: Code Mode
 * also adds a `codemode_search` result and the script itself to a real run.
 */
import type { AddressInfo } from "node:net";
import { buildApp } from "../mcp-servers/gateway/index.js";
import { captureAllTools } from "../mcp-servers/gateway/tools.js";

const estimateTokens = (chars: number): number => Math.round(chars / 4);

async function toolsList(base: string, path: string): Promise<{ count: number; chars: number }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await res.text();
  const payload = text.includes("data:") ? text.split("data:")[1]!.trim() : text;
  const { result } = JSON.parse(payload) as { result: { tools: unknown[] } };
  return { count: result.tools.length, chars: JSON.stringify(result.tools).length };
}

async function main(): Promise<void> {
  process.env.JIRA_BASE_URL ??= "https://example.atlassian.net";
  const server = buildApp(await captureAllTools()).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const all = await toolsList(base, "/mcp");
    const code = await toolsList(base, "/mcp/code");

    const search = await fetch(`${base}/api/codemode/codemode_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "jira sprint backlog" }),
    });
    const searchChars = (await search.text()).length;

    const rows = [
      { surface: "/mcp (every tool)", tools: all.count, chars: all.chars, "≈tokens": estimateTokens(all.chars) },
      { surface: "/mcp/code (Code Mode)", tools: code.count, chars: code.chars, "≈tokens": estimateTokens(code.chars) },
      {
        surface: "…plus one codemode_search result",
        tools: code.count,
        chars: code.chars + searchChars,
        "≈tokens": estimateTokens(code.chars + searchChars),
      },
    ];
    console.table(rows);
    const saved = 1 - (code.chars + searchChars) / all.chars;
    console.log(
      `Definitions loaded up front: ${(all.chars / code.chars).toFixed(0)}× smaller with Code Mode; ` +
        `${(saved * 100).toFixed(0)}% smaller even after one search. Estimate only (chars/4).`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

void main();
