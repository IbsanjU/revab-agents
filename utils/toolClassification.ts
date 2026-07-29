/**
 * Classify each tool as read-only or write — the basis for safe auto-approval.
 *
 * The friction users feel is confirming every single tool call, including harmless
 * reads. The fix is not "approve everything": it is to auto-approve the tools that
 * cannot change anything, and keep the confirmation exactly where it matters — on
 * writes to Jira/Confluence/JTMF, on anything that touches disk, and on commands.
 *
 * Classification is deliberately **fail-closed**: a tool is treated as a write unless
 * it clearly reads. A misclassified read costs one extra click; a misclassified write
 * silently creates tickets, so the default must never be "assume safe".
 *
 * Note this is about *approval prompts*, not authorization. Even an auto-approved
 * write would still hit the dryRun-first guard — but the confirmation is the layer a
 * user actually sees, so it stays on writes regardless.
 */

export type ToolRisk = "read" | "write";

/**
 * Verbs that mean the tool changes state somewhere. Checked first, fail-closed.
 *
 * Matched against whole `_`-separated segments, never as substrings: `widget`
 * contains "get", so substring matching would classify an unknown `frobnicate_widget`
 * as a safe read — the precise fail-open case this module exists to prevent.
 */
const WRITE_MARKERS = new Set([
  "create",
  "update",
  "delete",
  "assign",
  "move",
  "transition",
  "comment",
  "upload",
  "download",
  "save",
  "scaffold",
  "write",
  "send",
  "notify",
  "run",
  "generate",
  "append",
]);

/** Verbs that mean the tool only reads. Applied only when no write marker matched. */
const READ_MARKERS = new Set([
  "search",
  "get",
  "list",
  "read",
  "show",
  "log",
  "diff",
  "branches",
  "extract",
  "detect",
  "summary",
  "ocr",
]);

/**
 * Tools whose names are ambiguous or misleading, pinned explicitly.
 * Each entry documents why the name alone would classify it wrongly.
 */
const EXPLICIT: Record<string, ToolRisk> = {
  // "run_" marks these as writes: they execute a test suite in a target repo,
  // which is a side effect worth confirming even though nothing is persisted remotely.
  run_bdd: "write",
  run_playwright: "write",
  // Writes an Allure report to disk in the target project.
  generate_report: "write",
  // Reads results that already exist — despite living beside the report generator.
  allure_summary: "read",
  get_result_json: "read",
  // Reads the repo's conventions; "detect" is read-only despite sitting in codegen.
  detect_conventions: "read",
  // Persists to knowledge/ — a real write to this repo.
  knowledge_append: "write",
  knowledge_search: "read",
  // These pull remote content to local disk (hard rule #12: confirm the folder first).
  jira_save_issue: "write",
  confluence_save_page: "write",
  github_save_file: "write",
  confluence_download_attachment: "write",
  // Produces files on disk.
  create_pdf: "write",
  create_docx: "write",
  create_diagram: "write",
  // Reads a diagram's source into a graph — no output file.
  read_diagram: "read",
};

/**
 * Classify a tool by name. Unknown/ambiguous names resolve to "write" so a new tool
 * is never auto-approved by accident — it must be classified deliberately.
 */
export function classifyTool(name: string): ToolRisk {
  const explicit = EXPLICIT[name];
  if (explicit) return explicit;

  const segments = name.toLowerCase().split(/[_\-.]/).filter(Boolean);
  if (segments.some((segment) => WRITE_MARKERS.has(segment))) return "write";
  if (segments.some((segment) => READ_MARKERS.has(segment))) return "read";
  return "write";
}

export interface ClassifiedTools {
  read: string[];
  write: string[];
}

/** Split a tool list into the auto-approvable reads and the confirm-first writes. */
export function classifyTools(names: string[]): ClassifiedTools {
  const read: string[] = [];
  const write: string[] = [];
  for (const name of names) {
    (classifyTool(name) === "read" ? read : write).push(name);
  }
  return { read: read.sort(), write: write.sort() };
}

/**
 * Build the auto-approve entries for a VS Code workspace setting: read-only tools
 * true, writes explicitly false so the intent is visible in the settings file rather
 * than depending on an absent key defaulting the right way.
 */
export function buildAutoApproveMap(names: string[]): Record<string, boolean> {
  const { read, write } = classifyTools(names);
  const map: Record<string, boolean> = {};
  for (const name of read) map[name] = true;
  for (const name of write) map[name] = false;
  return map;
}
