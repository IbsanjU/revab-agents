import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";
import { resolveProjectRepoPath, getProject, assertWithinRepo } from "../../utils/manifest.js";

/**
 * Codegen MCP server.
 *
 * Scaffolds/updates Gherkin features, step definitions, and page objects
 * INSIDE a target project's manifest-declared testPaths — never inside
 * revab-agents itself. Follows the conventions documented in
 * .github/instructions/playwright-bdd.instructions.md, which describes what
 * this tool must write into a target repo (not conventions for this repo).
 *
 * Every write requires a `source` citation (Jira key / Confluence page id /
 * transcript timestamp / app-model reference) to be embedded as a Gherkin
 * comment, so generated artifacts stay traceable — this is the anti-hallucination
 * guardrail agents (test-planner, automation) must always populate.
 */
async function writeNoOverwrite(filePath: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
    return `Skipped (already exists): ${filePath}`;
  } catch {
    await fs.writeFile(filePath, content, "utf8");
    return `Created: ${filePath}`;
  }
}

startMcpHttpServer({
  name: "codegen",
  port: intEnv("CODEGEN_MCP_PORT", 7318),
  register(server) {
    server.registerTool(
      "scaffold_feature",
      {
        description:
          "Write a Gherkin .feature file into the target project's configured features path. Requires a source citation.",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
          fileName: z.string().describe("File name, e.g. 'checkout.feature'"),
          content: z.string().describe("Full Gherkin content"),
          source: z
            .string()
            .describe("Citation for traceability, e.g. 'Jira ABC-123' or 'Confluence page 456' — required"),
        },
      },
      async ({ project, fileName, content, source }) => {
        try {
          if (!source.trim()) throw new Error("source citation is required — do not generate uncited scenarios");
          const repoRoot = await resolveProjectRepoPath(project);
          const config = await getProject(project);
          const target = path.resolve(repoRoot, config.testPaths.features, path.basename(fileName));
          assertWithinRepo(repoRoot, target);
          const annotated = `# Source: ${source}\n${content.trimEnd()}\n`;
          return textResult(await writeNoOverwrite(target, annotated));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "scaffold_step",
      {
        description: "Write a TypeScript step-definition file into the target project's configured steps path.",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
          fileName: z.string().describe("File name, e.g. 'checkout.steps.ts'"),
          content: z.string().describe("Full TypeScript content"),
        },
      },
      async ({ project, fileName, content }) => {
        try {
          const repoRoot = await resolveProjectRepoPath(project);
          const config = await getProject(project);
          const target = path.resolve(repoRoot, config.testPaths.steps, path.basename(fileName));
          assertWithinRepo(repoRoot, target);
          return textResult(await writeNoOverwrite(target, content));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "scaffold_page",
      {
        description: "Write a TypeScript page-object file into the target project's configured pages path.",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
          fileName: z.string().describe("File name, e.g. 'checkout.page.ts'"),
          content: z.string().describe("Full TypeScript content"),
        },
      },
      async ({ project, fileName, content }) => {
        try {
          const repoRoot = await resolveProjectRepoPath(project);
          const config = await getProject(project);
          const target = path.resolve(repoRoot, config.testPaths.pages, path.basename(fileName));
          assertWithinRepo(repoRoot, target);
          return textResult(await writeNoOverwrite(target, content));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "detect_conventions",
      {
        description:
          "Inspect a target project's package.json and existing test files to detect its automation stack (Playwright/Cucumber versions, BrowserStack indicators, existing dir layout).",
        inputSchema: {
          project: z.string().describe("Project name from projects.manifest.json"),
        },
      },
      async ({ project }) => {
        try {
          const repoRoot = await resolveProjectRepoPath(project);
          const pkgPath = path.join(repoRoot, "package.json");
          const pkgRaw = await fs.readFile(pkgPath, "utf8").catch(() => undefined);
          if (!pkgRaw) {
            return textResult({
              project,
              hasPackageJson: false,
              note: "No package.json found — not a Node/TS project; codegen scaffolding is not supported for this stack.",
            });
          }
          const pkg = JSON.parse(pkgRaw) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            scripts?: Record<string, string>;
          };
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          const hasPlaywright = "@playwright/test" in deps;
          const hasCucumber = "@cucumber/cucumber" in deps;
          const hasAllure = Object.keys(deps).some((d) => d.startsWith("allure"));
          const hasBrowserStackSdk = Object.keys(deps).some((d) => d.toLowerCase().includes("browserstack"));
          const envRaw = await fs.readFile(path.join(repoRoot, ".env.example"), "utf8").catch(() => "");
          const hasBrowserStackEnv = /BROWSERSTACK_/i.test(envRaw);
          const hasBrowserStackYml = await fs
            .access(path.join(repoRoot, "browserstack.yml"))
            .then(() => true)
            .catch(() => false);
          return textResult({
            project,
            hasPackageJson: true,
            playwrightVersion: deps["@playwright/test"] ?? null,
            cucumberVersion: deps["@cucumber/cucumber"] ?? null,
            hasAllure,
            browserstackDetected: hasBrowserStackSdk || hasBrowserStackEnv || hasBrowserStackYml,
            scripts: pkg.scripts ?? {},
            supported: hasPlaywright,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
