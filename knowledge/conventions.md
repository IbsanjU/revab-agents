# Conventions

Team/org conventions the agents must follow. The self-improvement agent updates this file when new conventions are decided.

## Code
- TypeScript everywhere; ESM (`type: module`); run via `tsx` (no build output).
- Reuse on second use: promote repeated logic to `utils/` or `scripts/`.
- Secrets only in `.env`; config via `mcp-servers/shared/config.ts` helpers.

## Testing
- Gherkin tags: `@smoke`/`@regression` + `@<component>` + `@<JIRA-KEY>` on every scenario.
- Page objects hold locators/actions only — assertions live in steps.
- No hard waits; web-first assertions.

## Process
- Long tasks go through the orchestrator queue, not blocking calls.
- Every significant session ends with a `knowledge/learnings.md` entry.
- Test plans live in `knowledge/test-plans/<EPIC-KEY>.md`.
