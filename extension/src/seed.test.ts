import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { MARKER, isBundledHome, parseInstalledVersion, planSeed, type SeedFs } from "./seed.js";

const J = (...p: string[]) => path.join(...p);
const TEMPLATES = "/ext/resources/home";
const HOME = "/data/home";
const FILES = [
  ".env.example",
  "skills/verify/SKILL.md",
  "skills/route/SKILL.md",
  "knowledge/conventions.md",
  "knowledge/learnings.md",
  "projects/manifest.json",
  "projects/my-project/project.json",
];

function fsWith(existingInHome: string[]): SeedFs {
  const present = new Set(existingInHome.map((r) => J(HOME, ...r.split("/"))));
  return { exists: (p) => present.has(p), walk: () => FILES };
}
const targets = (actions: Array<{ to: string }>) => actions.map((a) => path.relative(HOME, a.to).split(path.sep).join("/")).sort();

test("a first run creates every file", () => {
  const actions = planSeed({ templates: TEMPLATES, home: HOME, version: "1", installedVersion: undefined, fs: fsWith([]) });
  assert.deepEqual(targets(actions), [...FILES].sort());
  assert.ok(actions.every((a) => a.reason === "missing"));
  assert.equal(actions[0]!.from.startsWith(TEMPLATES), true);
});

test("running again with the same version does nothing", () => {
  assert.deepEqual(planSeed({ templates: TEMPLATES, home: HOME, version: "1", installedVersion: "1", fs: fsWith(FILES) }), []);
});

test("user-owned files are never overwritten, even on an update", () => {
  const actions = planSeed({ templates: TEMPLATES, home: HOME, version: "2", installedVersion: "1", fs: fsWith(FILES) });
  const written = targets(actions);
  for (const userFile of ["knowledge/learnings.md", "knowledge/conventions.md", "projects/manifest.json", "projects/my-project/project.json"]) {
    assert.ok(!written.includes(userFile), `${userFile} is the user's and must be left alone`);
  }
});

test("an update refreshes framework-owned files only", () => {
  const actions = planSeed({ templates: TEMPLATES, home: HOME, version: "2", installedVersion: "1", fs: fsWith(FILES) });
  assert.deepEqual(targets(actions), [".env.example", "skills/route/SKILL.md", "skills/verify/SKILL.md"]);
  assert.ok(actions.every((a) => a.reason === "framework-update"));
});

test("a file the user deleted is restored; one they added to a skills folder is untouched", () => {
  const actions = planSeed({ templates: TEMPLATES, home: HOME, version: "1", installedVersion: "1", fs: fsWith(FILES.filter((f) => f !== "knowledge/learnings.md")) });
  assert.deepEqual(targets(actions), ["knowledge/learnings.md"]);
  // The planner only ever lists template files, so a custom skill the user added is never in the plan.
  assert.ok(!targets(planSeed({ templates: TEMPLATES, home: HOME, version: "2", installedVersion: "1", fs: fsWith([...FILES, "skills/mine/SKILL.md"]) })).includes("skills/mine/SKILL.md"));
});

test(".env is never created or touched", () => {
  const withEnv = { exists: () => false, walk: () => [".env", ...FILES] } satisfies SeedFs;
  // A template tree never contains .env; if one did by mistake it would be treated as user-owned
  // (create-only), never refreshed. The planner has no rule that overwrites it.
  const actions = planSeed({ templates: TEMPLATES, home: HOME, version: "2", installedVersion: "1", fs: withEnv });
  assert.ok(actions.filter((a) => a.to.endsWith(`${path.sep}.env`)).every((a) => a.reason === "missing"));
});

test("the marker is never copied from templates", () => {
  const fs = { exists: () => false, walk: () => [MARKER, "knowledge/conventions.md"] } satisfies SeedFs;
  assert.deepEqual(targets(planSeed({ templates: TEMPLATES, home: HOME, version: "1", installedVersion: undefined, fs })), ["knowledge/conventions.md"]);
});

test("marker detection and version parsing", () => {
  assert.equal(isBundledHome(HOME, { exists: (p) => p === J(HOME, MARKER) }), true);
  assert.equal(isBundledHome(HOME, { exists: () => false }), false);
  assert.equal(parseInstalledVersion('{"version":"0.4.0"}'), "0.4.0");
  for (const bad of [undefined, "", "not json", "{}", '{"version":4}']) assert.equal(parseInstalledVersion(bad), undefined);
});
