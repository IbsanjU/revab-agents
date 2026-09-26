import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { intEnv, optionalEnv } from "../mcp-servers/shared/config.js";
import { getProject, resolveProjectArtifactsDir } from "../utils/manifest.js";

/**
 * Batch-runs the media server's `media_extract_requirements` tool over every immediate
 * subfolder of an input directory (one MCP call per subfolder, so each stays under the
 * tool's per-call maxFiles cap), then merges the per-folder reports into one consolidated
 * markdown report. Requires the media MCP server to be running (`npm run serve:media` or
 * `npm run serve:mcp`).
 *
 * Defaults are wired for the common case: extracting requirements from Confluence
 * attachments pulled by `confluence-sync-project.ts` (`projects/<project>/downloads/confluence/attachments`),
 * but `--input`/`--outputDir`/`--consolidated` override any of that for other folder layouts.
 *
 * Usage: npm run media:batch-extract -- --project <name> [--input <relPath>]
 *   [--outputDir <relPath>] [--consolidated <relPath>] [--maxFilesPerBatch 25] [--noRecurse] [--force]
 */

const ROOT = path.resolve(process.cwd());

type CliArgs = {
  project: string;
  input?: string;
  outputDir?: string;
  consolidated?: string;
  recurse: boolean;
  maxFilesPerBatch: number;
  force: boolean;
};

type BatchOptions = {
  project: string;
  inputPath: string;
  outputDir: string;
  consolidatedPath: string;
  recurse: boolean;
  maxFilesPerBatch: number;
  force: boolean;
};

type BatchResult = {
  folder: string;
  outputFile: string;
  filesProcessed: number;
  totalFragments: number;
  routesUsed: string[];
  error?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    i += 1;
  }

  const project = String(flags.get("project") ?? "").trim();
  if (!project) throw new Error("Missing required argument: --project <name>");

  return {
    project,
    input: flags.get("input") ? String(flags.get("input")) : undefined,
    outputDir: flags.get("outputDir") ? String(flags.get("outputDir")) : undefined,
    consolidated: flags.get("consolidated") ? String(flags.get("consolidated")) : undefined,
    recurse: !(flags.get("noRecurse") === true),
    maxFilesPerBatch: Number(flags.get("maxFilesPerBatch") ?? 25),
    force: flags.get("force") === true,
  };
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

async function listSubdirectories(target: string): Promise<string[]> {
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function callMediaExtract(
  client: Client,
  args: { inputPath: string; recurse: boolean; outputPath: string; maxFiles: number }
): Promise<{ filesProcessed?: number; totalFragments?: number; routesUsed?: string[] }> {
  const result = await client.callTool({ name: "media_extract_requirements", arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const textBlock = content.find((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text");
  if (result.isError) {
    throw new Error(textBlock?.text ?? "media_extract_requirements failed");
  }
  return textBlock ? JSON.parse(textBlock.text) : {};
}

async function mergeReports(
  root: string,
  batchFiles: string[],
  consolidatedPath: string,
  meta: { project: string; input: string; totals: { filesProcessed: number; totalFragments: number; failed: string[] } }
): Promise<void> {
  const target = path.resolve(root, consolidatedPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const lines: string[] = [];
  lines.push("# Media Fallback — Consolidated Extraction");
  lines.push("");
  lines.push(`- Project: ${meta.project}`);
  lines.push(`- Source: ${meta.input} (all subfolders)`);
  lines.push(`- Generated At: ${new Date().toISOString()}`);
  lines.push(`- Total Files Processed: ${meta.totals.filesProcessed}`);
  lines.push(`- Total Fragments: ${meta.totals.totalFragments}`);
  lines.push(
    `- Failed Folders: ${meta.totals.failed.length}${meta.totals.failed.length ? ` (${meta.totals.failed.join(", ")})` : ""}`
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const file of batchFiles) {
    const raw = await fs.readFile(path.resolve(root, file), "utf8");
    lines.push(raw.replace(/^#[^\n]*\n/, "").trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  await fs.writeFile(target, lines.join("\n"), "utf8");
}

async function run(options: BatchOptions): Promise<void> {
  const target = path.resolve(ROOT, options.inputPath);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) throw new Error(`Input path does not exist: ${options.inputPath}`);

  await fs.mkdir(path.resolve(ROOT, options.outputDir), { recursive: true });

  const subdirs = stat.isDirectory() ? await listSubdirectories(target) : [];
  const batches =
    subdirs.length > 0
      ? subdirs.map((name) => ({ name, input: path.posix.join(toPosix(options.inputPath), name) }))
      : [{ name: path.basename(options.inputPath), input: options.inputPath }];

  const port = intEnv("MEDIA_MCP_PORT", 7319);
  const secret = optionalEnv("MCP_SHARED_SECRET");
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: secret ? { headers: { "x-mcp-secret": secret } } : undefined,
  });
  const client = new Client({ name: "revab-agents-batch-media-extract", version: "0.1.0" });
  await client.connect(transport);

  const results: BatchResult[] = [];
  try {
    for (const batch of batches) {
      const outputFile = path.posix.join(toPosix(options.outputDir), `batch-${batch.name}.md`);
      const outputAbs = path.resolve(ROOT, outputFile);
      if (!options.force && (await fs.stat(outputAbs).catch(() => null))) {
        console.log(`[skip] ${batch.name} — already extracted`);
        continue;
      }
      console.log(`[run]  ${batch.name} ...`);
      try {
        const parsed = await callMediaExtract(client, {
          inputPath: batch.input,
          recurse: options.recurse,
          outputPath: outputFile,
          maxFiles: options.maxFilesPerBatch,
        });
        results.push({
          folder: batch.name,
          outputFile,
          filesProcessed: parsed.filesProcessed ?? 0,
          totalFragments: parsed.totalFragments ?? 0,
          routesUsed: parsed.routesUsed ?? [],
        });
        console.log(`       OK — filesProcessed=${parsed.filesProcessed ?? 0} fragments=${parsed.totalFragments ?? 0}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ folder: batch.name, outputFile, filesProcessed: 0, totalFragments: 0, routesUsed: [], error: message });
        console.log(`       ERROR — ${message}`);
      }
    }
  } finally {
    await client.close();
  }

  const batchFiles = results.filter((r) => !r.error).map((r) => r.outputFile);
  const failed = results.filter((r) => r.error).map((r) => r.folder);
  const totals = {
    filesProcessed: results.reduce((sum, r) => sum + r.filesProcessed, 0),
    totalFragments: results.reduce((sum, r) => sum + r.totalFragments, 0),
    failed,
  };

  await mergeReports(ROOT, batchFiles, options.consolidatedPath, {
    project: options.project,
    input: options.inputPath,
    totals,
  });

  console.log("");
  console.log("=== Done ===");
  console.log(`Consolidated report: ${options.consolidatedPath}`);
  console.log(`Total files processed: ${totals.filesProcessed}`);
  console.log(`Total fragments: ${totals.totalFragments}`);
  if (failed.length > 0) console.log(`Failed folders: ${failed.join(", ")}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await getProject(args.project); // validates the project exists (trust boundary)
  const projectDir = await resolveProjectArtifactsDir(args.project);
  const projectRel = toPosix(path.relative(ROOT, projectDir));

  const options: BatchOptions = {
    project: args.project,
    inputPath: args.input ?? `${projectRel}/downloads/confluence/attachments`,
    outputDir: args.outputDir ?? `${projectRel}/reports/media-batches`,
    consolidatedPath: args.consolidated ?? `${projectRel}/reports/media-fallback-consolidated.md`,
    recurse: args.recurse,
    maxFilesPerBatch: args.maxFilesPerBatch,
    force: args.force,
  };

  await run(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
