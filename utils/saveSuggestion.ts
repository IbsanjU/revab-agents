/**
 * Suggests a default local folder name for saving pulled data (Jira/Confluence/JTMF
 * content) to disk, e.g. `projects/PROJ-XXX`. Agents must still ask the user to confirm
 * (or override) the suggestion before writing anything — see hard rule in
 * .github/copilot-instructions.md ("Ask before saving locally").
 */

const ISSUE_KEY_RE = /^([A-Z][A-Z0-9_]*)-\d+$/;

/**
 * Derive a suggested project folder name from a hint, which may be:
 * - a Jira issue key, e.g. "PROJ-123" -> "PROJ-XXX"
 * - a Jira/Confluence project or space key, e.g. "PROJ" -> "PROJ-XXX"
 * - anything else -> a sanitized "unsorted" fallback
 */
export function suggestProjectFolder(hint?: string | null): string {
  if (!hint) return "unsorted";
  const trimmed = hint.trim();
  const match = ISSUE_KEY_RE.exec(trimmed);
  const prefix = match ? match[1] : trimmed;
  const sanitized = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!sanitized) return "unsorted";
  return `${sanitized}-XXX`;
}

/** Build the message an agent should show the user before saving pulled data locally. */
export function buildSaveConfirmationPrompt(hint: string | undefined, defaultBaseDir: string): {
  suggestedFolder: string;
  message: string;
} {
  const suggestedFolder = suggestProjectFolder(hint);
  return {
    suggestedFolder,
    message:
      `No project folder was specified. Ask the user which project name to save under ` +
      `(default suggestion: \`${defaultBaseDir}/${suggestedFolder}\`). Re-call this tool with an explicit ` +
      `\`project\` value once confirmed.`,
  };
}
