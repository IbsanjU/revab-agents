import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { env, intEnv } from "../shared/config.js";
import { apiGet, apiPost } from "../shared/http.js";

const base = () => env("JIRA_BASE_URL");
const DEFAULT_FIELDS = "summary,status,issuetype,assignee,priority,labels,fixVersions,parent";

startMcpHttpServer({
  name: "jira",
  port: intEnv("JIRA_MCP_PORT", 7311),
  register(server) {
    server.registerTool(
      "jira_search",
      {
        description:
          "Search Jira issues with JQL. Returns key, summary, status, type, assignee for each match.",
        inputSchema: {
          jql: z.string().describe('JQL query, e.g. \'project = ABC AND sprint in openSprints()\''),
          maxResults: z.number().optional().describe("Max issues to return (default 25)"),
          fields: z.string().optional().describe("Comma-separated field list to return"),
        },
      },
      async ({ jql, maxResults, fields }) => {
        try {
          const data = await apiGet(base(), "/rest/api/2/search", {
            jql,
            maxResults: maxResults ?? 25,
            fields: fields ?? DEFAULT_FIELDS,
          });
          return textResult(data);
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
  },
});
