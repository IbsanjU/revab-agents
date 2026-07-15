import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { env, intEnv } from "../shared/config.js";
import { apiGet, apiPost, apiPut, apiDelete } from "../shared/http.js";
import { resolveWithinRoot } from "../../utils/fsSafety.js";
import { buildSaveConfirmationPrompt } from "../../utils/saveSuggestion.js";
import { buildJiraIssueUrl } from "../../utils/jiraLinks.js";

const base = () => env("JIRA_BASE_URL");
const DEFAULT_FIELDS = "summary,status,issuetype,assignee,priority,labels,fixVersions,parent";
const ROOT = path.resolve(process.cwd());
const DEFAULT_SAVE_DIR = "downloads/jira";

/** Escape a string for safe embedding in a JQL string literal (summary ~ "..."). */
function escapeJqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const BulkIssueDraft = z.object({
  projectKey: z.string().describe("Jira project key, e.g. ABC"),
  issueType: z.string().describe("Issue type name, e.g. Story, Bug, Task"),
  summary: z.string().describe("Issue title"),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  fields: z.record(z.unknown()).optional().describe("Additional raw Jira fields to merge in (e.g. assignee, priority, components, story points, epic link, sprint)"),
});

startMcpHttpServer({
  name: "jira",
  port: intEnv("JIRA_MCP_PORT", 7311),
  register(server) {
    server.registerTool(
      "jira_search",
      {
        description:
          "Search Jira issues with JQL. Returns key, summary, status, type, assignee, and a direct " +
          "browse url (for citing sources / linking back to complete information) for each match.",
        inputSchema: {
          jql: z.string().describe('JQL query, e.g. \'project = ABC AND sprint in openSprints()\''),
          maxResults: z.number().optional().describe("Max issues to return (default 25)"),
          fields: z.string().optional().describe("Comma-separated field list to return"),
        },
      },
      async ({ jql, maxResults, fields }) => {
        try {
          const data = await apiGet<{ issues?: Array<{ key: string; [k: string]: unknown }> }>(
            base(),
            "/rest/api/2/search",
            {
              jql,
              maxResults: maxResults ?? 25,
              fields: fields ?? DEFAULT_FIELDS,
            }
          );
          const issues = data.issues?.map((issue) => ({ ...issue, url: buildJiraIssueUrl(base(), issue.key) }));
          return textResult({ ...data, issues });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_save_issue",
      {
        description:
          "Pull a Jira issue to local disk as JSON (full fields + comments). If `project` is omitted, no " +
          "files are written — the tool instead returns a suggested project folder name " +
          "(e.g. `downloads/jira/PROJ-XXX`, derived from the issue key) so the agent can ask the user to " +
          "confirm or override it before saving. Re-call with an explicit `project` once confirmed.",
        inputSchema: {
          key: z.string().describe("Issue key, e.g. ABC-123"),
          project: z
            .string()
            .optional()
            .describe("Confirmed local folder name to save under (ask the user first if not provided)"),
          targetDir: z.string().optional().describe("Repo-relative base dir (default downloads/jira)"),
        },
      },
      async ({ key, project, targetDir }) => {
        try {
          const [issue, comments] = await Promise.all([
            apiGet(base(), `/rest/api/2/issue/${encodeURIComponent(key)}`, { expand: "renderedFields" }),
            apiGet(base(), `/rest/api/2/issue/${encodeURIComponent(key)}/comment`).catch(() => undefined),
          ]);
          const baseDir = targetDir ?? DEFAULT_SAVE_DIR;

          if (!project) {
            const prompt = buildSaveConfirmationPrompt(key, baseDir);
            return textResult({ needsConfirmation: true, key, ...prompt });
          }

          const dir = resolveWithinRoot(ROOT, path.join(baseDir, project));
          await fs.mkdir(dir, { recursive: true });
          const fileName = `${key}.json`;
          const payload = { key, savedAt: new Date().toISOString(), issue, comments };
          await fs.writeFile(path.join(dir, fileName), JSON.stringify(payload, null, 2), "utf8");

          return textResult({
            savedTo: path.relative(ROOT, path.join(dir, fileName)).replace(/\\/g, "/"),
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_get_issue",
      {
        description:
          "Get a Jira issue by key with full details (description, acceptance criteria, comments, links).",
        inputSchema: {
          key: z.string().describe("Issue key, e.g. ABC-123"),
          fields: z.string().optional().describe("Comma-separated field list (default: all)"),
        },
      },
      async ({ key, fields }) => {
        try {
          const data = await apiGet(base(), `/rest/api/2/issue/${encodeURIComponent(key)}`, {
            fields,
            expand: "renderedFields",
          });
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_get_epic_children",
      {
        description: "List all issues that belong to an epic (children / Epic Link).",
        inputSchema: {
          epicKey: z.string().describe("Epic key, e.g. ABC-100"),
          maxResults: z.number().optional(),
        },
      },
      async ({ epicKey, maxResults }) => {
        try {
          const jql = `parent = ${epicKey} OR "Epic Link" = ${epicKey} ORDER BY rank`;
          const data = await apiGet(base(), "/rest/api/2/search", {
            jql,
            maxResults: maxResults ?? 100,
            fields: DEFAULT_FIELDS + ",description",
          });
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_add_comment",
      {
        description: "Add a comment to a Jira issue.",
        inputSchema: {
          key: z.string().describe("Issue key, e.g. ABC-123"),
          body: z.string().describe("Comment text (plain text or Jira wiki markup)"),
        },
      },
      async ({ key, body }) => {
        try {
          const data = await apiPost(base(), `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
            body,
          });
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_search_users",
      {
        description:
          "Search Jira users by name/email — resolve a person to an accountId before assigning an issue " +
          "(jira_assign_issue) or building a bulk-create batch. Never guess an accountId. If projectKey is " +
          "given, restricts results to users assignable to that project.",
        inputSchema: {
          query: z.string().describe("Name or email fragment to search for"),
          projectKey: z.string().optional().describe("Restrict to users assignable to this Jira project"),
          maxResults: z.number().optional().describe("Max results (default 20)"),
        },
      },
      async ({ query, projectKey, maxResults }) => {
        try {
          const searchPath = projectKey ? "/rest/api/2/user/assignable/search" : "/rest/api/2/user/search";
          const params: Record<string, string | number> = { query, maxResults: maxResults ?? 20 };
          if (projectKey) params.project = projectKey;
          const data = await apiGet<Array<{ accountId: string; displayName: string; emailAddress?: string; active: boolean }>>(
            base(),
            searchPath,
            params
          );
          return textResult({
            users: data.map((u) => ({
              accountId: u.accountId,
              displayName: u.displayName,
              emailAddress: u.emailAddress,
              active: u.active,
            })),
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_create_issue",
      {
        description:
          "Create a new Jira issue. dryRun (default true) previews the payload without sending it — always search first to avoid duplicates.",
        inputSchema: {
          projectKey: z.string().describe("Jira project key, e.g. ABC"),
          issueType: z.string().describe("Issue type name, e.g. Story, Bug, Task"),
          summary: z.string().describe("Issue title"),
          description: z.string().optional(),
          labels: z.array(z.string()).optional(),
          fields: z.record(z.unknown()).optional().describe("Additional raw Jira fields to merge in"),
          dryRun: z.boolean().optional().describe("If true (default), return the payload without creating anything"),
        },
      },
      async ({ projectKey, issueType, summary, description, labels, fields, dryRun }) => {
        try {
          const payloadFields: Record<string, unknown> = {
            project: { key: projectKey },
            issuetype: { name: issueType },
            summary,
            ...(description ? { description } : {}),
            ...(labels ? { labels } : {}),
            ...(fields ?? {}),
          };
          if (dryRun ?? true) {
            return textResult({ dryRun: true, wouldCreate: { fields: payloadFields } });
          }
          const data = await apiPost(base(), "/rest/api/2/issue", { fields: payloadFields });
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_bulk_create_issues",
      {
        description:
          "Create many Jira issues in one batch — e.g. from a parsed Excel/CSV sheet (see media server's " +
          "read_excel_rows/read_csv_rows) or a list of chat-described tickets. Dedup-checks every row against " +
          "existing issues by summary before creating (set skipDedupe to bypass). dryRun (default true) returns " +
          "the full batch preview — including any detected duplicates — without creating anything. Each row " +
          "succeeds/fails/skips independently; a bad row never blocks the rest of the batch.",
        inputSchema: {
          issues: z.array(BulkIssueDraft).min(1).describe("Issue drafts to create"),
          skipDedupe: z.boolean().optional().describe("Skip the pre-create duplicate search (default false)"),
          dryRun: z.boolean().optional().describe("If true (default), return the full batch preview without creating anything"),
        },
      },
      async ({ issues, skipDedupe, dryRun }) => {
        try {
          const preview = await Promise.all(
            issues.map(async (draft, index) => {
              const payloadFields: Record<string, unknown> = {
                project: { key: draft.projectKey },
                issuetype: { name: draft.issueType },
                summary: draft.summary,
                ...(draft.description ? { description: draft.description } : {}),
                ...(draft.labels ? { labels: draft.labels } : {}),
                ...(draft.fields ?? {}),
              };
              let potentialDuplicates: Array<{ key: string; summary: string; url: string }> = [];
              if (!skipDedupe) {
                const jql = `project = ${draft.projectKey} AND summary ~ "${escapeJqlString(draft.summary)}" ORDER BY created DESC`;
                const found = await apiGet<{ issues?: Array<{ key: string; fields: { summary: string } }> }>(
                  base(),
                  "/rest/api/2/search",
                  { jql, maxResults: 5, fields: "summary" }
                ).catch(() => ({ issues: [] as Array<{ key: string; fields: { summary: string } }> }));
                potentialDuplicates = (found.issues ?? [])
                  .filter((i) => i.fields.summary.trim().toLowerCase() === draft.summary.trim().toLowerCase())
                  .map((i) => ({ key: i.key, summary: i.fields.summary, url: buildJiraIssueUrl(base(), i.key) }));
              }
              return { index, fields: payloadFields, potentialDuplicates };
            })
          );

          if (dryRun ?? true) {
            return textResult({ dryRun: true, batchSize: issues.length, preview });
          }

          const results: Array<Record<string, unknown>> = [];
          for (const row of preview) {
            if (row.potentialDuplicates.length > 0) {
              results.push({ index: row.index, skipped: true, reason: "duplicate", duplicates: row.potentialDuplicates });
              continue;
            }
            try {
              const data = await apiPost<{ key: string }>(base(), "/rest/api/2/issue", { fields: row.fields });
              results.push({ index: row.index, key: data.key, url: buildJiraIssueUrl(base(), data.key) });
            } catch (err) {
              results.push({ index: row.index, error: err instanceof Error ? err.message : String(err) });
            }
          }
          return textResult({
            batchSize: issues.length,
            created: results.filter((r) => "key" in r).length,
            skipped: results.filter((r) => r.skipped).length,
            failed: results.filter((r) => "error" in r).length,
            results,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    // jira_delete_issue is intentionally NOT registered — see the commented-out block below.
    // A BSA corrects/closes tickets; it never deletes Jira history. Kept in source (rather than
    // removed) so the full CRUD implementation is auditable and can be re-enabled deliberately
    // (uncomment + restart the jira MCP server) if a future workflow genuinely needs it.
    /*
    server.registerTool(
      "jira_delete_issue",
      {
        description:
          "Delete a Jira issue. Destructive and irreversible. dryRun (default true) previews the deletion without applying it.",
        inputSchema: {
          key: z.string().describe("Issue key, e.g. ABC-123"),
          deleteSubtasks: z.boolean().optional().describe("Also delete subtasks (default false)"),
          dryRun: z.boolean().optional().describe("If true (default), return the intended deletion without applying it"),
        },
      },
      async ({ key, deleteSubtasks, dryRun }) => {
        try {
          if (dryRun ?? true) {
            return textResult({ dryRun: true, wouldDelete: key, deleteSubtasks: deleteSubtasks ?? false });
          }
          const path = `/rest/api/2/issue/${encodeURIComponent(key)}${deleteSubtasks ? "?deleteSubtasks=true" : ""}`;
          const { status } = await apiDelete(base(), path);
          return textResult({ deleted: key, status });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
    */

    server.registerTool(
      "jira_update_issue",
      {
        description:
          "Update fields on a Jira issue (e.g. summary, description, labels). dryRun (default true) previews the payload without sending it.",
        inputSchema: {
          key: z.string().describe("Issue key, e.g. ABC-123"),
          fields: z.record(z.unknown()).describe("Jira field map to update, e.g. { summary: 'New title' }"),
          dryRun: z.boolean().optional().describe("If true (default), return the payload without updating anything"),
        },
      },
      async ({ key, fields, dryRun }) => {
        try {
          if (dryRun ?? true) {
            return textResult({ dryRun: true, key, wouldUpdate: { fields } });
          }
          const { status } = await apiPut(base(), `/rest/api/2/issue/${encodeURIComponent(key)}`, { fields });
          return textResult({ updated: key, status });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_transition_issue",
      {
        description:
          "Transition a Jira issue to a new workflow status (e.g. 'Done', 'In Progress'). dryRun (default true) lists available transitions and previews without applying.",
        inputSchema: {
          key: z.string().describe("Issue key, e.g. ABC-123"),
          transitionName: z.string().describe("Target status/transition name, e.g. 'Done' (case-insensitive match)"),
          comment: z.string().optional().describe("Optional comment to add with the transition"),
          dryRun: z.boolean().optional().describe("If true (default), only list available transitions without applying"),
        },
      },
      async ({ key, transitionName, comment, dryRun }) => {
        try {
          const transitionsData = await apiGet<{ transitions: Array<{ id: string; name: string }> }>(
            base(),
            `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`
          );
          const match = transitionsData.transitions.find(
            (t) => t.name.toLowerCase() === transitionName.toLowerCase()
          );
          if (dryRun ?? true) {
            return textResult({
              dryRun: true,
              key,
              requestedTransition: transitionName,
              matched: match ?? null,
              availableTransitions: transitionsData.transitions.map((t) => t.name),
            });
          }
          if (!match) {
            throw new Error(
              `No transition named "${transitionName}" for ${key}. Available: ${transitionsData.transitions
                .map((t) => t.name)
                .join(", ")}`
            );
          }
          const data = await apiPost(base(), `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
            transition: { id: match.id },
            ...(comment ? { update: { comment: [{ add: { body: comment } }] } } : {}),
          });
          return textResult(data ?? { transitioned: key, to: match.name });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_assign_issue",
      {
        description:
          "Assign a Jira issue to a user by accountId — resolve the accountId first via jira_search_users, " +
          "never guess it. Pass accountId: 'unassign' to clear the assignee. dryRun (default true) previews " +
          "the assignment without applying it.",
        inputSchema: {
          key: z.string().describe("Issue key, e.g. ABC-123"),
          accountId: z.string().describe("Jira accountId of the assignee (from jira_search_users), or 'unassign' to clear"),
          dryRun: z.boolean().optional().describe("If true (default), preview without applying"),
        },
      },
      async ({ key, accountId, dryRun }) => {
        try {
          const resolvedAccountId = accountId === "unassign" ? null : accountId;
          if (dryRun ?? true) {
            return textResult({ dryRun: true, key, wouldAssignTo: resolvedAccountId });
          }
          const { status } = await apiPut(base(), `/rest/api/2/issue/${encodeURIComponent(key)}/assignee`, {
            accountId: resolvedAccountId,
          });
          return textResult({ assigned: key, accountId: resolvedAccountId, status });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_get_boards",
      {
        description:
          "List Jira Agile boards, optionally filtered to a project. Use this to find a boardId for " +
          "jira_get_sprints / jira_get_backlog.",
        inputSchema: {
          projectKey: z.string().optional().describe("Restrict to boards for this project"),
          maxResults: z.number().optional().describe("Max results (default 50)"),
        },
      },
      async ({ projectKey, maxResults }) => {
        try {
          const params: Record<string, string | number> = { maxResults: maxResults ?? 50 };
          if (projectKey) params.projectKeyOrId = projectKey;
          const data = await apiGet(base(), "/rest/agile/1.0/board", params);
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_get_sprints",
      {
        description:
          "List sprints on a board (active/future/closed). Use jira_get_boards first to find the boardId.",
        inputSchema: {
          boardId: z.number().describe("Board id, from jira_get_boards"),
          state: z.string().optional().describe("Comma-separated states to filter: active, future, closed (default: active,future)"),
          maxResults: z.number().optional().describe("Max results (default 50)"),
        },
      },
      async ({ boardId, state, maxResults }) => {
        try {
          const data = await apiGet(base(), `/rest/agile/1.0/board/${boardId}/sprint`, {
            state: state ?? "active,future",
            maxResults: maxResults ?? 50,
          });
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_get_backlog",
      {
        description: "List issues in a board's backlog (not yet assigned to a sprint). Use jira_get_boards first to find the boardId.",
        inputSchema: {
          boardId: z.number().describe("Board id, from jira_get_boards"),
          maxResults: z.number().optional().describe("Max results (default 100)"),
          fields: z.string().optional().describe("Comma-separated field list to return"),
        },
      },
      async ({ boardId, maxResults, fields }) => {
        try {
          const data = await apiGet(base(), `/rest/agile/1.0/board/${boardId}/backlog`, {
            maxResults: maxResults ?? 100,
            fields: fields ?? DEFAULT_FIELDS,
          });
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_move_to_sprint",
      {
        description:
          "Move one or more issues into a sprint. Use jira_get_sprints to find the sprintId. dryRun " +
          "(default true) previews the move without applying it.",
        inputSchema: {
          sprintId: z.number().describe("Target sprint id, from jira_get_sprints"),
          issueKeys: z.array(z.string()).min(1).describe("Issue keys to move, e.g. ['ABC-1','ABC-2']"),
          dryRun: z.boolean().optional().describe("If true (default), preview without applying"),
        },
      },
      async ({ sprintId, issueKeys, dryRun }) => {
        try {
          if (dryRun ?? true) {
            return textResult({ dryRun: true, sprintId, wouldMove: issueKeys });
          }
          await apiPost(base(), `/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: issueKeys });
          return textResult({ movedToSprint: sprintId, issues: issueKeys });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jira_get_sprint_report",
      {
        description:
          "Summarize a sprint's tickets for tracking: counts by status, unassigned issues, and issues missing " +
          "a description or priority (a proxy for 'not ready' tickets). Use jira_get_sprints to find the sprintId.",
        inputSchema: {
          sprintId: z.number().describe("Sprint id, from jira_get_sprints"),
          maxResults: z.number().optional().describe("Max issues to scan (default 200)"),
        },
      },
      async ({ sprintId, maxResults }) => {
        try {
          const data = await apiGet<{ issues?: Array<{ key: string; fields: Record<string, unknown> }> }>(
            base(),
            `/rest/agile/1.0/sprint/${sprintId}/issue`,
            { maxResults: maxResults ?? 200, fields: "summary,status,assignee,description,priority" }
          );
          const issues = data.issues ?? [];
          const byStatus: Record<string, number> = {};
          const unassigned: string[] = [];
          const missingDescription: string[] = [];
          const missingPriority: string[] = [];
          for (const issue of issues) {
            const status = (issue.fields.status as { name?: string } | undefined)?.name ?? "Unknown";
            byStatus[status] = (byStatus[status] ?? 0) + 1;
            if (!issue.fields.assignee) unassigned.push(issue.key);
            if (!issue.fields.description) missingDescription.push(issue.key);
            if (!issue.fields.priority) missingPriority.push(issue.key);
          }
          return textResult({
            sprintId,
            total: issues.length,
            byStatus,
            unassigned: { count: unassigned.length, keys: unassigned },
            missingDescription: { count: missingDescription.length, keys: missingDescription },
            missingPriority: { count: missingPriority.length, keys: missingPriority },
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
