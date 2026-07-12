/**
 * Diagram parsers: convert structured diagram sources into a machine-readable
 * `{ nodes, edges }` graph so agents can reason about flows without vision.
 *
 * Supported formats:
 * - draw.io / diagrams.net XML (`.drawio`, `.xml`, Confluence-embedded exports)
 * - Mermaid flowchart/graph source (` flowchart TD` / `graph LR` blocks)
 * - PlantUML activity/component-style arrows (`A --> B : label`)
 *
 * Raster-only diagrams (PNG/JPG flowcharts) have no structure to parse — callers
 * should fall back to OCR block output and flag the result as best-effort.
 */

export interface DiagramNode {
  id: string;
  label: string;
  shape?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramGraph {
  format: "drawio" | "mermaid" | "plantuml";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  warnings: string[];
}

/** Strip HTML tags and decode common entities from draw.io labels. */
function cleanLabel(raw: string): string {
  const entities: Record<string, string> = {
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:lt|gt|amp|quot|#39|apos|nbsp);/g, (m) => entities[m])
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : undefined;
}

/**
 * Parse draw.io / diagrams.net XML (uncompressed `<mxGraphModel>` content).
 * Vertices (`vertex="1"`) become nodes; edges (`edge="1"`) become edges, with
 * edge labels taken from the edge's own `value` or a child label cell.
 */
export function parseDrawio(xml: string): DiagramGraph {
  const warnings: string[] = [];
  if (!/<mxGraphModel|<mxfile/i.test(xml)) {
    throw new Error("Not a draw.io/diagrams.net XML document (no <mxGraphModel>/<mxfile> found).");
  }
  if (/<diagram[^>]*>[^<\s][A-Za-z0-9+/=\s]{40,}<\/diagram>/.test(xml) && !/<mxGraphModel/i.test(xml)) {
    throw new Error(
      "This draw.io file stores compressed diagram data. Re-export it uncompressed (File > Properties > uncheck Compressed) and retry."
    );
  }

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const cellTags = xml.match(/<mxCell\b[^>]*>/g) ?? [];
  for (const tag of cellTags) {
    const id = attr(tag, "id");
    if (!id) continue;
    const value = cleanLabel(attr(tag, "value") ?? "");
    if (attr(tag, "vertex") === "1") {
      const style = attr(tag, "style") ?? "";
      const shape = /ellipse/.test(style)
        ? "ellipse"
        : /rhombus/.test(style)
          ? "decision"
          : /shape=([a-zA-Z0-9_]+)/.exec(style)?.[1] ?? "rectangle";
      nodes.push({ id, label: value, shape });
    } else if (attr(tag, "edge") === "1") {
      const from = attr(tag, "source");
      const to = attr(tag, "target");
      if (from && to) {
        edges.push({ from, to, ...(value ? { label: value } : {}) });
      } else {
        warnings.push(`Edge ${id} is missing a source or target (unconnected arrow) — skipped.`);
      }
    }
  }
  // Resolve edge endpoints to node labels where possible for readability.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    edge.from = byId.get(edge.from)?.label || edge.from;
    edge.to = byId.get(edge.to)?.label || edge.to;
  }
  return { format: "drawio", nodes, edges, warnings };
}

const MERMAID_EDGE_RE =
  /^\s*([A-Za-z0-9_.-]+)\s*(?:[[({]+"?([^\]})"]*)"?[\])}]+)?\s*[-=.]+[->][>]?\s*(?:\|([^|]*)\|\s*)?([A-Za-z0-9_.-]+)\s*(?:[[({]+"?([^\]})"]*)"?[\])}]+)?/;
const MERMAID_NODE_RE = /^\s*([A-Za-z0-9_.-]+)\s*[[({]+"?([^\]})"]*)"?[\])}]+\s*$/;

/** Parse a Mermaid `flowchart` / `graph` block into nodes and edges. */
export function parseMermaid(source: string): DiagramGraph {
  const warnings: string[] = [];
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const lines = source
    .replace(/```(?:mermaid)?/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(flowchart|graph|sequenceDiagram|classDiagram|%%|subgraph|end$|direction)/i.test(l));

  const upsert = (id: string, label?: string) => {
    const existing = nodes.get(id);
    if (existing) {
      if (label && existing.label === existing.id) existing.label = label;
      return;
    }
    nodes.set(id, { id, label: label || id });
  };

  for (const line of lines) {
    const edgeMatch = MERMAID_EDGE_RE.exec(line);
    if (edgeMatch) {
      const [, fromId, fromLabel, edgeLabel, toId, toLabel] = edgeMatch;
      upsert(fromId, fromLabel?.trim());
      upsert(toId, toLabel?.trim());
      edges.push({ from: fromId, to: toId, ...(edgeLabel?.trim() ? { label: edgeLabel.trim() } : {}) });
      continue;
    }
    const nodeMatch = MERMAID_NODE_RE.exec(line);
    if (nodeMatch) {
      upsert(nodeMatch[1], nodeMatch[2]?.trim());
      continue;
    }
    warnings.push(`Unparsed line: ${line}`);
  }
  return { format: "mermaid", nodes: [...nodes.values()], edges, warnings };
}

const PLANTUML_EDGE_RE = /^\s*"?([^"\s][^"]*?)"?\s*[-.]{1,2}(?:left|right|up|down)?[-.]*>\s*"?([^":]*?)"?\s*(?::\s*(.+))?$/;

/** Parse PlantUML arrow lines (`A --> B : label`) into nodes and edges. */
export function parsePlantuml(source: string): DiagramGraph {
  const warnings: string[] = [];
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(@startuml|@enduml|'|title\b|skinparam\b|!|scale\b)/i.test(l));

  for (const line of lines) {
    const m = PLANTUML_EDGE_RE.exec(line);
    if (!m) {
      warnings.push(`Unparsed line: ${line}`);
      continue;
    }
    const [, from, to, label] = m;
    const fromId = from.trim();
    const toId = to.trim();
    if (!fromId || !toId) continue;
    if (!nodes.has(fromId)) nodes.set(fromId, { id: fromId, label: fromId });
    if (!nodes.has(toId)) nodes.set(toId, { id: toId, label: toId });
    edges.push({ from: fromId, to: toId, ...(label?.trim() ? { label: label.trim() } : {}) });
  }
  return { format: "plantuml", nodes: [...nodes.values()], edges, warnings };
}

/** Detect the diagram format of a source string and parse it. */
export function parseDiagram(source: string, formatHint?: "drawio" | "mermaid" | "plantuml"): DiagramGraph {
  const format =
    formatHint ??
    (/<mxGraphModel|<mxfile/i.test(source)
      ? "drawio"
      : /@startuml/i.test(source)
        ? "plantuml"
        : /^\s*(flowchart|graph)\b/m.test(source) || /```mermaid/.test(source)
          ? "mermaid"
          : undefined);
  if (!format) {
    throw new Error(
      "Could not detect diagram format. Supported: draw.io/diagrams.net XML, Mermaid flowchart/graph, PlantUML. " +
        "For raster images (PNG/JPG), use ocr_image instead — the result is best-effort and needs human confirmation."
    );
  }
  if (format === "drawio") return parseDrawio(source);
  if (format === "plantuml") return parsePlantuml(source);
  return parseMermaid(source);
}
