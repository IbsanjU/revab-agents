import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
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
  // Discovery lists the hosted tools plus the two Code Mode tools that script them.
  assert.equal(body.tools.length, tools.length + 2);
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


async function mcpToolNames(path: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await res.text();
  const json = JSON.parse(text.includes("data:") ? text.split("data:")[1]!.trim() : text) as {
    result: { tools: Array<{ name: string }> };
  };
  return json.result.tools.map((t) => t.name);
}

test("Code Mode is served on its own endpoint with exactly two tools, leaving /mcp untouched", async () => {
  const code = await mcpToolNames("/mcp/code");
  assert.deepEqual(code.sort(), ["codemode_execute", "codemode_search"]);
  const all = await mcpToolNames("/mcp");
  assert.equal(all.length, tools.length);
  assert.ok(!all.includes("codemode_execute"), "/mcp must not gain code tools");
  assert.equal((await fetch(`${baseUrl}/mcp/code`)).status, 405);
});

test("Code Mode tools are discoverable over REST and classified fail-closed", async () => {
  const res = await fetch(`${baseUrl}/api/tools`);
  const { tools: listed } = (await res.json()) as { tools: Array<{ name: string; risk: string }> };
  assert.equal(listed.find((t) => t.name === "codemode_search")?.risk, "read");
  assert.equal(listed.find((t) => t.name === "codemode_execute")?.risk, "write");
});

test("codemode_execute runs a script against the real tools and returns only the result", async () => {
  const { status, body } = await post("/api/codemode/codemode_execute", {
    code: `async () => {
      const hits = await codemode.knowledge_search({ query: "orchestrator" });
      return { type: typeof hits, calls: 1 };
    }`,
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal((body.result as { calls: number }).calls, 1);
  assert.equal(body.toolCalls, 1);
});

test("codemode_execute cannot apply a write from code", async () => {
  const { body } = await post("/api/codemode/codemode_execute", {
    code: `try { await codemode.knowledge_append({ entry: "from code" }); return "wrote" } catch (e) { return e.message }`,
  });
  assert.match(String(body.result), /cannot be called from code|dryRun/);
});

test("codemode_search finds real tools by keyword", async () => {
  const { body } = await post("/api/codemode/codemode_search", { query: "confluence page" });
  const names = (body.matches as Array<{ name: string }>).map((m) => m.name);
  assert.ok(names.some((n) => n.startsWith("confluence_")), names.join(", "));
  assert.match(String(body.declarations), /declare const codemode/);
});

test("disabled tools are absent from MCP, REST discovery, REST calls and Code Mode alike", async () => {
  const { filterTools } = await import("./filter.js");
  const spec = "jira_search, knowledge_search, codemode_execute";
  const { kept, removed } = filterTools(tools, spec);
  assert.equal(removed.length, 2);

  const local = buildApp(kept, { disabled: spec, removed }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => local.once("listening", resolve));
  const base = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const listNames = async (path: string) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const text = await res.text();
    const json = JSON.parse(text.includes("data:") ? text.split("data:")[1]!.trim() : text) as { result: { tools: Array<{ name: string }> } };
    return json.result.tools.map((t) => t.name);
  };
  try {
    const health = (await (await fetch(`${base}/health`)).json()) as { tools: number; disabled: number; codeMode: string[] };
    assert.equal(health.disabled, 2);
    assert.equal(health.tools, tools.length - 2);
    assert.deepEqual(health.codeMode, ["codemode_search"], "Code Mode's own tools can be disabled too");

    const mcp = await listNames("/mcp");
    assert.ok(!mcp.includes("jira_search") && !mcp.includes("knowledge_search"), "absent from MCP");
    assert.ok(mcp.includes("jira_get_issue"), "other tools remain");

    const discovery = (await (await fetch(`${base}/api/tools`)).json()) as {
      tools: Array<{ name: string }>;
      disabled: Array<{ name: string; server: string }>;
    };
    assert.deepEqual(discovery.disabled.map((d) => d.name).sort(), ["jira_search", "knowledge_search"], "a client can show what is off");
    assert.ok(!discovery.tools.some((t) => t.name === "jira_search"), "absent from REST discovery");
    assert.equal((await call("/api/jira/jira_search", { jql: "x" })).status, 404, "REST call refused");
    assert.equal((await call("/api/codemode/codemode_execute", { code: "return 1" })).status, 404);

    const viaCode = await call("/api/codemode/codemode_search", { query: "jira search" });
    assert.ok(!(viaCode.body.matches as Array<{ name: string }>).some((m) => m.name === "jira_search"), "not findable through Code Mode");
  } finally {
    local.closeAllConnections();
    await new Promise<void>((resolve) => local.close(() => resolve()));
  }
});

// ---- transcribe_media through the real gateway, with a stand-in Python ------------------------

test("transcribe_media: a cited transcript comes back, and bad input is refused before Python runs", { skip: process.platform === "win32" }, async () => {
  const { chmodSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const dir = path.join(process.cwd(), ".workspaces", "whisper-gateway-test");
  mkdirSync(dir, { recursive: true });
  const media = path.join(dir, "Standup Call.mp3");
  writeFileSync(media, "not really audio; the stand-in does not read it");
  writeFileSync(path.join(dir, "notes.txt"), "text");
  const python = path.join(dir, "fake-python");
  writeFileSync(
    python,
    `#!/bin/sh\ncat > "${dir}/request.json"; printf '%s\\n' '{"ok":true,"language":"en","languageProbability":0.99,"durationSeconds":42,"segments":[{"start":0,"end":5,"text":"Welcome everyone."},{"start":75,"end":80,"text":"Login must lock after five tries."}]}'\n`,
  );
  chmodSync(python, 0o755);
  const previous = process.env.WHISPER_PYTHON;
  process.env.WHISPER_PYTHON = python;
  try {
    const rel = path.relative(process.cwd(), media);
    const ok = await post("/api/media/transcribe_media", { filePath: rel, model: "tiny", language: "en" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.language, "en");
    assert.equal(ok.body.text, "Welcome everyone. Login must lock after five tries.");
    const segments = ok.body.segments as Array<{ citation: string }>;
    assert.deepEqual(segments.map((s) => s.citation), ["transcript:Standup-Call@00:00:00", "transcript:Standup-Call@00:01:15"]);

    const { readFileSync } = await import("node:fs");
    const sent = JSON.parse(readFileSync(path.join(dir, "request.json"), "utf8"));
    assert.equal(sent.model, "tiny");
    assert.equal(sent.path, media, "Python receives the resolved path inside the root");

    const text = await post("/api/media/transcribe_media", { filePath: path.relative(process.cwd(), path.join(dir, "notes.txt")) });
    assert.match(JSON.stringify(text.body), /does not look like an audio or video file/);
    const escape = await post("/api/media/transcribe_media", { filePath: "../outside.mp3" });
    assert.match(JSON.stringify(escape.body), /escapes root/);
    const missing = await post("/api/media/transcribe_media", { filePath: path.relative(process.cwd(), path.join(dir, "gone.wav")) });
    assert.match(JSON.stringify(missing.body), /File not found/);
    const badModel = await post("/api/media/transcribe_media", { filePath: rel, model: "someone/else" });
    assert.equal(badModel.status, 400, "the model is validated by the tool schema");
  } finally {
    if (previous === undefined) delete process.env.WHISPER_PYTHON;
    else process.env.WHISPER_PYTHON = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("transcribe_media is read-only for approval purposes, so clients can auto-approve it", async () => {
  const { tools: listed } = (await (await fetch(`${baseUrl}/api/tools`)).json()) as { tools: Array<{ name: string; risk: string }> };
  assert.equal(listed.find((t) => t.name === "transcribe_media")?.risk, "read");
});
