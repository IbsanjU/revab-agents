# Verification Checklist

Work through this before delivering. Run `scripts/verify_plan.py` first for the mechanical checks, then the judgment passes.

---

## A. Structural

- [ ] All 15 sections present, correctly numbered, in order
- [ ] Sub-sections present (2.1–2.4, 3.1–3.2, 4.1–4.3, 9.1–9.2, 14.1)
- [ ] TOC entries match actual headings — text and numbering
- [ ] Source numbering quirks preserved in RECONSTRUCT mode, and flagged to the user
- [ ] Every table's rows have the same column count as its header
- [ ] No cell contains an unescaped `|`
- [ ] No placeholder text from a prior release left behind

## B. Source fidelity

- [ ] Every populated field attributable to a specific source
- [ ] No invented dates
- [ ] No invented names
- [ ] No invented ticket or epic IDs
- [ ] No invented URLs, and no prior-release URL carried forward unchanged
- [ ] No invented event names
- [ ] Truncated source text left truncated
- [ ] Illegible source values marked, not guessed
- [ ] Overlapping screenshots stitched without duplicated rows

## C. Consistency across sections

Check each fact in every section it appears:

- [ ] POD / product group name — header note, 4.1, 4.2, roles
- [ ] Platform / PG name
- [ ] Application name
- [ ] Event names — 4.2, entry criteria, glossary, every test case
- [ ] Environment name and test set — 5, 9, 10
- [ ] Test phases — 5, 6, 8, case metadata
- [ ] Every person's name spelled identically everywhere
- [ ] Every person's role identical everywhere it appears
- [ ] Version number consistent between overview and revision history
- [ ] Language and placement-type variants consistent between 3.2, 4.2, and the case suite

## D. Reference IDs

- [ ] Assumption/constraint/dependency IDs unique
- [ ] IDs sequential within their type
- [ ] Type letter matches the ID prefix (`A`→assumption, `C`→constraint, `D`→dependency)
- [ ] Risk numbers sequential with no gaps after deletions

## E. Content correctness

- [ ] Goal statement covers scope, non-impact, additional validation, and conditions
- [ ] Scope Definition specifies exactly when each event fires, not just that it does
- [ ] Multiple screens firing the same event enumerated individually
- [ ] Entry and exit points explicitly identified
- [ ] Out-of-scope items don't contradict in-scope items
- [ ] Test Types ✅/❌ consistent with the stated phases and out-of-scope list
- [ ] Risks phrased as IF/THEN/RESULTING IN
- [ ] Risks are risks; questions are open items
- [ ] Glossary contains only acronyms used in the body
- [ ] Every glossary expansion correct
- [ ] Boilerplate sections match prior-plan wording

## F. Coverage (case suites)

- [ ] Every in-scope validation point has at least one case
- [ ] Every case traces to something in scope
- [ ] Every dimensional combination covered or explicitly descoped
- [ ] Coverage matrix present and matching the case list
- [ ] Case IDs sequential, no gaps or duplicates
- [ ] Summary table row count matches detailed case count
- [ ] Each case has ID, title, dimensions, priority, phase, pre-conditions, steps, pass and fail criteria
- [ ] Derived cases reference a base case that exists
- [ ] Negative and edge cases included
- [ ] Execution tracking table lists every case ID
- [ ] Priorities assigned deliberately

## G. Open items

- [ ] Every `TBD` in the document appears in Open Items
- [ ] Every "confirm with X" from review appears in Open Items
- [ ] Each open item has a named owner
- [ ] No open item silently resolved without a source
- [ ] Standing caveat present at the top of the case suite when cases are written against unconfirmed values

## H. REVISE mode closure

- [ ] Numbered correction list built before editing
- [ ] Each correction applied, deferred, or explicitly declined
- [ ] Deletions applied, not just additions
- [ ] Reviewer reasoning generalized across the affected table or section
- [ ] User's own prior edits preserved
- [ ] Change table delivered
- [ ] Closure count stated

---

## Reporting

State plainly what was verified and what's outstanding. Lead with anything actionable. Useful shape:

> Verified: all 15 sections, TOC matches, 30 cases cover 6 validation points × 4 combinations with no gaps.
> Outstanding: 9 fields pending confirmation — event names and screen counts from the dev lead, SIT/PAT dates, JTMF folder URL. All in Open Items.
> Note: `A001` appears twice — preserved from the source document, worth flagging to the reviewer.

When asked whether an artifact is complete, re-run verification rather than answering from memory. "Complete in structure, with N fields pending confirmation" is usually the truthful answer and is more useful than "yes."
