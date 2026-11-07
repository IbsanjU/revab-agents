/**
 * Seeding the extension's own home folder, used when there is no framework checkout.
 *
 * The gateway reads its `.env`, `projects/`, `knowledge/` and `skills/` from its working
 * directory. In bundled mode that directory is a folder the extension creates and fills from
 * templates it ships. Two kinds of file, with opposite rules:
 *  - framework-owned (`skills/`, `.env.example`): refreshed when the extension is updated;
 *  - everything else (`knowledge/`, `projects/`): written only if missing, never overwritten,
 *    because it holds the user's own data. `.env` is never created or touched.
 * Nothing is ever deleted. Pure planning (no `vscode`, fs injected) so every rule is tested.
 */
import * as path from "node:path";

export const MARKER = ".revab-home.json";

export interface SeedFs {
  exists(p: string): boolean;
  /** Files under `dir`, as paths relative to it, `/`-separated. */
  walk(dir: string): string[];
}

export interface SeedAction {
  from: string;
  to: string;
  reason: "missing" | "framework-update";
}

const isFrameworkOwned = (rel: string) => rel === ".env.example" || rel.startsWith("skills/");

export function planSeed(input: {
  templates: string;
  home: string;
  version: string;
  installedVersion: string | undefined;
  fs: SeedFs;
}): SeedAction[] {
  const updated = input.installedVersion !== input.version;
  const actions: SeedAction[] = [];
  for (const rel of input.fs.walk(input.templates)) {
    if (rel === MARKER) continue;
    const to = path.join(input.home, ...rel.split("/"));
    const missing = !input.fs.exists(to);
    if (missing) actions.push({ from: path.join(input.templates, ...rel.split("/")), to, reason: "missing" });
    else if (updated && isFrameworkOwned(rel)) {
      actions.push({ from: path.join(input.templates, ...rel.split("/")), to, reason: "framework-update" });
    }
  }
  return actions;
}

export function isBundledHome(dir: string, fs: Pick<SeedFs, "exists">): boolean {
  return fs.exists(path.join(dir, MARKER));
}

export function parseInstalledVersion(markerText: string | undefined): string | undefined {
  try {
    const v = (JSON.parse(markerText ?? "") as { version?: unknown }).version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}
