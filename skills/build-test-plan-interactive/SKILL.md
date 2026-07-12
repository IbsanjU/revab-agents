---
name: build-test-plan-interactive
description: Explore a target application interactively (via the playwright MCP server) to build/update a living app model — pages, roles/testids, flows — used to ground test-plan generation in real UI, not guesses. Use when planning tests for an app that hasn't been mapped yet, or when automation hits an unmapped page.
---
# Build test plan interactively (app-model learning)

## Steps
1. Check whether `knowledge/app-model/<project>.md` already exists; read it first —
   don't re-explore what's already documented.
2. Use the official `playwright` MCP server (navigate, snapshot, click) to walk the
   target application's key flows relevant to the current requirement.
3. For each page visited, record: URL/route, purpose, key interactive elements with
   their accessible roles/testids (from the snapshot, not invented), and the flows that
   pass through it.
4. Append/update `knowledge/app-model/<project>.md` with this structured map.
5. When `test-planner` needs a locator or flow detail, it must cite the app-model entry
   rather than guessing a selector — if the page isn't yet mapped, re-run this skill
   before generating scenarios for it.

## Rules
- Only record elements actually observed in a snapshot — never guess role/testid names.
- Re-run exploration when the app model looks stale (e.g. automation fails because a
   locator no longer matches) instead of patching guesses into the plan.
