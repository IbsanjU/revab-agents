import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatAgentEntries,
  bundledHomePath,
  extensionId,
  isRevabGatewayEntry,
  removeGatewayEntries,
  removeRevabSettings,
  vsixFileName,
} from "./extensionConfig.js";

test("chat agent entries are sorted, agent files only, and inside the extension", () => {
  assert.deepEqual(chatAgentEntries(["b.agent.md", "README.md", "a.agent.md"]), [
    { path: "./agents/a.agent.md" },
    { path: "./agents/b.agent.md" },
  ]);
});

test("only a gateway entry pointing at a local gateway counts as revab's", () => {
  assert.equal(isRevabGatewayEntry("gateway", { type: "http", url: "http://localhost:7300/mcp" }), true);
  assert.equal(isRevabGatewayEntry("gateway-code", { url: "http://127.0.0.1:7400/mcp/code" }), true);
  assert.equal(isRevabGatewayEntry("gateway", { url: "https://corp.example.com/mcp" }), false, "someone else's server named gateway");
  assert.equal(isRevabGatewayEntry("playwright", { url: "http://localhost:7315/mcp" }), false);
  assert.equal(isRevabGatewayEntry("gateway", null), false);
  assert.equal(isRevabGatewayEntry("gateway", { command: "node" }), false);
});

test("uninstall removes revab's gateway entries and keeps every other server", () => {
  const input = {
    servers: {
      gateway: { type: "http", url: "http://localhost:7300/mcp" },
      "gateway-code": { type: "http", url: "http://localhost:7300/mcp/code" },
      playwright: { type: "http", url: "http://localhost:7315/mcp" },
      mine: { command: "x" },
    },
    inputs: [1],
  };
  const { config, removed } = removeGatewayEntries(input, "servers");
  assert.deepEqual(removed, ["gateway", "gateway-code"]);
  assert.deepEqual(Object.keys(config.servers as object), ["playwright", "mine"]);
  assert.deepEqual(config.inputs, [1]);
  assert.ok("gateway" in input.servers, "must not mutate its input");
});

test("a foreign server called gateway survives", () => {
  const input = { mcpServers: { gateway: { url: "https://corp.example.com/mcp" } } };
  const { config, removed } = removeGatewayEntries(input, "mcpServers");
  assert.deepEqual(removed, []);
  assert.deepEqual(config, input);
});

test("a config with no servers section is returned untouched", () => {
  assert.deepEqual(removeGatewayEntries({ a: 1 }, "servers"), { config: { a: 1 }, removed: [] });
});

test("settings cleanup removes revab.* and only revab's approvals", () => {
  const tools = new Set(["jira_search", "jira_create_issue"]);
  const { settings, removed } = removeRevabSettings(
    {
      "editor.fontSize": 14,
      "revab.gateway.port": 7300,
      "revab.home": "/x",
      "chat.tools.autoApprove": { jira_search: true, jira_create_issue: false, other_tool: true },
    },
    tools,
  );
  assert.deepEqual(settings, { "editor.fontSize": 14, "chat.tools.autoApprove": { other_tool: true } });
  assert.deepEqual(removed.sort(), [
    "chat.tools.autoApprove[jira_create_issue]",
    "chat.tools.autoApprove[jira_search]",
    "revab.gateway.port",
    "revab.home",
  ]);
});

test("an approvals map that becomes empty is dropped, not left as {}", () => {
  const { settings } = removeRevabSettings({ "chat.tools.autoApprove": { jira_search: true } }, new Set(["jira_search"]));
  assert.deepEqual(settings, {});
});

test("file and id naming", () => {
  assert.equal(vsixFileName({ name: "revab-agents", version: "0.2.0" }), "revab-agents-0.2.0.vsix");
  assert.equal(extensionId({ publisher: "your-org", name: "revab-agents" }), "your-org.revab-agents");
});

test("the bundled home path follows each platform's VS Code layout, lowercases the id, and honours an override", () => {
  const id = "Your-Org.revab-agents";
  assert.equal(
    bundledHomePath({ platform: "linux", env: {}, homedir: "/home/u", extensionId: id }),
    "/home/u/.config/Code/User/globalStorage/your-org.revab-agents/home",
  );
  assert.equal(
    bundledHomePath({ platform: "linux", env: { XDG_CONFIG_HOME: "/xdg" }, homedir: "/home/u", extensionId: id }),
    "/xdg/Code/User/globalStorage/your-org.revab-agents/home",
  );
  assert.equal(
    bundledHomePath({ platform: "darwin", env: {}, homedir: "/Users/u", extensionId: id }),
    "/Users/u/Library/Application Support/Code/User/globalStorage/your-org.revab-agents/home",
  );
  assert.equal(
    bundledHomePath({ platform: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, homedir: "C:\\Users\\u", extensionId: id }),
    "C:\\Users\\u\\AppData\\Roaming\\Code\\User\\globalStorage\\your-org.revab-agents\\home",
  );
  assert.equal(
    bundledHomePath({ platform: "linux", env: {}, homedir: "/h", extensionId: id, userDataDir: "/custom/insiders" }),
    "/custom/insiders/User/globalStorage/your-org.revab-agents/home",
  );
});
