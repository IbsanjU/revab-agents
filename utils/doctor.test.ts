import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkBaseUrls,
  checkNodeVersion,
  checkOptionalIntegrations,
  checkPlaceholders,
  checkServiceAuth,
  overallStatus,
  runEnvChecks,
  type Env,
} from "./doctor.js";

test("node version below the engine floor fails with an actionable fix", () => {
  const old = checkNodeVersion("v18.20.0");
  assert.equal(old.status, "fail");
  assert.match(old.fix ?? "", /Node 20/);
  assert.equal(checkNodeVersion("v22.1.0").status, "ok");
});

// Auth resolution must mirror mcp-servers/shared/http.ts, or the report lies.
test("email + token infers basic auth", () => {
  const env: Env = { JIRA_EMAIL: "bot@co.com", JIRA_API_TOKEN: "t" };
  const result = checkServiceAuth("JIRA", env);
  assert.equal(result.status, "ok");
  assert.match(result.detail, /basic/);
});

test("token with no email infers bearer PAT auth", () => {
  const result = checkServiceAuth("JIRA", { JIRA_API_TOKEN: "pat" });
  assert.equal(result.status, "ok");
  assert.match(result.detail, /bearer/);
});

test("a missing token fails and names both the per-service and shared var", () => {
  const result = checkServiceAuth("CONFLUENCE", {});
  assert.equal(result.status, "fail");
  assert.match(result.fix ?? "", /CONFLUENCE_API_TOKEN/);
  assert.match(result.fix ?? "", /ATLASSIAN_API_TOKEN/);
});

test("explicit basic mode without an email fails rather than silently erroring at runtime", () => {
  const result = checkServiceAuth("JTMF", { JTMF_API_TOKEN: "t", JTMF_AUTH_MODE: "basic" });
  assert.equal(result.status, "fail");
  assert.match(result.detail, /no email/);
});

test("an invalid auth mode is reported as a failure", () => {
  const result = checkServiceAuth("JIRA", { JIRA_API_TOKEN: "t", JIRA_AUTH_MODE: "token" });
  assert.equal(result.status, "fail");
  assert.match(result.fix ?? "", /basic.*bearer|bearer.*basic/s);
});

test("the shared ATLASSIAN token is reported as the fallback source", () => {
  const result = checkServiceAuth("JTMF", { ATLASSIAN_API_TOKEN: "t", ATLASSIAN_EMAIL: "a@b.c" });
  assert.equal(result.status, "ok");
  assert.match(result.detail, /shared/);
});

test("base URLs must be present and look like URLs", () => {
  const missing = checkBaseUrls({});
  assert.ok(missing.every((r) => r.status === "fail"));

  const bare = checkBaseUrls({ JIRA_BASE_URL: "jira.company.com", CONFLUENCE_BASE_URL: "https://x.co/wiki" });
  assert.equal(bare[0]?.status, "fail", "a bare host must be rejected — every call would fail");

  const placeholder = checkBaseUrls({
    JIRA_BASE_URL: "https://your-org.atlassian.net",
    CONFLUENCE_BASE_URL: "https://real.atlassian.net/wiki",
  });
  assert.equal(placeholder[0]?.status, "warn", "an unedited placeholder should warn");
  assert.equal(placeholder[1]?.status, "ok");
});

test("placeholder credentials copied from .env.example are caught", () => {
  const results = checkPlaceholders({ JIRA_API_TOKEN: "jira-service-account-token" });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "fail");
});

test("a half-configured Graph email setup fails; an absent one is silent", () => {
  const partial = checkOptionalIntegrations({ GRAPH_TENANT_ID: "t", GITHUB_TOKEN: "g" });
  assert.ok(partial.some((r) => r.name === "email (graph)" && r.status === "fail"));

  const absent = checkOptionalIntegrations({ GITHUB_TOKEN: "g" });
  assert.equal(absent.some((r) => r.name === "email (graph)"), false);
});

test("a missing GITHUB_TOKEN warns about the gh CLI fallback rather than failing", () => {
  const results = checkOptionalIntegrations({});
  const github = results.find((r) => r.name === "github auth");
  assert.equal(github?.status, "warn");
  assert.match(github?.fix ?? "", /gh auth login/);
});

test("overallStatus escalates fail over warn over ok", () => {
  assert.equal(overallStatus([{ name: "a", status: "ok", detail: "" }]), "ok");
  assert.equal(
    overallStatus([
      { name: "a", status: "ok", detail: "" },
      { name: "b", status: "warn", detail: "" },
    ]),
    "warn",
  );
  assert.equal(
    overallStatus([
      { name: "a", status: "warn", detail: "" },
      { name: "b", status: "fail", detail: "" },
    ]),
    "fail",
  );
});

test("a fully configured env produces no failures", () => {
  const env: Env = {
    JIRA_BASE_URL: "https://real.atlassian.net",
    CONFLUENCE_BASE_URL: "https://real.atlassian.net/wiki",
    JIRA_EMAIL: "jira@co.com",
    JIRA_API_TOKEN: "a",
    CONFLUENCE_EMAIL: "conf@co.com",
    CONFLUENCE_API_TOKEN: "b",
    JTMF_API_TOKEN: "c",
    GITHUB_TOKEN: "d",
  };
  const failures = runEnvChecks(env).filter((r) => r.status === "fail");
  assert.deepEqual(failures, [], `unexpected failures: ${failures.map((f) => f.name).join(", ")}`);
});
