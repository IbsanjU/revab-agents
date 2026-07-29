import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { buildApp } from "./index.js";
import { captureAllTools, type CapturedTool } from "./tools.js";

let tools: CapturedTool[];
let server: Server;
let baseUrl: string;

before(async () => {
  // A base URL is required by the Atlassian servers at import time.
  process.env.JIRA_BASE_URL ??= "https://example.atlassian.net";
  tools = await captureAllTools();
  server = buildApp(tools).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  // fetch keeps connections alive, which would hold the event loop open and hang
  // the test run — drop them explicitly before closing.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("every server's tools are captured into one namespace", () => {
  const servers = new Set(tools.map((t) => t.server));
  assert.ok(tools.length > 50, `expected the full tool surface, got ${tools.length}`);
  assert.ok(servers.size >= 11, `expected all servers, got ${[...servers].join(", ")}`);
  assert.ok(tools.some((t) => t.name === "jira_search"));
  assert.ok(tools.some((t) => t.name === "scaffold_feature"));
});

test("tool names are unique — a duplicate would silently shadow in MCP's flat namespace", () => {
  const seen = new Set<string>();
  for (const tool of tools) {
    assert.equal(seen.has(tool.name), false, `duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
  }
});

test("every tool exposes a description and is reachable at /api/<server>/<tool>", async () => {
  for (const tool of tools) {
    assert.notEqual(tool.description.trim(), "", `${tool.name} has no description`);
  }
  const res = await fetch(`${baseUrl}/api/tools`);
  const body = (await res.json()) as { tools: Array<{ endpoint: string }> };
  assert.equal(body.tools.length, tools.length);
  assert.ok(body.tools.every((t) => t.endpoint.startsWith("/api/")));
});

test("health reports the hosted tool count", async () => {
  const res = await fetch(`${baseUrl}/health`);
  const body = (await res.json()) as { ok: boolean; tools: number };
  assert.equal(body.ok, true);
  assert.equal(body.tools, tools.length);
});

// The safety properties must hold on the REST door exactly as they do on MCP.
test("REST preserves the dryRun-first default (no write escapes through it)", async () => {
  const { status, body } = await post("/api/jira/jira_create_issue", {
    projectKey: "ABC",
    issueType: "Story",
    summary: "safety check",
  });
  assert.equal(status, 200);
  assert.equal(body.dryRun, true, "omitting dryRun must still preview, never create");
});

test("REST applies the same input coercion as MCP (quoted booleans)", async () => {
  const { body } = await post("/api/jira/jira_create_issue", {
    projectKey: "ABC",
    issueType: "Story",
    summary: "coercion check",
    dryRun: "true",
  });
  assert.equal(body.dryRun, true, 'the string "true" must coerce, not error');
});

test("REST rejects invalid input with field-level detail", async () => {
  const { status, body } = await post("/api/jira/jira_create_issue", {});
  assert.equal(status, 400);
  const issues = body.issues as Array<{ path: string }>;
  assert.ok(issues.some((i) => i.path === "projectKey"));
});

test("an unknown tool 404s and points at discovery", async () => {
  const { status, body } = await post("/api/jira/does_not_exist", {});
  assert.equal(status, 404);
  assert.match(String(body.error), /\/api\/tools/);
});

test("the MCP surface lists the same tools and rejects stateless GET", async () => {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await res.text();
  assert.match(text, /"jira_search"/);

  const getRes = await fetch(`${baseUrl}/mcp`);
  assert.equal(getRes.status, 405);
});

