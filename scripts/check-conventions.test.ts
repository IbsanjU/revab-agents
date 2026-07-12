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

const MARKER = "<!-- shared-conduct:v1 -->";
const BOUNDARIES = "### Per-agent boundaries (can / cannot / must not)\n- **planner** — can: read.\n";

async function writeAgentFixture(dir: string, opts: { marker: boolean; boundaries?: string; agents?: string[] }) {
  await fs.mkdir(path.join(dir, ".github", "agents"), { recursive: true });
  await fs.writeFile(path.join(dir, ".github", "copilot-instructions.md"), opts.boundaries ?? BOUNDARIES, "utf8");
  for (const name of opts.agents ?? ["planner"]) {
    await fs.writeFile(
      path.join(dir, ".github", "agents", `${name}.agent.md`),
      `# ${name}\n${opts.marker ? MARKER + "\n## Conduct\n" : ""}`,
      "utf8"
    );
  }
}

test("check-conventions passes when every agent carries the shared-conduct marker and matches the boundaries list", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-conduct-ok-"));
  try {
    await writeAgentFixture(dir, { marker: true });
    const result = await runCheckerIn(dir);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /OK/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions flags an agent file missing the shared-conduct marker", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-conduct-nomarker-"));
  try {
    await writeAgentFixture(dir, { marker: false });
    const result = await runCheckerIn(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Missing shared-conduct marker/);
    assert.match(result.stderr, /npm run agents:conduct/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions flags a boundaries persona with no matching .agent.md file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-conduct-noagent-"));
  try {
    await writeAgentFixture(dir, {
      marker: true,
      boundaries: BOUNDARIES + "- **reporter** — can: report.\n",
    });
    const result = await runCheckerIn(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Persona "reporter" is listed under "Per-agent boundaries".*has no \.agent\.md file/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check-conventions flags an .agent.md file missing from the boundaries list", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-conventions-conduct-unlisted-"));
  try {
    await writeAgentFixture(dir, { marker: true, agents: ["planner", "mystery"] });
    const result = await runCheckerIn(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Agent "mystery" .* is missing from the "Per-agent boundaries" list/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
