import { spawn } from "child_process";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";
import { resolveProjectRepoPath } from "../../utils/manifest.js";

/**
 * Git MCP server — read-only local git history/branch/diff search.
 *
 * Scoped to a manifest-resolved project's repoPath (same trust boundary as
 * playwright-runner/allure-report/codegen), or to this repo itself when `project`
 * is omitted (e.g. researching revab-agents' own history) — never a raw path.
 *
 * Every tool here runs the `git` binary directly via `spawn(..., { shell: false })`,
 * passing arguments as an argv array rather than a shell command line. That is the
 * injection mitigation: free-text inputs (search queries, author filters, refs) are
 * never interpreted by a shell, so they can't smuggle in `;`, `|`, backticks, etc.
 * Read-only by design: no clone/checkout/commit/push/reset tool is exposed here.
 */

const MAX_OUTPUT_CHARS = 8000;
const LOG_FORMAT = "%H|%ad|%an|%s";

function runGit(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Reject a repo-relative path that tries to escape the repo root. */
function assertSafeRelativePath(p: string): void {
  if (p.startsWith("/") || p.startsWith("\\") || p.split(/[\\/]/).includes("..")) {
    throw new Error(`Path must be repo-relative and cannot escape the repo root: ${p}`);
  }
}

async function resolveRepo(project?: string): Promise<string> {
  if (project) return resolveProjectRepoPath(project);
  return process.cwd();
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + "\n... (truncated)" : text;
}

function parseLog(stdout: string): Array<{ hash: string; date: string; author: string; subject: string }> {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, author, ...rest] = line.split("|");
      return { hash, date, author, subject: rest.join("|") };
    });
}

startMcpHttpServer({
  name: "git",
  port: intEnv("GIT_MCP_PORT", 7322),
  register(server) {
    server.registerTool(
      "git_log",
      {
        description:
          "Read-only commit history for a manifest-resolved project (or this repo if `project` is " +
          "omitted). Set `allBranches: true` to search history across every branch, not just the " +
          "current one — useful for finding related work done on a different branch before starting " +
          "something new.",
        inputSchema: {
          project: z.string().optional().describe("Project name from the manifest; omit to use this repo"),
          path: z.string().optional().describe("Repo-relative file/dir to scope history to"),
          maxCount: z.number().optional().describe("Max commits to return (default 20)"),
          allBranches: z.boolean().optional().describe("Search across all branches (--all), not just the current one"),
          since: z.string().optional().describe("Only commits after this date, e.g. '2 weeks ago' or '2026-06-01'"),
          author: z.string().optional().describe("Filter by author name/email substring"),
        },
      },
      async ({ project, path: relPath, maxCount, allBranches, since, author }) => {
        try {
          const cwd = await resolveRepo(project);
          if (relPath) assertSafeRelativePath(relPath);
          const args = ["log", "--date=iso", `--pretty=format:${LOG_FORMAT}`, "-n", String(maxCount ?? 20)];
          if (allBranches) args.push("--all");
          if (since) args.push(`--since=${since}`);
          if (author) args.push(`--author=${author}`);
          if (relPath) args.push("--", relPath);
          const result = await runGit(args, cwd);
          if (result.code !== 0) throw new Error(result.stderr || "git log failed");
          return textResult(parseLog(result.stdout));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "git_branches",
      {
        description:
          "List local and remote branches sorted by most recent activity, each with its last commit " +
          "date and subject. Check this before starting new work to see if a relevant branch already exists.",
        inputSchema: {
          project: z.string().optional().describe("Project name from the manifest; omit to use this repo"),
          includeRemote: z.boolean().optional().describe("Include remote-tracking branches (default true)"),
          maxCount: z.number().optional().describe("Max branches to return (default 30)"),
        },
      },
      async ({ project, includeRemote, maxCount }) => {
        try {
          const cwd = await resolveRepo(project);
          const args = [
            "branch",
            ...(includeRemote === false ? [] : ["-a"]),
            "--sort=-committerdate",
            "--format=%(refname:short)|%(committerdate:iso)|%(subject)",
          ];
          const result = await runGit(args, cwd);
          if (result.code !== 0) throw new Error(result.stderr || "git branch failed");
          const branches = result.stdout
            .split("\n")
            .filter(Boolean)
            .slice(0, maxCount ?? 30)
            .map((line) => {
              const [name, lastCommitDate, ...rest] = line.split("|");
              return { name, lastCommitDate, lastSubject: rest.join("|") };
            });
          return textResult(branches);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "git_search",
      {
        description:
          "Search git history for a topic/keyword. `mode: \"messages\"` (default) greps commit messages " +
          "across every branch — fast, good for 'has anyone worked on X'. `mode: \"content\"` greps file " +
          "contents at a single ref (default HEAD) via `git grep` — slower, scoped to one ref at a time.",
        inputSchema: {
          project: z.string().optional().describe("Project name from the manifest; omit to use this repo"),
          query: z.string().describe("Search text (plain substring or basic regex)"),
          mode: z.enum(["messages", "content"]).optional().describe("Default: messages"),
          ref: z.string().optional().describe("For mode:content — which ref to search (default HEAD)"),
          maxResults: z.number().optional().describe("Max matches to return (default 20)"),
        },
      },
      async ({ project, query, mode, ref, maxResults }) => {
        try {
          const cwd = await resolveRepo(project);
          const limit = maxResults ?? 20;
          if (mode === "content") {
            const args = ["grep", "-i", "-n", "-I", query, ref ?? "HEAD"];
            const result = await runGit(args, cwd);
            // git grep exits 1 when there are no matches — not an error.
            if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr || "git grep failed");
            const lines = result.stdout.split("\n").filter(Boolean).slice(0, limit);
            return textResult({ mode: "content", ref: ref ?? "HEAD", matches: lines });
          }
          const args = ["log", "--all", "-i", `--grep=${query}`, "--date=iso", `--pretty=format:${LOG_FORMAT}`, "-n", String(limit)];
          const result = await runGit(args, cwd);
          if (result.code !== 0) throw new Error(result.stderr || "git log --grep failed");
          return textResult({ mode: "messages", matches: parseLog(result.stdout) });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "git_diff",
      {
        description:
          "Read-only diff between two refs (or a ref and the working tree) for a manifest-resolved project.",
        inputSchema: {
          project: z.string().optional().describe("Project name from the manifest; omit to use this repo"),
          base: z.string().describe("Base ref, e.g. 'main' or a commit hash"),
          head: z.string().optional().describe("Head ref (omit to diff against the working tree)"),
          path: z.string().optional().describe("Repo-relative path to scope the diff to"),
        },
      },
      async ({ project, base, head, path: relPath }) => {
        try {
          const cwd = await resolveRepo(project);
          if (relPath) assertSafeRelativePath(relPath);
          const range = head ? `${base}..${head}` : base;
          const args = ["diff", range];
          if (relPath) args.push("--", relPath);
          const result = await runGit(args, cwd);
          if (result.code !== 0) throw new Error(result.stderr || "git diff failed");
          return textResult({ range, diff: truncate(result.stdout) });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "git_show",
      {
        description:
          "Show a commit's message/stat, or a file's content at a specific ref, for a manifest-resolved project.",
        inputSchema: {
          project: z.string().optional().describe("Project name from the manifest; omit to use this repo"),
          ref: z.string().describe("Commit-ish, e.g. 'HEAD', a branch name, or a commit hash"),
          path: z.string().optional().describe("Repo-relative file path to show at that ref"),
        },
      },
      async ({ project, ref, path: relPath }) => {
        try {
          const cwd = await resolveRepo(project);
          if (relPath) assertSafeRelativePath(relPath);
          const args = relPath ? ["show", `${ref}:${relPath}`] : ["show", "--stat", ref];
          const result = await runGit(args, cwd);
          if (result.code !== 0) throw new Error(result.stderr || "git show failed");
          return textResult({ ref, path: relPath ?? null, content: truncate(result.stdout) });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
