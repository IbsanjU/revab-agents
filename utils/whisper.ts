/**
 * Speech-to-text with faster-whisper, run as a local Python subprocess.
 *
 * Nothing leaves the machine except the one-time model download from Hugging Face. Design rules:
 *  - The Python helper travels as a string and is passed with `-c`, so it works unchanged from a
 *    framework checkout and from the single-file bundle (no script path to locate).
 *  - The request goes in on stdin as JSON and the result comes back as one JSON line on stdout, so
 *    nothing from the user's file can be mistaken for a shell argument.
 *  - The subprocess gets an allowlisted environment, never the gateway's: the Jira, Confluence and
 *    GitHub tokens in this process are not visible to Python or its packages.
 *  - The model name is an allowlist, not free text: an arbitrary Hugging Face id would download and
 *    load whatever a repository contains.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const MODELS = [
  "tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en",
  "large-v1", "large-v2", "large-v3", "large-v3-turbo", "turbo",
  "distil-small.en", "distil-medium.en", "distil-large-v2", "distil-large-v3",
] as const;

export const MEDIA_EXTENSIONS = [
  ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma",
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v",
] as const;

/** Packages the setup installs. `av` is capped: PyAV 17+ rejects an argument faster-whisper 1.x passes, so transcription crashes. */
export const WHISPER_REQUIREMENTS = ["faster-whisper>=1.0,<2", "av<17"] as const;

export interface WhisperRequest {
  path: string;
  model: string;
  language: string | undefined;
  task: "transcribe" | "translate";
  vadFilter: boolean;
  beamSize: number;
  wordTimestamps: boolean;
  device: string;
  computeType: string;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  /** `transcript:<id>@HH:MM:SS`, the citation form the framework accepts (hard rule 9). */
  citation: string;
  words?: Array<{ start: number; end: number; word: string; probability: number }>;
}

export interface WhisperResult {
  language: string;
  languageProbability: number;
  durationSeconds: number;
  model: string;
  device: string;
  computeType: string;
  text: string;
  segments: WhisperSegment[];
  truncated: boolean;
}

export type WhisperErrorKind = "python-not-found" | "not-installed" | "av-incompatible" | "timeout" | "failed" | "bad-output";

export class WhisperError extends Error {
  constructor(readonly kind: WhisperErrorKind, message: string) {
    super(message);
    this.name = "WhisperError";
  }
}

const SETUP_HINT = "Run `revab whisper-setup` once (it installs faster-whisper into its own environment), or set WHISPER_PYTHON to a Python that has it.";

// ---- request building -----------------------------------------------------

export function buildWhisperRequest(input: {
  path: string;
  model?: string | undefined;
  language?: string | undefined;
  task?: string | undefined;
  vadFilter?: boolean | undefined;
  beamSize?: number | undefined;
  wordTimestamps?: boolean | undefined;
  device?: string | undefined;
  computeType?: string | undefined;
  env: Record<string, string | undefined>;
}): WhisperRequest {
  const model = input.model ?? input.env.WHISPER_MODEL ?? "small";
  if (!(MODELS as readonly string[]).includes(model)) {
    throw new Error(`Unknown model "${model}". Choose one of: ${MODELS.join(", ")}.`);
  }
  const language = input.language && input.language !== "auto" ? input.language.toLowerCase() : undefined;
  if (language !== undefined && !/^[a-z]{2,3}$/.test(language)) {
    throw new Error(`Invalid language "${input.language}". Use a two- or three-letter code such as "en", or omit it to detect.`);
  }
  const task = input.task ?? "transcribe";
  if (task !== "transcribe" && task !== "translate") throw new Error('task must be "transcribe" or "translate".');
  const device = input.device ?? input.env.WHISPER_DEVICE ?? "auto";
  if (!["auto", "cpu", "cuda"].includes(device)) throw new Error('device must be "auto", "cpu" or "cuda".');
  const computeType = input.computeType ?? input.env.WHISPER_COMPUTE_TYPE ?? "auto";
  if (!["auto", "int8", "int8_float16", "float16", "float32"].includes(computeType)) {
    throw new Error("computeType must be one of auto, int8, int8_float16, float16, float32.");
  }
  const beamSize = Math.min(10, Math.max(1, Math.trunc(input.beamSize ?? 5)));
  return {
    path: input.path,
    model,
    language,
    task,
    vadFilter: input.vadFilter ?? true,
    beamSize,
    wordTimestamps: input.wordTimestamps ?? false,
    device,
    computeType,
  };
}

export function isMediaFile(filePath: string): boolean {
  return (MEDIA_EXTENSIONS as readonly string[]).includes(path.extname(filePath).toLowerCase());
}

// ---- formatting -----------------------------------------------------------

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** A citation id: the file name without its extension, reduced to characters the citation form allows. */
export function citationId(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "media";
}

export function segmentCitation(id: string, startSeconds: number): string {
  return `transcript:${id}@${formatTimestamp(startSeconds)}`;
}

// ---- subprocess environment & python discovery ----------------------------

const ENV_ALLOW = new Set([
  "PATH", "Path", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "SystemRoot", "COMSPEC", "PATHEXT",
  "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
  "OMP_NUM_THREADS", "CUDA_VISIBLE_DEVICES", "XDG_CACHE_HOME",
]);

/** The only variables the Python process may see: no credentials of ours, only what it needs to run and download. */
export function whisperEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = { PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ENV_ALLOW.has(key) || key.startsWith("LC_") || key.startsWith("HF_") || key.startsWith("WHISPER_")) out[key] = value;
  }
  return out;
}

/** Where the private environment's interpreter lives (whether or not it exists yet). */
export function venvPythonPath(cwd: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? path.join(cwd, ".revab", "whisper-venv", "Scripts", "python.exe")
    : path.join(cwd, ".revab", "whisper-venv", "bin", "python");
}

/** The interpreter to use: WHISPER_PYTHON, else the environment `revab whisper-setup` creates, else the system python. */
export function resolveWhisperPython(
  env: Record<string, string | undefined>,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): string {
  if (env.WHISPER_PYTHON?.trim()) return env.WHISPER_PYTHON.trim();
  const venvPython = venvPythonPath(cwd, platform);
  if (exists(venvPython)) return venvPython;
  return platform === "win32" ? "python" : "python3";
}

// ---- the Python helper ----------------------------------------------------

/** Reads one JSON request on stdin; writes exactly one JSON line on stdout. Everything else goes to stderr. */
export const WHISPER_SCRIPT = String.raw`
import json, sys

def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def fail(kind, message):
    emit({"ok": False, "error": {"kind": kind, "message": message}})
    sys.exit(1)

try:
    request = json.loads(sys.stdin.read())
except Exception as e:
    fail("failed", "bad request: %s" % e)

try:
    from faster_whisper import WhisperModel
except Exception as e:
    fail("not-installed", "%s: %s" % (type(e).__name__, e))

try:
    model = WhisperModel(request["model"], device=request["device"], compute_type=request["computeType"])
    segments, info = model.transcribe(
        request["path"],
        language=request.get("language"),
        task=request["task"],
        vad_filter=request["vadFilter"],
        beam_size=request["beamSize"],
        word_timestamps=request["wordTimestamps"],
    )
    out = []
    for seg in segments:
        item = {"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()}
        if request["wordTimestamps"] and seg.words:
            item["words"] = [
                {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word, "probability": round(w.probability, 3)}
                for w in seg.words
            ]
        out.append(item)
    emit({
        "ok": True,
        "language": info.language,
        "languageProbability": round(info.language_probability, 3),
        "durationSeconds": round(info.duration, 2),
        "segments": out,
    })
except TypeError as e:
    fail("av-incompatible" if "metadata_errors" in str(e) else "failed", "%s: %s" % (type(e).__name__, e))
except Exception as e:
    fail("failed", "%s: %s" % (type(e).__name__, e))
`;

/** A tiny script that prints the installed versions, for `doctor` and `whisper-setup --check`. */
export const WHISPER_PROBE_SCRIPT = `
import json
out = {}
try:
    import faster_whisper
    out["fasterWhisper"] = faster_whisper.__version__
except Exception as e:
    out["error"] = "%s: %s" % (type(e).__name__, e)
try:
    import av
    out["av"] = av.__version__
except Exception:
    pass
print(json.dumps(out))
`;

// ---- parsing & running ----------------------------------------------------

/** Turn the helper's one-line JSON into a typed result, or a WhisperError that says what to do. */
export function parseWhisperOutput(
  stdout: string,
  request: Pick<WhisperRequest, "model" | "device" | "computeType">,
  id: string,
  maxChars: number,
): WhisperResult {
  const line = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1);
  let parsed: any;
  try {
    parsed = JSON.parse(line ?? "");
  } catch {
    throw new WhisperError("bad-output", `The transcriber returned something that is not JSON: ${(line ?? "").slice(0, 200)}`);
  }
  if (!parsed.ok) {
    const kind = parsed.error?.kind as WhisperErrorKind | undefined;
    const message = String(parsed.error?.message ?? "unknown error");
    if (kind === "not-installed") throw new WhisperError("not-installed", `faster-whisper is not installed in that Python (${message}). ${SETUP_HINT}`);
    if (kind === "av-incompatible") {
      throw new WhisperError("av-incompatible", `faster-whisper cannot decode audio with the installed PyAV (${message}). Install a compatible one: pip install "av<17", or run \`revab whisper-setup\`.`);
    }
    throw new WhisperError("failed", message);
  }

  const segments: WhisperSegment[] = (parsed.segments as Array<{ start: number; end: number; text: string; words?: WhisperSegment["words"] }>).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    citation: segmentCitation(id, s.start),
    ...(s.words ? { words: s.words } : {}),
  }));

  // Respect the character budget at a segment boundary, so a long recording cannot flood the reply.
  let used = 0;
  const kept: WhisperSegment[] = [];
  let truncated = false;
  for (const seg of segments) {
    if (used + seg.text.length + 1 > maxChars && kept.length > 0) {
      truncated = true;
      break;
    }
    kept.push(seg);
    used += seg.text.length + 1;
  }
  return {
    language: parsed.language,
    languageProbability: parsed.languageProbability,
    durationSeconds: parsed.durationSeconds,
    model: request.model,
    device: request.device,
    computeType: request.computeType,
    text: kept.map((s) => s.text).join(" "),
    segments: kept,
    truncated,
  };
}

export interface RunOptions {
  python: string;
  request: WhisperRequest;
  env: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs: number;
  maxChars: number;
}

export function runWhisper(options: RunOptions): Promise<WhisperResult> {
  const id = citationId(options.request.path);
  return new Promise((resolve, reject) => {
    const child = spawn(options.python, ["-c", WHISPER_SCRIPT], {
      cwd: options.cwd,
      env: whisperEnv(options.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(() =>
        reject(
          new WhisperError(
            "timeout",
            `Transcription did not finish within ${Math.round(options.timeoutMs / 1000)}s and was stopped. Try a smaller model (tiny, base), keep vadFilter on, or raise timeoutSeconds. The first run with a model also downloads it.`,
          ),
        ),
      );
    }, options.timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString("utf8")).slice(-4000)));
    child.on("error", (err: NodeJS.ErrnoException) => {
      done(() =>
        reject(
          err.code === "ENOENT"
            ? new WhisperError("python-not-found", `Python was not found ("${options.python}"). ${SETUP_HINT}`)
            : new WhisperError("failed", `Could not start Python: ${err.message}`),
        ),
      );
    });
    child.on("close", (code) => {
      done(() => {
        try {
          resolve(parseWhisperOutput(stdout, options.request, id, options.maxChars));
        } catch (err) {
          if (err instanceof WhisperError && err.kind === "bad-output" && code !== 0) {
            reject(new WhisperError("failed", `The transcriber exited with code ${code}. ${stderr.trim().split(/\r?\n/).slice(-3).join(" | ")}`));
          } else reject(err);
        }
      });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(options.request));
  });
}
