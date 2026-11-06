import { test } from "node:test";
import assert from "node:assert/strict";
import { cliArgsFrom, shimContent, shimFileName } from "./shim.js";

const base = { node: "/usr/bin/node", cliArgs: ["/opt/revab/bundle/revab.cjs"], home: "/data/home" };

test("the file name follows the platform", () => {
  assert.equal(shimFileName("linux"), "revab");
  assert.equal(shimFileName("darwin"), "revab");
  assert.equal(shimFileName("win32"), "revab.cmd");
});

test("the launcher's CLI arguments are the gateway launch without its start sub-command", () => {
  assert.deepEqual(cliArgsFrom(["/x/revab.cjs", "start"]), ["/x/revab.cjs"]);
  assert.deepEqual(cliArgsFrom(["--import", "tsx", "/x/cli/index.ts", "start"]), ["--import", "tsx", "/x/cli/index.ts"]);
  assert.deepEqual(cliArgsFrom(["/x/revab.cjs"]), ["/x/revab.cjs"]);
});

test("posix: runs the CLI, passes every argument through, and enters the home folder only for doctor and start", () => {
  const text = shimContent({ platform: "linux", ...base });
  assert.match(text, /^#!\/bin\/sh/);
  assert.match(text, /doctor\|start\) cd '\/data\/home' \|\| exit 1 ;;/);
  assert.match(text, /exec '\/usr\/bin\/node' '\/opt\/revab\/bundle\/revab\.cjs' "\$@"/);
  assert.doesNotMatch(text, /init|call|tools/, "other commands run where the user is");
});

test("posix: a single quote in a path cannot break out of its quoting", () => {
  const text = shimContent({ platform: "linux", node: "/n", cliArgs: ["/it's here/x.cjs"], home: "/h'; rm -rf /; '" });
  assert.match(text, /'\/it'\\''s here\/x\.cjs'/);
  assert.match(text, /cd '\/h'\\''; rm -rf \/; '\\'''/);
});

test("posix: loader flags come before the entry file, in order", () => {
  const text = shimContent({ platform: "linux", node: "/n", cliArgs: ["--import", "tsx", "/r/cli/index.ts"], home: "/r" });
  assert.match(text, /exec '\/n' '--import' 'tsx' '\/r\/cli\/index\.ts' "\$@"/);
});

test("windows: a .cmd launcher with CRLF, home handling, and %* passthrough", () => {
  const text = shimContent({ platform: "win32", node: "C:\\Program Files\\nodejs\\node.exe", cliArgs: ["C:\\ext\\bundle\\revab.cjs"], home: "C:\\Users\\u\\home" });
  assert.match(text, /^@echo off\r\n/);
  assert.match(text, /if \/I "%~1"=="doctor" cd \/d "C:\\Users\\u\\home"/);
  assert.match(text, /if \/I "%~1"=="start" cd \/d/);
  assert.match(text, /"C:\\Program Files\\nodejs\\node\.exe" "C:\\ext\\bundle\\revab\.cjs" %\*/);
});

test("windows: percent signs are escaped and a path with a double quote is refused rather than mis-quoted", () => {
  assert.match(shimContent({ platform: "win32", node: "n", cliArgs: ["C:\\100%\\x.cjs"], home: "h" }), /"C:\\100%%\\x\.cjs"/);
  assert.throws(() => shimContent({ platform: "win32", node: 'bad"path', cliArgs: ["x"], home: "h" }), /quote/);
});
