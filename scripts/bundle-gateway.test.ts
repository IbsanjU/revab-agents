/**
 * Builds the real bundle and runs it the way an installed extension would: copied OUTSIDE the
 * repository (so it cannot quietly borrow the repo's node_modules), with its own empty-ish home
 * folder as the working directory. Slow (builds and copies ~100 MB), so one test does it all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleGateway } from "./bundle-gateway.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 7396;
const DOCTOR_PORT = 7397;

const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

test("the bundled gateway runs outside the repo with only its shipped packages", { timeout: 180_000 }, async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "revab-bundle-"));
  let child: ChildProcess | undefined;
  try {
    const out = path.join(work, "ext", "bundle");
    const result = await bundleGateway({ outDir: out, root: REPO });
    assert.ok(result.bytes > 1_000_000, "the bundle contains the servers");
    assert.ok(result.packages.includes("tesseract.js") && result.packages.includes("pdfkit") && result.packages.includes("pdf-parse"));
    assert.ok(!result.packages.some((p) => p.startsWith("@napi-rs/")), "no platform-specific native packages");

    const home = path.join(work, "home");
    mkdirSync(path.join(home, "knowledge"), { recursive: true });
    mkdirSync(path.join(home, "reports"), { recursive: true });
    cpSync(path.join(REPO, "projects"), path.join(home, "projects"), { recursive: true });
    writeFileSync(path.join(home, "knowledge", "note.md"), "bundled gateway searchable text: zebra-quartz\n");
    const env: NodeJS.ProcessEnv = { ...process.env, JIRA_BASE_URL: "https://example.atlassian.net", GATEWAY_MCP_PORT: String(PORT) };
    delete env.NODE_OPTIONS;

    // `doctor` must not start a gateway: in a one-file bundle every module shares one URL, and the
    // "am I the entry point" guard would otherwise start it on import.
    const doctor = spawnSync(process.execPath, [result.file, "doctor", "--json"], {
      cwd: home,
      env: { ...env, GATEWAY_MCP_PORT: String(DOCTOR_PORT) },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.match(doctor.stdout, /"name"/, `doctor should print a report: ${doctor.stderr}`);
    assert.equal(await listening(DOCTOR_PORT), false, "doctor must not leave a gateway running");

    const logPath = path.join(work, "gateway.log");
    const logFd = openSync(logPath, "w");
    child = spawn(process.execPath, [result.file, "start"], { cwd: home, env, stdio: ["ignore", logFd, logFd] });
    closeSync(logFd);
    const base = `http://127.0.0.1:${PORT}`;
    let health: { tools: number } | undefined;
    for (let i = 0; i < 60 && !health; i++) {
      await new Promise((r) => setTimeout(r, 500));
      health = (await fetch(`${base}/health`).then((r) => r.json()).catch(() => undefined)) as typeof health;
    }
    assert.ok(health, `the bundled gateway should come up. Log: ${readFileSync(logPath, "utf8").split("\n").slice(-12).join(" | ")}`);

    const { captureAllTools } = await import("../mcp-servers/gateway/tools.js");
    assert.equal(health.tools, (await captureAllTools()).length, "the bundle hosts every tool the sources do");

    const post = async (p: string, body: unknown) => (await fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<Record<string, any>>;

    const found = await post("/api/artifacts/knowledge_search", { query: "zebra-quartz" });
    assert.ok(JSON.stringify(found).includes("note.md"), "tools read files from the home folder (the working directory)");

    // Proves the packages that cannot be bundled were shipped and resolve from beside the bundle.
    const made = await post("/api/media/create_pdf", { targetPath: "reports/t.pdf", title: "T", sections: [{ heading: "H", body: "pdf round trip works" }] });
    const text = await post("/api/media/read_pdf_text", { filePath: "reports/t.pdf" });
    assert.match(String(text.text), /pdf round trip works/, `create_pdf said ${JSON.stringify(made)}; read_pdf_text said ${JSON.stringify(text)}`);

    const code = await post("/api/codemode/codemode_execute", { code: "return 6 * 7" });
    assert.equal(code.result, 42, "Code Mode's worker sandbox works from the bundle");
  } finally {
    child?.kill();
    rmSync(work, { recursive: true, force: true });
  }
});
