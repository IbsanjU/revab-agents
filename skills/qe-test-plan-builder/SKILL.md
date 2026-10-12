---
name: qe-test-plan-builder
description: Build, reconstruct, revise, and verify enterprise QE test plans and test case suites in the standard 15-section banking/Confluence format. Use this skill whenever the user is working with a test plan, test strategy, test cases, test scenarios, SIT/PAT/UAT documentation, sign-off criteria, entry/exit criteria, or QE deliverables — including when they upload screenshots of a Confluence test plan and ask to reconstruct it, paste a requirements or review-call transcript and ask for a plan or test cases, ask to apply a reviewer's corrections to an existing plan, or ask whether a plan is complete. Trigger it even if the user only says "write a test plan", "write test cases for this", "update the test plan", or "is this artifact complete" without naming the format.
---

# QE Test Plan Builder

Enterprise QE test plans follow a fixed template, get reviewed line-by-line by a test lead, and get signed off by a Product Owner and Technology Asset Owner. That review is unforgiving about two things: **invented content** and **inconsistency across sections**. The whole point of this skill is to produce artifacts that survive that review.

## The one rule that matters most

**Never invent a fact that a reviewer could check.**

A test plan is a controlled document. If it says "SIT starts 20 Oct 2025" and no source said that, the reviewer catches it and trust in the whole document drops. So:

- If a source states it → write it.
- If a source doesn't state it → write `TBD` and log it as an open item with an owner.
- If a source is ambiguous → write the conservative reading and flag it.

Plausible-sounding filler is worse than `TBD`, because `TBD` prompts a conversation and filler silently becomes wrong. Dates, names, ticket IDs, URLs, environment names, event names, and sign-off locations are the highest-risk fields — never guess any of them.

## Pick the mode first

Four things get asked. Identify which one before writing anything.

| Mode | Trigger | Output |
|---|---|---|
| **RECONSTRUCT** | Screenshots/photos/PDF of an existing plan, "recreate this", "reconstruct this document" | Faithful transcription, no additions |
| **AUTHOR** | Requirements doc, call transcript, "write a test plan for X" | New plan from template, unknowns as TBD |
| **CASES** | "write test cases for this plan", "test scenarios" | Test case suite + coverage matrix |
| **REVISE** | Review transcript, "reviewer has corrections", "update the plan" | Updated plan + itemized change log |

Modes chain. A user who asks for a plan usually asks for cases next, then a revision after review. Keep the artifacts as separate files so each can be versioned independently.

---

## RECONSTRUCT mode

Goal: what's on screen, in template order, and nothing else.

1. Read every image before writing. Screenshots overlap and scroll — a table cut off in image 4 usually continues in image 5. Stitch them; don't emit the same row twice.
2. Transcribe cell contents exactly, including odd artifacts. If a heading reads `14.1. 15.1. Defect Priority`, that duplicated numbering is a real defect in the source document — keep it and mention it to the user rather than silently fixing it. Same for a `Reference Id` column that repeats `A001` twice.
3. Truncated links and text (`.../EasyWeb+Top+10+Marketing+Campaigns+for+Migra...`) get transcribed as truncated. Do not reconstruct the missing characters.
4. Distinguish an empty cell from an unreadable one. Empty stays empty; unreadable becomes `[unreadable]`.
5. A blurry photo of a screen is not a clean source. If a value is genuinely illegible, say so rather than picking the likeliest string.

Then run verification (below) and report anything you stitched, guessed, or couldn't read.

## AUTHOR mode

Goal: a complete-shaped plan where every populated field is sourced.

1. Extract from the source in this order: scope and flows → events and validation points → environment and test set → people and roles → dates → dependencies and risks.
2. Reuse a prior plan for the same application as the structural base when one exists. Boilerplate sections (test objectives, defect severity/priority, roles, entry/exit criteria) are organizational standards — carry them forward verbatim. Reviewers expect them unchanged and will push back on creative rewrites.
3. Populate only what the source supports. Everything else is `TBD`.
4. Derive the risk and dependency rows from what the source actually revealed as shaky — a pending account setup, an unconfirmed event name, an upstream team's ownership. Generic risks come from the boilerplate; specific ones come from the transcript.
5. Close with an **Open Items** table: item, owner, status. Every `TBD` in the document appears here. This is the single most valuable section for the author, because it's the follow-up list.

Read `references/test-plan-template.md` for the section-by-section template and what belongs in each.

## CASES mode

Goal: every validation point in scope, crossed with every dimensional variant, with no gaps and no silent duplicates.

1. Enumerate the atomic validation points from the plan's In-Scope section — each event, each button, each entry/exit point.
2. Enumerate the dimensions — language, offer/placement type, environment, browser, account type.
3. Cross them into a coverage matrix. Write the matrix *before* the test cases; it's what proves coverage to a reviewer.
4. Write each case with: ID, title, dimension tags, priority, phase, pre-conditions, numbered step/expected-result table, pass criteria, fail criteria.
5. For cases that differ from an earlier case only along one dimension, reference the base case and state the delta rather than restating 9 identical steps. Full restatement bloats the suite and makes divergence bugs invisible when steps are later edited.
6. Add negative and edge cases deliberately: ineligible account sees no events, page reload doesn't double-fire, abandonment mid-flow, session timeout.
7. Include an execution tracking table (tester, phase result, date, defect ID) — the suite is a working document during execution, not just a plan artifact.

Read `references/test-case-template.md` for the case format and edge-case checklist.

## REVISE mode

This is the mode with the most failure potential, because feedback arrives as a messy transcript — auto-transcribed, out of order, with garbled names and half-finished sentences.

1. **Extract corrections into a numbered list first.** Do not start editing. Build the list, then edit. Working straight from the transcript is how corrections get missed.
2. Each correction needs: section, current text, requested change, and whether it's certain or ambiguous.
3. Auto-transcription mangles proper nouns. "Kiwi" is `QE`. "Satan pad" is `SIT/PAT`, "jtml" is `JTMF`, "Razer"/"Reszle"/"result" is `RESL`, "Hilo"/"reloc"/"heal okay"/"he locked" is `HELOC`. "Mindstone" is `Milestone`. Infer from context, and when a name is genuinely unrecoverable, ask rather than inventing a colleague.
4. Separate **do this** from **check this**. A reviewer saying "change the POD name to X" is an instruction. "Check with Chris whether we're doing regression testing" is an open item — it becomes a row in Open Items, not a silent edit. Conflating the two either fabricates confirmations or drops action items.
5. **Deletions are as important as additions.** Reviewers frequently remove content: rows that duplicate other sections, glossary entries for acronyms never used in the document, distribution-list entries for people who authored the plan. Apply removals; don't just append.
6. Understand *why* a change was asked, because the reason usually generalizes. "Don't add your own name to the distribution list — plan creators aren't distribution recipients" is a rule about that whole table, not one row.
7. Deliver the updated plan **plus a change table** — section, what changed, why. The user has to defend the revision in the next review; they need to see the diff without re-reading 15 sections.

Read `references/revision-guide.md` for transcript-parsing patterns.

---

## Verification process

Run this before delivering any artifact. It exists because the expensive failures in this work aren't bad prose — they're a missing section, a name that changed in section 2 but not section 13, or a confirmation you fabricated.

Verification has a scripted half and a judgment half. Run the script for what's mechanically checkable, then do the passes the script can't.

### Scripted checks

```bash
python3 scripts/verify_plan.py <path-to-plan.md>
python3 scripts/verify_plan.py <path-to-cases.md> --type cases
```

The script reports: missing/extra template sections, table-of-contents entries that don't match actual headings, malformed tables (rows whose column count doesn't match the header), every `TBD` with its line number and section, duplicate reference IDs, orphaned glossary acronyms (defined but never used in the body), and — for case suites — ID sequence gaps and cases missing required fields.

Script findings are signals, not verdicts. A duplicate `A001` may be a faithfully reconstructed source defect. An unused glossary term may be one the reviewer wants kept. Report them; let the user decide.

### Judgment passes

**1. Source-fidelity pass.** For every populated field, name the source. Screenshot N, transcript line, prior plan, or user statement. Any field you can't attribute is either a `TBD` you filled in or an assumption you didn't flag — fix it. This is the pass that catches invented dates and event names, and it's the one worth doing slowly.

**2. Consistency pass.** Facts that appear in more than one section must match everywhere. The recurring offenders:

- POD / product group name — appears in the header note, section 4.1, section 4.2, and roles
- Event names — In-Scope, entry criteria, glossary, and every test case
- Environment and test set — milestones, test environment, assumptions
- People and roles — approvals, reviewers, distribution, escalation, milestones, communication, roles
- Test phases — milestones, test types, entry/exit criteria, case metadata

A rename applied in one place and missed in five is the single most common review finding.

**3. Scope-coverage pass.** Every flow, event, and validation point in the In-Scope section is reachable by at least one test case, and every test case traces back to something in scope. Gaps mean under-testing; orphans mean scope creep.

**4. Open-items pass.** Every `TBD`, every "confirm with X", and every unconfirmed name appears in Open Items with an owner. A `TBD` that isn't in Open Items is a question nobody will remember to ask.

**5. Boilerplate-drift pass.** Standard sections must match the organization's wording. Diff against the prior plan; unintentional paraphrase of a controlled section reads as carelessness to a reviewer.

**6. For REVISE mode — closure pass.** Walk the numbered correction list from step 1 and confirm each is applied, deferred to Open Items, or explicitly declined. Report the count: *"14 corrections — 11 applied, 3 moved to Open Items pending confirmation."* Silent partial application is the failure mode here.

### Report the results

State what you verified and what's outstanding — plainly, in the response, not as a separate document. Lead with anything the user needs to act on.

Do not claim a document is complete without having run these passes. When asked "is this complete?", re-run verification rather than answering from memory of having written it; the honest answer is often "complete in structure, with N fields pending confirmation," and that's more useful than "yes."

`references/verification-checklist.md` has the full checklist in tickable form for long documents.

---

## Output conventions

- Markdown files, one artifact per file, under `projects/<project>/test-plans/` (this repo's manifest-resolved convention — same folder `test-planner`'s own Gherkin-based plans use). Version in the filename when superseding (`..._v2.md`) so the reviewer can diff.
- Preserve the source template's heading numbering exactly, quirks included.
- Tables for anything tabular in the source. Pipe tables survive Confluence paste; nested lists inside cells do not, so keep cell content flat.
- `TBD` — not "N/A", not blank, not a plausible placeholder. `TBD` is searchable and unambiguous; "N/A" asserts that nothing is needed.
- Keep the reviewer's own phrasing for anything they dictated. It's their document.

## revab-agents integration notes

- **This skill's "never invent a fact" rule *is* hard rule #9 (citation required)** for this
  framework — treat them as the same rule, not two separate ones. A field with no checkable
  source is `TBD`, exactly as hard rule #9 requires a citation or a refusal to invent.
- **The scripted verification half (`scripts/verify_plan.py`) needs a Python runtime via a
  terminal, which `test-planner` deliberately never holds** (planning never executes anything
  — see `prompts/agents/test-planner.ts`'s `mustNotHave: Bash` in `evals/capabilities.ts`).
  Run the five judgment passes yourself either way; ask the user to run the script locally
  (`python3 skills/qe-test-plan-builder/scripts/verify_plan.py <path>`) and paste back the
  findings, or hand the path to **automation** or **self-improve** (both hold `Bash`) to run
  it for you. Never skip the judgment passes because the script wasn't run — they catch what
  it structurally can't (fabricated confirmations, scope-coverage gaps, boilerplate drift).
- **RECONSTRUCT mode** (screenshots/photos of an existing plan) needs `ocr_image`/`ocr_pdf` —
  already granted to `test-planner`'s sibling `researcher`. If the source is a scanned/photo
  upload rather than pasted text, hand the extraction to **researcher** first
  (`extract-requirements-from-image`) and build the plan from its cited output.
- Still a QE-framework document: every populated field cites what it came from the same way
  a Gherkin scenario cites its source — this skill's own `references/verification-checklist.md`
  already enforces that, no change needed to its rules.
