/**
 * Build the self-contained gateway the VS Code extension ships, so users need no clone.
 *
 *   tsx scripts/bundle-gateway.ts <outDir>
 *
 * Produces `<outDir>/revab.cjs` (the whole CLI and all eleven servers, bundled with esbuild)
 * and `<outDir>/node_modules` holding only what cannot be inlined:
 *   tesseract.js   worker scripts and WASM loaded by path
 *   pdfkit         font data read from disk
 *   pdf-parse      PDF.js and its worker
 * together with their runtime dependencies. The platform-specific native canvas that PDF.js can
 * optionally use is left out, so one build runs on every OS; text extraction does not need it.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { dependencyClosure } from "../utils/dependencyClosure.js";

export const EXTERNALS = ["tesseract.js", "pdfkit", "pdf-parse"] as const;
/** Optional native packages: platform-specific, and not needed for text extraction. */
export const SKIPPED = [/^@napi-rs\//];

export interface BundleResult {
  file: string;
  bytes: number;
  packages: string[];
}

export async function bundleGateway(options: { outDir: string; root?: string }): Promise<BundleResult> {
  const root = path.resolve(options.root ?? path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const outDir = path.resolve(options.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const file = path.join(outDir, "revab.cjs");
  await build({
    entryPoints: [path.join(root, "cli", "index.ts")],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: [...EXTERNALS],
    // The bundle is one file, so `import.meta.url` is that file; and the gateway's "am I the
    // entry module?" check must be off, because the CLI starts it explicitly.
    define: { "import.meta.url": "import_meta_url", "process.env.REVAB_BUNDLED": '"1"' },
    banner: { js: 'const import_meta_url = require("url").pathToFileURL(__filename).href;' },
    legalComments: "none",
    logLevel: "warning",
  });

  const modules = path.join(root, "node_modules");
  const { packages, missing } = dependencyClosure(
    modules,
    EXTERNALS,
    { exists: (p) => existsSync(p), read: (p) => readFileSync(p, "utf8") },
    SKIPPED,
  );
  if (missing.length > 0) throw new Error(`cannot bundle: dependencies not installed: ${missing.join(", ")}. Run npm install.`);
  for (const name of packages) {
    cpSync(path.join(modules, name), path.join(outDir, "node_modules", name), { recursive: true });
  }

  const version = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }).version;
  writeFileSync(path.join(outDir, "bundle.json"), `${JSON.stringify({ version, externals: [...EXTERNALS] }, null, 2)}\n`);
  return { file, bytes: statSync(file).size, packages };
}

/**
 * Templates for the home folder the extension creates in bundled mode: framework-owned skills
 * and `.env.example`, plus starter files. Deliberately NOT this repo's own `learnings.md` (its
 * session history) or its long dev-notes `memory.md`; small templates stand in for both.
 */
export function assembleHomeTemplates(options: { root: string; extDir: string }): string {
  const { root, extDir } = options;
  const templates = path.join(extDir, "resources", "home");
  rmSync(templates, { recursive: true, force: true });
  mkdirSync(path.join(templates, "knowledge"), { recursive: true });
  cpSync(path.join(root, "skills"), path.join(templates, "skills"), { recursive: true });
  cpSync(path.join(root, "projects"), path.join(templates, "projects"), { recursive: true });
  copyFileSync(path.join(root, ".env.example"), path.join(templates, ".env.example"));
  copyFileSync(path.join(root, "knowledge", "conventions.md"), path.join(templates, "knowledge", "conventions.md"));
  copyFileSync(path.join(root, "extension", "resources", "memory.template.md"), path.join(templates, "knowledge", "memory.md"));
  copyFileSync(path.join(root, "extension", "resources", "learnings.template.md"), path.join(templates, "knowledge", "learnings.md"));
  return templates;
}

const invokedDirectly = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedDirectly) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("Usage: tsx scripts/bundle-gateway.ts <outDir>");
    process.exit(1);
  }
  bundleGateway({ outDir }).then(
    (r) => console.log(`bundled ${r.file} (${Math.round(r.bytes / 1024)} KB) + ${r.packages.length} external packages`),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
