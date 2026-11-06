import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseProbe, parsePythonVersion, pythonIsSupported, runWhisperSetup, venvDir } from "./whisper.js";
import { venvPythonPath } from "../utils/whisper.js";

type Call = { command: string; args: string[] };

function fake(handlers: { versionText?: string; venvOk?: boolean; pipOk?: boolean; probe?: object; existsAfterVenv?: boolean }) {
  const calls: Call[] = [];
  let venvCreated = false;
  const run = (command: string, args: string[]) => {
    calls.push({ command, args });
    if (args[0] === "--version") return { status: 0, stdout: handlers.versionText ?? "Python 3.12.4\n", stderr: "" };
    if (args[0] === "-m" && args[1] === "venv") {
      venvCreated = handlers.venvOk !== false;
      return { status: handlers.venvOk === false ? 1 : 0, stdout: "", stderr: handlers.venvOk === false ? "ensurepip is not available" : "" };
    }
    if (args[1] === "pip") return { status: handlers.pipOk === false ? 1 : 0, stdout: "", stderr: handlers.pipOk === false ? "no matching distribution" : "" };
    if (args[0] === "-c") return { status: 0, stdout: JSON.stringify(handlers.probe ?? { fasterWhisper: "1.2.1", av: "16.1.0" }) + "\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, run, exists: (p: string) => venvCreated && p === venvPythonPath("/work") };
}

const quiet = async <T>(fn: () => T): Promise<T> => {
  const log = console.log;
  console.log = () => undefined;
  try {
    return fn();
  } finally {
    console.log = log;
  }
};

test("setup installs into the NEW environment, never the system Python (the bug that reported success while installing in the wrong place)", async () => {
  const { calls, run, exists } = fake({});
  const code = await quiet(() => runWhisperSetup({ cwd: "/work", run, exists }));
  assert.equal(code, 0);
  const envPython = venvPythonPath("/work");
  const pip = calls.find((c) => c.args[1] === "pip");
  assert.ok(pip, "pip was run");
  assert.equal(pip.command, envPython, "pip must run with the environment's interpreter");
  assert.deepEqual(pip.args.slice(0, 2), ["-m", "pip"]);
  assert.ok(pip.args.includes("av<17"), "av is capped: PyAV 17+ breaks faster-whisper's decoding");
  assert.ok(pip.args.some((a) => a.startsWith("faster-whisper")));
  // And the verification that follows uses the same interpreter, so "ready" means that environment.
  const probe = calls.filter((c) => c.args[0] === "-c").at(-1)!;
  assert.equal(probe.command, envPython);
  // The only thing run with the system Python is `--version` and creating the environment.
  const systemCalls = calls.filter((c) => c.command === "python3" || c.command === "python").map((c) => c.args[0] + " " + (c.args[1] ?? ""));
  assert.deepEqual([...new Set(systemCalls)].sort(), ["--version ", "-m venv"]);
});

test("setup reuses an existing environment instead of recreating it", async () => {
  const { calls, run } = fake({});
  await quiet(() => runWhisperSetup({ cwd: "/work", run, exists: () => true }));
  assert.ok(!calls.some((c) => c.args[0] === "-m" && c.args[1] === "venv"));
});

test("setup refuses a Python that is missing or too old, with a way forward", async () => {
  const missing = fake({ versionText: "" });
  assert.equal(await quiet(() => runWhisperSetup({ cwd: "/work", run: missing.run, exists: missing.exists })), 1);
  const old = fake({ versionText: "Python 3.8.10" });
  assert.equal(await quiet(() => runWhisperSetup({ cwd: "/work", run: old.run, exists: old.exists })), 1);
  assert.ok(!old.calls.some((c) => c.args[1] === "venv"), "nothing is created for an unsupported Python");
});

test("a failed venv creation or pip install fails the setup", async () => {
  const noVenv = fake({ venvOk: false });
  assert.equal(await quiet(() => runWhisperSetup({ cwd: "/work", run: noVenv.run, exists: noVenv.exists })), 1);
  const noPip = fake({ pipOk: false });
  assert.equal(await quiet(() => runWhisperSetup({ cwd: "/work", run: noPip.run, exists: noPip.exists })), 1);
});

test("setup is not 'ready' unless faster-whisper actually imports afterwards", async () => {
  const broken = fake({ probe: { error: "ImportError: libcudnn" } });
  assert.equal(await quiet(() => runWhisperSetup({ cwd: "/work", run: broken.run, exists: broken.exists })), 1);
});

test("--check reports without installing anything", async () => {
  const ok = fake({});
  assert.equal(await quiet(() => runWhisperSetup({ cwd: "/work", checkOnly: true, run: ok.run, exists: ok.exists })), 0);
  assert.ok(!ok.calls.some((c) => c.args[1] === "pip" || c.args[1] === "venv"));
  const none = fake({ probe: { error: "ModuleNotFoundError" } });
  assert.equal(await quiet(() => runWhisperSetup({ cwd: "/work", checkOnly: true, run: none.run, exists: none.exists })), 1);
});

test("version parsing and probe parsing", () => {
  assert.deepEqual(parsePythonVersion("Python 3.13.16"), [3, 13]);
  assert.equal(parsePythonVersion("nope"), undefined);
  assert.equal(pythonIsSupported([3, 9]), true);
  assert.equal(pythonIsSupported([3, 8]), false);
  assert.equal(pythonIsSupported([4, 0]), true);
  assert.equal(pythonIsSupported(undefined), false);
  assert.deepEqual(parseProbe('noise\n{"fasterWhisper":"1.2.1"}\n'), { fasterWhisper: "1.2.1" });
  assert.ok(parseProbe("garbage").error);
  assert.equal(venvDir("/w"), path.join("/w", ".revab", "whisper-venv"));
});
