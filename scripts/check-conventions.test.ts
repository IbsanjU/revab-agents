import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const CHECK_SCRIPT = path.resolve("scripts", "check-conventions.ts");

async function runCheckerIn(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["tsx", CHECK_SCRIPT], { cwd });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("check-conventions passes on a valid skill + registry setup", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-ok-"));
  try {
    await fs.mkdir(path.join(dir, "skills", "my-skill"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "skills", "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: Does a thing.\n---\n# My skill\n",
      "utf8"
    );
    await fs.mkdir(path.join(dir, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "agents", "registry.ts"),
      `export const handlers: Record<string, TaskHandler> = {\n` +
        `  "run-bdd": {\n` +
        `    async run(payload) {\n` +
        `      const project = requireProject(payload);\n` +
        `      const cwd = await resolveProjectRepoPath(project);\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
      "utf8"
    );
    const result = await runCheckerIn(dir);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /OK/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions flags a skill whose frontmatter name doesn't match its directory", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-badname-"));
  try {
    await fs.mkdir(path.join(dir, "skills", "my-skill"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "skills", "my-skill", "SKILL.md"),
      "---\nname: wrong-name\ndescription: Does a thing.\n---\n# My skill\n",
      "utf8"
    );
    const result = await runCheckerIn(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /does not match directory name/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions flags a skill missing frontmatter entirely", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-nofm-"));
  try {
    await fs.mkdir(path.join(dir, "skills", "my-skill"), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", "my-skill", "SKILL.md"), "# My skill\nNo frontmatter here.\n", "utf8");
    const result = await runCheckerIn(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Missing or malformed --- frontmatter/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions flags a registry handler that resolves a project path without guarding payload.project", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-noguard-"));
  try {
    await fs.mkdir(path.join(dir, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "agents", "registry.ts"),
      `export const handlers: Record<string, TaskHandler> = {\n` +
        `  "run-bdd": {\n` +
        `    async run(payload) {\n` +
        `      const cwd = await resolveProjectRepoPath(payload.somethingElse);\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
      "utf8"
    );
    const result = await runCheckerIn(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /calls resolveProjectRepoPath\(\.\.\.\) without first requiring/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions flags missing freshness cues in required agent prompts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-freshness-missing-"));
  try {
    const agentsDir = path.join(dir, ".github", "agents");
    await fs.mkdir(agentsDir, { recursive: true });
    const required = [
      "automation.agent.md",
      "bsa.agent.md",
      "documenter.agent.md",
      "orchestrator.agent.md",
      "planner.agent.md",
      "reporter.agent.md",
      "researcher.agent.md",
      "test-planner.agent.md",
    ];
    for (const file of required) {
      await fs.writeFile(path.join(agentsDir, file), "# Agent\nNo recency verification language here.\n", "utf8");
    }

    const result = await runCheckerIn(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Missing explicit freshness\/staleness cue/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions passes freshness rule when all required agent prompts include cues", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-freshness-ok-"));
  try {
    const agentsDir = path.join(dir, ".github", "agents");
    await fs.mkdir(agentsDir, { recursive: true });
    const required = [
      "automation.agent.md",
      "bsa.agent.md",
      "documenter.agent.md",
      "orchestrator.agent.md",
      "planner.agent.md",
      "reporter.agent.md",
      "researcher.agent.md",
      "test-planner.agent.md",
    ];
    for (const file of required) {
      await fs.writeFile(path.join(agentsDir, file), "# Agent\nAlways verify last-updated date and version before reuse.\n", "utf8");
    }

    const result = await runCheckerIn(dir);
    assert.equal(result.code, 0, result.stdout + result.stderr);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
