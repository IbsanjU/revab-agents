/**
 * Correction records — the training signal for the agents.
 *
 * Every time a user corrects an agent ("no, don't do X, do Y"), that is the single
 * most valuable data this framework produces, and it is otherwise lost when the
 * session ends. A correction is appended to `knowledge/corrections/<YYYY-MM>.jsonl`
 * (one JSON object per line, append-only, easy to diff and grep), then folded into
 * the owning agent's spec in `prompts/agents/*.ts` as a concrete negative example.
 *
 * Flow: observe → log (`npm run correction -- log …`) → fold into the spec →
 * mark applied → verify with an eval. See `skills/capture-correction/SKILL.md`.
 */
import { promises as fs } from "fs";
import path from "path";

/**
 * Resolved per call rather than at import time: capturing cwd on module load makes
 * the log location unchangeable for the life of the process (and untestable).
 */
export function correctionsDir(): string {
  return path.resolve("knowledge", "corrections");
}

/** How much the wrong behavior cost — drives which corrections get folded in first. */
export type CorrectionSeverity = "low" | "medium" | "high";

/** `open` = logged, not yet reflected in a spec; `applied` = folded into the agent. */
export type CorrectionStatus = "open" | "applied";

export interface CorrectionRecord {
  /** Stable id: `<YYYY-MM-DD>-<n>`. */
  id: string;
  /** ISO date the correction was observed. */
  date: string;
  /** Agent or skill that behaved wrongly (e.g. "orchestrator", "skill:code-review"). */
  agent: string;
  /** One line of what was being attempted. */
  task: string;
  /** What the agent actually did (the wrong behavior). */
  observed: string;
  /** What it should have done instead. */
  expected: string;
  /**
   * The generalized rule this implies — the reusable form, not the one-off.
   * This is what gets folded into the agent spec as an Always/Never bullet.
   */
  rule: string;
  severity: CorrectionSeverity;
  status: CorrectionStatus;
}

function monthFile(date: string): string {
  return path.join(correctionsDir(), `${date.slice(0, 7)}.jsonl`);
}

/** Read every correction record, oldest first. Returns [] when nothing is logged yet. */
export async function readCorrections(): Promise<CorrectionRecord[]> {
  let files: string[];
  try {
    files = (await fs.readdir(correctionsDir())).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const records: CorrectionRecord[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(correctionsDir(), file), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as CorrectionRecord);
      } catch {
        // A malformed line shouldn't sink the whole log — skip it and keep going.
      }
    }
  }
  return records;
}

/** Append a correction, assigning it the next id for its date. */
export async function appendCorrection(
  input: Omit<CorrectionRecord, "id" | "status"> & { status?: CorrectionStatus },
): Promise<CorrectionRecord> {
  await fs.mkdir(correctionsDir(), { recursive: true });
  const existing = await readCorrections();
  const sameDay = existing.filter((r) => r.date === input.date).length;
  const record: CorrectionRecord = {
    ...input,
    id: `${input.date}-${String(sameDay + 1).padStart(3, "0")}`,
    status: input.status ?? "open",
  };
  await fs.appendFile(monthFile(input.date), JSON.stringify(record) + "\n", "utf8");
  return record;
}

/**
 * Group open corrections by agent, most-corrected first — the queue of what to fix
 * next. A repeated rule across several records is the strongest signal of all.
 */
export function openByAgent(records: CorrectionRecord[]): Array<{ agent: string; records: CorrectionRecord[] }> {
  const open = records.filter((r) => r.status === "open");
  const byAgent = new Map<string, CorrectionRecord[]>();
  for (const r of open) {
    const list = byAgent.get(r.agent) ?? [];
    list.push(r);
    byAgent.set(r.agent, list);
  }
  const severityRank: Record<CorrectionSeverity, number> = { high: 3, medium: 2, low: 1 };
  return [...byAgent.entries()]
    .map(([agent, list]) => ({ agent, records: list }))
    .sort((a, b) => {
      if (b.records.length !== a.records.length) return b.records.length - a.records.length;
      const aMax = Math.max(...a.records.map((r) => severityRank[r.severity]));
      const bMax = Math.max(...b.records.map((r) => severityRank[r.severity]));
      return bMax - aMax;
    });
}

/** Mark records applied (folded into a spec) by id. Returns how many changed. */
export async function markApplied(ids: string[]): Promise<number> {
  const wanted = new Set(ids);
  let changed = 0;
  let files: string[];
  try {
    files = (await fs.readdir(correctionsDir())).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }
  for (const file of files) {
    const full = path.join(correctionsDir(), file);
    const raw = await fs.readFile(full, "utf8");
    const lines = raw.split("\n");
    const out = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      try {
        const rec = JSON.parse(trimmed) as CorrectionRecord;
        if (wanted.has(rec.id) && rec.status !== "applied") {
          rec.status = "applied";
          changed++;
          return JSON.stringify(rec);
        }
      } catch {
        // leave malformed lines untouched
      }
      return line;
    });
    await fs.writeFile(full, out.join("\n"), "utf8");
  }
  return changed;
}
