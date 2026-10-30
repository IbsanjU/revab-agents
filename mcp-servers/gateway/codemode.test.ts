import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { buildCodeModeTools, createToolCaller } from "./codemode.js";
import type { CapturedTool } from "./tools.js";

const text = (body: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(body) }],
  ...(isError ? { isError: true } : {}),
});

function fakeTools() {
  const seen: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const mk = (name: string, inputSchema: Record<string, z.ZodTypeAny>, result: unknown = { ok: true }): CapturedTool => ({
    server: "fake",
    name,
    description: `${name} tool`,
    inputSchema,
    handler: async (args) => {
      seen.push({ tool: name, args });
      return text(result);
    },
  });
  const tools = [
    mk("jira_search", { jql: z.string() }, { issues: [{ key: "A-1" }, { key: "A-2" }] }),
    // write-classified, has dryRun:
    mk("jira_create_issue", { summary: z.string(), dryRun: z.boolean().optional() }, { preview: true }),
    // write-classified, no dryRun:
    mk("jira_delete_issue", { key: z.string() }),
    { ...mk("jira_get_boom", {}), handler: async () => text({ message: "upstream 500" }, true) },
  ];
  return { tools, seen };
}

test("calls read tools and returns the unwrapped result", async () => {
  const { tools } = fakeTools();
  const caller = createToolCaller(tools, 10);
  const reply = JSON.parse(await caller("jira_search", { jql: "x" }));
  assert.deepEqual(reply, { ok: { issues: [{ key: "A-1" }, { key: "A-2" }] } });
});

test("a write tool with dryRun is forced to dryRun: true, whatever the code asked for", async () => {
  const { tools, seen } = fakeTools();
  const caller = createToolCaller(tools, 10);
  await caller("jira_create_issue", { summary: "s", dryRun: false });
  await caller("jira_create_issue", { summary: "s" });
  assert.deepEqual(seen.map((s) => s.args.dryRun), [true, true]);
});

test("a write tool with no dryRun mode is refused and never reaches its handler", async () => {
  const { tools, seen } = fakeTools();
  const reply = JSON.parse(await createToolCaller(tools, 10)("jira_delete_issue", { key: "A-1" }));
  assert.match(reply.error, /cannot be called from code/);
  assert.equal(seen.length, 0);
});

test("unknown tools, invalid input and upstream errors come back as errors, never throws", async () => {
  const { tools } = fakeTools();
  const caller = createToolCaller(tools, 10);
  assert.match(JSON.parse(await caller("nope", {})).error, /Unknown tool "nope"/);
  assert.match(JSON.parse(await caller("jira_search", { jql: 5 })).error, /Invalid input for jira_search: jql/);
  assert.equal(JSON.parse(await caller("jira_get_boom", {})).error, "upstream 500");
});

test("the call budget is enforced", async () => {
  const { tools } = fakeTools();
  const caller = createToolCaller(tools, 2);
  await caller("jira_search", { jql: "a" });
  await caller("jira_search", { jql: "b" });
  assert.match(JSON.parse(await caller("jira_search", { jql: "c" })).error, /Call limit reached/);
  assert.equal(caller.calls(), 3);
});

test("codemode tools cannot call themselves (no recursion)", async () => {
  const { tools } = fakeTools();
  const [, execute] = buildCodeModeTools(tools);
  const out = await execute!.handler({ code: "return await codemode.codemode_execute({ code: 'return 1' })" });
  assert.equal(out.isError, true);
  assert.match(JSON.parse(out.content[0]!.text).error, /Unknown tool "codemode_execute"/);
});

test("execute chains calls, filters in code, and returns only the result", async () => {
  const { tools, seen } = fakeTools();
  const [, execute] = buildCodeModeTools(tools);
  const out = await execute!.handler({
    code: `async () => {
      const r = await codemode.jira_search({ jql: "project = A" });
      return r.issues.map((i) => i.key);
    }`,
  });
  const body = JSON.parse(out.content[0]!.text);
  assert.deepEqual(body.result, ["A-1", "A-2"]);
  assert.equal(body.toolCalls, 1);
  assert.equal(seen.length, 1);
  assert.equal(out.isError, undefined);
});

test("execute reports sandbox errors with isError and keeps console output", async () => {
  const { tools } = fakeTools();
  const [, execute] = buildCodeModeTools(tools);
  const out = await execute!.handler({ code: "console.log('step 1'); throw new Error('bad script')" });
  assert.equal(out.isError, true);
  const body = JSON.parse(out.content[0]!.text);
  assert.equal(body.error, "bad script");
  assert.deepEqual(body.logs, ["step 1"]);
});

test("execute truncates oversized output and says so", async () => {
  const { tools } = fakeTools();
  const [, execute] = buildCodeModeTools(tools, { maxOutputChars: 200 });
  const out = await execute!.handler({ code: "return 'x'.repeat(5000)" });
  assert.match(out.content[0]!.text, /truncated \d+ characters/);
  assert.ok(out.content[0]!.text.length < 400);
});

test("search returns ranked tools with risk and declarations", async () => {
  const { tools } = fakeTools();
  const [search] = buildCodeModeTools(tools);
  const out = JSON.parse((await search!.handler({ query: "jira create" })).content[0]!.text);
  assert.equal(out.matches[0].name, "jira_create_issue");
  assert.equal(out.matches[0].risk, "write");
  assert.match(out.declarations, /declare const codemode/);
  const none = JSON.parse((await search!.handler({ query: "zzzz" })).content[0]!.text);
  assert.deepEqual(none.matches, []);
});
