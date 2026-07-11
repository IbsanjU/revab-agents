import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { githubGet, githubMcpPort, defaultGithubOrg } from "../shared/githubHttp.js";

/**
 * GitHub MCP server: read-only search across an organization's repos (code, repo
 * metadata, issues/PRs, commits) plus a single-file fetch, so agents can pull in
 * "connecting sources" that live in code/docs rather than Jira/Confluence/JTMF.
 * Repo-agnostic like jira/confluence — org/repo are call-time qualifiers, not
 * resolved through projects.manifest.json (no local filesystem access here).
 */

type SearchScope = { org?: string; repo?: string };

/**
 * Compose GitHub search qualifiers for org/repo scoping. If neither is given and
 * GITHUB_ORG is configured, scope to that org by default (never a hardcoded org).
 */
function scopeQualifier({ org, repo }: SearchScope): string {
  if (repo) return `repo:${repo}`;
  if (org) return `org:${org}`;
  const fallbackOrg = defaultGithubOrg();
  return fallbackOrg ? `org:${fallbackOrg}` : "";
}

function buildQuery(query: string, scope: SearchScope, extraQualifiers: string[] = []): string {
  return [query, scopeQualifier(scope), ...extraQualifiers].filter(Boolean).join(" ");
}

interface CodeSearchItem {
  name: string;
  path: string;
  sha: string;
  html_url: string;
  repository: { full_name: string; html_url: string };
}

interface RepoSearchItem {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
}

interface IssueSearchItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  repository_url: string;
  pull_request?: unknown;
}

interface CommitSearchItem {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { name?: string; date?: string } };
  repository: { full_name: string };
}

interface SearchResponse<T> {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
}

startMcpHttpServer({
  name: "github",
  port: githubMcpPort(),
  register(server) {
    server.registerTool(
      "github_search_code",
      {
        description:
          "Search code across GitHub (defaults to GITHUB_ORG's repos if org/repo aren't given). " +
          "Returns file path, repo, and a direct html url per match.",
        inputSchema: {
          query: z.string().describe('Search terms, e.g. "retry logic" or GitHub code-search qualifiers like "extension:ts"'),
          org: z.string().optional().describe("Limit to an org (overrides GITHUB_ORG default)"),
          repo: z.string().optional().describe("Limit to a single repo, e.g. owner/repo (overrides org)"),
          language: z.string().optional().describe("Limit to a language, e.g. typescript"),
          path: z.string().optional().describe("Limit to a path prefix"),
          maxResults: z.number().optional().describe("Max items to return (default 20, max 100)"),
        },
      },
      async ({ query, org, repo, language, path, maxResults }) => {
        try {
          const qualifiers = [
            language ? `language:${language}` : "",
            path ? `path:${path}` : "",
          ];
          const q = buildQuery(query, { org, repo }, qualifiers);
          const data = await githubGet<SearchResponse<CodeSearchItem>>("/search/code", {
            q,
            per_page: Math.min(maxResults ?? 20, 100),
          });
          const items = data.items.map((item) => ({
            name: item.name,
            path: item.path,
            repo: item.repository.full_name,
            url: item.html_url,
          }));
          return textResult({ total_count: data.total_count, incomplete_results: data.incomplete_results, items });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "github_search_repos",
      {
        description:
          "Search repositories across GitHub (defaults to GITHUB_ORG if org isn't given). " +
          "Returns full name, description, language, stars, and a direct html url per match.",
        inputSchema: {
          query: z.string().describe('Search terms, e.g. "checkout service" or GitHub qualifiers'),
          org: z.string().optional().describe("Limit to an org (overrides GITHUB_ORG default)"),
          language: z.string().optional().describe("Limit to a language"),
          maxResults: z.number().optional().describe("Max items to return (default 20, max 100)"),
        },
      },
      async ({ query, org, language, maxResults }) => {
        try {
          const qualifiers = [language ? `language:${language}` : ""];
          const q = buildQuery(query, { org }, qualifiers);
          const data = await githubGet<SearchResponse<RepoSearchItem>>("/search/repositories", {
            q,
            per_page: Math.min(maxResults ?? 20, 100),
          });
          const items = data.items.map((item) => ({
            name: item.full_name,
            description: item.description,
            language: item.language,
            stars: item.stargazers_count,
            updatedAt: item.updated_at,
            url: item.html_url,
          }));
          return textResult({ total_count: data.total_count, incomplete_results: data.incomplete_results, items });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "github_search_issues",
      {
        description:
          "Search issues and pull requests across GitHub (defaults to GITHUB_ORG if org/repo aren't given). " +
          "Returns number, title, state, and a direct html url per match.",
        inputSchema: {
          query: z.string().describe('Search terms, e.g. "flaky login test"'),
          org: z.string().optional().describe("Limit to an org (overrides GITHUB_ORG default)"),
          repo: z.string().optional().describe("Limit to a single repo, e.g. owner/repo (overrides org)"),
          type: z.enum(["issue", "pr"]).optional().describe("Limit to issues or pull requests only"),
          state: z.enum(["open", "closed"]).optional(),
          maxResults: z.number().optional().describe("Max items to return (default 20, max 100)"),
        },
      },
      async ({ query, org, repo, type, state, maxResults }) => {
        try {
          const qualifiers = [
            type ? `is:${type}` : "",
            state ? `is:${state}` : "",
          ];
          const q = buildQuery(query, { org, repo }, qualifiers);
          const data = await githubGet<SearchResponse<IssueSearchItem>>("/search/issues", {
            q,
            per_page: Math.min(maxResults ?? 20, 100),
          });
          const items = data.items.map((item) => ({
            number: item.number,
            title: item.title,
            state: item.state,
            isPullRequest: Boolean(item.pull_request),
            url: item.html_url,
          }));
          return textResult({ total_count: data.total_count, incomplete_results: data.incomplete_results, items });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "github_search_commits",
      {
        description:
          "Search commit messages across GitHub (defaults to GITHUB_ORG if org/repo aren't given). " +
          "Returns sha, message, author, and a direct html url per match.",
        inputSchema: {
          query: z.string().describe('Search terms, e.g. "fix race condition"'),
          org: z.string().optional().describe("Limit to an org (overrides GITHUB_ORG default)"),
          repo: z.string().optional().describe("Limit to a single repo, e.g. owner/repo (overrides org)"),
          maxResults: z.number().optional().describe("Max items to return (default 20, max 100)"),
        },
      },
      async ({ query, org, repo, maxResults }) => {
        try {
          const q = buildQuery(query, { org, repo });
          const data = await githubGet<SearchResponse<CommitSearchItem>>("/search/commits", {
            q,
            per_page: Math.min(maxResults ?? 20, 100),
          });
          const items = data.items.map((item) => ({
            sha: item.sha.slice(0, 12),
            message: item.commit.message.split("\n")[0],
            author: item.commit.author?.name,
            date: item.commit.author?.date,
            repo: item.repository.full_name,
            url: item.html_url,
          }));
          return textResult({ total_count: data.total_count, incomplete_results: data.incomplete_results, items });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "github_get_file",
      {
        description:
          "Fetch a single file's text content from a GitHub repo (e.g. to read a source/doc surfaced by " +
          "github_search_code) — refuses files it can't decode as text (binary) or that exceed the size limit.",
        inputSchema: {
          repo: z.string().describe("owner/repo, e.g. myorg/myservice"),
          path: z.string().describe("Path to the file within the repo"),
          ref: z.string().optional().describe("Branch, tag, or commit SHA (default: repo's default branch)"),
        },
      },
      async ({ repo, path, ref }) => {
        try {
          const data = await githubGet<{
            name: string;
            path: string;
            sha: string;
            size: number;
            encoding: string;
            content?: string;
            html_url: string;
            type: string;
          }>(`/repos/${repo}/contents/${path}`, ref ? { ref } : undefined);

          if (data.type !== "file" || !data.content) {
            throw new Error(`${path} is not a single file (got type: ${data.type})`);
          }
          if (data.size > 500_000) {
            throw new Error(`${path} is ${data.size} bytes — too large to inline (limit 500KB)`);
          }
          const text = Buffer.from(data.content, data.encoding as BufferEncoding).toString("utf8");
          return textResult({ path: data.path, sha: data.sha, url: data.html_url, content: text });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
