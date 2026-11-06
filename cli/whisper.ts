/**
 * `revab whisper-setup` — install faster-whisper into its own Python environment.
 *
 * The transcription tool needs Python with faster-whisper. Installing it system-wide is a mess
 * (and today a plain `pip install faster-whisper` pulls a PyAV that breaks it), so this creates a
 * private virtual environment under `.revab/whisper-venv` with known-compatible versions. The tool
 * finds that environment on its own; nothing to configure.
 *
 *   revab whisper-setup            create the environment and install (safe to re-run)
 *   revab whisper-setup --check    only report what is installed
 *   revab whisper-setup --python <path>   build the environment from a specific Python
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { WHISPER_PROBE_SCRIPT, WHISPER_REQUIREMENTS, resolveWhisperPython, venvPythonPath } from "../utils/whisper.js";

export interface SetupOptions {
  cwd?: string;
  python?: string;
  checkOnly?: boolean;
  /** Test seam: does this path exist? */
  exists?: (p: string) => boolean;
  /** Test seam: replaces process spawning. */
  run?: (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
}

export function venvDir(cwd: string): string {
  return path.join(cwd, ".revab", "whisper-venv");
}

/** `[major, minor]` from `Python 3.12.4`, or undefined. */
export function parsePythonVersion(text: string): [number, number] | undefined {
  const m = /Python\s+(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** faster-whisper supports Python 3.9 and newer. */
export function pythonIsSupported(version: [number, number] | undefined): boolean {
  return !!version && (version[0] > 3 || (version[0] === 3 && version[1] >= 9));
}

export interface ProbeResult {
  fasterWhisper?: string;
  av?: string;
  error?: string;
}

export function parseProbe(stdout: string): ProbeResult {
  try {
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "") as ProbeResult;
  } catch {
    return { error: "could not read the Python environment" };
  }
}

const defaultRun: NonNullable<SetupOptions["run"]> = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

const say = (symbol: string, message: string) => console.log(`  ${symbol} ${message}`);

/** Returns the process exit code. */
export function runWhisperSetup(options: SetupOptions = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const run = options.run ?? defaultRun;
  const venv = venvDir(cwd);
  const exists = options.exists ?? existsSync;
  // The environment's own interpreter, by explicit path. It must NOT be resolved by "does it exist yet":
  // before the environment is created that falls back to the system Python, and pip would then install
  // into the wrong place while the check below (using the same interpreter) reported success.
  const envPython = venvPythonPath(cwd);

  if (options.checkOnly) {
    const python = resolveWhisperPython(process.env, cwd);
    const probe = parseProbe(run(python, ["-c", WHISPER_PROBE_SCRIPT]).stdout);
    if (probe.fasterWhisper) {
      say("✓", `faster-whisper ${probe.fasterWhisper}${probe.av ? `, av ${probe.av}` : ""} (${python})`);
      return 0;
    }
    say("✗", `faster-whisper is not available via ${python}${probe.error ? ` (${probe.error})` : ""}. Run \`revab whisper-setup\`.`);
    return 1;
  }

  const base = options.python ?? (process.platform === "win32" ? "python" : "python3");
  const version = parsePythonVersion(run(base, ["--version"]).stdout || run(base, ["--version"]).stderr);
  if (!version) {
    say("✗", `Python was not found ("${base}"). Install Python 3.9 or newer, or pass --python <path>.`);
    return 1;
  }
  if (!pythonIsSupported(version)) {
    say("✗", `Python ${version.join(".")} is too old: faster-whisper needs 3.9 or newer. Pass --python <path> to a newer one.`);
    return 1;
  }
  say("·", `using Python ${version.join(".")} (${base})`);

  if (!exists(envPython)) {
    mkdirSync(path.dirname(venv), { recursive: true });
    say("·", `creating ${venv}`);
    const made = run(base, ["-m", "venv", venv]);
    if (made.status !== 0) {
      say("✗", `could not create the environment: ${(made.stderr || made.stdout).trim().split(/\r?\n/).slice(-2).join(" | ")}. On Debian/Ubuntu: apt install python3-venv.`);
      return 1;
    }
  } else {
    say("·", `reusing ${venv}`);
  }

  say("·", `installing ${WHISPER_REQUIREMENTS.join(" ")} (a few hundred MB; this can take a minute)`);
  const installed = run(envPython, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", ...WHISPER_REQUIREMENTS]);
  if (installed.status !== 0) {
    say("✗", `pip failed: ${(installed.stderr || installed.stdout).trim().split(/\r?\n/).slice(-3).join(" | ")}`);
    return 1;
  }

  const probe = parseProbe(run(envPython, ["-c", WHISPER_PROBE_SCRIPT]).stdout);
  if (!probe.fasterWhisper) {
    say("✗", `installed, but faster-whisper does not import${probe.error ? `: ${probe.error}` : ""}`);
    return 1;
  }
  say("✓", `faster-whisper ${probe.fasterWhisper}${probe.av ? `, av ${probe.av}` : ""} is ready`);
  console.log(
    `\nThe transcribe_media tool will use it automatically. The first transcription downloads the model\n` +
      `(tiny ~75 MB, small ~465 MB, large-v3 ~3 GB) from Hugging Face. Choose one with WHISPER_MODEL or the tool's model argument.`,
  );
  return 0;
}
