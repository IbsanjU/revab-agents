# Test Case Suite — Format and Coverage Reference

## Suite structure

```
Header block (application, POD, environment, author, reviewer, version, date)
Overview (what's covered, dimensions, standing caveats)
Pre-Conditions (applicable to all cases)
Test Case Summary table
Detailed Test Cases
Coverage Matrix
Execution Tracking table
Notes & Open Items
```

## Deriving cases from the plan

Test cases come from section 4.2 (High Level In Scope) — nowhere else. The Scope Definition already decomposes flows into entry points, validation points, and exit points; those are the atomic cases.

**Step 1 — enumerate validation points.** One per event, per triggering control. If a flow has an entry event, two cancel screens, two decline screens, and a completion event, that's six validation points, not four. Screens that fire the same event name are still separate test cases because they're separate code paths and either can break alone.

**Step 2 — enumerate dimensions.** Language, offer/placement type, environment, browser, account type. Each dimension multiplies the suite.

**Step 3 — cross into a matrix.** Validation points × dimensions. Write the matrix before the cases — it's what a reviewer checks for gaps.

**Step 4 — add non-derived cases.** The plan describes the happy path and the documented rejections. It doesn't describe the ways the implementation fails. Add:

- End-to-end happy path per dimensional combination (distinct from individual event cases — catches sequencing and ordering bugs that per-event cases pass)
- Ineligible account sees no events fire
- Page reload doesn't duplicate events
- Browser back button mid-flow
- Session timeout mid-flow
- Abandonment — user leaves without completing, partial events recorded correctly
- Rapid double-click on an action control
- Event payload correctness — right offer, right URL, right user, right timestamp

## Prioritization

**High** — primary language, primary placement type, all core events, happy path. What blocks sign-off.
**Medium** — secondary language and placement type, negative and edge cases.
**Low** — rare combinations, nice-to-have validations.

Priority drives descoping conversations when the timeline compresses, so assign it deliberately.

## Detailed case format

```markdown
### [PREFIX]-TC-0NN
**Title:** [Action being verified] ([dimensions])
**Offer Type:** | **Language:** | **Priority:** | **Test Phase:**
**Pre-conditions:**
- [State required beyond the universal pre-conditions]

| Step | Action | Expected Result |
|---|---|---|
| 1 | [Single concrete action] | [Single observable outcome] |

**Pass Criteria:** [One sentence — the condition under which this passes]
**Fail Criteria:** [One sentence — including partial-failure modes]
```

### Writing steps

One action per step, one observable outcome per expected result. "Log in and navigate to the offer page and click Start" is three steps; as one step a failure can't be localized.

Expected results must be observable. "Event is captured correctly" isn't checkable; "a View Item event appears in the Event Log Dashboard with Offer = X and a current timestamp" is.

Include verification steps explicitly — switching to the monitoring tool, refreshing, filtering by test user. These are real actions a tester performs and omitting them makes the case look shorter than the work.

### Derived cases

When a case differs from an earlier one only along one dimension, reference and state the delta:

```markdown
### [PREFIX]-TC-016
**Title:** [...] (Contextual – French)
> **Steps identical to [PREFIX]-TC-002** with these differences:
> - Offer configured as Contextual
> - Account language set to French
> - Verify the event reflects Contextual type and French locale

**Pass Criteria:** [...]
**Fail Criteria:** [...]
```

Restating twelve near-identical step tables hides divergence: when someone later edits the base case, the copies silently rot. The delta form keeps one source of truth.

Only the base case per validation point gets full steps. Choose the primary-dimension case (primary language, primary placement type) as the base.

## Coverage matrix

Grid of validation points against dimensional combinations, cells holding case IDs:

| Validation Point | Intercept/EN | Contextual/EN | Intercept/FR | Contextual/FR |
|---|---|---|---|---|
| Entry event | TC-001 | TC-008 | TC-015 | TC-022 |
| Cancel screen 1 | TC-003 | TC-010 | TC-017 | TC-024 |

An empty cell is either a gap or a deliberate descope — annotate which. This matrix is the fastest way for a reviewer to assess coverage and the fastest way for the author to spot a missed combination.

## Execution tracking

| TC ID | Tester | SIT Result | SIT Date | PAT Result | PAT Date | Defect ID | Notes |

One row per case, pre-populated with IDs. The suite is a working document during execution.

## Notes & Open Items

Item | Owner | Status. Anything blocking execution: unconfirmed event names, uncertain screen counts, missing credentials, pending configuration. Carry forward the plan's open items that affect case execution.

## Placeholder discipline

Unconfirmed event names, screen counts, and button labels appear as written *with a standing caveat at the top of the suite* noting they're pending confirmation and the suite needs updating when confirmed. Writing cases against unconfirmed names is fine — the suite has to exist before the answer arrives — but the caveat has to be visible, otherwise the next reader assumes confirmation happened.
