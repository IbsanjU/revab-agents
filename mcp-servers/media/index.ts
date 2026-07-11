import { promises as fs } from "fs";
import { createWriteStream } from "fs";
import path from "path";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";
import { imageSize } from "image-size";
import { fileTypeFromBuffer } from "file-type";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { startMcpHttpServer, textResult, errorResult } from "../shared/server.js";
import { intEnv } from "../shared/config.js";
import { resolveWithinRoot } from "../../utils/fsSafety.js";
import { resolveProjectRepoPath } from "../../utils/manifest.js";

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
  },
});
