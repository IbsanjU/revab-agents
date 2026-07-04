# sample-target-repo (fixture)

A minimal, self-contained Playwright + Cucumber + Allure project. It exists **only**
to smoke-test the `revab-agents` MCP tools (`playwright-runner`, `allure-report`,
`codegen`) end to end without needing a real external project on hand.

This directory is a stand-in for "any other repo/project" that `revab-agents`
operates on via the project manifest (`projects.manifest.json`, project key
`sample`). It is never executed as part of `revab-agents`'s own build/test/lint —
see `.github/copilot-instructions.md` for the "no execution of tests inside
revab-agents itself" rule.

## Standalone usage

```bash
cd fixtures/sample-target-repo
npm install
npx playwright install chromium
npm run test:bdd
npm run report:generate && npm run report:open
```

## Used by

- `mcp-servers/playwright-runner` — `run_bdd`, `run_playwright`, `get_test_files`
- `mcp-servers/allure-report` — `generate_report`, `allure_summary`, `get_result_json`
- `mcp-servers/codegen` — scaffolds features/steps/pages into `tests/`
