/**
 * Citation validation — makes hard rule #9 enforceable instead of aspirational.
 *
 * Every generated test case, scenario, or external write must carry a source. That
 * rule was previously enforced only as "the string is non-empty", which a model
 * satisfies with `source: "TBD"` or `"from the requirements"` — exactly the
 * plausible-sounding filler the rule exists to prevent. A citation that cannot be
 * resolved back to a real artifact is a hallucination with extra steps.
 *
 * So a citation must match a known, checkable shape:
 *   - Jira issue key            `PROJ-123`
 *   - Confluence page           `confluence:123456` (or `page:123456`)
 *   - JTMF test case            `jtmf:ABC-321`
 *   - App model reference       `app-model:<project>#<section>`
 *   - Transcript timestamp      `transcript:<id>@00:12:34`
 *   - Repo file (with line)     `path/to/file.ts:42`
 *   - URL                       `https://…`
 *
 * Multiple citations may be comma-separated; every one must be valid. The point is
 * not format policing — it is that each accepted form names something a human or a
 * later agent can actually go and open.
 */

export type CitationKind =
  | "jira"
  | "confluence"
  | "jtmf"
  | "app-model"
  | "transcript"
  | "file"
  | "url";

export interface ParsedCitation {
  kind: CitationKind;
  /** The citation exactly as written. */
  raw: string;
}

/** Filler an agent reaches for when it has no real source. Rejected explicitly. */
const PLACEHOLDER = /^(tbd|todo|n\/?a|none|unknown|source|the requirements?|requirements?|from (the )?(chat|requirements?|ticket|spec)|internal|experience|assumed?|inferred)$/i;

const PATTERNS: Array<{ kind: CitationKind; test: RegExp }> = [
  { kind: "jira", test: /^[A-Z][A-Z0-9_]+-\d+$/ },
  { kind: "confluence", test: /^(confluence|page):\d+$/i },
  { kind: "jtmf", test: /^jtmf:[A-Z][A-Z0-9_]+-\d+$/i },
  // app-model:<project>#<section> — section optional but the project is not.
  { kind: "app-model", test: /^app-model:[\w.-]+(#[\w .-]+)?$/i },
  // transcript:<id>@HH:MM:SS or @MM:SS — a timestamp is what makes it checkable.
  { kind: "transcript", test: /^transcript:[\w.-]+@\d{1,2}:\d{2}(:\d{2})?$/i },
  { kind: "url", test: /^https?:\/\/\S+$/i },
  // A repo path, optionally with :line. Requires a real extension so bare prose
  // ("the login page") can't pass as a file reference.
  { kind: "file", test: /^[\w./\\-]+\.[A-Za-z0-9]{1,10}(:\d+)?$/ },
];

export interface CitationValidation {
  valid: boolean;
  citations: ParsedCitation[];
  /** Human-readable reason, present only when invalid. */
  error?: string;
}

const EXPECTED_FORMS =
  "Expected one or more of: a Jira key (PROJ-123), confluence:<pageId>, jtmf:<KEY-123>, " +
  "app-model:<project>#<section>, transcript:<id>@00:12:34, a repo path (src/foo.ts:42), or an https:// URL. " +
  "Comma-separate multiple sources.";

/**
 * Validate a citation string. Returns every parsed citation when valid, or a
 * reason when not. Never throws — callers decide how to surface the failure.
 */
export function validateCitation(source: string | undefined): CitationValidation {
  const raw = (source ?? "").trim();
  if (!raw) {
    return {
      valid: false,
      citations: [],
      error: `A source citation is required (hard rule #9) — do not generate uncited content. ${EXPECTED_FORMS}`,
    };
  }

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const citations: ParsedCitation[] = [];
  for (const part of parts) {
    if (PLACEHOLDER.test(part)) {
      return {
        valid: false,
        citations: [],
        error:
          `"${part}" is a placeholder, not a source. If you don't have a real reference, ask for one instead of inventing content (hard rule #9). ${EXPECTED_FORMS}`,
      };
    }
    const match = PATTERNS.find((p) => p.test.test(part));
    if (!match) {
      return {
        valid: false,
        citations: [],
        error: `"${part}" is not a recognizable source citation. ${EXPECTED_FORMS}`,
      };
    }
    citations.push({ kind: match.kind, raw: part });
  }

  return { valid: true, citations };
}

/**
 * Validate and throw with the reason — for tool handlers that must refuse to
 * write uncited content.
 */
export function requireCitation(source: string | undefined): ParsedCitation[] {
  const result = validateCitation(source);
  if (!result.valid) throw new Error(result.error);
  return result.citations;
}
