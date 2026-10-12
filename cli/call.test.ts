import { test } from "node:test";
import assert from "node:assert/strict";
import { authHeaders, findTool, gatewayBase, parseArgs, type ToolInfo } from "./call.js";

const tools: ToolInfo[] = [
  { name: "jira_search", server: "jira", endpoint: "/api/jira/jira_search" },
  { name: "jira_get_issue", server: "jira", endpoint: "/api/jira/jira_get_issue" },
  { name: "consensus_score", server: "artifacts", endpoint: "/api/artifacts/consensus_score" },
];

test("gatewayBase prefers GATEWAY_URL, then GATEWAY_MCP_PORT, then 7300", () => {
  assert.equal(gatewayBase({ GATEWAY_URL: "http://h:9/" }), "http://h:9");
  assert.equal(gatewayBase({ GATEWAY_MCP_PORT: "7400" }), "http://localhost:7400");
  assert.equal(gatewayBase({}), "http://localhost:7300");
});

test("authHeaders sends the shared secret only when configured", () => {
  assert.equal(authHeaders({}) ["x-mcp-secret"], undefined);
  assert.equal(authHeaders({ MCP_SHARED_SECRET: "s" })["x-mcp-secret"], "s");
});

test("parseArgs accepts objects and rejects everything else with a hint", () => {
  assert.deepEqual(parseArgs(undefined), {});
  assert.deepEqual(parseArgs("  "), {});
  assert.deepEqual(parseArgs('{"a":1}'), { a: 1 });
  for (const bad of ["not json", "[1]", "3", "null"]) {
    assert.throws(() => parseArgs(bad), /JSON object/);
  }
});

test("findTool matches exact names and server/name, and suggests near misses", () => {
  assert.equal(findTool(tools, "jira_search").server, "jira");
  assert.equal(findTool(tools, "artifacts/consensus_score").name, "consensus_score");
  assert.throws(() => findTool(tools, "jira"), /Did you mean: jira_search, jira_get_issue/);
  assert.throws(() => findTool(tools, "zzz"), /revab tools/);
});
