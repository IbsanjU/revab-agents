import path from "path";

/**
 * Resolve `relPath` against `root` and refuse anything that escapes `root`.
 * Shared trust-boundary helper — reuse this instead of re-implementing path
 * containment checks in individual MCP servers (artifacts, confluence, media, ...).
 */
export function resolveWithinRoot(root: string, relPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path escapes root: ${relPath}`);
  }
  return resolved;
}
