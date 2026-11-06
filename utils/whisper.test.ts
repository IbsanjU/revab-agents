import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCitation } from "./citation.js";
import {
  MEDIA_EXTENSIONS,
  MODELS,
  WHISPER_REQUIREMENTS,
  WhisperError,
  buildWhisperRequest,
  citationId,
  formatTimestamp,
  isMediaFile,
  parseWhisperOutput,
  resolveWhisperPython,
  runWhisper,
  segmentCitation,
  venvPythonPath,
  whisperEnv,
} from "./whisper.js";

const posixOnly = process.platform === "win32" ? { skip: "uses a shell-script stand-in for Python" } : {};
const req = (extra: Partial<Parameters<typeof buildWhisperRequest>[0]> = {}) => buildWhisperRequest({ path: "/x/a.wav", env: {}, ...extra });

// ---- request validation ---------------------------------------------------

test("defaults: small model, auto device and compute type, VAD on, beam 5", () => {
  assert.deepEqual(req(), {
    path: "/x/a.wav", model: "small", language: undefined, task: "transcribe",
    vadFilter: true, beamSize: 5, wordTimestamps: false, device: "auto", computeType: "auto",
  });
});

test("environment variables supply defaults, arguments win", () => {
  const env = { WHISPER_MODEL: "base", WHISPER_DEVICE: "cpu", WHISPER_COMPUTE_TYPE: "int8" };
  assert.equal(buildWhisperRequest({ path: "p", env }).model, "base");
  assert.equal(buildWhisperRequest({ path: "p", env }).device, "cpu");
  assert.equal(buildWhisperRequest({ path: "p", env, model: "tiny" }).model, "tiny");
});

test("the model is an allowlist: an arbitrary Hugging Face id is refused", () => {
  assert.throws(() => req({ model: "evil/some-repo" }), /Unknown model/);
  assert.throws(() => req({ env: { WHISPER_MODEL: "../../x" } }), /Unknown model/);
  for (const m of MODELS) assert.equal(req({ model: m }).model, m);
});

test("language: auto or omitted means detect; a code is normalised; anything else is refused", () => {
  assert.equal(req({ language: "auto" }).language, undefined);
  assert.equal(req({ language: "EN" }).language, "en");
  assert.throws(() => req({ language: "english; rm -rf /" }), /Invalid language/);
});

test("task, device and compute type are checked; beam size is clamped", () => {
  assert.throws(() => req({ task: "summarize" }), /task/);
  assert.throws(() => req({ device: "tpu" }), /device/);
  assert.throws(() => req({ computeType: "int4" }), /computeType/);
  assert.equal(req({ beamSize: 99 }).beamSize, 10);
  assert.equal(req({ beamSize: 0 }).beamSize, 1);
  assert.equal(req({ beamSize: 3.9 }).beamSize, 3);
});

test("only audio and video files are accepted, whatever the case", () => {
  for (const ext of MEDIA_EXTENSIONS) assert.ok(isMediaFile(`/x/file${ext.toUpperCase()}`), ext);
  for (const name of ["a.txt", "a.pdf", "a.exe", "noextension", "a.wav.txt"]) assert.equal(isMediaFile(name), false, name);
});

test("av is capped in the install requirements, because PyAV 17+ breaks faster-whisper's audio decoding", () => {
  assert.ok(WHISPER_REQUIREMENTS.includes("av<17"));
});

// ---- citations ------------------------------------------------------------

test("timestamps and citations use the form the framework's citation rule accepts", () => {
  assert.equal(formatTimestamp(0), "00:00:00");
  assert.equal(formatTimestamp(61.9), "00:01:01");
  assert.equal(formatTimestamp(3725), "01:02:05");
  assert.equal(formatTimestamp(-4), "00:00:00");
  assert.equal(citationId("/p/Kick-off call (final).mp4"), "Kick-off-call-final");
  assert.equal(citationId("/p/日本語.wav"), "media");
  const citation = segmentCitation("kickoff", 754);
  assert.equal(citation, "transcript:kickoff@00:12:34");
  assert.equal(validateCitation(citation).valid, true, "hard rule 9 must accept it");
});

// ---- environment & interpreter ---------------------------------------------

test("the Python process gets no credentials of ours, only what it needs to run and download", () => {
  const out = whisperEnv({
    PATH: "/usr/bin", HOME: "/h", HF_HOME: "/cache", HF_TOKEN: "hf_x", HTTPS_PROXY: "http://p", SSL_CERT_FILE: "/ca", LC_CTYPE: "C", WHISPER_MODEL: "base",
    JIRA_API_TOKEN: "secret", CONFLUENCE_API_TOKEN: "secret", GITHUB_TOKEN: "secret", MCP_SHARED_SECRET: "secret", GRAPH_CLIENT_SECRET: "secret", TEAMS_WEBHOOK_URL: "secret",
    NODE_OPTIONS: "--require /evil.js", AWS_SECRET_ACCESS_KEY: "secret",
  });
  assert.equal(out.PATH, "/usr/bin");
  assert.equal(out.HF_HOME, "/cache");
  assert.equal(out.HTTPS_PROXY, "http://p");
  assert.equal(out.WHISPER_MODEL, "base");
  assert.equal(out.LC_CTYPE, "C");
  for (const key of ["JIRA_API_TOKEN", "CONFLUENCE_API_TOKEN", "GITHUB_TOKEN", "MCP_SHARED_SECRET", "GRAPH_CLIENT_SECRET", "TEAMS_WEBHOOK_URL", "NODE_OPTIONS", "AWS_SECRET_ACCESS_KEY"]) {
    assert.equal(key in out, false, `${key} must not reach the Python process`);
  }
  assert.equal(out.PYTHONIOENCODING, "utf-8");
});

test("python is WHISPER_PYTHON, else the private environment if it exists, else the system python", () => {
  assert.equal(resolveWhisperPython({ WHISPER_PYTHON: " /opt/py " }, "/w", "linux", () => true), "/opt/py");
  assert.equal(resolveWhisperPython({}, "/w", "linux", (p) => p === venvPythonPath("/w", "linux")), "/w/.revab/whisper-venv/bin/python");
  assert.equal(resolveWhisperPython({}, "/w", "linux", () => false), "python3");
  assert.equal(resolveWhisperPython({}, "C:\\w", "win32", () => false), "python");
  assert.match(venvPythonPath("C:\\w", "win32"), /Scripts[\\/]python\.exe$/);
});

// ---- parsing --------------------------------------------------------------

const okJson = (segments: Array<{ start: number; end: number; text: string }>) =>
  JSON.stringify({ ok: true, language: "en", languageProbability: 0.98, durationSeconds: 30, segments });
const ctx = { model: "tiny", device: "cpu", computeType: "int8" };

test("a good result gets a citation on every segment and a joined text", () => {
  const r = parseWhisperOutput(`noise\n${okJson([{ start: 0, end: 2, text: "Hello" }, { start: 65, end: 70, text: "World" }])}\n`, ctx, "mtg", 1000);
  assert.equal(r.text, "Hello World");
  assert.deepEqual(r.segments.map((s) => s.citation), ["transcript:mtg@00:00:00", "transcript:mtg@00:01:05"]);
  assert.equal(r.truncated, false);
  assert.equal(r.language, "en");
});

test("a long transcript is cut at a segment boundary and says so; the first segment is always kept", () => {
  const segments = Array.from({ length: 5 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, text: "x".repeat(40) }));
  const cut = parseWhisperOutput(okJson(segments), ctx, "a", 100);
  assert.equal(cut.truncated, true);
  assert.equal(cut.segments.length, 2);
  const tiny = parseWhisperOutput(okJson(segments), ctx, "a", 1);
  assert.equal(tiny.segments.length, 1, "never an empty result for a non-empty recording");
});

test("errors from the helper become specific, actionable messages", () => {
  const err = (kind: string, message = "m") => JSON.stringify({ ok: false, error: { kind, message } });
  assert.throws(() => parseWhisperOutput(err("not-installed", "ModuleNotFoundError"), ctx, "a", 10), (e: unknown) => e instanceof WhisperError && e.kind === "not-installed" && /whisper-setup/.test(e.message));
  assert.throws(() => parseWhisperOutput(err("av-incompatible", "metadata_errors"), ctx, "a", 10), (e: unknown) => e instanceof WhisperError && e.kind === "av-incompatible" && /av<17/.test(e.message));
  assert.throws(() => parseWhisperOutput(err("failed", "boom"), ctx, "a", 10), /boom/);
  assert.throws(() => parseWhisperOutput("not json at all", ctx, "a", 10), (e: unknown) => e instanceof WhisperError && e.kind === "bad-output");
});

// ---- running (stub interpreter) --------------------------------------------

function stub(body: string): { python: string; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "whisper-stub-"));
  const python = path.join(dir, "python");
  writeFileSync(python, `#!/bin/sh\n${body}\n`);
  chmodSync(python, 0o755);
  return { python, dir };
}
const base = { request: req(), env: {}, timeoutMs: 20_000, maxChars: 10_000 };

test("runs the helper, sends the request on stdin, and parses the answer", posixOnly, async () => {
  const { python, dir } = stub(`cat > "$0.stdin"; printf '%s\\n' '${okJson([{ start: 3, end: 4, text: "ok" }])}'`);
  try {
    const r = await runWhisper({ ...base, python, request: req({ path: "/media/Demo Call.mp3", model: "tiny", language: "en" }) });
    assert.equal(r.segments[0]!.citation, "transcript:Demo-Call@00:00:03");
    const sent = JSON.parse((await import("node:fs")).readFileSync(`${python}.stdin`, "utf8"));
    assert.equal(sent.path, "/media/Demo Call.mp3");
    assert.equal(sent.model, "tiny");
    assert.equal(sent.language, "en");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the subprocess never sees the gateway's credentials", posixOnly, async () => {
  const { python, dir } = stub(`cat >/dev/null; printf '{"ok":true,"language":"en","languageProbability":1,"durationSeconds":1,"segments":[{"start":0,"end":1,"text":"jira=[%s] gh=[%s] hf=[%s]"}]}\\n' "$JIRA_API_TOKEN" "$GITHUB_TOKEN" "$HF_HOME"`);
  try {
    const r = await runWhisper({ ...base, python, env: { PATH: process.env.PATH, JIRA_API_TOKEN: "s3cret", GITHUB_TOKEN: "s3cret", HF_HOME: "/models" } });
    assert.equal(r.text, "jira=[] gh=[] hf=[/models]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing interpreter is explained, not a bare ENOENT", posixOnly, async () => {
  await assert.rejects(runWhisper({ ...base, python: "/definitely/not/python" }), (e: unknown) => e instanceof WhisperError && e.kind === "python-not-found" && /whisper-setup/.test(e.message));
});

test("a run that never finishes is killed at the timeout", posixOnly, async () => {
  const { python, dir } = stub(`cat >/dev/null; sleep 30`);
  try {
    const started = Date.now();
    await assert.rejects(runWhisper({ ...base, python, timeoutMs: 400 }), (e: unknown) => e instanceof WhisperError && e.kind === "timeout" && /smaller model/.test(e.message));
    assert.ok(Date.now() - started < 5000, "must not wait for the sleeping process");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a crash with no JSON reports the exit code and the last stderr lines", posixOnly, async () => {
  const { python, dir } = stub(`cat >/dev/null; echo 'Traceback: something broke' >&2; exit 3`);
  try {
    await assert.rejects(runWhisper({ ...base, python }), /exited with code 3.*something broke/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- real transcription (opt-in) -------------------------------------------

test("REAL: faster-whisper transcribes a speech sample", { skip: !process.env.WHISPER_REAL_PYTHON || !process.env.WHISPER_REAL_SAMPLE }, async () => {
  const r = await runWhisper({
    python: process.env.WHISPER_REAL_PYTHON!,
    request: buildWhisperRequest({ path: process.env.WHISPER_REAL_SAMPLE!, model: "tiny", env: {} }),
    env: process.env,
    timeoutMs: 240_000,
    maxChars: 10_000,
  });
  assert.equal(r.language, "en");
  assert.match(r.text.toLowerCase(), /country/);
  assert.match(r.segments[0]!.citation, /^transcript:.+@00:00:0\d$/);
});
