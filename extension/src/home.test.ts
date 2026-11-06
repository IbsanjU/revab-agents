import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { distIsStale, gatewayLaunch, isFrameworkHome, parsePid, resolveHome, runtimePaths, tailLines, type FsLike } from "./home.js";

const J = (...p: string[]) => path.join(...p);

function fakeFs(files: Record<string, string>, dirs: string[] = []): FsLike {
  return {
    exists: (p) => p in files || dirs.includes(p),
    read: (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p]!;
    },
  };
}

const checkout = (root: string, extra: Record<string, string> = {}, dirs: string[] = []) =>
  fakeFs({ [J(root, "package.json")]: '{"name":"revab-agents"}', ...extra }, [J(root, "prompts", "agents"), ...dirs]);

test("a checkout needs the right package name and the agent specs", () => {
  assert.equal(isFrameworkHome("/r", checkout("/r")), true);
  assert.equal(isFrameworkHome("/r", fakeFs({ [J("/r", "package.json")]: '{"name":"other"}' }, [J("/r", "prompts", "agents")])), false);
  assert.equal(isFrameworkHome("/r", fakeFs({ [J("/r", "package.json")]: '{"name":"revab-agents"}' })), false);
  assert.equal(isFrameworkHome("/r", fakeFs({ [J("/r", "package.json")]: "not json" })), false);
  assert.equal(isFrameworkHome("/missing", fakeFs({})), false);
});

test("the setting wins over open folders, and a bad setting is reported, not ignored", () => {
  const fs = checkout("/a");
  assert.deepEqual(resolveHome({ configured: "/a", workspaceFolders: ["/elsewhere"], fs }), { home: "/a", source: "setting" });
  const bad = resolveHome({ configured: "/nope", workspaceFolders: ["/a"], fs });
  assert.equal(bad.source, "none");
  assert.match((bad as { problem?: string }).problem ?? "", /not a revab-agents checkout/);
});

test("without a setting the first open folder that is a checkout is used", () => {
  const fs = checkout("/b");
  assert.deepEqual(resolveHome({ configured: "  ", workspaceFolders: ["/x", "/b"], fs }), { home: "/b", source: "workspace" });
  assert.equal(resolveHome({ configured: undefined, workspaceFolders: ["/x"], fs }).source, "none");
});

test("launch prefers the compiled CLI, falls back to tsx, and refuses without dependencies", () => {
  const built = checkout("/r", { [J("/r", "dist", "cli", "index.js")]: "" });
  assert.deepEqual(gatewayLaunch("/r", 7300, built), {
    command: "node",
    args: [J("/r", "dist", "cli", "index.js"), "start"],
    cwd: "/r",
    env: { GATEWAY_MCP_PORT: "7300" },
  });
  const dev = checkout("/r", {}, [J("/r", "node_modules", "tsx")]);
  assert.deepEqual(gatewayLaunch("/r", 7400, dev, "/opt/node").args.slice(0, 3), ["--import", "tsx", J("/r", "cli", "index.ts")]);
  assert.equal(gatewayLaunch("/r", 7400, dev, "/opt/node").command, "/opt/node");
  assert.throws(() => gatewayLaunch("/r", 7300, checkout("/r")), /npm install/);
});

test("launch arguments never go through a shell, so a path with spaces stays one argument", () => {
  const spaced = "/my projects/revab agents";
  const launch = gatewayLaunch(spaced, 7300, checkout(spaced, { [J(spaced, "dist", "cli", "index.js")]: "" }));
  assert.equal(launch.args[0], J(spaced, "dist", "cli", "index.js"));
  assert.equal(launch.cwd, spaced);
});

test("runtime files live under .revab inside the checkout", () => {
  assert.deepEqual(runtimePaths("/r"), { dir: J("/r", ".revab"), pid: J("/r", ".revab", "gateway.pid"), log: J("/r", ".revab", "gateway.log") });
});

test("parsePid accepts a pid and rejects junk, zero and one", () => {
  assert.equal(parsePid("1234\n"), 1234);
  for (const bad of ["", "abc", "0", "1", "-5", "12.5", undefined]) assert.equal(parsePid(bad), undefined, String(bad));
});

test("tailLines keeps the last non-empty lines", () => {
  assert.equal(tailLines("a\n\nb\nc\n", 2), "b\nc");
});

function withTimes(base: FsLike, dist: number, newest: number): FsLike {
  return { ...base, mtimeMs: () => dist, newestSourceMtimeMs: () => newest };
}

test("a build older than the sources is skipped in favour of tsx, with a note saying why", () => {
  const base = checkout("/r", { [J("/r", "dist", "cli", "index.js")]: "" }, [J("/r", "node_modules", "tsx")]);
  const stale = gatewayLaunch("/r", 7300, withTimes(base, 100, 200));
  assert.deepEqual(stale.args.slice(0, 2), ["--import", "tsx"]);
  assert.match(stale.note ?? "", /npm run build/);
  const fresh = gatewayLaunch("/r", 7300, withTimes(base, 300, 200));
  assert.equal(fresh.args[0], J("/r", "dist", "cli", "index.js"));
  assert.equal(fresh.note, undefined);
});

test("a stale build with no tsx still runs, but says so", () => {
  const base = checkout("/r", { [J("/r", "dist", "cli", "index.js")]: "" });
  const launch = gatewayLaunch("/r", 7300, withTimes(base, 100, 200));
  assert.equal(launch.args[0], J("/r", "dist", "cli", "index.js"));
  assert.match(launch.note ?? "", /tsx is not installed/);
});

test("staleness is not claimed when times are unavailable or there is no build", () => {
  const base = checkout("/r", { [J("/r", "dist", "cli", "index.js")]: "" });
  assert.equal(distIsStale("/r", base), false, "no timing support: assume current");
  assert.equal(distIsStale("/r", withTimes(checkout("/r"), 1, 2)), false, "no dist at all");
});
