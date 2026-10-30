import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, runInSandbox, type ToolCaller } from "./sandbox.js";

const ok = (value: unknown) => JSON.stringify({ ok: value });
const fail = (error: string) => JSON.stringify({ error });
const echo: ToolCaller = async (name, args) => ok({ name, args });

test("normalizeCode accepts an async arrow, a bare body, and fenced code", () => {
  assert.equal(normalizeCode("async () => 1"), "(async () => 1)()");
  assert.equal(normalizeCode("async () => { return 1 };"), "(async () => { return 1 })()");
  assert.match(normalizeCode("return 2"), /^\(async \(\) => \{\nreturn 2\n\}\)\(\)$/);
  assert.equal(normalizeCode("```js\nasync () => 3\n```"), "(async () => 3)()");
});

test("returns the value and captures console output", async () => {
  const r = await runInSandbox("console.log('hi', {a:1}); console.error('bad'); return 1 + 1", echo);
  assert.equal(r.result, 2);
  assert.deepEqual(r.logs, ["hi {\"a\":1}", "[error] bad"]);
});

test("round-trips tool calls and runs them in parallel", async () => {
  const r = await runInSandbox(
    "const [a, b] = await Promise.all([codemode.alpha({x: 1}), codemode.beta({y: 2})]); return [a, b]",
    echo,
  );
  assert.deepEqual(r.result, [
    { name: "alpha", args: { x: 1 } },
    { name: "beta", args: { y: 2 } },
  ]);
});

test("a failing tool call throws inside the code and can be caught there", async () => {
  const caller: ToolCaller = async () => fail("Jira said no");
  const r = await runInSandbox("try { await codemode.x({}); } catch (e) { return 'caught: ' + e.message }", caller);
  assert.equal(r.result, "caught: Jira said no");
  const uncaught = await runInSandbox("await codemode.x({})", caller);
  assert.equal(uncaught.error, "Jira said no");
});

test("a synchronous infinite loop is killed by the timeout", async () => {
  const started = Date.now();
  const r = await runInSandbox("while (true) {}", echo, { timeoutMs: 300 });
  assert.match(r.error ?? "", /timed out/);
  assert.ok(Date.now() - started < 3_000, "must not hang");
});

test("a hung tool call is also bounded by the timeout", async () => {
  const never: ToolCaller = () => new Promise(() => undefined);
  const r = await runInSandbox("await codemode.stuck({})", never, { timeoutMs: 300 });
  assert.match(r.error ?? "", /timed out/);
});

test("the sandbox has no Node, network, or timer globals", async () => {
  const r = await runInSandbox(
    `return {
      process: typeof process, require: typeof require, fetch: typeof fetch,
      module: typeof module, Buffer: typeof Buffer, setTimeout: typeof setTimeout,
      globalThis: typeof globalThis.process
    }`,
    echo,
  );
  assert.deepEqual(r.result, {
    process: "undefined", require: "undefined", fetch: "undefined",
    module: "undefined", Buffer: "undefined", setTimeout: "undefined", globalThis: "undefined",
  });
});

test("string eval and Function constructors are blocked", async () => {
  const evalTry = await runInSandbox("return eval('1+1')", echo);
  assert.match(evalTry.error ?? "", /code generation|EvalError|not allowed/i);
  const fnTry = await runInSandbox("return (function(){}).constructor('return 1')()", echo);
  assert.match(fnTry.error ?? "", /code generation|EvalError|not allowed/i);
});

test("known constructor-chain escapes do not reach the host", async () => {
  const attempts = [
    "return this.constructor.constructor('return process')()",
    "return (await codemode.x({})).constructor.constructor('return process')()",
    "const p = codemode.x({}); return p.constructor.constructor('return process')()",
    "try { await codemode.x({}); } catch (e) { return e.constructor.constructor('return process')() }",
    "return console.log.constructor('return process')()",
  ];
  for (const code of attempts) {
    const r = await runInSandbox(code, async () => fail("boom"));
    assert.ok(r.error !== undefined, `must not succeed: ${code}`);
    assert.doesNotMatch(JSON.stringify(r.result ?? ""), /pid|versions|env/, `leaked a process object: ${code}`);
  }
});

test("model code cannot see the gateway's environment", async () => {
  process.env.CODEMODE_TEST_SECRET = "s3cret";
  const r = await runInSandbox("return typeof process", echo);
  assert.equal(r.result, "undefined");
  delete process.env.CODEMODE_TEST_SECRET;
});

test("a syntax error is reported, not thrown", async () => {
  const r = await runInSandbox("return (", echo);
  assert.ok(r.error);
});

test("an undefined return value is reported as null", async () => {
  const r = await runInSandbox("const x = 1", echo);
  assert.equal(r.result, null);
});
