/**
 * What the extension may pass to the gateway, and how tool choices are checked.
 *
 * No `vscode` import, so every rule is unit tested. Two properties matter:
 *  - Secrets live in VS Code's SecretStorage, never in settings JSON, and are only ever
 *    named (never printed) in logs and messages.
 *  - The plain `revab.environment` setting is an ALLOWLIST. Without it a setting could inject
 *    NODE_OPTIONS, LD_PRELOAD or PATH into the gateway process, and a token pasted there
 *    would sit in plaintext. Anything not allowed is rejected by name, with the reason.
 */

export interface SecretSpec {
  key: string;
  label: string;
  hint: string;
}

/** Environment variables that are credentials. Stored encrypted, set through a command. */
export const SECRETS: readonly SecretSpec[] = [
  { key: "JIRA_API_TOKEN", label: "Jira API token", hint: "Atlassian API token, or a Personal Access Token for Jira Server" },
  { key: "CONFLUENCE_API_TOKEN", label: "Confluence API token", hint: "Atlassian API token, or a Personal Access Token" },
  { key: "JTMF_API_TOKEN", label: "JTMF API token", hint: "Token for the Jira-based test management instance" },
  { key: "ATLASSIAN_API_TOKEN", label: "Atlassian token (shared fallback)", hint: "Used for any of the three above that has no token of its own" },
  { key: "GITHUB_TOKEN", label: "GitHub token", hint: "Read access is enough for the search and read tools" },
  { key: "GRAPH_CLIENT_SECRET", label: "Microsoft Graph client secret", hint: "For Outlook notifications" },
  { key: "TEAMS_WEBHOOK_URL", label: "Teams webhook URL", hint: "The URL is itself a secret" },
  { key: "BROWSERSTACK_ACCESS_KEY", label: "BrowserStack access key", hint: "Only if the target project already uses BrowserStack" },
  { key: "MCP_SHARED_SECRET", label: "Gateway shared secret", hint: "If set, the extension also sends it as the x-mcp-secret header" },
];

/** Non-secret configuration the `revab.environment` setting may carry. */
export const PLAIN_KEYS: readonly string[] = [
  "JIRA_BASE_URL",
  "CONFLUENCE_BASE_URL",
  "JIRA_EMAIL",
  "CONFLUENCE_EMAIL",
  "JTMF_EMAIL",
  "ATLASSIAN_EMAIL",
  "JIRA_AUTH_MODE",
  "CONFLUENCE_AUTH_MODE",
  "JTMF_AUTH_MODE",
  "ATLASSIAN_AUTH_MODE",
  "JTMF_STEPS_FIELD",
  "JTMF_TEST_ISSUE_TYPE",
  "JTMF_TEST_PLAN_ISSUE_TYPE",
  "GITHUB_ORG",
  "GITHUB_API_BASE_URL",
  "GRAPH_TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_SENDER",
  "BROWSERSTACK_USERNAME",
  "HTTP_TIMEOUT_MS",
  "HTTP_MAX_RETRIES",
];

const SECRET_KEYS = new Set(SECRETS.map((s) => s.key));
const PLAIN = new Set(PLAIN_KEYS);
const TOOL_ENTRY = /^[A-Za-z0-9_./*-]+$/;

export interface GatewayEnv {
  env: Record<string, string>;
  /** Setting entries that were refused, each with the reason. Never contains a value. */
  rejected: Array<{ key: string; reason: string }>;
}

export function buildGatewayEnv(input: {
  plain: unknown;
  secrets: Record<string, string | undefined>;
  disabled: unknown;
  port: number;
}): GatewayEnv {
  const env: Record<string, string> = {};
  const rejected: GatewayEnv["rejected"] = [];

  if (input.plain && typeof input.plain === "object" && !Array.isArray(input.plain)) {
    for (const [key, value] of Object.entries(input.plain as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key)) {
        rejected.push({ key, reason: "is a credential: use \"revab: Set credentials\" so it is stored encrypted, not in settings" });
      } else if (!PLAIN.has(key)) {
        rejected.push({ key, reason: "is not an allowed variable for revab.environment" });
      } else if (typeof value === "string" || typeof value === "number") {
        const text = String(value).trim();
        if (text) env[key] = text;
      } else {
        rejected.push({ key, reason: "must be a string or a number" });
      }
    }
  }

  // Secrets last, so a stored credential wins over anything else.
  for (const [key, value] of Object.entries(input.secrets)) {
    if (SECRET_KEYS.has(key) && value) env[key] = value;
  }

  const disabled = Array.isArray(input.disabled)
    ? input.disabled.filter((e): e is string => typeof e === "string" && TOOL_ENTRY.test(e.trim())).map((e) => e.trim())
    : [];
  if (disabled.length > 0) env.GATEWAY_DISABLED_TOOLS = [...new Set(disabled)].join(",");

  env.GATEWAY_MCP_PORT = String(input.port);
  return { env, rejected };
}

/** The x-mcp-secret header the gateway requires when MCP_SHARED_SECRET is set. */
export function sharedSecretHeaders(secrets: Record<string, string | undefined>): Record<string, string> {
  const value = secrets.MCP_SHARED_SECRET;
  return value ? { "x-mcp-secret": value } : {};
}

/** Variable names only, with secrets marked: safe to log or show. */
export function describeEnv(env: Record<string, string>): string[] {
  return Object.keys(env)
    .sort()
    .map((k) => (SECRET_KEYS.has(k) ? `${k} (secret)` : k));
}

// ---- tool selection -------------------------------------------------------

/** Tool names an agent file references, from its `tools:` frontmatter (`gateway/x`, `gateway-code/x`). */
export function agentToolRefs(markdown: string): string[] {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  const tools = /^tools:\s*(.*)$/m.exec(front)?.[1] ?? "";
  return [...tools.matchAll(/'gateway(?:-code)?\/([A-Za-z0-9_]+)'/g)].map((m) => m[1]!);
}

export interface AgentLoss {
  agent: string;
  lost: string[];
}

/** Which agents lose which tools if `disabled` (exact tool names) were switched off. */
export function agentsLosing(
  disabled: ReadonlySet<string>,
  agents: ReadonlyArray<{ name: string; tools: readonly string[] }>,
): AgentLoss[] {
  return agents
    .map((a) => ({ agent: a.name, lost: a.tools.filter((t) => disabled.has(t)) }))
    .filter((a) => a.lost.length > 0);
}

/**
 * Turn a picker result into the stored list: every unchecked tool, plus any existing entry that
 * is not a plain tool name (a `server/*` or `prefix*` pattern edited by hand), which the
 * picker cannot represent and so must not drop.
 */
export function nextDisabledList(
  existing: readonly string[],
  allToolNames: ReadonlySet<string>,
  uncheckedNames: readonly string[],
): string[] {
  const patterns = existing.filter((e) => !allToolNames.has(e));
  return [...new Set([...patterns, ...uncheckedNames])].sort();
}
