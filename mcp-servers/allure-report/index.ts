import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";
import { resolveProjectRepoPath, assertWithinRepo } from "../../utils/manifest.js";
import { execCommand } from "../../utils/exec.js";

/**
 * Allure-report MCP server.
 *
 * Generates and analyzes Allure results for a target project (manifest-resolved
 * repoPath), never for revab-agents itself — this framework has no test suite
 * of its own to report on.
 */
interface AllureResult {
  name?: string;
  status?: string;
  statusDetails?: { message?: string };
  labels?: Array<{ name: string; value: string }>;
}

startMcpHttpServer({
  name: "allure-report",
  port: intEnv("ALLURE_REPORT_MCP_PORT", 7317),
  register(server) {
    server.registerTool(
      "generate_report",
      {
        description: "Generate the Allure HTML report for a target project (npm run report:generate in that repo).",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
        },
      },
      async ({ project }) => {
        try {
          const cwd = await resolveProjectRepoPath(project);
          const result = await execCommand("npm", ["run", "report:generate"], cwd);
          return textResult({ project, exitCode: result.code, stdout: result.stdout.slice(-2000) });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "allure_summary",
      {
        description:
          "Summarize the latest Allure results for a target project: status counts and failed test details.",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
          resultsDir: z.string().optional().describe("Relative to the project repo, default: reports/allure-results"),
        },
      },
      async ({ project, resultsDir }) => {
        try {
          const repoRoot = await resolveProjectRepoPath(project);
          const dir = path.resolve(repoRoot, resultsDir ?? "reports/allure-results");
          assertWithinRepo(repoRoot, dir);
          const entries = await fs.readdir(dir).catch(() => [] as string[]);
          const resultFiles = entries.filter((f) => f.endsWith("-result.json"));
          if (resultFiles.length === 0) {
            return textResult(`No Allure results found for project "${project}". Run run_bdd/run_playwright first.`);
          }
          const counts: Record<string, number> = {};
          const failures: Array<{ name?: string; message?: string }> = [];
          for (const file of resultFiles) {
            const raw = await fs.readFile(path.join(dir, file), "utf8");
            const result = JSON.parse(raw) as AllureResult;
            const status = result.status ?? "unknown";
            counts[status] = (counts[status] ?? 0) + 1;
            if (status === "failed" || status === "broken") {
              failures.push({ name: result.name, message: result.statusDetails?.message?.slice(0, 500) });
            }
          }
          return textResult({ project, total: resultFiles.length, counts, failures });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "get_result_json",
      {
        description: "Read one raw Allure -result.json file for a target project (for stack traces / attachments).",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
          resultId: z.string().describe("Result file name, e.g. '1234-result.json'"),
          resultsDir: z.string().optional().describe("Relative to the project repo, default: reports/allure-results"),
        },
      },
      async ({ project, resultId, resultsDir }) => {
        try {
          const repoRoot = await resolveProjectRepoPath(project);
          const dir = path.resolve(repoRoot, resultsDir ?? "reports/allure-results");
          assertWithinRepo(repoRoot, dir);
          const file = path.join(dir, path.basename(resultId));
          assertWithinRepo(repoRoot, file);
          const content = await fs.readFile(file, "utf8");
          return textResult(JSON.parse(content));
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
