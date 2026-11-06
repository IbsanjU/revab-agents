import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(EXT, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(EXT, "package.json"), "utf8")) as {
  engines: { vscode: string };
  devDependencies: Record<string, string>;
  activationEvents: string[];
  contributes: {
    chatAgents: Array<{ path: string }>;
    mcpServerDefinitionProviders: Array<{ id: string }>;
    commands: Array<{ command: string }>;
    configuration: { properties: Record<string, unknown> };
  };
};
const source = fs.readFileSync(path.join(EXT, "src", "extension.ts"), "utf8");

test("the bundled agents list matches the generated agent files exactly (no drift)", () => {
  const generated = fs.readdirSync(path.join(REPO, ".github", "agents")).filter((f) => f.endsWith(".agent.md")).sort();
  assert.deepEqual(
    pkg.contributes.chatAgents.map((a) => a.path),
    generated.map((f) => `./agents/${f}`),
    "run `npm run extension:package` and commit extension/package.json",
  );
});

test("the MCP provider id is declared in the manifest, as the editor requires", () => {
  const registered = /registerMcpServerDefinitionProvider\("([^"]+)"/.exec(source)?.[1];
  assert.ok(registered, "extension registers a provider");
  assert.ok(pkg.contributes.mcpServerDefinitionProviders.some((p) => p.id === registered));
});

test("every declared command is registered, and every registered command is declared", () => {
  const declared = pkg.contributes.commands.map((c) => c.command).sort();
  const registered = [...source.matchAll(/registerCommand\("([^"]+)"/g)].map((m) => m[1]!).sort();
  assert.deepEqual(registered, declared);
});

test("@types/vscode is pinned and not newer than the minimum editor version (vsce refuses otherwise)", () => {
  const min = pkg.engines.vscode.replace(/^\^/, "");
  assert.equal(pkg.devDependencies["@types/vscode"], min, "pin @types/vscode to engines.vscode exactly");
});

test("every revab.* setting the code reads is declared", () => {
  const read = new Set(
    [...source.matchAll(/c\.get<[^>]+>\("([a-zA-Z.]+)"/g)].map((m) => `revab.${m[1]}`),
  );
  for (const key of read) assert.ok(key in pkg.contributes.configuration.properties, `${key} is read but not declared`);
});

test("activation does not wait for a folder, so agents and tools work in any window", () => {
  assert.deepEqual(pkg.activationEvents, ["onStartupFinished"]);
});
