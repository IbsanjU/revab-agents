import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";
import { resolveProjectRepoPath, getProject } from "../../utils/manifest.js";
import { execCommand } from "../../utils/exec.js";

/**
 * Playwright-runner MCP server.
 *
 * Executes a target project's own Playwright/Cucumber suite — it never runs tests
 * against revab-agents itself. `project` must be a name declared in
 * projects.manifest.json; the manifest is the only trust boundary for resolving
 * which directory a command may run in (see utils/manifest.ts).
 */
const TAG_PATTERN = /^[@\w\s()|&-]+$/;

async function walkFeatureFiles(dir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFeatureFiles(full, results);
    } else if (entry.name.endsWith(".feature")) {
      results.push(full);
    }
  }
}

startMcpHttpServer({
  name: "playwright-runner",
  port: intEnv("PLAYWRIGHT_RUNNER_MCP_PORT", 7316),
  register(server) {
    server.registerTool(
      "run_bdd",
      {
        description:
          "Run the target project's Cucumber/Playwright BDD suite (npm run test:bdd in that repo). Requires the project to declare a test:bdd script.",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
          tags: z.string().optional().describe("Cucumber tag expression, e.g. '@smoke'"),
        },
      },
      async ({ project, tags }) => {
        try {
          const cwd = await resolveProjectRepoPath(project);
          const args = ["run", "test:bdd"];
          if (tags) {
            if (!TAG_PATTERN.test(tags)) throw new Error(`Invalid tag expression: ${tags}`);
            args.push("--", "--tags", `"${tags}"`);
          }
          const result = await execCommand("npm", args, cwd);
          return textResult({
            project,
            exitCode: result.code,
            stdout: result.stdout.slice(-4000),
            stderr: result.stderr.slice(-4000),
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "run_playwright",
      {
        description:
          "Run the target project's Playwright test suite directly (npx playwright test), for repos using @playwright/test without Cucumber.",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
          grep: z.string().optional().describe("Playwright --grep pattern"),
          projectFlag: z.string().optional().describe("Playwright --project flag, e.g. 'chromium' or 'browserstack'"),
        },
      },
      async ({ project, grep, projectFlag }) => {
        try {
          const cwd = await resolveProjectRepoPath(project);
          const args = ["playwright", "test"];
          if (grep) args.push("--grep", grep);
          if (projectFlag) args.push("--project", projectFlag);
          const result = await execCommand("npx", args, cwd);
          return textResult({
            project,
            exitCode: result.code,
            stdout: result.stdout.slice(-4000),
            stderr: result.stderr.slice(-4000),
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "get_test_files",
      {
        description: "List Gherkin feature files under the target project's configured features path.",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
        },
      },
      async ({ project }) => {
        try {
          const cwd = await resolveProjectRepoPath(project);
          const config = await getProject(project);
          const featuresDir = path.join(cwd, config.testPaths.features);
          const files: string[] = [];
          await walkFeatureFiles(featuresDir, files);
          return textResult(files.map((f) => path.relative(cwd, f).replace(/\\/g, "/")));
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
