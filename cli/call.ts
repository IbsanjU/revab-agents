/**
 * `revab tools` / `revab call` — use the gateway without MCP.
 *
 * The gateway serves every tool as plain JSON over REST as well as MCP. These two
 * commands are the thin client for that second door, for hosts or runs where MCP is
 * not available (no org enablement, CI, a plain shell, another editor). It is the
 * same handler behind the same validation and dry-run guards as the MCP path, so
 * nothing here can do more than an MCP call could.
 */

export interface ToolInfo {
  name: string;
  server: string;
  description?: string;
  endpoint: string;
  risk?: string;
}

export function gatewayBase(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GATEWAY_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = Number(env.GATEWAY_MCP_PORT) || 7300;
  return `http://localhost:${port}`;
}

export function authHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.MCP_SHARED_SECRET) headers["x-mcp-secret"] = env.MCP_SHARED_SECRET;
  return headers;
}

/** Parse the JSON argument; empty means "no arguments". */
export function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Arguments must be a JSON object, e.g. '{"key":"PROJ-1"}'. Got: ${raw}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Arguments must be a JSON object, e.g. '{"key":"PROJ-1"}'. Got: ${raw}`);
  }
  return value as Record<string, unknown>;
}

export function findTool(tools: ToolInfo[], name: string): ToolInfo {
  const exact = tools.filter((t) => t.name === name);
  if (exact.length === 1) return exact[0]!;
  const bySlash = tools.find((t) => `${t.server}/${t.name}` === name);
  if (bySlash) return bySlash;
  const near = tools.filter((t) => t.name.includes(name)).slice(0, 5).map((t) => t.name);
  throw new Error(
    `Unknown tool "${name}".` + (near.length ? ` Did you mean: ${near.join(", ")}?` : " Run `revab tools` to list them.")
  );
}

async function fetchTools(base: string): Promise<ToolInfo[]> {
  const res = await fetch(`${base}/api/tools`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${base}/api/tools returned ${res.status}. Is the gateway running? Try \`revab start\`.`);
  const body = (await res.json()) as { tools?: ToolInfo[] };
  return body.tools ?? [];
}

export async function runTools(opts: { json: boolean; filter?: string }): Promise<void> {
  const tools = await fetchTools(gatewayBase());
  const shown = opts.filter ? tools.filter((t) => t.name.includes(opts.filter!)) : tools;
  if (opts.json) {
    console.log(JSON.stringify(shown, null, 2));
    return;
  }
  for (const t of shown) console.log(`${t.risk === "write" ? "W" : "R"}  ${t.name.padEnd(36)} ${t.server}`);
  console.log(`\n${shown.length} tool(s). R = read-only, W = write (dryRun-first).`);
}

/** Returns the process exit code: 0 ok, 1 tool/transport error. */
export async function runCall(toolName: string | undefined, rawArgs: string | undefined): Promise<number> {
  if (!toolName) throw new Error("Usage: revab call <tool> ['<json arguments>']");
  const base = gatewayBase();
  const args = parseArgs(rawArgs);
  const tool = findTool(await fetchTools(base), toolName);
  const res = await fetch(`${base}${tool.endpoint}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(args),
  });
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  return res.ok ? 0 : 1;
}

