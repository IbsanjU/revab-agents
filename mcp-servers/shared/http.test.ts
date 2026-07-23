import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authHeaders, setAuthService } from "./http.js";

/** Clear every auth-related env var so each case starts from a known state. */
function clearAuthEnv(): void {
  for (const svc of ["JIRA", "CONFLUENCE", "JTMF", "ATLASSIAN"]) {
    delete process.env[`${svc}_AUTH_MODE`];
    delete process.env[`${svc}_EMAIL`];
    delete process.env[`${svc}_API_TOKEN`];
  }
}

function basicHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

beforeEach(() => {
  clearAuthEnv();
  setAuthService("jira");
});

test("email + token with no explicit mode resolves to basic (unchanged behavior)", () => {
  process.env.JIRA_EMAIL = "jira-bot@company.com";
  process.env.JIRA_API_TOKEN = "cloud-token";
  assert.equal(
    authHeaders().Authorization,
    basicHeader("jira-bot@company.com", "cloud-token"),
  );
});

test("token only (no email, no mode) falls back to bearer PAT auth", () => {
  process.env.JIRA_API_TOKEN = "server-pat";
  assert.equal(authHeaders().Authorization, "Bearer server-pat");
});

test("explicit bearer mode wins even when an email is present", () => {
  process.env.JIRA_AUTH_MODE = "bearer";
  process.env.JIRA_EMAIL = "ignored@company.com";
  process.env.JIRA_API_TOKEN = "server-pat";
  assert.equal(authHeaders().Authorization, "Bearer server-pat");
});

test("per-service PAT is preferred over the shared ATLASSIAN token", () => {
  process.env.JIRA_API_TOKEN = "jira-pat";
  process.env.ATLASSIAN_API_TOKEN = "shared-pat";
  // No email anywhere -> bearer; the per-service token must win over the shared one.
  assert.equal(authHeaders().Authorization, "Bearer jira-pat");
});

test("a shared ATLASSIAN_EMAIL is inherited by a service, inferring basic", () => {
  // Documents the precedence: email falls back to the shared value, so a service with
  // only a PAT still infers basic if ATLASSIAN_EMAIL is set. Use JIRA_AUTH_MODE=bearer
  // to force PAT auth in a mixed Cloud + Server/DC .env.
  process.env.JIRA_API_TOKEN = "jira-token";
  process.env.ATLASSIAN_EMAIL = "shared@company.com";
  assert.equal(
    authHeaders().Authorization,
    basicHeader("shared@company.com", "jira-token"),
  );
});

test("explicit basic mode with no email throws a helpful error", () => {
  process.env.JIRA_AUTH_MODE = "basic";
  process.env.JIRA_API_TOKEN = "cloud-token";
  assert.throws(() => authHeaders(), /Missing email/);
});

test("an invalid auth mode is rejected", () => {
  process.env.JIRA_AUTH_MODE = "token";
  process.env.JIRA_API_TOKEN = "x";
  assert.throws(() => authHeaders(), /Invalid auth mode/);
});
