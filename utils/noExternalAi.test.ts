import { test } from "node:test";
import assert from "node:assert/strict";
import { findExternalAiUsage } from "./noExternalAi.js";

test("a provider SDK in any dependency section is reported", () => {
  const pkg = (section: string, name: string) => ({ path: "package.json", text: JSON.stringify({ [section]: { [name]: "1" } }) });
  for (const [section, name] of [["dependencies", "openai"], ["devDependencies", "@anthropic-ai/sdk"], ["dependencies", "@ai-sdk/openai"], ["optionalDependencies", "langchain"]]) {
    assert.equal(findExternalAiUsage([pkg(section, name)]).length, 1, `${name} in ${section}`);
  }
});

test("a hosted-model endpoint or provider key variable in code or config is reported", () => {
  assert.equal(findExternalAiUsage([{ path: "a.ts", text: 'fetch("https://api.openai.com/v1/chat")' }]).length, 1);
  assert.equal(findExternalAiUsage([{ path: ".env.example", text: "ANTHROPIC_API_KEY=" }]).length, 1);
});

test("MCP SDK, local tooling and ordinary dependencies are fine", () => {
  const ok = [
    { path: "package.json", text: JSON.stringify({ dependencies: { "@modelcontextprotocol/sdk": "1", zod: "3", tsx: "4", "pdf-parse": "1" } }) },
    { path: "utils/whisper.ts", text: "spawn('python', ['-m', 'faster_whisper'])" },
  ];
  assert.deepEqual(findExternalAiUsage(ok), []);
});

test("the real repository has no external AI provider dependency", async () => {
  const { promises: fs } = await import("fs");
  const path = await import("path");
  const files: Array<{ path: string; text: string }> = [];
  const skip = new Set(["node_modules", "dist", ".git", ".revab", "knowledge", "docs", "evals"]);
  async function walk(dir: string): Promise<void> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (skip.has(e.name) || e.name.endsWith(".test.ts") || e.name === "noExternalAi.ts" || e.name === "package-lock.json") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|mjs|js|json|md|example)$/.test(e.name) || e.name === ".env.example") files.push({ path: p, text: await fs.readFile(p, "utf8") });
    }
  }
  await walk(".");
  assert.deepEqual(findExternalAiUsage(files), []);
});
