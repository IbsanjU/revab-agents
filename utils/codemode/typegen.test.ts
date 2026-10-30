import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { declareTool, generateTypes, jsonSchemaToTs, searchTools, type ToolLike } from "./typegen.js";

const tool = (name: string, description: string, inputSchema: Record<string, z.ZodTypeAny>): ToolLike => ({
  name,
  description,
  inputSchema,
});

test("maps JSON Schema primitives, enums, arrays and nested objects", () => {
  assert.equal(jsonSchemaToTs({ type: "string" }), "string");
  assert.equal(jsonSchemaToTs({ type: "integer" }), "number");
  assert.equal(jsonSchemaToTs({ enum: ["a", "b"] }), '"a" | "b"');
  assert.equal(jsonSchemaToTs({ type: "array", items: { type: "boolean" } }), "Array<boolean>");
  assert.equal(jsonSchemaToTs({ anyOf: [{ type: "string" }, { type: "null" }] }), "string | null");
  assert.match(
    jsonSchemaToTs({ type: "object", properties: { a: { type: "string" } }, required: ["a"] }),
    /a: string;/,
  );
});

test("unknown shapes degrade to unknown instead of throwing", () => {
  assert.equal(jsonSchemaToTs(undefined), "unknown");
  assert.equal(jsonSchemaToTs({ type: "weird" }), "unknown");
  assert.equal(jsonSchemaToTs({}), "unknown");
});

test("declares a tool with optional fields and JSDoc from descriptions", () => {
  const d = declareTool(
    tool("jira_search", "Search Jira with JQL.", {
      jql: z.string().describe("JQL query"),
      limit: z.number().optional().describe("Max rows"),
    }),
  );
  assert.equal(d.typeName, "JiraSearchInput");
  assert.match(d.input, /type JiraSearchInput = \{/);
  assert.match(d.input, /\/\*\* JQL query \*\/\s*\n\s*jql: string;/);
  assert.match(d.input, /limit\?: number;/);
  assert.match(d.method, /jira_search: \(input: JiraSearchInput\) => Promise<unknown>;/);
});

test("a description containing */ cannot break out of its comment", () => {
  const d = declareTool(tool("t", "evil */ declare const x = 1; /*", { a: z.string() }));
  assert.doesNotMatch(d.input.split("\n")[0]!, /\*\/ declare/);
});

test("generateTypes emits one codemode namespace for all tools", () => {
  const out = generateTypes([tool("a_one", "A", { x: z.string() }), tool("b_two", "B", {})]);
  assert.match(out, /declare const codemode: \{/);
  assert.match(out, /a_one: \(input: AOneInput\)/);
  assert.match(out, /b_two: \(input: BTwoInput\)/);
});

test("search ranks name matches above description matches and respects the limit", () => {
  const tools = [
    tool("confluence_get_page", "Read a page", {}),
    tool("jira_get_sprints", "List sprints for a board", {}),
    tool("jira_search", "Search issues; can filter by sprint", {}),
  ];
  assert.deepEqual(searchTools(tools, "sprint").map((t) => t.name), ["jira_get_sprints", "jira_search"]);
  assert.equal(searchTools(tools, "jira", 1).length, 1);
  assert.deepEqual(searchTools(tools, "zzzz"), []);
  assert.deepEqual(searchTools(tools, "  "), []);
});
