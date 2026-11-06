/**
 * Switching tools off at the gateway, so a disabled tool is absent everywhere (MCP, REST and
 * Code Mode) instead of merely hidden in one editor.
 *
 * The spec is a comma- or whitespace-separated list. Each entry is one of:
 *   jira_search     an exact tool name
 *   jira/*          every tool of one server (the `server` field in /api/tools)
 *   confluence_*    every tool whose name starts with the prefix
 * Entries that match nothing are reported, never silently ignored: a typo in a spec that
 * was meant to turn something off must not look like it worked.
 */

export interface Filterable {
  name: string;
  server: string;
}

export interface FilterResult<T extends Filterable> {
  kept: T[];
  removed: T[];
  /** Entries that matched no tool. */
  unmatched: string[];
}

export function parseDisabledSpec(spec: string | undefined): string[] {
  return (spec ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function matches(tool: Filterable, entry: string): boolean {
  if (entry.endsWith("/*")) return tool.server === entry.slice(0, -2);
  if (entry.endsWith("*")) return tool.name.startsWith(entry.slice(0, -1));
  return tool.name === entry;
}

export function filterTools<T extends Filterable>(tools: T[], spec: string | undefined): FilterResult<T> {
  const entries = parseDisabledSpec(spec);
  if (entries.length === 0) return { kept: tools, removed: [], unmatched: [] };
  const kept: T[] = [];
  const removed: T[] = [];
  for (const tool of tools) (entries.some((e) => matches(tool, e)) ? removed : kept).push(tool);
  const unmatched = entries.filter((e) => !tools.some((t) => matches(t, e)));
  return { kept, removed, unmatched };
}
