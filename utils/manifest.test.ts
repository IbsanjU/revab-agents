import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

/**
 * Tests for utils/manifest.ts — the trust-boundary module that resolves which
 * on-disk project a tool/task may operate on.
 *
 * Each test writes its own throwaway manifest.json and points MANIFEST_PATH_OVERRIDE
 * at it, then dynamically re-imports the module with a cache-busting query so the
 * module-level MANIFEST_PATH constant (and its in-memory cache) is recomputed fresh.
 */

const MANIFEST_MODULE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "manifest.ts");

async function freshManifestModule() {
  const url = `${pathToFileURL(MANIFEST_MODULE_PATH).href}?t=${Date.now()}-${Math.random()}`;
  return import(url) as Promise<typeof import("./manifest.js")>;
}

async function withManifest<T>(manifestJson: unknown, fn: (mod: Awaited<ReturnType<typeof freshManifestModule>>) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-manifest-test-"));
  const manifestPath = path.join(dir, "projects.manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifestJson, null, 2), "utf8");
  const prev = process.env.MANIFEST_PATH_OVERRIDE;
  process.env.MANIFEST_PATH_OVERRIDE = manifestPath;
  try {
    const mod = await freshManifestModule();
    return await fn(mod);
  } finally {
    if (prev === undefined) delete process.env.MANIFEST_PATH_OVERRIDE;
    else process.env.MANIFEST_PATH_OVERRIDE = prev;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const VALID_PROJECT = {
  name: "sample",
  repoPath: null,
  repoUrl: null,
  branch: null,
  testPaths: { features: "tests/features", steps: "tests/steps", pages: "tests/pages", support: "tests/support" },
};

test("loadManifest throws a clear error when the manifest file is missing", async () => {
  const prev = process.env.MANIFEST_PATH_OVERRIDE;
  process.env.MANIFEST_PATH_OVERRIDE = path.join(os.tmpdir(), "definitely-does-not-exist", "projects.manifest.json");
  try {
    const mod = await freshManifestModule();
    await assert.rejects(() => mod.loadManifest(), /Missing projects\.manifest\.json/);
  } finally {
    if (prev === undefined) delete process.env.MANIFEST_PATH_OVERRIDE;
    else process.env.MANIFEST_PATH_OVERRIDE = prev;
  }
});

test("loadManifest throws with field-level detail on a malformed manifest", async () => {
  await withManifest({ projects: [{ name: "" }] }, async (mod) => {
    await assert.rejects(() => mod.loadManifest(), /Invalid projects\.manifest\.json/);
  });
});

test("loadManifest rejects a manifest with zero projects", async () => {
  await withManifest({ projects: [] }, async (mod) => {
    await assert.rejects(() => mod.loadManifest());
  });
});

test("getProject throws and lists known projects when the name is unknown", async () => {
  await withManifest({ projects: [VALID_PROJECT] }, async (mod) => {
    await assert.rejects(() => mod.getProject("nope"), /Unknown project "nope".*Known projects: sample/s);
  });
});

test("getProject returns the matching project entry", async () => {
  await withManifest({ projects: [VALID_PROJECT] }, async (mod) => {
    const project = await mod.getProject("sample");
    assert.equal(project.name, "sample");
  });
});

test("resolveProjectRepoPath throws when repoPath does not exist on disk", async () => {
  await withManifest(
    { projects: [{ ...VALID_PROJECT, repoPath: "does/not/exist/anywhere" }] },
    async (mod) => {
      await assert.rejects(() => mod.resolveProjectRepoPath("sample"), /does not exist locally/);
    }
  );
});

test("resolveProjectRepoPath throws when neither repoPath nor repoUrl is set", async () => {
  await withManifest({ projects: [VALID_PROJECT] }, async (mod) => {
    await assert.rejects(() => mod.resolveProjectRepoPath("sample"), /neither repoPath nor repoUrl/);
  });
});

test("resolveProjectRepoPath resolves an existing repoPath", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revab-manifest-repo-"));
  try {
    await withManifest({ projects: [{ ...VALID_PROJECT, repoPath: dir }] }, async (mod) => {
      const resolved = await mod.resolveProjectRepoPath("sample");
      assert.equal(resolved, path.resolve(dir));
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("assertWithinRepo allows a path inside the repo root", async () => {
  const mod = await freshManifestModule();
  const root = path.resolve("/tmp/repo-root");
  assert.doesNotThrow(() => mod.assertWithinRepo(root, path.join(root, "nested", "file.ts")));
});

test("assertWithinRepo allows the repo root itself", async () => {
  const mod = await freshManifestModule();
  const root = path.resolve("/tmp/repo-root");
  assert.doesNotThrow(() => mod.assertWithinRepo(root, root));
});

test("assertWithinRepo rejects a path traversal escape (../)", async () => {
  const mod = await freshManifestModule();
  const root = path.resolve("/tmp/repo-root");
  assert.throws(() => mod.assertWithinRepo(root, path.join(root, "..", "outside.ts")), /escapes project repo root/);
});

test("assertWithinRepo rejects a sibling directory with a similar name prefix", async () => {
  const mod = await freshManifestModule();
  const root = path.resolve("/tmp/repo-root");
  // "/tmp/repo-root-evil" starts with the string "/tmp/repo-root" but is not actually nested under it.
  assert.throws(() => mod.assertWithinRepo(root, `${root}-evil/file.ts`), /escapes project repo root/);
});
