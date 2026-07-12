/**
 * Build a browsable web link for a Jira/JTMF issue key.
 * Shared helper — reuse this instead of re-implementing browse-URL construction
 * in individual MCP servers (jira, jtmf both key off JIRA_BASE_URL).
 */
export function buildJiraIssueUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}
