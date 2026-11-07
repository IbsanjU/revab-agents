/**
 * Behavior evals without a model. An eval is a markdown file (task prompt + Must / Must not rubric).
 * To run one, a person pastes its prompt into VS Code Copilot Chat with the right agent selected; the
 * gateway's call log records which tools were used; this module then
 *   - checks what the log can prove (a tool never called, a write that was not a dry run, a read that
 *     came before a write), deterministically, and
 *   - takes the person's verdict on the judgement items (did it state the approval rule plainly?).
 * No AI provider is called from here, and none is needed.
 */
import type { CallRecord, MarkRecord } from "../mcp-servers/gateway/callLog.js";

export interface BehaviorEval {
  id: string;
  title: string;
  agent: string;
  prompts: string[];
  must: string[];
  mustNot: string[];
}

function section(text: string, heading: RegExp): string {
  const m = heading.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function bullets(block: string, label: RegExp): string[] {
  const m = label.exec(block);
  if (!m) return [];
  const rest = block.slice(m.index + m[0].length);
  const stop = /^\*\*[A-Za-z ]+:\*\*/m.exec(rest);
  const body = stop ? rest.slice(0, stop.index) : rest;
  const out: string[] = [];
  for (const line of body.split("\n")) {
    if (/^- /.test(line)) out.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] += " " + line.trim();
  }
  return out;
}

export function parseBehaviorEval(id: string, text: string): BehaviorEval {
  const title = /^# (.+)$/m.exec(text)?.[1]?.trim() ?? id;
  const agent = /^\*\*Agent:\*\*\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "?";
  const taskBlock = section(text, /^## Task prompts?\s*$/m);
  const prompts: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) prompts.push(cur.join(" ").trim()); cur = []; };
  for (const raw of taskBlock.split("\n")) {
    const m = /^(?:\d+\.\s*)?>\s?(.*)$/.exec(raw);
    if (m) {
      if (/^\d+\.\s*>/.test(raw)) flush();
      cur.push(m[1]);
    } else if (!raw.trim()) flush();
  }
  flush();
  const rubric = section(text, /^## Rubric\s*$/m);
  return { id, title, agent, prompts, must: bullets(rubric, /^\*\*Must:\*\*/m), mustNot: bullets(rubric, /^\*\*Must not:\*\*/m) };
}

// ---- machine checks ------------------------------------------------------------------------

export type Check =
  | { kind: "mustCall"; tool: string; why: string }
  | { kind: "never"; tool: string; why: string }
  /** No state-changing call with `dryRun: false`. */
  | { kind: "noLiveWrites"; why: string }
  /** No state-changing call at all. */
  | { kind: "readOnly"; why: string }
  /** If `then` was called, one of `first` was called before it. Vacuous when `then` was never called. */
  | { kind: "before"; first: string[]; then: string; why: string };

export interface CheckResult {
  check: Check;
  pass: boolean;
  detail: string;
}

export function evaluateChecks(calls: CallRecord[], checks: Check[]): CheckResult[] {
  const names = calls.map((c) => c.tool);
  return checks.map((check): CheckResult => {
    switch (check.kind) {
      case "mustCall": {
        const pass = names.includes(check.tool);
        return { check, pass, detail: pass ? `called \`${check.tool}\`` : `\`${check.tool}\` was never called` };
      }
      case "never": {
        const n = names.filter((t) => t === check.tool).length;
        return { check, pass: n === 0, detail: n === 0 ? `never called \`${check.tool}\`` : `called \`${check.tool}\` ${n}×` };
      }
      case "noLiveWrites": {
        const bad = calls.filter((c) => c.risk === "write" && c.dryRun === false);
        return { check, pass: bad.length === 0, detail: bad.length ? `live write(s): ${[...new Set(bad.map((c) => c.tool))].join(", ")}` : "no write ran with dryRun false" };
      }
      case "readOnly": {
        const bad = calls.filter((c) => c.risk === "write");
        return { check, pass: bad.length === 0, detail: bad.length ? `write call(s): ${[...new Set(bad.map((c) => c.tool))].join(", ")}` : "only read calls" };
      }
      case "before": {
        const idx = names.indexOf(check.then);
        if (idx < 0) return { check, pass: true, detail: `\`${check.then}\` was not called (nothing to order)` };
        const ok = names.slice(0, idx).some((t) => check.first.includes(t));
        return { check, pass: ok, detail: ok ? `\`${check.then}\` came after ${check.first.join(" / ")}` : `\`${check.then}\` was called with none of ${check.first.join(" / ")} before it` };
      }
    }
  });
}

// ---- call log segments ---------------------------------------------------------------------

export type LogLine = CallRecord | MarkRecord;

export function parseLog(text: string): LogLine[] {
  const out: LogLine[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as LogLine); } catch { /* torn last line */ }
  }
  return out;
}

/** Calls recorded after the latest mark for `id`, up to the next mark of any eval. Null if never marked. */
export function segmentFor(lines: LogLine[], id: string): CallRecord[] | null {
  let start = -1;
  lines.forEach((l, i) => { if ("mark" in l && l.mark === id) start = i; });
  if (start < 0) return null;
  const out: CallRecord[] = [];
  for (const l of lines.slice(start + 1)) {
    if ("mark" in l) break;
    out.push(l);
  }
  return out;
}

// ---- manual items and results --------------------------------------------------------------

export interface ManualItem { ref: string; kind: "must" | "mustNot"; text: string }

export function manualItems(e: BehaviorEval): ManualItem[] {
  return [
    ...e.must.map((text, i) => ({ ref: `M${i + 1}`, kind: "must" as const, text })),
    ...e.mustNot.map((text, i) => ({ ref: `N${i + 1}`, kind: "mustNot" as const, text })),
  ];
}

/** Parse `--pass M1,M2 --fail N1` style refs, validating them against the eval. */
export function parseRefs(value: string | undefined, valid: Set<string>): string[] {
  if (!value) return [];
  const refs = value.split(",").map((r) => r.trim().toUpperCase()).filter(Boolean);
  const bad = refs.filter((r) => !valid.has(r));
  if (bad.length) throw new Error(`unknown item(s) ${bad.join(", ")}; valid: ${[...valid].join(", ")}`);
  return refs;
}

export type Verdict = "PASS" | "FAIL" | "PENDING";

export function verdictOf(machine: CheckResult[], items: ManualItem[], passed: string[], failed: string[]): { verdict: Verdict; unjudged: string[] } {
  const judged = new Set([...passed, ...failed]);
  const unjudged = items.filter((i) => !judged.has(i.ref)).map((i) => i.ref);
  if (machine.some((m) => !m.pass) || failed.length) return { verdict: "FAIL", unjudged };
  return { verdict: unjudged.length ? "PENDING" : "PASS", unjudged };
}

const PLACEHOLDER = /^\|\s*_\(record[^\n]*\n?/m;
const HEADER = "| Date | Host / model | Result | Notes |\n|---|---|---|---|\n";

/** Append one run row to an eval's `## Runs` section, replacing any placeholder. */
export function recordRun(text: string, row: { date: string; host: string; result: string; notes: string }): string {
  const line = `| ${row.date} | ${row.host} | ${row.result} | ${row.notes.replace(/\|/g, "/").replace(/\s+/g, " ")} |\n`;
  const idx = text.search(/^## Runs\s*$/m);
  if (idx < 0) return text.replace(/\n*$/, "\n") + `\n## Runs\n\n${HEADER}${line}`;
  const head = text.slice(0, idx);
  let body = text.slice(idx).replace(/^## Runs\s*\n/, "");
  body = body.replace(/^\s*_No [^\n]*_\s*\n?/m, "");
  if (!/^\|.*\bDate\b/m.test(body)) body = `\n${HEADER}`;
  body = body.replace(PLACEHOLDER, "");
  return `${head}## Runs\n${body.replace(/^\n*/, "\n").replace(/\n*$/, "\n")}${line}`;
}

// ---- the paste-in pack ---------------------------------------------------------------------

export function renderPack(evals: BehaviorEval[], checksFor: (id: string) => Check[]): string {
  const L: string[] = [
    "# Behavior eval pack for VS Code Copilot",
    "",
    "No AI provider is called by this repo. You run each case in Copilot Chat; the gateway's call log and the rubric do the scoring.",
    "",
    "**Once:** start the gateway with the call log on: `GATEWAY_CALL_LOG=.revab/calls.jsonl npm run revab -- start` (extension users: set `GATEWAY_CALL_LOG` in `revab.environment`, then restart the gateway).",
    "",
    "**For each case:** 1) run its `mark` command, 2) open Copilot Chat in agent mode and pick the named agent from the dropdown, 3) paste the prompt and answer as the agent asks, 4) run `score` with your verdict on each judgement item.",
    "",
  ];
  for (const e of evals) {
    const items = manualItems(e);
    const checks = checksFor(e.id);
    L.push(`## ${e.id}`, "", `**${e.title}** · agent: ${e.agent}`, "", `1. \`npm run eval:behavior -- mark ${e.id}\``);
    L.push(`2. Pick **${e.agent}** in the chat agent dropdown and paste:`, "");
    for (const p of e.prompts) L.push(`   > ${p}`, "");
    L.push("3. Then judge each item (what the log cannot see):", "");
    for (const i of items) L.push(`   - **${i.ref}** ${i.kind === "must" ? "must" : "must NOT"}: ${i.text}`);
    L.push("", `4. \`npm run eval:behavior -- score ${e.id} --model "<model shown in the picker>" --pass M1,M2,... --fail N1,...\``, "");
    L.push(checks.length ? `Checked automatically from the call log: ${checks.map((c) => c.why).join("; ")}.` : "No automatic checks: this case is all judgement.", "");
  }
  return L.join("\n");
}
