import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { execCommand } from "./exec.js";

/**
 * Project manifest loader/validator.
 *
 * `revab-agents` never operates on its own files as "the project under test" —
 * every MCP tool / orchestrator task that touches test code, runs Playwright/Cucumber,
 * or reads Allure results must resolve a target repo path through this manifest.
 * This is the trust boundary: only `repoPath`s that resolve from a manifest entry
 * may be used as a command `cwd` or file-write root. Never accept a raw,
 * un-cross-checked path/URL directly from a task payload or tool argument.
 */

const TestPathsSchema = z.object({
  features: z.string(),
  steps: z.string(),
  pages: z.string(),
  support: z.string(),
});

const ExecutionSchema = z.object({
  mode: z.enum(["local", "browserstack", "custom"]).default("local"),
  browserstack: z
    .object({
      usernameEnvVar: z.string().default("BROWSERSTACK_USERNAME"),
      accessKeyEnvVar: z.string().default("BROWSERSTACK_ACCESS_KEY"),
      browsers: z.array(z.string()).default([]),
    })
    .optional(),
  customConvention: z.string().optional(),
});

const ProjectSchema = z.object({
  name: z.string().min(1),
  repoPath: z.string().nullable().default(null),
  repoUrl: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  testPaths: TestPathsSchema,
  jira: z.object({ projectKey: z.string(), defaultJql: z.string().optional() }).optional(),
  confluence: z.object({ spaceKey: z.string() }).optional(),
  jtmf: z.object({ projectId: z.string(), testPlanId: z.string().nullable().optional() }).optional(),
  execution: ExecutionSchema.default({ mode: "local" }),
});

const ManifestSchema = z.object({
  projects: z.array(ProjectSchema).min(1),
});

export type Project = z.infer<typeof ProjectSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

const MANIFEST_PATH = path.resolve(process.cwd(), "projects.manifest.json");
const WORKSPACES_ROOT = path.resolve(process.cwd(), ".workspaces");

let cached: Manifest | undefined;

/** Load and validate projects.manifest.json. Fails fast with a clear error on invalid/missing fields. */
export async function loadManifest(force = false): Promise<Manifest> {
  if (cached && !force) return cached;
  let raw: string;
  try {
    raw = await fs.readFile(MANIFEST_PATH, "utf8");
  } catch {
    throw new Error(
      `Missing projects.manifest.json at repo root. Add a project entry before running any project-scoped tool.`
    );
  }
  const parsed = ManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid projects.manifest.json:\n${parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Get a single project entry by name. Throws if not found — never silently defaults. */
export async function getProject(name: string): Promise<Project> {
  const manifest = await loadManifest();
  const project = manifest.projects.find((p) => p.name === name);
  if (!project) {
    const known = manifest.projects.map((p) => p.name).join(", ") || "(none)";
    throw new Error(`Unknown project "${name}" in projects.manifest.json. Known projects: ${known}`);
  }
  return project;
}

/**
 * Resolve the local checkout path for a project (trust-boundary enforcement point).
 * - If `repoPath` is set, it must exist locally and is used as-is (resolved relative to repo root).
 * - If only `repoUrl` is set, shallow-clone (or fetch+checkout if already cloned) into
 *   `.workspaces/<project>/` and return that path. Credentials come from the environment
 *   only (e.g. a credential helper or SSH agent) — never persisted in the manifest.
 */
export async function resolveProjectRepoPath(name: string): Promise<string> {
  const project = await getProject(name);

  if (project.repoPath) {
    const resolved = path.resolve(process.cwd(), project.repoPath);
    try {
      await fs.access(resolved);
    } catch {
      throw new Error(`Project "${name}" repoPath does not exist locally: ${resolved}`);
    }
    return resolved;
  }

  if (project.repoUrl) {
    const workspace = path.join(WORKSPACES_ROOT, name);
    try {
      await fs.access(path.join(workspace, ".git"));
      // Already cloned — refresh instead of re-cloning.
      await execCommand("git", ["fetch", "origin"], workspace);
      await execCommand("git", ["checkout", project.branch ?? "HEAD"], workspace);
      await execCommand("git", ["pull", "--ff-only"], workspace);
    } catch {
      await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
      const args = ["clone", "--depth", "1"];
      if (project.branch) args.push("--branch", project.branch);
      args.push(project.repoUrl, workspace);
      const result = await execCommand("git", args);
      if (result.code !== 0) {
        throw new Error(`Failed to clone ${project.repoUrl} for project "${name}":\n${result.stderr}`);
      }
    }
    return workspace;
  }

  throw new Error(`Project "${name}" has neither repoPath nor repoUrl set in projects.manifest.json.`);
}

/**
 * Validate that a candidate absolute path is within a resolved project repo root.
 * Use this before any file write triggered by a tool argument, to prevent path escape.
 */
export function assertWithinRepo(repoRoot: string, candidate: string): void {
  const resolved = path.resolve(candidate);
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    throw new Error(`Path escapes project repo root: ${candidate}`);
  }
}
