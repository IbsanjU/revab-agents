import nodemailer from "nodemailer";
import { env, optionalEnv } from "../mcp-servers/shared/config.js";

/**
 * Notification channels: Microsoft Teams (Incoming Webhook / Power Automate workflow
 * URL) and Outlook email (Microsoft Graph sendMail with an app registration, or
 * smtp.office365.com via nodemailer as the low-setup fallback).
 *
 * Shared by the `notify` MCP server (dryRun-first, user-confirmed sends) and the
 * orchestrator worker (automatic task-completion notices, opt-in per task via a
 * `notify` payload flag). All config comes from .env — see .env.example.
 */

export interface TeamsMessage {
  title: string;
  text: string;
  /** Key/value facts rendered as a fact set (e.g. project, task type, pass/fail counts). */
  facts?: Record<string, string>;
  /** Optional link (e.g. an Allure report URL) rendered as an action button. */
  link?: { title: string; url: string };
}

/** Build the Adaptive Card webhook payload for a Teams message (exported for dryRun previews). */
export function buildTeamsPayload(message: TeamsMessage): Record<string, unknown> {
  const body: Array<Record<string, unknown>> = [
    { type: "TextBlock", size: "Large", weight: "Bolder", text: message.title, wrap: true },
    { type: "TextBlock", text: message.text, wrap: true },
  ];
  if (message.facts && Object.keys(message.facts).length > 0) {
    body.push({
      type: "FactSet",
      facts: Object.entries(message.facts).map(([title, value]) => ({ title, value })),
    });
  }
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(message.link ? { actions: [{ type: "Action.OpenUrl", title: message.link.title, url: message.link.url }] } : {}),
        },
      },
    ],
  };
}

/** Post an Adaptive Card to the configured Teams webhook (TEAMS_WEBHOOK_URL). */
export async function sendTeams(message: TeamsMessage): Promise<{ status: number }> {
  const webhookUrl = env("TEAMS_WEBHOOK_URL");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTeamsPayload(message)),
  });
  if (!res.ok) {
    throw new Error(`Teams webhook failed: ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 500)}`);
  }
  return { status: res.status };
}

export interface EmailMessage {
  to: string[];
  subject: string;
  /** Plain-text body; a simple HTML variant is derived from it. */
  body: string;
}

/** Which email transport the current .env configures ("graph", "smtp", or null when unconfigured). */
export function emailTransport(): "graph" | "smtp" | null {
  if (optionalEnv("GRAPH_TENANT_ID") && optionalEnv("GRAPH_CLIENT_ID") && optionalEnv("GRAPH_CLIENT_SECRET") && optionalEnv("GRAPH_SENDER")) {
    return "graph";
  }
  if (optionalEnv("SMTP_HOST") && optionalEnv("SMTP_USER") && optionalEnv("SMTP_PASS")) return "smtp";
  return null;
}

async function graphToken(): Promise<string> {
  const tenant = env("GRAPH_TENANT_ID");
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GRAPH_CLIENT_ID"),
      client_secret: env("GRAPH_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function sendViaGraph(message: EmailMessage): Promise<void> {
  const token = await graphToken();
  const sender = env("GRAPH_SENDER");
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: "Text", content: message.body },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph sendMail failed: ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 500)}`);
  }
}

async function sendViaSmtp(message: EmailMessage): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: env("SMTP_HOST", "smtp.office365.com"),
    port: parseInt(optionalEnv("SMTP_PORT") ?? "587", 10),
    secure: false, // STARTTLS on 587
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });
  await transporter.sendMail({
    from: optionalEnv("SMTP_FROM") ?? env("SMTP_USER"),
    to: message.to.join(", "),
    subject: message.subject,
    text: message.body,
  });
}

/** Send an Outlook email using whichever transport (Graph or SMTP) the .env configures. */
export async function sendEmail(message: EmailMessage): Promise<{ transport: "graph" | "smtp" }> {
  const transport = emailTransport();
  if (!transport) {
    throw new Error(
      "No email transport configured: set GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET/GRAPH_SENDER for Microsoft Graph, or SMTP_HOST/SMTP_USER/SMTP_PASS for Office365 SMTP."
    );
  }
  if (transport === "graph") await sendViaGraph(message);
  else await sendViaSmtp(message);
  return { transport };
}
