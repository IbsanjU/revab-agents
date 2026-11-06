/**
 * Loading `pdf-parse` without requiring a native canvas.
 *
 * pdf-parse (PDF.js) wants `@napi-rs/canvas`, a platform-specific native package, to supply the
 * `DOMMatrix`, `ImageData` and `Path2D` globals PDF.js touches when it loads. This framework only
 * extracts text and metadata, which never render anything, so a build that ships for every OS can
 * leave that package out. Without it the module fails at load ("DOMMatrix is not defined").
 *
 * The stand-ins must be defined BEFORE the first load: PDF.js is an ES module, and Node caches a
 * module whose evaluation failed, so retrying after a failure keeps failing. So we check whether
 * the canvas package resolves, and define inert stand-ins up front only when it does not. Where
 * the real canvas is installed (a framework checkout) nothing is stubbed.
 *
 * Loaded lazily so a missing or odd PDF stack cannot stop the gateway from starting.
 */
import { createRequire } from "node:module";
import type { PDFParse } from "pdf-parse";

type PdfModule = { PDFParse: typeof PDFParse };
let loaded: PdfModule | undefined;

/** Inert stand-ins: enough for PDF.js to load and extract text; they draw nothing. */
export function installRenderingStubs(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): string[] {
  const installed: string[] = [];
  const define = (name: string, value: unknown) => {
    if (typeof target[name] === "undefined") {
      target[name] = value;
      installed.push(name);
    }
  };
  define(
    "DOMMatrix",
    class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[]) {
        if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number];
      }
      multiplySelf(): this { return this; }
      preMultiplySelf(): this { return this; }
      translate(): DOMMatrix { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]); }
      scale(): DOMMatrix { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]); }
      invertSelf(): this { return this; }
    },
  );
  define("ImageData", class ImageData { constructor(public width = 0, public height = 0, public data: Uint8ClampedArray = new Uint8ClampedArray(0)) {} });
  define("Path2D", class Path2D {});
  return installed;
}

export function canvasAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve("@napi-rs/canvas");
    return true;
  } catch {
    return false;
  }
}

export async function loadPdfParse(): Promise<PdfModule> {
  if (loaded) return loaded;
  if (!canvasAvailable()) installRenderingStubs();
  loaded = (await import("pdf-parse")) as PdfModule;
  return loaded;
}

export async function newPdfParser(data: Buffer | Uint8Array): Promise<InstanceType<typeof PDFParse>> {
  const { PDFParse: Parser } = await loadPdfParse();
  return new Parser({ data });
}
