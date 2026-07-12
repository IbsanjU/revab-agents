import { stripHtml } from "../mcp-servers/shared/http.js";

/**
 * Expands Confluence "structured macro" content that would otherwise be lost or
 * flattened by a plain HTML-to-text strip — accordions, expand panels, tabs
 * groups/pages, info/note/warning panels — into a readable, nested plain-text
 * outline. Handles arbitrary nesting depth (e.g. tabs inside an accordion inside
 * another accordion) by repeatedly collapsing the innermost macro block first.
 */

const MACRO_BLOCK_RE =
  /<ac:structured-macro ac:name="([^"]+)"[^>]*>((?:(?!<ac:structured-macro)[\s\S])*?)<\/ac:structured-macro>/;

const LEAF_LABELS: Record<string, string> = {
  expand: "Expand",
  "accordion-tab": "Accordion tab",
  "tabs-page": "Tab",
  "tabs-pane": "Tab",
  "tab-pane": "Tab",
};

const CONTAINER_MACROS = new Set(["accordion", "tabs-group", "tabs-container", "deck"]);
const CALLOUT_LABELS: Record<string, string> = {
  info: "Info",
  note: "Note",
  warning: "Warning",
  tip: "Tip",
};

function extractParam(body: string, name: string): string | undefined {
  const re = new RegExp(`<ac:parameter ac:name="${name}">([\\s\\S]*?)</ac:parameter>`, "i");
  const match = re.exec(body);
  return match ? stripHtml(match[1]) : undefined;
}

function extractInnerBody(body: string): string {
  const richText = /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i.exec(body);
  if (richText) return richText[1];
  const plainText = /<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/i.exec(body);
  if (plainText) return plainText[1];
  // Strip any leading <ac:parameter> tags and use the remainder as the body.
  return body.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, "");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() ? prefix + line : line))
    .join("\n");
}

/** Expand every Confluence structured macro in `html` into readable nested plain text. */
export function expandConfluenceMacros(html: string, maxIterations = 500): string {
  let current = html;
  for (let i = 0; i < maxIterations; i++) {
    const match = MACRO_BLOCK_RE.exec(current);
    if (!match) break;
    const [fullMatch, name, body] = match;
    const innerHtml = extractInnerBody(body);
    const innerText = stripHtml(innerHtml).trim();

    let rendered: string;
    if (LEAF_LABELS[name]) {
      const title = extractParam(body, "title") ?? "(untitled)";
      rendered = `\n[${LEAF_LABELS[name]}: ${title}]\n${indent(innerText, "  ")}\n`;
    } else if (CALLOUT_LABELS[name]) {
      const title = extractParam(body, "title");
      rendered = `\n> **${CALLOUT_LABELS[name]}${title ? `: ${title}` : ""}**\n${indent(innerText, "> ")}\n`;
    } else if (CONTAINER_MACROS.has(name)) {
      // Containers just wrap already-expanded children — pass their (already rendered) text through.
      rendered = `\n${innerText}\n`;
    } else {
      // Unknown macro (code, panel, etc.) — fall back to its stripped inner text.
      rendered = innerText;
    }
    current = current.slice(0, match.index) + rendered + current.slice(match.index + fullMatch.length);
  }
  return stripHtml(current).replace(/\n{3,}/g, "\n\n").trim();
}
