import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJiraIssueUrl } from "./jiraLinks.js";

test("buildJiraIssueUrl joins base url and key", () => {
  assert.equal(
    buildJiraIssueUrl("https://example.atlassian.net", "ABC-123"),
    "https://example.atlassian.net/browse/ABC-123"
  );
});

test("buildJiraIssueUrl strips a trailing slash from the base url", () => {
  assert.equal(
    buildJiraIssueUrl("https://example.atlassian.net/", "ABC-123"),
    "https://example.atlassian.net/browse/ABC-123"
  );
});

test("buildJiraIssueUrl encodes special characters in the key", () => {
  assert.equal(
    buildJiraIssueUrl("https://example.atlassian.net", "ABC 123"),
    "https://example.atlassian.net/browse/ABC%20123"
  );
});
