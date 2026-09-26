import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAutoApproveMap, classifyTool, classifyTools } from "./toolClassification.js";

test("plain reads are classified read", () => {
  for (const name of [
    "jira_search",
    "jira_get_issue",
    "confluence_get_page",
    "jtmf_search_tests",
    "git_log",
    "git_diff",
    "git_branches",
    "list_files",
    "read_repo_file",
    "get_test_files",
    "github_search_code",
  ]) {
    assert.equal(classifyTool(name), "read", `${name} should be read-only`);
  }
});

test("every state-changing tool is classified write", () => {
  for (const name of [
    "jira_create_issue",
    "jira_bulk_create_issues",
    "jira_update_issue",
    "jira_transition_issue",
    "jira_assign_issue",
    "jira_move_to_sprint",
    "confluence_create_page",
    "confluence_update_page",
    "confluence_delete_page",
    "confluence_add_comment",
    "confluence_upload_attachment",
    "jtmf_delete_test_case",
    "scaffold_feature",
    "scaffold_step",
    "notify_teams",
    "notify_email",
  ]) {
    assert.equal(classifyTool(name), "write", `${name} must require confirmation`);
  }
});

// Fail-closed is the whole safety property: a name we don't recognize must not be
// auto-approved just because it lacks a write verb.
test("an unknown tool defaults to write, never auto-approved by accident", () => {
  assert.equal(classifyTool("frobnicate_widget"), "write");
  assert.equal(classifyTool(""), "write");
});

test("tools whose names would mislead are pinned explicitly", () => {
  // Executes a suite in a target repo — a side effect worth confirming.
  assert.equal(classifyTool("run_bdd"), "write");
  assert.equal(classifyTool("generate_report"), "write");
  // Reads results that already exist, despite sitting beside the generator.
  assert.equal(classifyTool("allure_summary"), "read");
  assert.equal(classifyTool("get_result_json"), "read");
  // "detect" reads the repo's conventions even though it lives in codegen.
  assert.equal(classifyTool("detect_conventions"), "read");
  // Persists into knowledge/.
  assert.equal(classifyTool("knowledge_append"), "write");
  assert.equal(classifyTool("knowledge_search"), "read");
});

test("pull-to-disk tools are writes (hard rule #12 confirms the folder first)", () => {
  for (const name of [
    "jira_save_issue",
    "confluence_save_page",
    "github_save_file",
    "confluence_download_attachment",
  ]) {
    assert.equal(classifyTool(name), "write", `${name} writes to disk`);
  }
});

test("classifyTools splits and sorts the two groups", () => {
  const { read, write } = classifyTools(["jira_create_issue", "jira_search", "git_log"]);
  assert.deepEqual(read, ["git_log", "jira_search"]);
  assert.deepEqual(write, ["jira_create_issue"]);
});

test("the auto-approve map marks writes false explicitly, not by omission", () => {
  const map = buildAutoApproveMap(["jira_search", "jira_create_issue"]);
  assert.equal(map.jira_search, true);
  assert.equal(map.jira_create_issue, false);
  assert.equal(
    Object.keys(map).length,
    2,
    "writes must appear as explicit false so the intent is visible in settings",
  );
});
