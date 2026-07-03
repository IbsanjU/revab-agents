---
applyTo: 'tests/**/*.ts, tests/**/*.feature'
description: 'Playwright + Cucumber BDD conventions for all test code'
---
# Playwright + BDD conventions

## Gherkin (tests/features/)
- Declarative scenarios: describe behavior, not UI mechanics.
- Tags on every scenario: at least one of `@smoke` / `@regression`, plus `@<component>` and the Jira key tag (e.g. `@ABC-123`).
- `Scenario Outline` + `Examples` for data variations; no copy-pasted scenarios.

## Step definitions (tests/steps/)
- Reuse existing steps before adding new ones; prefer generic parameterized phrasing.
- Access the browser via the `QeWorld` (`this.page`); never create browsers inside steps.
- Assertions via `expect` from `@playwright/test`; web-first assertions (`toBeVisible`, `toHaveText`) over manual polling.
- No `waitForTimeout`; no `.then()` chains — async/await only.

## Page objects (tests/pages/)
- One class per page/component. Locators as readonly fields using `getByRole`/`getByLabel`/`getByTestId`.
- Methods are user actions returning data or void — no assertions inside page objects.

## Data & config
- Base URLs and credentials from env vars only; test data via Examples tables or fixtures — never hardcoded secrets.
- Allure: results write to reports/allure-results; attach screenshots on failure in the After hook (already wired in tests/support/).
