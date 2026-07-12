import { promises as fs } from "fs";
import path from "path";
import { execCommand } from "../utils/exec.js";
import { resolveProjectRepoPath } from "../utils/manifest.js";

/**
 * Task type registry: maps orchestrator task types to handlers.
 * Add new capabilities here — keep handlers generic and parameterized.
 * Handlers run whitelisted npm scripts only (no arbitrary shell from payloads).
 *
 * IMPORTANT: revab-agents never executes tests against itself. Any handler that runs
 * Playwright/Cucumber/Allure or writes test code must resolve `cwd` via
 * `resolveProjectRepoPath(project)` (utils/manifest.ts) — the manifest is the only
 * trust boundary for which directory a shell command may target. Never accept a raw
 * `repoPath` from a payload directly.
 */
export interface TaskHandler {
  description: string;
  run(payload: Record<string, unknown>): Promise<unknown>;
}

const TAG_PATTERN = /^[@\w\s()|&-]+$/; // cucumber tag expressions only
// Reject shell metacharacters in any payload value that ends up as an execCommand argv entry
// (execCommand uses spawn(..., { shell: true }) for Windows npm/npx shim compatibility, so
// argv entries are not immune to shell injection — validate untrusted input before use).
const SHELL_METACHAR_PATTERN = /[;&|`$(){}<>\n\r]/;

function requireProject(payload: Record<string, unknown>): string {
  const project = typeof payload.project === "string" ? payload.project : undefined;
  if (!project) throw new Error("payload.project (name from projects.manifest.json) is required");
  return project;
}

export const handlers: Record<string, TaskHandler> = {
  "run-bdd": {
    description:
      "Run the target project's Cucumber/Playwright BDD suite. Payload: { project: 'my-project', tags?: '@smoke' }",
    async run(payload) {
      const project = requireProject(payload);
      const cwd = await resolveProjectRepoPath(project);
      const args = ["run", "test:bdd"];
      const tags = typeof payload.tags === "string" ? payload.tags : undefined;
      if (tags) {
        if (!TAG_PATTERN.test(tags)) throw new Error(`Invalid tag expression: ${tags}`);
        args.push("--", "--tags", `"${tags}"`);
      }
      const result = await execCommand("npm", args, cwd);
      return { project, exitCode: result.code, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) };
    },
  },
  "generate-report": {
    description: "Generate the Allure report for a target project. Payload: { project: 'my-project' }",
    async run(payload) {
      const project = requireProject(payload);
      const cwd = await resolveProjectRepoPath(project);
      const result = await execCommand("npm", ["run", "report:generate"], cwd);
      return { project, exitCode: result.code, stdout: result.stdout.slice(-2000) };
    },
  },
  typecheck: {
    description: "Typecheck the revab-agents framework itself (not a target project).",
    async run() {
      const result = await execCommand("npm", ["run", "typecheck"]);
      return { exitCode: result.code, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) };
    },
  },
  "import-agents": {
    description: "Import agents/scripts from another repo. Payload: { source: 'C:/path/to/repo', dryRun?: true }",
    async run(payload) {
      const source = typeof payload.source === "string" ? payload.source : undefined;
      if (!source) throw new Error("payload.source (path to source repo) is required");
      if (SHELL_METACHAR_PATTERN.test(source)) {
        throw new Error(`payload.source contains disallowed shell metacharacters: ${source}`);
      }
      const resolved = path.resolve(source);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isDirectory()) {
        throw new Error(`payload.source does not resolve to an existing directory: ${resolved}`);
      }
      const args = ["run", "import:agents", "--", resolved];
      if (payload.dryRun) args.push("--dry-run");
      const result = await execCommand("npm", args);
      return { exitCode: result.code, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) };
    },
  },
};

export function listTaskTypes(): Array<{ type: string; description: string }> {
  return Object.entries(handlers).map(([type, h]) => ({ type, description: h.description }));
}
