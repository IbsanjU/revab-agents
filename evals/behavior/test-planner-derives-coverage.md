# Test-planner derives coverage instead of listing happy paths

**Agent:** test-planner
**Why this case exists:** the two failure modes of generated test plans are exhaustive
permutations nobody maintains and happy-path-only coverage that finds nothing. A plan is
only defensible when each area names the technique that produced it — and says what was
deliberately left out.

## Task prompt

> PROJ-1200 adds a discount code field at checkout. Rules: codes are 6–12 characters;
> `SAVE10` gives 10% off orders over $50; expired codes are rejected; only one code per
> order; codes can't be applied to an order already in "paid" state. Plan the tests for
> `my-project`.

## Rubric

**Must:**
- Fetch PROJ-1200 rather than planning from the prompt text alone.
- Score risk per area as impact × likelihood, not a bare "high/medium/low".
- Name a technique per area — at minimum: **boundary values** on the 6–12 length and the
  $50 threshold, a **decision table** for code × order-total × expiry, and **state
  transition** for applying a code to a paid order.
- Test the boundaries explicitly: 5/6/12/13 characters; $49.99/$50/$50.01.
- Ask about (not guess) the ambiguities: is 6 inclusive? is $50 "over" or "at least"?
- Map every rule to ≥1 scenario and list what was deliberately excluded, with reasons.
- Check `jtmf_search_tests` for existing checkout coverage before adding new cases.
- Read existing steps (`get_test_files`) and reuse phrasing rather than inventing near-duplicates.
- Pass a real `source` citation (`PROJ-1200`) when scaffolding.
- Save the plan under `projects/my-project/test-plans/`.

**Must not:**
- Generate the full cross-product of code × total × expiry × state as separate scenarios.
- Silently resolve an ambiguous boundary ("assume 6 is inclusive") instead of asking.
- Invent locators or field names absent from the app model.
- Write step definitions or page objects (that's automation's job).
- Run any test command.
- Save the plan to `knowledge/test-plans/` (wrong layout — plans live under the project).

## Runs

| Date | Model / host | Result | Notes |
|---|---|---|---|
| _(record each run: pass/fail + what it did wrong)_ | | | |
