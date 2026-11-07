import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { BROWSER_TOOLS, browserServerEntry, parseAllowedHosts } from "./browserServer.js";
import { runInit } from "../cli/init.js";

test("parseAllowedHosts keeps bare hosts and wildcards, rejects URLs, paths, ports and a bare *", () => {
  const r = parseAllowedHosts(["App.Test, *.stage.test", "https://evil.test", "a.test/path", "host:8080", "*", " ", "app.test"]);
  assert.deepEqual(r.hosts, ["app.test", "*.stage.test"]);
  assert.deepEqual(r.invalid, ["https://evil.test", "a.test/path", "host:8080", "*"]);
});

test("the entry never enables script execution or external navigation and never installs at launch", () => {
  const e = browserServerEntry(["app.test", "localhost"]);
  assert.deepEqual(e.args, ["--no-install", "playwright-mcp-vscode"]);
  assert.equal(e.env.PLAYWRIGHT_ALLOWED_HOSTS, "localhost,127.0.0.1,app.test");
  assert.equal(e.env.PLAYWRIGHT_ENABLE_SCRIPT_EXECUTION, "false");
  assert.ok(!e.env.PLAYWRIGHT_ENABLED_TOOLS.split(",").includes("page_eval"), "page_eval is switched off by policy (the server still lists it but refuses the call: verified against the real server)");
  assert.equal(e.env.PLAYWRIGHT_ALLOW_EXTERNAL_NAVIGATION, "false");
  assert.ok(!(BROWSER_TOOLS as readonly string[]).includes("page_eval"), "page_eval must never be grantable");
});

async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-init-"));
  const log = console.log;
  console.log = () => {};
  try { return await fn(dir); } finally { console.log = log; }
}

test("init --browser adds playwright-local to both configs and keeps existing entries", async () => {
  await inTemp(async (dir) => {
    await fs.mkdir(path.join(dir, ".vscode"));
    await fs.writeFile(path.join(dir, ".vscode", "mcp.json"), JSON.stringify({ servers: { mine: { type: "http", url: "http://x" } } }));
    await runInit({ cwd: dir, browser: true, allowHosts: ["app.test"] });
    const vs = JSON.parse(await fs.readFile(path.join(dir, ".vscode", "mcp.json"), "utf8"));
    const cc = JSON.parse(await fs.readFile(path.join(dir, ".mcp.json"), "utf8"));
    assert.ok(vs.servers.mine, "another developer's entry is untouched");
    assert.equal(vs.servers["playwright-local"].env.PLAYWRIGHT_ALLOWED_HOSTS, "localhost,127.0.0.1,app.test");
    assert.ok(cc.mcpServers["playwright-local"]);
  });
});

test("init --browser never overwrites a hand-edited entry, and a bad host registers nothing", async () => {
  await inTemp(async (dir) => {
    await fs.mkdir(path.join(dir, ".vscode"));
    const mine = { type: "stdio", command: "node", args: ["custom.js"] };
    await fs.writeFile(path.join(dir, ".vscode", "mcp.json"), JSON.stringify({ servers: { "playwright-local": mine } }));
    await runInit({ cwd: dir, browser: true });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, ".vscode", "mcp.json"), "utf8")).servers["playwright-local"], mine);
  });
  await inTemp(async (dir) => {
    await runInit({ cwd: dir, browser: true, allowHosts: ["https://evil.test"] });
    const cc = JSON.parse(await fs.readFile(path.join(dir, ".mcp.json"), "utf8"));
    assert.ok(!cc.mcpServers["playwright-local"], "an invalid allowlist must not register an unrestricted server");
  });
});

test("without --browser nothing browser-related is written", async () => {
  await inTemp(async (dir) => {
    await runInit({ cwd: dir });
    assert.ok(!JSON.stringify(JSON.parse(await fs.readFile(path.join(dir, ".mcp.json"), "utf8"))).includes("playwright-local"));
  });
});
