import { z } from "zod";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";
import { buildTeamsPayload, sendTeams, sendEmail, emailTransport, type TeamsMessage, type EmailMessage } from "../../utils/notify.js";

/**
 * Notify MCP server: Microsoft Teams (Incoming Webhook / Power Automate workflow URL)
 * and Outlook email (Microsoft Graph sendMail, or smtp.office365.com fallback).
 *
 * Write-safety convention (same as Jira/Confluence/JTMF writes): both tools default to
 * dryRun:true — preview the exact message and get the user's explicit confirmation
 * before re-calling with dryRun:false. The orchestrator worker bypasses this server and
 * calls utils/notify.ts directly for opt-in task-completion notices (payload.notify).
 */

const LinkSchema = z.object({
  title: z.string().describe("Button label, e.g. 'Open Allure report'"),
  url: z.string().url().describe("Link target URL"),
});

startMcpHttpServer({
  name: "notify",
  port: intEnv("NOTIFY_MCP_PORT", 7321),
  register(server) {
    server.registerTool(
      "notify_teams",
      {
        description:
          "Post an Adaptive Card message to the configured Microsoft Teams channel (TEAMS_WEBHOOK_URL). " +
          "Defaults to dryRun:true — returns the exact card payload for preview; only re-call with " +
          "dryRun:false after the user explicitly confirms the previewed message.",
        inputSchema: {
          title: z.string().describe("Card title, e.g. 'BDD run finished: my-project'"),
          text: z.string().describe("Card body text"),
          facts: z.record(z.string()).optional().describe("Key/value facts, e.g. { project: 'my-project', passed: '41', failed: '2' }"),
          link: LinkSchema.optional().describe("Optional action button, e.g. a report link"),
          dryRun: z.boolean().default(true).describe("Preview the card payload without posting (default true)"),
        },
      },
      async ({ title, text, facts, link, dryRun }) => {
        try {
          const message: TeamsMessage = { title, text, facts, link };
          if (dryRun) {
            return textResult({
              dryRun: true,
              wouldPost: buildTeamsPayload(message),
              note: "Preview only — nothing was sent. Show this to the user and re-call with dryRun:false after explicit confirmation.",
            });
          }
          const result = await sendTeams(message);
          return textResult({ sent: true, ...result });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "notify_email",
      {
        description:
          "Send an Outlook email via Microsoft Graph (GRAPH_* env vars) or Office365 SMTP (SMTP_* env vars). " +
          "Defaults to dryRun:true — returns the message and detected transport for preview; only re-call " +
          "with dryRun:false after the user explicitly confirms the previewed message.",
        inputSchema: {
          to: z.array(z.string().email()).min(1).describe("Recipient email addresses"),
          subject: z.string().describe("Email subject"),
          body: z.string().describe("Plain-text email body"),
          dryRun: z.boolean().default(true).describe("Preview the email without sending (default true)"),
        },
      },
      async ({ to, subject, body, dryRun }) => {
        try {
          const message: EmailMessage = { to, subject, body };
          if (dryRun) {
            return textResult({
              dryRun: true,
              transport: emailTransport() ?? "unconfigured (set GRAPH_* or SMTP_* in .env)",
              wouldSend: message,
              note: "Preview only — nothing was sent. Show this to the user and re-call with dryRun:false after explicit confirmation.",
            });
          }
          const result = await sendEmail(message);
          return textResult({ sent: true, ...result });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
