---
applyTo: 'mcp-servers/codegen/**/*.ts, skills/**/*.md'
description: 'Playwright + Cucumber BDD conventions the codegen MCP tool must enforce when scaffolding code into a target project (not conventions for files in this repo — revab-agents has no test suite of its own)'
---
# Playwright + BDD conventions (for scaffolding into target projects)

These conventions are enforced by the `codegen` MCP server's `scaffold_feature`/`scaffold_step`/`scaffold_page` tools when writing into a **target project's** paths (resolved from `projects.manifest.json`). They describe what generated code must look like in that project — `revab-agents` itself never contains `tests/`.

## Gherkin (target project's `testPaths.features`)
- Declarative scenarios: describe behavior, not UI mechanics.
- Tags on every scenario: at least one of `@smoke` / `@regression`, plus `@<component>` and the Jira key tag (e.g. `@ABC-123`).
- Every feature file must start with a `# Source: <citation>` comment (Jira key / Confluence page / transcript timestamp / app-model reference) — `scaffold_feature` enforces this.
- `Scenario Outline` + `Examples` for data variations; no copy-pasted scenarios.

## Step definitions (target project's `testPaths.steps`)
- Reuse existing steps before adding new ones; prefer generic parameterized phrasing.
- Access the browser via that project's own World/fixture class; never create browsers inside steps.
- Assertions via `expect` from `@playwright/test`; web-first assertions (`toBeVisible`, `toHaveText`) over manual polling.
- No `waitForTimeout`; no `.then()` chains — async/await only.

## Page objects (target project's `testPaths.pages`)
- One class per page/component. Locators as readonly fields using `getByRole`/`getByLabel`/`getByTestId` — sourced from that project's `knowledge/app-model/<project>.md` when available, never guessed.
- Methods are user actions returning data or void — no assertions inside page objects.

## Data & config
- Base URLs and credentials from env vars only; test data via Examples tables or fixtures — never hardcoded secrets.
- Allure results write to the target project's own `reports/allure-results` (read via the `allure-report` MCP server); attach screenshots on failure in that project's After hook.

## Concurrency
- Never issue multiple `scaffold_step`/`scaffold_page`/`scaffold_feature` calls targeting the **same file** within one turn — the no-overwrite behavior prevents silent data loss, but two same-file writes racing in one turn is still undefined; make same-file edits sequentially, one call at a time, reading the result before the next.
