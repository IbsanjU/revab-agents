import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";

/**
 * Artifacts MCP server: repo-rooted file search/read, Allure result analysis,
 * and knowledge persistence for the self-improvement loop.
 * All paths are confined to the repository root.
 */
const ROOT = path.resolve(process.cwd());
const IGNORED = new Set(["node_modules", ".git", "dist", ".queue"]);

/** Resolve a relative path and refuse anything escaping the repo root. */
function safeResolve(relPath: string): string {
  const resolved = path.resolve(ROOT, relPath);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`Path escapes repository root: ${relPath}`);
  }
  return resolved;
}

async function walk(dir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, results);
    } else {
      results.push(path.relative(ROOT, full).replace(/\\/g, "/"));
    }
  }
}

interface AllureResult {
  name?: string;
  status?: string;
  statusDetails?: { message?: string };
  labels?: Array<{ name: string; value: string }>;
}

startMcpHttpServer({
  name: "artifacts",
  port: intEnv("ARTIFACTS_MCP_PORT", 7314),
  register(server) {
    server.registerTool(
      "list_files",
      {
        description:
          "List files in the repo (recursive), optionally filtered by a substring or regex on the relative path.",
        inputSchema: {
          dir: z.string().optional().describe("Subdirectory to search (default: repo root)"),
          match: z.string().optional().describe("Substring or JS regex to filter paths"),
          limit: z.number().optional().describe("Max entries (default 200)"),
        },
      },
      async ({ dir, match, limit }) => {
        try {
          const files: string[] = [];
          await walk(safeResolve(dir ?? "."), files);
          let filtered = files;
          if (match) {
            let regex: RegExp;
            try {
              regex = new RegExp(match, "i");
            } catch {
              regex = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            }
            filtered = files.filter((f) => regex.test(f));
          }
          return textResult(filtered.slice(0, limit ?? 200));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "read_repo_file",
      {
        description: "Read a file from the repo by relative path, optionally a line range.",
        inputSchema: {
          filePath: z.string().describe("Path relative to repo root"),
          startLine: z.number().optional().describe("1-based start line"),
          endLine: z.number().optional().describe("1-based end line (inclusive)"),
        },
      },
      async ({ filePath, startLine, endLine }) => {
        try {
          const content = await fs.readFile(safeResolve(filePath), "utf8");
          if (!startLine && !endLine) return textResult(content);
          const lines = content.split(/\r?\n/);
          const slice = lines.slice((startLine ?? 1) - 1, endLine ?? lines.length);
          return textResult(slice.join("\n"));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "allure_summary",
      {
        description:
          "Summarize the latest Allure results (reports/allure-results): status counts and failed test details.",
        inputSchema: {
          resultsDir: z.string().optional().describe("Default: reports/allure-results"),
        },
      },
      async ({ resultsDir }) => {
        try {
          const dir = safeResolve(resultsDir ?? "reports/allure-results");
          const entries = await fs.readdir(dir).catch(() => [] as string[]);
          const resultFiles = entries.filter((f) => f.endsWith("-result.json"));
          if (resultFiles.length === 0) {
            return textResult("No Allure results found. Run `npm run test:bdd` first.");
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
          return textResult({ total: resultFiles.length, counts, failures });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "knowledge_append",
      {
        description:
          "Append a dated entry to a knowledge file (knowledge/*.md). Used by agents to persist session learnings.",
        inputSchema: {
          file: z
            .string()
            .optional()
            .describe("Knowledge file name, e.g. learnings.md (default). Must live under knowledge/."),
          entry: z.string().describe("Markdown entry to append"),
        },
      },
      async ({ file, entry }) => {
        try {
          const name = path.basename(file ?? "learnings.md");
          if (!name.endsWith(".md")) throw new Error("Knowledge files must be .md");
          const target = safeResolve(path.join("knowledge", name));
          const stamp = new Date().toISOString().slice(0, 10);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.appendFile(target, `\n### ${stamp}\n${entry.trim()}\n`, "utf8");
          return textResult(`Appended entry to knowledge/${name}`);
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
