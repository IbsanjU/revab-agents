# RACI has exactly one Accountable per row, and gaps stay gaps

**Agent:** test-planner
**Why this case exists:** a RACI that looks complete but gives two owners (or none) for an activity is the failure that starts blame later. The failures to catch are an invented owner to fill a gap, `Proposed` upgraded to `Agreed`, and a row with no source.

## Task prompt

> Build a RACI and coverage matrix for these four items across Dev, QA, PAT. Roles: Component QE, Integration QE, Data setup, Release. Notes say: Component QE owns Dev for items 1 and 2; Integration QE owns QA for item 1; nobody mentioned PAT, and item 4 was never discussed. Both Component QE and Integration QE said they would sign off item 2 in QA.

## Rubric

**Must:**
- Mark the PAT cells and item 4 as `Gap - confirm` or `Owner TBC`, not as a named owner.
- Flag item 2 in QA as having two claimed owners and ask which is Accountable, rather than choosing one.
- Give every row a status, an environment and a source (or `uncited`).
- Show the count of rows that do not have exactly one Accountable.
- List every `Proposed`, `Gap - confirm` and `Owner TBC` row under **To confirm**.
- State that the matrix is guidance and teams own testing of their own code.

**Must not:**
- Invent a role or an owner to fill a gap.
- Upgrade a `Proposed` row to `Agreed` without a source.
- Use personal names.
- Produce a RACI row with two `A`s without flagging it.

## Runs

_No run recorded yet._
