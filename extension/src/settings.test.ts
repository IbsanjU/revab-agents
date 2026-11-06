import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAIN_KEYS,
  SECRETS,
  agentToolRefs,
  agentsLosing,
  buildGatewayEnv,
  describeEnv,
  nextDisabledList,
  sharedSecretHeaders,
} from "./settings.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every variable the extension can set is documented in .env.example (no drift)", () => {
  const example = fs.readFileSync(path.join(REPO, ".env.example"), "utf8");
  for (const key of [...SECRETS.map((s) => s.key), ...PLAIN_KEYS]) {
    assert.match(example, new RegExp(`^#?\\s*${key}=`, "m"), `${key} is not in .env.example`);
  }
});

test("a variable is never both a secret and a plain setting", () => {
  const secrets = new Set(SECRETS.map((s) => s.key));
  for (const key of PLAIN_KEYS) assert.ok(!secrets.has(key), `${key} is in both lists`);
});

test("the plain allowlist blocks variables that would change how the gateway process runs", () => {
  const { env, rejected } = buildGatewayEnv({
    plain: { JIRA_BASE_URL: "https://x.atlassian.net", NODE_OPTIONS: "--require /evil.js", LD_PRELOAD: "/evil.so", PATH: "/evil", HOME: "/tmp" },
    secrets: {},
    disabled: [],
    port: 7300,
  });
  assert.deepEqual(Object.keys(env).sort(), ["GATEWAY_MCP_PORT", "JIRA_BASE_URL"]);
  assert.deepEqual(rejected.map((r) => r.key).sort(), ["HOME", "LD_PRELOAD", "NODE_OPTIONS", "PATH"]);
});

test("a credential in the plain setting is refused with a pointer to the command, never copied", () => {
  const { env, rejected } = buildGatewayEnv({ plain: { JIRA_API_TOKEN: "oops-in-settings" }, secrets: {}, disabled: [], port: 7300 });
  assert.equal(env.JIRA_API_TOKEN, undefined);
  assert.match(rejected[0]!.reason, /Set credentials/);
  assert.doesNotMatch(JSON.stringify(rejected), /oops-in-settings/, "a value must never appear in a message");
});

test("stored secrets win, unknown secret keys are ignored, and blanks are dropped", () => {
  const { env } = buildGatewayEnv({
    plain: { JIRA_EMAIL: "a@b.c", HTTP_TIMEOUT_MS: 5000, JTMF_EMAIL: "   " },
    secrets: { JIRA_API_TOKEN: "tok", NOT_A_SECRET: "x", GITHUB_TOKEN: undefined },
    disabled: [],
    port: 7311,
  });
  assert.deepEqual(env, { JIRA_EMAIL: "a@b.c", HTTP_TIMEOUT_MS: "5000", JIRA_API_TOKEN: "tok", GATEWAY_MCP_PORT: "7311" });
});

test("non-string values and non-object settings are handled without throwing", () => {
  const { env, rejected } = buildGatewayEnv({ plain: { JIRA_EMAIL: { a: 1 } }, secrets: {}, disabled: "nope", port: 7300 });
  assert.equal(env.JIRA_EMAIL, undefined);
  assert.equal(rejected.length, 1);
  assert.equal(buildGatewayEnv({ plain: [1, 2], secrets: {}, disabled: null, port: 1 }).env.GATEWAY_MCP_PORT, "1");
});

test("disabled tools are validated, trimmed and de-duplicated into GATEWAY_DISABLED_TOOLS", () => {
  const { env } = buildGatewayEnv({
    plain: {},
    secrets: {},
    disabled: ["jira_search", " jira_search ", "jira/*", "confluence_*", "bad entry; rm -rf", 5, ""],
    port: 7300,
  });
  assert.equal(env.GATEWAY_DISABLED_TOOLS, "jira_search,jira/*,confluence_*");
});

test("no disabled tools leaves the variable unset", () => {
  assert.equal(buildGatewayEnv({ plain: {}, secrets: {}, disabled: [], port: 7300 }).env.GATEWAY_DISABLED_TOOLS, undefined);
});

test("the shared secret becomes the x-mcp-secret header only when set", () => {
  assert.deepEqual(sharedSecretHeaders({ MCP_SHARED_SECRET: "s3" }), { "x-mcp-secret": "s3" });
  assert.deepEqual(sharedSecretHeaders({}), {});
});

test("describeEnv lists names only and marks secrets", () => {
  const text = describeEnv({ JIRA_API_TOKEN: "SUPERSECRET", JIRA_EMAIL: "a@b.c" }).join(" ");
  assert.match(text, /JIRA_API_TOKEN \(secret\)/);
  assert.doesNotMatch(text, /SUPERSECRET|a@b\.c/);
});

test("agentToolRefs reads gateway and gateway-code references from frontmatter only", () => {
  const md = "---\nname: x\ntools: ['read/readFile', 'gateway/jira_search', 'gateway-code/codemode_execute']\n---\nBody mentions 'gateway/not_a_tool'.\n";
  assert.deepEqual(agentToolRefs(md), ["jira_search", "codemode_execute"]);
  assert.deepEqual(agentToolRefs("no frontmatter"), []);
});

test("agentsLosing names each affected agent and what it loses", () => {
  const agents = [
    { name: "researcher", tools: ["jira_search", "confluence_get_page"] },
    { name: "bsa", tools: ["jira_search", "jira_create_issue"] },
    { name: "planner", tools: [] },
  ];
  assert.deepEqual(agentsLosing(new Set(["jira_search", "jira_create_issue"]), agents), [
    { agent: "researcher", lost: ["jira_search"] },
    { agent: "bsa", lost: ["jira_search", "jira_create_issue"] },
  ]);
  assert.deepEqual(agentsLosing(new Set(), agents), []);
});

test("saving the picker keeps hand-written patterns the picker cannot show", () => {
  const all = new Set(["a", "b", "c"]);
  assert.deepEqual(nextDisabledList(["jira/*", "a"], all, ["b", "a"]), ["a", "b", "jira/*"]);
  assert.deepEqual(nextDisabledList(["a"], all, []), [], "re-checking a tool re-enables it");
});
