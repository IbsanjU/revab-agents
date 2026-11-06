import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const posixOnly = process.platform === "win32" ? { skip: "uses a shell-script stand-in for the `code` CLI" } : {};

/** A throwaway checkout holding revab's config plus things that must survive an uninstall. */
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "revab-uninstall-"));
  const w = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  w("extension/package.json", JSON.stringify({ name: "revab-agents", version: "9.9.9", publisher: "acme", contributes: {} }));
  w(".env", "JIRA_API_TOKEN=keep-me\n");
  w("knowledge/learnings.md", "keep me\n");
  w(
    ".vscode/mcp.json",
    JSON.stringify({
      servers: {
        gateway: { type: "http", url: "http://localhost:7300/mcp" },
        "gateway-code": { type: "http", url: "http://localhost:7300/mcp/code" },
        playwright: { type: "http", url: "http://localhost:7315/mcp" },
      },
    }),
  );
  w(".mcp.json", JSON.stringify({ mcpServers: { gateway: { type: "http", url: "http://localhost:7300/mcp" }, mine: { command: "x" } } }));
  w(
    ".vscode/settings.json",
    JSON.stringify({
      "editor.fontSize": 14,
      "revab.home": "/x",
      "chat.tools.autoApprove": { jira_search: true, knowledge_append: false, my_own_tool: true },
    }),
  );
  w(".revab/gateway.log", "log\n");
  // Stand-in for the `code` CLI: records its arguments.
  const fake = path.join(root, "fake-code.sh");
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${path.join(root, "code-calls.txt")}"\n`);
  chmodSync(fake, 0o755);
  return { root, fake };
}

const run = (root: string, fake: string, ...extra: string[]) =>
  spawnSync(
    process.execPath,
    ["--import", "tsx", path.join(REPO, "scripts", "extension.ts"), "uninstall", "--root", root, "--code", fake, "--keep-gateway", ...extra],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, JIRA_BASE_URL: "https://example.atlassian.net" } },
  );

test("--dry-run changes nothing and says what it would do", posixOnly, () => {
  const { root, fake } = fixture();
  const before = readFileSync(path.join(root, ".vscode", "mcp.json"), "utf8");
  const out = run(root, fake, "--dry-run", "--purge-config");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /would run: .*--uninstall-extension acme\.revab-agents/);
  assert.match(out.stdout, /would remove gateway, gateway-code/);
  assert.equal(readFileSync(path.join(root, ".vscode", "mcp.json"), "utf8"), before);
  assert.equal(existsSync(path.join(root, "code-calls.txt")), false, "must not call the code CLI");
  assert.equal(existsSync(path.join(root, ".revab")), true);
});

test("uninstall removes the extension, with no config changes unless asked", posixOnly, () => {
  const { root, fake } = fixture();
  const out = run(root, fake);
  assert.equal(out.status, 0, out.stderr);
  assert.match(readFileSync(path.join(root, "code-calls.txt"), "utf8"), /--uninstall-extension acme\.revab-agents/);
  assert.match(readFileSync(path.join(root, ".vscode", "mcp.json"), "utf8"), /"gateway"/, "config untouched without --purge-config");
  assert.match(out.stdout, /Re-run with --purge-config/);
});

test("--purge-config removes only revab's entries and never touches .env, knowledge or foreign settings", posixOnly, () => {
  const { root, fake } = fixture();
  const out = run(root, fake, "--purge-config");
  assert.equal(out.status, 0, out.stderr);

  const mcp = JSON.parse(readFileSync(path.join(root, ".vscode", "mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(mcp.servers), ["playwright"]);
  const claude = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(claude.mcpServers), ["mine"]);
  const settings = JSON.parse(readFileSync(path.join(root, ".vscode", "settings.json"), "utf8"));
  assert.deepEqual(settings, { "editor.fontSize": 14, "chat.tools.autoApprove": { my_own_tool: true } });
  assert.equal(existsSync(path.join(root, ".revab")), false, "runtime folder removed");

  assert.equal(readFileSync(path.join(root, ".env"), "utf8"), "JIRA_API_TOKEN=keep-me\n");
  assert.equal(readFileSync(path.join(root, "knowledge", "learnings.md"), "utf8"), "keep me\n");
});

test("running it twice is safe", posixOnly, () => {
  const { root, fake } = fixture();
  run(root, fake, "--purge-config");
  const again = run(root, fake, "--purge-config");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /nothing of revab's to remove/);
});

function homeFixture(withMarker: boolean) {
  const { root, fake } = fixture();
  const udd = path.join(root, "user-data");
  const home = path.join(udd, "User", "globalStorage", "acme.revab-agents", "home");
  mkdirSync(path.join(home, "knowledge"), { recursive: true });
  writeFileSync(path.join(home, ".env"), "JIRA_API_TOKEN=mine\n");
  writeFileSync(path.join(home, "knowledge", "learnings.md"), "mine\n");
  if (withMarker) writeFileSync(path.join(home, ".revab-home.json"), "{}");
  return { root, fake, udd, home };
}

test("--purge-home is never implied: a plain uninstall keeps the bundled home", posixOnly, () => {
  const { root, fake, udd, home } = homeFixture(true);
  const out = run(root, fake, "--user-data-dir", udd);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(existsSync(home), true);
  assert.match(out.stdout, /add --purge-home to delete it/);
});

test("--purge-home --dry-run reports what would go and deletes nothing", posixOnly, () => {
  const { root, fake, udd, home } = homeFixture(true);
  const out = run(root, fake, "--purge-home", "--dry-run", "--user-data-dir", udd);
  assert.match(out.stdout, /would delete the bundled home .*\(\d+ files; holds knowledge, \.env/);
  assert.equal(existsSync(path.join(home, ".env")), true);
});

test("--purge-home deletes the extension's home, and only when it carries the marker", posixOnly, () => {
  const marked = homeFixture(true);
  const out = run(marked.root, marked.fake, "--purge-home", "--user-data-dir", marked.udd);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(existsSync(marked.home), false);

  const unmarked = homeFixture(false);
  const kept = run(unmarked.root, unmarked.fake, "--purge-home", "--user-data-dir", unmarked.udd);
  assert.match(kept.stdout, /not the extension's home — left alone/);
  assert.equal(existsSync(path.join(unmarked.home, ".env")), true, "an unmarked folder is never deleted");
});
