/**
 * The policy-controlled browser server (playwright-mcp-vscode) as an MCP entry, for `revab init --browser`.
 *
 * It is opt-in because it is not hosted by the gateway: the package must be installed next to the
 * config, and a registered entry whose package is missing would just show up as a failing server.
 * Navigation is limited to an allowlist of hosts and the entry never enables script execution
 * (`page_eval`) or external navigation.
 */

export const BROWSER_SERVER_NAME = "playwright-local";
export const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1"];
export const BROWSER_PACKAGE = "playwright-mcp-vscode";

/** The tools an agent may be granted from this server. `page_eval` is deliberately absent. */
export const BROWSER_TOOLS = ["browser_navigate", "page_snapshot", "page_click", "page_type", "page_wait_for", "page_console_logs", "browser_close"] as const;

const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/** Normalize `--allow-host` values: split on commas, lowercase, reject anything that is not a bare host. */
export function parseAllowedHosts(values: string[]): { hosts: string[]; invalid: string[] } {
  const hosts: string[] = [];
  const invalid: string[] = [];
  for (const raw of values.flatMap((v) => v.split(","))) {
    const h = raw.trim().toLowerCase();
    if (!h) continue;
    if (!HOST.test(h) || h === "*") invalid.push(raw.trim());
    else if (!hosts.includes(h)) hosts.push(h);
  }
  return { hosts, invalid };
}

export interface BrowserServerEntry {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function browserServerEntry(extraHosts: string[] = []): BrowserServerEntry {
  const hosts = [...DEFAULT_ALLOWED_HOSTS, ...extraHosts.filter((h) => !DEFAULT_ALLOWED_HOSTS.includes(h))];
  return {
    type: "stdio",
    // --no-install: never download the package at launch; fail clearly if it is not installed.
    command: "npx",
    args: ["--no-install", BROWSER_PACKAGE],
    env: {
      PLAYWRIGHT_ALLOWED_HOSTS: hosts.join(","),
      // The server still LISTS page_eval but refuses a call to anything not enabled ("disabled by policy").
      PLAYWRIGHT_ENABLED_TOOLS: BROWSER_TOOLS.join(","),
      PLAYWRIGHT_ALLOW_EXTERNAL_NAVIGATION: "false",
      PLAYWRIGHT_ENABLE_SCRIPT_EXECUTION: "false",
    },
  };
}
