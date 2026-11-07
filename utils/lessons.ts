/**
 * Structured lessons: small, atomic, evidence-backed behaviours the framework has learned, kept in
 * knowledge/lessons.md next to the free-form learnings log. Idea taken from ECC's continuous-learning
 * ("instincts" with confidence and scope), simplified to what a plain markdown file can enforce.
 *
 * A lesson is a block of `key: value` lines. Confidence is computed from the counts, never stored,
 * so it cannot drift from its evidence:
 *
 *     confidence = (1 - 0.7^support) * 0.5^contradict
 *
 * One observation is 0.30; three is 0.66; each contradiction halves what is left.
 */

export interface Lesson {
  id: string;
  trigger: string;
  action: string;
  /** `global`, or `project:<name>` for a lesson that must not leak across projects. */
  scope: string;
  domain: string;
  /** Independent observations that support it (>= 1). */
  support: number;
  contradict: number;
  /** Where it was observed: PR numbers, commits, files. Required: no citation, no lesson. */
  evidence: string;
  /** ISO date of the latest observation. */
  last: string;
}

const KEYS = ["id", "trigger", "action", "scope", "domain", "support", "contradict", "evidence", "last"] as const;
const SCOPE = /^(global|project:[a-z0-9][a-z0-9-_]*)$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Promotion bar: seen at least this often with nothing against it. */
export const PROMOTE_AT = 3;

export function confidence(l: Pick<Lesson, "support" | "contradict">): number {
  return Math.round((1 - Math.pow(0.7, l.support)) * Math.pow(0.5, l.contradict) * 100) / 100;
}

/** Parse every `id:`-led block. Headings, comments and prose between blocks are ignored. */
export function parseLessons(text: string): Array<Partial<Record<(typeof KEYS)[number], string>> & { _line: number }> {
  const out: Array<Partial<Record<(typeof KEYS)[number], string>> & { _line: number }> = [];
  let cur: (Partial<Record<(typeof KEYS)[number], string>> & { _line: number }) | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) { cur = null; return; }
    const m = /^([a-z]+):\s*(.*)$/.exec(line);
    if (m && (KEYS as readonly string[]).includes(m[1])) {
      if (m[1] === "id") { cur = { _line: i + 1 }; out.push(cur); }
      if (cur) (cur as Record<string, string | number>)[m[1]] = m[2].trim();
    } else if (!/^(#|<!--|-->)/.test(line)) {
      cur = null; // prose ends a block
    }
  });
  return out;
}

export interface LessonProblem { id: string; line: number; message: string }

/** Validate raw parsed blocks and return typed lessons plus every problem found. */
export function validateLessons(text: string): { lessons: Lesson[]; problems: LessonProblem[] } {
  const problems: LessonProblem[] = [];
  const lessons: Lesson[] = [];
  const seen = new Set<string>();
  for (const raw of parseLessons(text)) {
    const id = raw.id ?? "?";
    const bad = (message: string) => problems.push({ id, line: raw._line, message });
    for (const k of KEYS) if (!raw[k]) bad(`missing \`${k}\``);
    if (raw.id && !ID.test(raw.id)) bad("id must be kebab-case");
    if (raw.id && seen.has(raw.id)) bad("duplicate id");
    if (raw.id) seen.add(raw.id);
    if (raw.scope && !SCOPE.test(raw.scope)) bad("scope must be `global` or `project:<name>`");
    if (raw.last && !DATE.test(raw.last)) bad("last must be YYYY-MM-DD");
    const support = Number(raw.support);
    const contradict = Number(raw.contradict);
    if (raw.support && (!Number.isInteger(support) || support < 1)) bad("support must be an integer >= 1");
    if (raw.contradict && (!Number.isInteger(contradict) || contradict < 0)) bad("contradict must be an integer >= 0");
    if (raw.evidence && raw.evidence.length < 3) bad("evidence must name where it was observed");
    if (KEYS.every((k) => raw[k]) && !problems.some((p) => p.line === raw._line)) {
      lessons.push({ id: raw.id!, trigger: raw.trigger!, action: raw.action!, scope: raw.scope!, domain: raw.domain!, support, contradict, evidence: raw.evidence!, last: raw.last! });
    }
  }
  return { lessons, problems };
}

export type Verdict = "promote" | "review" | "keep";

/** What should happen to a lesson next. Report-only: a person or self-improve acts on it. */
export function verdict(l: Lesson): { verdict: Verdict; why: string } {
  if (l.contradict >= 2 && l.contradict >= l.support) return { verdict: "review", why: "contradicted as often as supported: fix or retire it" };
  if (l.support >= PROMOTE_AT && l.contradict === 0) {
    return {
      verdict: "promote",
      why: l.scope === "global"
        ? "seen often, never contradicted: fold into a skill or `prompts/shared/conduct.ts` (self-improve proposes the diff)"
        : `seen often, never contradicted: fold into the ${l.scope.slice(8)} project's knowledge or skill`,
    };
  }
  return { verdict: "keep", why: `${l.support}/${PROMOTE_AT} observations toward promotion` };
}

/** Record another observation of a lesson in the file text; throws if the id is unknown. */
export function reinforce(text: string, id: string, evidence: string, date: string, against = false): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `id: ${id}`);
  if (start < 0) throw new Error(`no lesson with id \`${id}\``);
  let end = start;
  while (end + 1 < lines.length && lines[end + 1].trim() !== "") end++;
  const field = against ? "contradict" : "support";
  const set = (key: string, fn: (v: string) => string) => {
    const i = lines.findIndex((l, n) => n >= start && n <= end && l.startsWith(`${key}:`));
    if (i < 0) throw new Error(`lesson \`${id}\` has no \`${key}\``);
    lines[i] = `${key}: ${fn(lines[i].slice(key.length + 1).trim())}`;
  };
  set(field, (v) => String(Number(v) + 1));
  set("evidence", (v) => `${v}; ${evidence}`);
  set("last", () => date);
  return lines.join("\n");
}

export function renderList(lessons: Lesson[]): string {
  const rows = [...lessons].sort((a, b) => confidence(b) - confidence(a) || a.id.localeCompare(b.id));
  const out = ["id | conf | support/against | scope | verdict"];
  for (const l of rows) out.push(`${l.id} | ${confidence(l).toFixed(2)} | ${l.support}/${l.contradict} | ${l.scope} | ${verdict(l).verdict}`);
  return out.join("\n");
}
