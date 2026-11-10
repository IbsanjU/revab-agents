/**
 * Convention: nothing specific to one organization, employer or customer belongs in this repository.
 * The terms to keep out are themselves identifying, so they live in a LOCAL, untracked file
 * (`.revab/denylist.txt`) and never in the repo. `npm run check:conventions` reads it when present
 * and fails if any tracked text contains a listed term. Without the file the check does nothing.
 *
 * File format, one entry per line:
 *   a plain term             matched case-insensitively as a whole word
 *   /regex/flags             a regular expression (use this to exclude a legitimate use, for example
 *                            a negative lookbehind so a diagram keyword is not flagged)
 *   # comment, blank lines  ignored
 */
export interface DenyEntry { label: string; test: RegExp }

export function parseDenylist(text: string): { entries: DenyEntry[]; errors: string[] } {
  const entries: DenyEntry[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    try {
      const m = /^\/(.+)\/([a-z]*)$/.exec(line);
      if (m) entries.push({ label: line, test: new RegExp(m[1], m[2].includes("g") ? m[2] : m[2]) });
      else entries.push({ label: line, test: new RegExp(`\\b${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") });
    } catch {
      errors.push(`denylist line ${i + 1} is not a valid pattern`);
    }
  });
  return { entries, errors };
}

export interface DenyHit { path: string; line: number; entry: string }

/** First hit per entry per file, with the line number. The matched text is never echoed. */
export function findDenied(files: Array<{ path: string; text: string }>, entries: DenyEntry[]): DenyHit[] {
  const hits: DenyHit[] = [];
  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    for (const e of entries) {
      const idx = lines.findIndex((l) => e.test.test(l));
      if (idx >= 0) hits.push({ path: f.path, line: idx + 1, entry: e.label });
    }
  }
  return hits;
}
