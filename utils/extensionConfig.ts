/**
 * Pure helpers behind `npm run extension:*` — what the extension's manifest should list, and
 * which config entries belong to revab and may be removed on uninstall. Kept separate from
 * the script so every rule is unit tested without touching a real settings file.
 */

export interface ChatAgentEntry {
  path: string;
}

/** `contributes.chatAgents` for the bundled agent files, in a stable order. */
export function chatAgentEntries(fileNames: string[]): ChatAgentEntry[] {
  return fileNames
    .filter((f) => f.endsWith(".agent.md"))
    .sort()
    .map((f) => ({ path: `./agents/${f}` }));
}

const GATEWAY_NAMES = new Set(["gateway", "gateway-code"]);
const GATEWAY_URL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mcp(\/code)?\/?$/;

/** Only entries that point at a local gateway endpoint are ours; anything else is the user's. */
export function isRevabGatewayEntry(name: string, entry: unknown): boolean {
  if (!GATEWAY_NAMES.has(name)) return false;
  const url = (entry as { url?: unknown } | null)?.url;
  return typeof url === "string" && GATEWAY_URL.test(url);
}

type McpConfig = Record<string, unknown>;

/** Remove revab's gateway entries from an `mcp.json` (`servers`) or `.mcp.json` (`mcpServers`) object. */
export function removeGatewayEntries(
  config: McpConfig,
  key: "servers" | "mcpServers",
): { config: McpConfig; removed: string[] } {
  const servers = config[key];
  if (!servers || typeof servers !== "object") return { config, removed: [] };
  const kept: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (isRevabGatewayEntry(name, entry)) removed.push(name);
    else kept[name] = entry;
  }
  return { config: { ...config, [key]: kept }, removed };
}

/**
 * Remove the `revab.*` settings, and the tool approvals the extension wrote (keys that are
 * revab tool names). Approvals for tools revab does not host are left exactly as they were.
 */
export function removeRevabSettings(
  settings: Record<string, unknown>,
  toolNames: ReadonlySet<string>,
): { settings: Record<string, unknown>; removed: string[] } {
  const next: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("revab.")) {
      removed.push(key);
    } else if (key === "chat.tools.autoApprove" && value && typeof value === "object") {
      const kept: Record<string, unknown> = {};
      for (const [tool, approved] of Object.entries(value as Record<string, unknown>)) {
        if (toolNames.has(tool)) removed.push(`${key}[${tool}]`);
        else kept[tool] = approved;
      }
      if (Object.keys(kept).length > 0) next[key] = kept;
    } else {
      next[key] = value;
    }
  }
  return { settings: next, removed };
}

export function vsixFileName(pkg: { name: string; version: string }): string {
  return `${pkg.name}-${pkg.version}.vsix`;
}

export function extensionId(pkg: { publisher: string; name: string }): string {
  return `${pkg.publisher}.${pkg.name}`;
}

/**
 * Where VS Code keeps an extension's private storage, which is where the bundled home lives.
 * `userDataDir` is the folder that contains `User/` (override it for Insiders, VSCodium or a
 * portable install). Extension folders are lowercased by VS Code.
 */
export function bundledHomePath(input: {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  extensionId: string;
  userDataDir?: string;
}): string {
  const sep = input.platform === "win32" ? "\\" : "/";
  const join = (...parts: string[]) => parts.join(sep);
  let base = input.userDataDir;
  if (!base) {
    if (input.platform === "win32") base = join(input.env.APPDATA ?? join(input.homedir, "AppData", "Roaming"), "Code");
    else if (input.platform === "darwin") base = join(input.homedir, "Library", "Application Support", "Code");
    else base = join(input.env.XDG_CONFIG_HOME ?? join(input.homedir, ".config"), "Code");
  }
  return join(base, "User", "globalStorage", input.extensionId.toLowerCase(), "home");
}
