import { promises as fs } from "fs";
import { createWriteStream } from "fs";
import path from "path";
import os from "os";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import { imageSize } from "image-size";
import { fileTypeFromBuffer } from "file-type";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { createWorker } from "tesseract.js";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";
import { resolveWithinRoot } from "../../utils/fsSafety.js";
import { resolveProjectRepoPath } from "../../utils/manifest.js";
import { parseDiagram } from "../../utils/diagramParse.js";
import { execCommand } from "../../utils/exec.js";

/**
 * Media MCP server: reads/writes multimedia and document files so their content
 * (images, PDFs, DOCX, and other file types) can be fed to Copilot as structured
 * metadata JSON or plain text, and so agents can generate styled PDF/DOCX reports.
 * Resolves paths against this framework repo by default, or against a manifest
 * project's repoPath if `project` is given (same trust boundary as other
 * project-scoped MCP servers — see utils/manifest.ts).
 */
const ROOT = path.resolve(process.cwd());
const MAX_READ_BYTES = 25 * 1024 * 1024; // 25MB safety cap for in-memory reads/parsing

const EXT_MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
};

async function resolveRoot(project?: string): Promise<string> {
  return project ? resolveProjectRepoPath(project) : ROOT;
}

async function readFileWithLimit(target: string): Promise<Buffer> {
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error(`Not a file: ${target}`);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`File exceeds the ${MAX_READ_BYTES}-byte read limit (${stat.size} bytes)`);
  }
  return fs.readFile(target);
}

const SectionSchema = z.object({
  heading: z.string().optional().describe("Optional section heading"),
  body: z.string().describe("Section body text (plain text; newlines become paragraph breaks)"),
});

interface OcrBlock {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface RequirementFragment {
  text: string;
  sourceType: "media-fallback";
  sourceId: string;
  location: string;
  confidence?: number;
}

interface FileExtraction {
  path: string;
  mimeType: string;
  route: string;
  summary: string;
  metadata: Record<string, unknown>;
  fragments: RequirementFragment[];
}

function formatMetaValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value);
}

/**
 * OCR an image buffer with tesseract.js (fully local — no data leaves the machine;
 * language traineddata is downloaded once from the tesseract CDN and cached — set
 * TESSERACT_LANG_PATH / TESSERACT_CACHE_PATH in .env for offline or proxied setups).
 * Returns plain text plus block-level segments with bounding boxes and confidence,
 * so agents can tell headings/labels apart from body text.
 */
async function ocrBuffer(buffer: Buffer, lang: string): Promise<{ text: string; confidence: number; blocks: OcrBlock[] }> {
  const workerOptions: Record<string, string> = {};
  const langPath = process.env.TESSERACT_LANG_PATH;
  const cachePath = process.env.TESSERACT_CACHE_PATH;
  if (langPath) workerOptions.langPath = langPath;
  if (cachePath) workerOptions.cachePath = cachePath;
  const worker = await createWorker(lang, undefined, workerOptions);
  try {
    const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true });
    const blocks: OcrBlock[] = (data.blocks ?? []).map((b) => ({
      text: b.text.trim(),
      confidence: Math.round(b.confidence * 100) / 100,
      bbox: b.bbox,
    }));
    return { text: data.text.trim(), confidence: Math.round(data.confidence * 100) / 100, blocks };
  } finally {
    await worker.terminate();
  }
}

function splitRequirementLines(text: string, maxLines = 20): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 5)
    .slice(0, maxLines);
}

async function listFiles(target: string, recurse: boolean): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) throw new Error(`Path is neither file nor directory: ${target}`);
  const out: string[] = [];
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isFile()) out.push(full);
    if (recurse && entry.isDirectory()) {
      out.push(...(await listFiles(full, true)));
    }
  }
  return out;
}

async function extractFromSingleFile(
  root: string,
  target: string,
  lang: string,
  maxChars: number,
  ocrConfidenceThreshold: number
): Promise<FileExtraction> {
  const rel = path.relative(root, target).replace(/\\/g, "/");
  const stat = await fs.stat(target);
  const buffer = await readFileWithLimit(target);
  const detected = await fileTypeFromBuffer(buffer);
  const ext = path.extname(target).toLowerCase();
  const mimeType = detected?.mime ?? EXT_MIME[ext] ?? "application/octet-stream";
  const sourceId = rel;
  const baseMetadata: Record<string, unknown> = {
    sizeBytes: stat.size,
    extension: ext || "",
  };

  if (mimeType.startsWith("image/")) {
    const result = await ocrBuffer(buffer, lang);
    const lines = splitRequirementLines(result.text);
    let dimensions: { width?: number; height?: number; imageType?: string } = {};
    try {
      const dims = imageSize(buffer);
      dimensions = { width: dims.width, height: dims.height, imageType: dims.type };
    } catch {
      // best effort only; OCR can still proceed without dimensions
    }
    const fragments: RequirementFragment[] = lines.map((line, idx) => ({
      text: line,
      sourceType: "media-fallback",
      sourceId,
      location: `line:${idx + 1}`,
      confidence: result.confidence,
    }));
    const lowConfidence = result.confidence < ocrConfidenceThreshold;
    return {
      path: rel,
      mimeType,
      route: "ocr_image",
      summary: `OCR text length=${result.text.length}; confidence=${result.confidence}${lowConfidence ? " (below threshold)" : ""}`,
      metadata: { ...baseMetadata, ...dimensions, ocrConfidence: result.confidence, ocrBlocks: result.blocks.length },
      fragments,
    };
  }

  if (mimeType === "application/pdf" || ext === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const textResult = await parser.getText();
      const rawText = textResult.text.trim();
      if (rawText.length > 30) {
        const lines = splitRequirementLines(rawText.slice(0, maxChars));
        return {
          path: rel,
          mimeType,
          route: "read_pdf_text",
          summary: `PDF text-layer extracted, pages=${textResult.total}`,
          metadata: { ...baseMetadata, pageCount: textResult.total, extractionMode: "text-layer" },
          fragments: lines.map((line, idx) => ({
            text: line,
            sourceType: "media-fallback",
            sourceId,
            location: `pdf-text-line:${idx + 1}`,
          })),
        };
      }

      const shots = await parser.getScreenshot({ first: 5 });
      const fragments: RequirementFragment[] = [];
      for (const page of shots.pages) {
        const ocr = await ocrBuffer(Buffer.from(page.data), lang);
        for (const line of splitRequirementLines(ocr.text, 10)) {
          fragments.push({
            text: line,
            sourceType: "media-fallback",
            sourceId,
            location: `page:${page.pageNumber}`,
            confidence: ocr.confidence,
          });
        }
      }
      return {
        path: rel,
        mimeType,
        route: "ocr_pdf",
        summary: `PDF had weak/no text layer; OCR applied to ${shots.pages.length} page(s)`,
        metadata: { ...baseMetadata, ocrPages: shots.pages.length, extractionMode: "ocr" },
        fragments,
      };
    } finally {
      await parser.destroy();
    }
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    const lines = splitRequirementLines(result.value.slice(0, maxChars));
    return {
      path: rel,
      mimeType,
      route: "read_docx_text",
      summary: `DOCX extracted${result.messages.length ? ` with ${result.messages.length} warning(s)` : ""}`,
      metadata: {
        ...baseMetadata,
        approxWordCount: result.value.trim().split(/\s+/).filter(Boolean).length,
        warnings: result.messages.length,
      },
      fragments: lines.map((line, idx) => ({
        text: line,
        sourceType: "media-fallback",
        sourceId,
        location: `docx-line:${idx + 1}`,
      })),
    };
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).slice(0, 20);
    const lines = rows.map((r) => JSON.stringify(r));
    return {
      path: rel,
      mimeType,
      route: "read_excel_rows",
      summary: `Excel parsed: sheet=${sheetName}, rows(sample)=${rows.length}`,
      metadata: { ...baseMetadata, sheetName, sampledRows: rows.length },
      fragments: lines.map((line, idx) => ({
        text: line,
        sourceType: "media-fallback",
        sourceId,
        location: `row:${idx + 1}`,
      })),
    };
  }

  if (ext === ".csv") {
    const workbook = XLSX.read(buffer.toString("utf8"), { type: "string" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).slice(0, 30);
    return {
      path: rel,
      mimeType,
      route: "read_csv_rows",
      summary: `CSV parsed rows(sample)=${rows.length}`,
      metadata: { ...baseMetadata, sampledRows: rows.length },
      fragments: rows.map((r, idx) => ({
        text: JSON.stringify(r),
        sourceType: "media-fallback",
        sourceId,
        location: `row:${idx + 1}`,
      })),
    };
  }

  if ([".drawio", ".mmd", ".puml", ".plantuml", ".mermaid"].includes(ext) || (ext === ".xml" && buffer.toString("utf8").includes("mxGraphModel"))) {
    const parsed = parseDiagram(buffer.toString("utf8"));
    const edgeLines = parsed.edges.slice(0, 30).map((e) => `${e.from} -> ${e.to}${e.label ? ` (${e.label})` : ""}`);
    return {
      path: rel,
      mimeType,
      route: "read_diagram",
      summary: `Diagram parsed: nodes=${parsed.nodes.length}, edges=${parsed.edges.length}`,
      metadata: { ...baseMetadata, nodes: parsed.nodes.length, edges: parsed.edges.length },
      fragments: edgeLines.map((line, idx) => ({
        text: line,
        sourceType: "media-fallback",
        sourceId,
        location: `edge:${idx + 1}`,
      })),
    };
  }

  if ([".txt", ".md", ".json", ".yaml", ".yml", ".html", ".htm", ".xml"].includes(ext)) {
    const text = buffer.toString("utf8").slice(0, maxChars);
    const lines = splitRequirementLines(text, 30);
    return {
      path: rel,
      mimeType,
      route: "plain_text_fallback",
      summary: `Plain text fallback for ${ext || "unknown extension"}`,
      metadata: { ...baseMetadata, sampledChars: text.length },
      fragments: lines.map((line, idx) => ({
        text: line,
        sourceType: "media-fallback",
        sourceId,
        location: `line:${idx + 1}`,
      })),
    };
  }

  return {
    path: rel,
    mimeType,
    route: "metadata_only",
    summary: "Unsupported binary type for extraction; metadata only",
    metadata: baseMetadata,
    fragments: [],
  };
}

async function writeConsolidatedMarkdown(
  root: string,
  outputPath: string,
  inputPath: string,
  extractions: FileExtraction[]
): Promise<string> {
  const target = resolveWithinRoot(root, outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const generatedAt = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# Media Requirement Extraction (Fallback)");
  lines.push("");
  lines.push(`- Input: ${inputPath}`);
  lines.push(`- Generated At: ${generatedAt}`);
  lines.push(`- Files Processed: ${extractions.length}`);
  lines.push("");
  for (const ex of extractions) {
    lines.push(`## ${ex.path}`);
    lines.push("");
    lines.push(`- MIME Type: ${ex.mimeType}`);
    lines.push(`- Route: ${ex.route}`);
    lines.push(`- Summary: ${ex.summary}`);
    lines.push("");
    lines.push("### File Metadata");
    lines.push("");
    const metaEntries = Object.entries(ex.metadata ?? {});
    if (metaEntries.length === 0) {
      lines.push("- None");
    } else {
      for (const [k, v] of metaEntries) {
        lines.push(`- ${k}: ${formatMetaValue(v)}`);
      }
    }
    lines.push("");
    lines.push("### Requirement Fragments");
    lines.push("");
    if (ex.fragments.length === 0) {
      lines.push("- None extracted");
    } else {
      for (const fragment of ex.fragments) {
        lines.push(`- [${fragment.location}] ${fragment.text}`);
      }
    }
    lines.push("");
  }
  await fs.writeFile(target, lines.join("\n"), "utf8");
  return path.relative(root, target).replace(/\\/g, "/");
}

startMcpHttpServer({
  name: "media",
  port: intEnv("MEDIA_MCP_PORT", 7319),
  register(server) {
    server.registerTool(
      "get_file_metadata",
      {
        description:
          "Inspect a local file (image, PDF, DOCX, or any other type) and return structured metadata JSON " +
          "— size, detected MIME type, and type-specific details (image width/height; PDF page count and " +
          "document info; DOCX approximate word count) — suitable for feeding to Copilot as context.",
        inputSchema: {
          filePath: z.string().describe("Path to the file, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
        },
      },
      async ({ filePath, project }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, filePath);
          const stat = await fs.stat(target);
          if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
          const ext = path.extname(target).toLowerCase();
          if (stat.size > MAX_READ_BYTES) {
            return textResult({
              path: filePath,
              sizeBytes: stat.size,
              extension: ext,
              warning: `File exceeds the ${MAX_READ_BYTES}-byte metadata-read limit; only size/extension returned.`,
            });
          }

          const buffer = await fs.readFile(target);
          const detected = await fileTypeFromBuffer(buffer);
          const mimeType = detected?.mime ?? EXT_MIME[ext] ?? "application/octet-stream";

          let extra: Record<string, unknown> = {};
          if (mimeType.startsWith("image/")) {
            try {
              const dims = imageSize(buffer);
              extra = { width: dims.width, height: dims.height, imageType: dims.type };
            } catch (e) {
              extra = { imageMetadataError: e instanceof Error ? e.message : String(e) };
            }
          } else if (mimeType === "application/pdf" || ext === ".pdf") {
            const parser = new PDFParse({ data: buffer });
            try {
              const info = await parser.getInfo();
              extra = { pageCount: info.total, info: info.info };
            } catch (e) {
              extra = { pdfMetadataError: e instanceof Error ? e.message : String(e) };
            } finally {
              await parser.destroy();
            }
          } else if (ext === ".docx") {
            try {
              const result = await mammoth.extractRawText({ buffer });
              const words = result.value.trim().split(/\s+/).filter(Boolean);
              extra = { approxWordCount: words.length };
            } catch (e) {
              extra = { docxMetadataError: e instanceof Error ? e.message : String(e) };
            }
          }

          return textResult({ path: filePath, sizeBytes: stat.size, extension: ext, mimeType, ...extra });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "read_pdf_text",
      {
        description: "Extract text from a local PDF file, optionally truncated to maxChars.",
        inputSchema: {
          filePath: z.string().describe("Path to the PDF, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
          maxChars: z.number().optional().describe("Truncate extracted text to this many characters"),
        },
      },
      async ({ filePath, project, maxChars }) => {
        const parser_holder: { parser?: PDFParse } = {};
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, filePath);
          const buffer = await readFileWithLimit(target);
          const parser = new PDFParse({ data: buffer });
          parser_holder.parser = parser;
          const result = await parser.getText();
          const text = maxChars ? result.text.slice(0, maxChars) : result.text;
          return textResult({
            pageCount: result.total,
            truncated: !!maxChars && result.text.length > maxChars,
            text,
          });
        } catch (err) {
          return errorResult(err);
        } finally {
          await parser_holder.parser?.destroy();
        }
      }
    );

    server.registerTool(
      "read_docx_text",
      {
        description: "Extract plain text from a local DOCX file.",
        inputSchema: {
          filePath: z.string().describe("Path to the .docx file, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
        },
      },
      async ({ filePath, project }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, filePath);
          const buffer = await readFileWithLimit(target);
          const result = await mammoth.extractRawText({ buffer });
          return textResult({ text: result.value, warnings: result.messages.map((m) => m.message) });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "read_excel_rows",
      {
        description:
          "Parse a local .xlsx/.xls file into structured rows — e.g. a bulk requirements/ticket sheet a " +
          "stakeholder shared. Treats the first row of the sheet as column headers and returns each following " +
          "row as an object keyed by header (blank cells become empty strings). Use jira_bulk_create_issues " +
          "to turn the returned rows into tickets after mapping columns to Jira fields.",
        inputSchema: {
          filePath: z.string().describe("Path to the .xlsx/.xls file, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
          sheetName: z.string().optional().describe("Sheet to read (default: first sheet in the workbook)"),
          maxRows: z.number().optional().describe("Cap the number of data rows returned (default: all)"),
        },
      },
      async ({ filePath, project, sheetName, maxRows }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, filePath);
          const buffer = await readFileWithLimit(target);
          const workbook = XLSX.read(buffer, { type: "buffer" });
          const resolvedSheet = sheetName ?? workbook.SheetNames[0];
          const sheet = workbook.Sheets[resolvedSheet];
          if (!sheet) {
            throw new Error(`Sheet "${resolvedSheet}" not found. Available sheets: ${workbook.SheetNames.join(", ")}`);
          }
          const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
          const rows = maxRows ? allRows.slice(0, maxRows) : allRows;
          return textResult({
            sheetNames: workbook.SheetNames,
            sheet: resolvedSheet,
            headers: allRows.length ? Object.keys(allRows[0]) : [],
            rowCount: allRows.length,
            truncated: !!maxRows && allRows.length > maxRows,
            rows,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "read_csv_rows",
      {
        description:
          "Parse a local .csv file into structured rows. Treats the first row as column headers and returns " +
          "each following row as an object keyed by header (blank cells become empty strings). Use " +
          "jira_bulk_create_issues to turn the returned rows into tickets after mapping columns to Jira fields.",
        inputSchema: {
          filePath: z.string().describe("Path to the .csv file, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
          maxRows: z.number().optional().describe("Cap the number of data rows returned (default: all)"),
        },
      },
      async ({ filePath, project, maxRows }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, filePath);
          const buffer = await readFileWithLimit(target);
          const workbook = XLSX.read(buffer.toString("utf8"), { type: "string" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
          const rows = maxRows ? allRows.slice(0, maxRows) : allRows;
          return textResult({
            headers: allRows.length ? Object.keys(allRows[0]) : [],
            rowCount: allRows.length,
            truncated: !!maxRows && allRows.length > maxRows,
            rows,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "create_pdf",
      {
        description:
          "Create a styled PDF document from a title and a list of sections (optional heading + body text). " +
          "Supports a custom accent color for the title/headings.",
        inputSchema: {
          targetPath: z.string().describe("Where to write the PDF, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve targetPath against (default: this framework repo)"),
          title: z.string().describe("Document title"),
          sections: z.array(SectionSchema).min(1).describe("Ordered list of sections"),
          accentColor: z.string().optional().describe("Hex color for the title/headings, e.g. #2563eb (default #1f2937)"),
        },
      },
      async ({ targetPath, project, title, sections, accentColor }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, targetPath);
          await fs.mkdir(path.dirname(target), { recursive: true });
          const color = accentColor ?? "#1f2937";

          await new Promise<void>((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50 });
            const stream = createWriteStream(target);
            doc.pipe(stream);
            doc.fontSize(24).fillColor(color).text(title, { align: "center" });
            doc.moveDown(1.5);
            for (const section of sections) {
              if (section.heading) {
                doc.fontSize(16).fillColor(color).text(section.heading);
                doc.moveDown(0.3);
              }
              doc.fontSize(11).fillColor("#111827").text(section.body, { align: "left" });
              doc.moveDown(1);
            }
            doc.end();
            stream.on("finish", resolve);
            stream.on("error", reject);
          });

          return textResult({ savedTo: path.relative(root, target).replace(/\\/g, "/") });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "create_docx",
      {
        description:
          "Create a styled DOCX document from a title and a list of sections (optional heading + body paragraphs).",
        inputSchema: {
          targetPath: z.string().describe("Where to write the .docx, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve targetPath against (default: this framework repo)"),
          title: z.string().describe("Document title"),
          sections: z.array(SectionSchema).min(1).describe("Ordered list of sections"),
        },
      },
      async ({ targetPath, project, title, sections }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, targetPath);
          await fs.mkdir(path.dirname(target), { recursive: true });

          const children: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
          for (const section of sections) {
            if (section.heading) {
              children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
            }
            for (const line of section.body.split(/\n+/)) {
              if (line.trim()) children.push(new Paragraph({ children: [new TextRun(line)] }));
            }
          }

          const doc = new Document({ sections: [{ children }] });
          const buffer = await Packer.toBuffer(doc);
          await fs.writeFile(target, buffer);

          return textResult({ savedTo: path.relative(root, target).replace(/\\/g, "/") });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "ocr_image",
      {
        description:
          "OCR a local image (screenshot, scanned requirement doc, whiteboard photo) with a fully local " +
          "tesseract engine — no data leaves the machine. Returns plain text plus block-level segments " +
          "with bounding boxes and confidence scores so headings/labels can be told apart from body text.",
        inputSchema: {
          filePath: z.string().describe("Path to the image, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
          lang: z.string().optional().describe("Tesseract language code (default: eng)"),
        },
      },
      async ({ filePath, project, lang }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, filePath);
          const buffer = await readFileWithLimit(target);
          const result = await ocrBuffer(buffer, lang ?? "eng");
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "ocr_pdf",
      {
        description:
          "OCR a scanned/image-only PDF page by page (read_pdf_text only handles PDFs with a text layer). " +
          "Renders each page and runs local tesseract OCR on it. Slow for large PDFs — use maxPages.",
        inputSchema: {
          filePath: z.string().describe("Path to the PDF, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
          lang: z.string().optional().describe("Tesseract language code (default: eng)"),
          maxPages: z.number().optional().describe("OCR at most this many pages (default 10)"),
        },
      },
      async ({ filePath, project, lang, maxPages }) => {
        const holder: { parser?: PDFParse } = {};
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, filePath);
          const buffer = await readFileWithLimit(target);
          const parser = new PDFParse({ data: buffer });
          holder.parser = parser;
          const limit = Math.max(1, maxPages ?? 10);
          const shots = await parser.getScreenshot({ first: limit });
          const pages: Array<{ pageNumber: number; text: string; confidence: number }> = [];
          for (const page of shots.pages) {
            const result = await ocrBuffer(Buffer.from(page.data), lang ?? "eng");
            pages.push({ pageNumber: page.pageNumber, text: result.text, confidence: result.confidence });
          }
          return textResult({ totalPages: shots.total, ocrPages: pages.length, pages });
        } catch (err) {
          return errorResult(err);
        } finally {
          await holder.parser?.destroy();
        }
      }
    );

    server.registerTool(
      "read_diagram",
      {
        description:
          "Parse a structured diagram into a machine-readable { nodes, edges } graph. Supports " +
          "draw.io/diagrams.net XML (.drawio/.xml), Mermaid flowchart/graph source, and PlantUML arrows " +
          "— pass either a filePath or inline source. For raster-only diagrams (PNG/JPG flowcharts) use " +
          "ocr_image instead and treat the output as best-effort, needing human confirmation.",
        inputSchema: {
          filePath: z.string().optional().describe("Path to the diagram file, relative to the repo (or the project's repo if `project` is given)"),
          source: z.string().optional().describe("Inline diagram source (e.g. a mermaid block copied from a Confluence page or .md file)"),
          project: z.string().optional().describe("Manifest project name to resolve filePath against (default: this framework repo)"),
          format: z.enum(["drawio", "mermaid", "plantuml"]).optional().describe("Format hint (default: auto-detect)"),
        },
      },
      async ({ filePath, source, project, format }) => {
        try {
          if (!filePath && !source) throw new Error("Provide either filePath or source.");
          let content = source;
          if (filePath) {
            const root = await resolveRoot(project);
            const target = resolveWithinRoot(root, filePath);
            const ext = path.extname(target).toLowerCase();
            if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(ext)) {
              throw new Error(
                "Raster image diagrams have no parseable structure — run ocr_image on this file instead " +
                  "and treat the extracted blocks as best-effort input that needs human confirmation."
              );
            }
            content = (await readFileWithLimit(target)).toString("utf8");
          }
          return textResult(parseDiagram(content!, format));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "media_extract_requirements",
      {
        description:
          "Unified local fallback extractor when native vision is unavailable. Auto-routes files by type " +
          "(images -> ocr_image, scanned PDFs -> ocr_pdf, text PDFs -> read_pdf_text, DOCX -> read_docx_text, " +
          "XLS/XLSX/CSV -> row parsing, diagrams -> read_diagram, text files -> plain text fallback) and writes " +
          "one consolidated markdown report.",
        inputSchema: {
          inputPath: z.string().describe("File or directory path to extract from, relative to repo (or `project` repo if provided)"),
          project: z.string().optional().describe("Manifest project name to resolve inputPath/outputPath against"),
          outputPath: z
            .string()
            .optional()
            .describe("Where to save consolidated markdown; default is <input>/requirements-extract.md or <file>.requirements.md"),
          recurse: z.boolean().optional().describe("If inputPath is a directory, include subdirectories (default false)"),
          maxFiles: z.number().optional().describe("Max files to process from a directory (default 25)"),
          lang: z.string().optional().describe("OCR language code for image/scanned PDF routes (default eng)"),
          maxChars: z.number().optional().describe("Max chars to read from text-like sources (default 12000)"),
          ocrConfidenceThreshold: z.number().optional().describe("Confidence threshold for OCR warning notes (default 60)"),
        },
      },
      async ({ inputPath, project, outputPath, recurse, maxFiles, lang, maxChars, ocrConfidenceThreshold }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, inputPath);
          const files = await listFiles(target, recurse ?? false);
          const limited = files.slice(0, Math.max(1, maxFiles ?? 25));

          const extractions: FileExtraction[] = [];
          const errors: Array<{ path: string; error: string }> = [];
          for (const file of limited) {
            try {
              extractions.push(
                await extractFromSingleFile(root, file, lang ?? "eng", Math.max(1000, maxChars ?? 12000), ocrConfidenceThreshold ?? 60)
              );
            } catch (err) {
              errors.push({
                path: path.relative(root, file).replace(/\\/g, "/"),
                error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
              });
            }
          }

          const stat = await fs.stat(target);
          const defaultOutput = stat.isDirectory()
            ? path.join(inputPath, "requirements-extract.md")
            : `${inputPath}.requirements.md`;
          const savedTo = await writeConsolidatedMarkdown(root, outputPath ?? defaultOutput, inputPath, extractions);

          const fragments = extractions.flatMap((e) => e.fragments);
          return textResult({
            inputPath,
            savedTo,
            filesProcessed: extractions.length,
            filesRequested: limited.length,
            totalFragments: fragments.length,
            routesUsed: [...new Set(extractions.map((e) => e.route))],
            errors,
          });
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      "create_diagram",
      {
        description:
          "Render Mermaid diagram source to an SVG or PNG file (via @mermaid-js/mermaid-cli, run through npx " +
          "on demand), so agents can author architecture/flow diagrams for docs and Confluence pages.",
        inputSchema: {
          source: z.string().describe("Mermaid diagram source, e.g. 'flowchart TD\\n A --> B'"),
          targetPath: z.string().describe("Where to write the rendered .svg or .png, relative to the repo (or the project's repo if `project` is given)"),
          project: z.string().optional().describe("Manifest project name to resolve targetPath against (default: this framework repo)"),
        },
      },
      async ({ source, targetPath, project }) => {
        try {
          const root = await resolveRoot(project);
          const target = resolveWithinRoot(root, targetPath);
          const ext = path.extname(target).toLowerCase();
          if (![".svg", ".png"].includes(ext)) throw new Error("targetPath must end in .svg or .png");
          await fs.mkdir(path.dirname(target), { recursive: true });
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-mermaid-"));
          const inputFile = path.join(tmpDir, "diagram.mmd");
          try {
            await fs.writeFile(inputFile, source, "utf8");
            const result = await execCommand("npx", ["-y", "@mermaid-js/mermaid-cli", "-i", inputFile, "-o", target]);
            if (result.code !== 0) {
              throw new Error(`mermaid-cli failed (exit ${result.code}):\n${result.stderr.slice(-2000)}`);
            }
          } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
          }
          return textResult({ savedTo: path.relative(root, target).replace(/\\/g, "/") });
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
});
