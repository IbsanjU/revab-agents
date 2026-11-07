import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// The manifest module reads these at import time, so set them before anything imports it.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "revab-rec-tool-"));
const repo = path.join(root, "app");
await fs.mkdir(path.join(repo, ".playwright-recorder", "sessions", "s1"), { recursive: true });
await fs.writeFile(path.join(repo, ".playwright-recorder", "sessions", "s1", "manifest.json"), JSON.stringify({ status: "complete", counts: {} }));
await fs.writeFile(path.join(repo, ".playwright-recorder", "sessions", "s1", "network.ndjson"), JSON.stringify({ method: "GET", url: "https://a.test/x?token=SECRET", status: 500 }) + "\n");
const manifestPath = path.join(root, "projects.manifest.json");
await fs.writeFile(manifestPath, JSON.stringify({ projects: [{ name: "app", repoPath: repo, repoUrl: null, branch: null, testPaths: { features: "f", steps: "s", pages: "p", support: "u" } }] }));
process.env.MANIFEST_PATH_OVERRIDE = manifestPath;
process.env.PROJECTS_DIR_OVERRIDE = path.join(root, "none");

const { captureAllTools } = await import("../mcp-servers/gateway/tools.js");
const tools = await captureAllTools();
const tool = tools.find((t) => t.name === "recording_summary")!;
const call = async (args: Record<string, unknown>) => {
  const r = await tool.handler(args);
  const text = r.content[0].text;
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* errors are plain text */ }
  return { isError: r.isError, body: body as Record<string, unknown> };
};

test("recording_summary is registered on the allure-report server", () => {
  assert.equal(tool.server, "allure-report");
});

test("it finds the newest session in a project's repo and strips secrets from URLs", async () => {
  const r = await call({ project: "app" });
  assert.ok(!r.isError, JSON.stringify(r.body));
  const body = r.body as { recording: string; network: { failed: Array<{ url: string; status: number }> } };
  assert.equal(body.recording, path.join(".playwright-recorder", "sessions", "s1"), "the recorder's default output layout works with no arguments");
  assert.deepEqual(body.network.failed.map((f) => [f.url, f.status]), [["https://a.test/x", 500]]);
  assert.ok(!JSON.stringify(r.body).includes("SECRET"));
});

test("an unknown project and a path escaping the repo are refused", async () => {
  const unknown = await call({ project: "nope" });
  assert.ok(unknown.isError);
  assert.match(JSON.stringify(unknown.body), /nope/, "refused because the project is not in the manifest");
  const escape = await call({ project: "app", recordingDir: "../../etc" });
  assert.ok(escape.isError, "must not read outside the project repo");
  assert.match(JSON.stringify(escape.body), /outside|within|escape/i);
});

test("no recording gives a next step, not a crash", async () => {
  const r = await call({ project: "app", recordingDir: "empty" });
  assert.ok(r.isError);
  assert.match(JSON.stringify(r.body), /No recording found/);
});
