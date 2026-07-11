import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestProjectFolder, buildSaveConfirmationPrompt } from "./saveSuggestion.js";

test("suggestProjectFolder derives the project prefix from an issue key", () => {
  assert.equal(suggestProjectFolder("PROJ-123"), "PROJ-XXX");
});

test("suggestProjectFolder accepts a bare project/space key", () => {
  assert.equal(suggestProjectFolder("ABC"), "ABC-XXX");
});

test("suggestProjectFolder falls back to unsorted when hint is missing", () => {
  assert.equal(suggestProjectFolder(undefined), "unsorted");
  assert.equal(suggestProjectFolder(""), "unsorted");
});

test("suggestProjectFolder sanitizes unusual characters", () => {
  assert.equal(suggestProjectFolder("my space!!"), "MY-SPACE-XXX");
});

test("buildSaveConfirmationPrompt returns a suggestion and an ask-the-user message", () => {
  const result = buildSaveConfirmationPrompt("PROJ-123", "downloads/confluence");
  assert.equal(result.suggestedFolder, "PROJ-XXX");
  assert.match(result.message, /downloads\/confluence\/PROJ-XXX/);
  assert.match(result.message, /Ask the user/);
});
