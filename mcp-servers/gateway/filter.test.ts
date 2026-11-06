import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTools, parseDisabledSpec } from "./filter.js";

const tools = [
  { name: "jira_search", server: "jira" },
  { name: "jira_create_issue", server: "jira" },
  { name: "confluence_get_page", server: "confluence" },
  { name: "confluence_update_page", server: "confluence" },
  { name: "knowledge_search", server: "artifacts" },
];
const names = (list: Array<{ name: string }>) => list.map((t) => t.name);

test("parses commas and whitespace, and ignores empties", () => {
  assert.deepEqual(parseDisabledSpec(" a, b  c ,,"), ["a", "b", "c"]);
  assert.deepEqual(parseDisabledSpec(undefined), []);
  assert.deepEqual(parseDisabledSpec(""), []);
});

test("no spec keeps everything and removes nothing", () => {
  const r = filterTools(tools, "");
  assert.equal(r.kept.length, 5);
  assert.deepEqual(r.removed, []);
});

test("exact names, server wildcards and prefix wildcards", () => {
  assert.deepEqual(names(filterTools(tools, "jira_create_issue").removed), ["jira_create_issue"]);
  assert.deepEqual(names(filterTools(tools, "confluence/*").removed), ["confluence_get_page", "confluence_update_page"]);
  assert.deepEqual(names(filterTools(tools, "jira_*").removed), ["jira_search", "jira_create_issue"]);
});

test("a server wildcard does not match a tool that merely starts with the server name", () => {
  const odd = [{ name: "jira_x", server: "other" }, { name: "y", server: "jira" }];
  assert.deepEqual(names(filterTools(odd, "jira/*").removed), ["y"]);
});

test("entries that match nothing are reported, not silently dropped", () => {
  const r = filterTools(tools, "jira_serch, git/*");
  assert.deepEqual(r.unmatched, ["jira_serch", "git/*"]);
  assert.equal(r.removed.length, 0, "a typo must not disable anything");
});

test("kept and removed partition the input", () => {
  const r = filterTools(tools, "jira/*, knowledge_search");
  assert.equal(r.kept.length + r.removed.length, tools.length);
  assert.deepEqual(names(r.kept), ["confluence_get_page", "confluence_update_page"]);
});
