import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { env, intEnv, optionalEnv } from "../shared/config.js";
import { apiGet } from "../shared/http.js";

/**
 * JTMF / test-management MCP server.
 * Test cases and test plans usually live as Jira issues with org-specific custom fields,
 * so everything here is driven by env config (JTMF_* vars) plus a raw-GET escape hatch
 * for any org-specific REST endpoint.
 */
const base = () => env("JIRA_BASE_URL");

startMcpHttpServer({
  name: "jtmf",
  port: intEnv("JTMF_MCP_PORT", 7313),
  register(server) {
    server.registerTool(
      "jtmf_get_test_case",
      {
        description:
          "Get a test-case issue by key, including its test steps (read from the configured JTMF_STEPS_FIELD custom field).",
        inputSchema: {
          key: z.string().describe("Test issue key, e.g. ABC-321"),
        },
      },
      async ({ key }) => {
        try {
          const stepsField = optionalEnv("JTMF_STEPS_FIELD");
          const issue = await apiGet<{ key: string; fields: Record<string, unknown> }>(
            base(),
            `/rest/api/2/issue/${encodeURIComponent(key)}`
          );
          return textResult({
            key: issue.key,
            summary: issue.fields["summary"],
            status: (issue.fields["status"] as { name?: string } | undefined)?.name,
            description: issue.fields["description"],
            steps: stepsField ? issue.fields[stepsField] : "(set JTMF_STEPS_FIELD in .env)",
            labels: issue.fields["labels"],
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jtmf_search_tests",
      {
        description:
          "Search test-case issues with JQL. Automatically scopes to the configured test issue type unless the JQL already mentions issuetype.",
        inputSchema: {
          jql: z.string().describe('JQL fragment, e.g. \'project = ABC AND labels = regression\''),
          maxResults: z.number().optional(),
        },
      },
      async ({ jql, maxResults }) => {
        try {
          const testType = optionalEnv("JTMF_TEST_ISSUE_TYPE") ?? "Test";
          const scoped = /issuetype/i.test(jql) ? jql : `issuetype = "${testType}" AND (${jql})`;
          const data = await apiGet(base(), "/rest/api/2/search", {
            jql: scoped,
            maxResults: maxResults ?? 50,
            fields: "summary,status,labels,priority",
          });
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jtmf_get_test_plan",
      {
        description:
          "Get a test-plan issue and all issues linked to it (its tests), via issue links.",
        inputSchema: {
          key: z.string().describe("Test plan issue key"),
        },
      },
      async ({ key }) => {
        try {
          const issue = await apiGet<{
            key: string;
            fields: {
              summary?: string;
              description?: string;
              issuelinks?: Array<{
                type?: { name?: string };
                inwardIssue?: { key: string; fields?: { summary?: string; status?: { name?: string } } };
                outwardIssue?: { key: string; fields?: { summary?: string; status?: { name?: string } } };
              }>;
            };
          }>(base(), `/rest/api/2/issue/${encodeURIComponent(key)}`, {
            fields: "summary,description,issuelinks",
          });
          const linked = (issue.fields.issuelinks ?? []).map((l) => {
            const target = l.inwardIssue ?? l.outwardIssue;
            return {
              key: target?.key,
              summary: target?.fields?.summary,
              status: target?.fields?.status?.name,
              linkType: l.type?.name,
            };
          });
          return textResult({
            key: issue.key,
            summary: issue.fields.summary,
            description: issue.fields.description,
            linkedIssues: linked,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "jtmf_raw_get",
      {
        description:
          "Escape hatch: GET any REST path on the Jira/JTMF base URL (e.g. org-specific JTMF endpoints). Path must start with /rest/.",
        inputSchema: {
          path: z.string().describe("REST path starting with /rest/, e.g. /rest/jtmf/1.0/testrun/123"),
          params: z.record(z.string()).optional().describe("Optional query parameters"),
        },
      },
      async ({ path, params }) => {
        try {
          if (!path.startsWith("/rest/")) {
            return errorResult(new Error("path must start with /rest/"));
          }
          const data = await apiGet(base(), path, params);
          return textResult(data);
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
