# Revision Guide — Working From Review Transcripts

Review feedback usually arrives as an auto-generated meeting transcript: no punctuation discipline, garbled proper nouns, the reviewer thinking aloud and reversing themselves, and no section markers. The work is turning that into a correction list.

## Build the correction list before editing

Read the whole transcript first. Then extract:

| # | Section | Current | Requested change | Certainty |
|---|---|---|---|---|
| 1 | 2.2 Approvals | [name A] | Replace with [name B] | Certain |
| 2 | 3.2 Objectives | — | Confirm regression scope with dev lead | Open item |

Editing while reading loses corrections, because reviewers revisit earlier sections mid-call. Build the list, confirm it looks complete against the transcript, then edit.

## Decoding auto-transcription

Speech-to-text mangles domain vocabulary consistently. Common patterns:

| Heard | Almost certainly |
|---|---|
| kiwi, QEB, qvs | QE |
| Satan pad, sit back, set pad | SIT/PAT |
| jtml, jtmf | JTMF |
| Razer, Reszle, result, Razel | RESL |
| Hilo, reloc, heal okay, he locked, haylock | HELOC |
| Mindstone | Milestone |
| conference, confluence | Confluence |
| sidewalk events, site mapping | sitemap events |
| interpret | intercept |
| Amin Jinna, garbled names | Ask — don't guess a colleague's name |

Product and person names get mangled worst. Infer from context where the surrounding sentence makes it unambiguous. Where a name is genuinely unrecoverable, ask — inventing a colleague into a controlled document is a serious error, worse than the delay of asking.

## Instruction vs. investigation

Two different things sound similar in a transcript:

**Instruction** — apply directly.
> "Change the POD name to Marketing Personalization Canada."
> "Remove that line about rejection of the campaign offer."

**Investigation** — becomes an Open Item, not an edit.
> "Check with Chris whether we're doing regression testing."
> "Confirm whether unit testing or normal dev testing."

Treating investigation as instruction fabricates a confirmation nobody gave. Treating instruction as investigation drops the correction. When a reviewer says "check X and update accordingly," the check is the open item and the update happens after the answer arrives — the document keeps `TBD` in the meantime.

## Deletions

Reviewers delete more than they add. Watch for:

- "That's not needed" / "you can remove that"
- "That's too technical" — glossary entries for terms the audience knows
- "Why have you added that here?" — content that doesn't belong in that section
- "We don't need D5 and D3" — redundant rows
- "You do not add your name" — role-based exclusions

Deletions are easy to miss because they're phrased as asides. Scan the transcript a second time specifically for removal language.

## Generalize the reason

Reviewers explain corrections. The explanation usually covers more than the instance:

> "You do not add your name because you're the plan creator. Whoever is working on the test plan, we do not add their name to the distribution list."

That's a rule about the whole table — check every name in it against authorship, not just the one mentioned.

> "This event can be triggered from multiple cancel pages — don't put this note. Be specific, highlight all the cancels and all the declines."

That's a rule about the whole Scope Definition — replace every vague multiplicity note with enumerated instances.

## Reviewer reversals

Reviewers change their minds mid-sentence. The last statement on a point wins:

> "Should be removed. You have — no, we should not."

Keep it. When a reversal is genuinely ambiguous, list it in the change table as a question rather than picking silently.

## Reconciling with an already-edited document

Often the user has applied some corrections before sharing the transcript. Their edited version is the base — not your earlier draft. Diff their version against the transcript:

- Corrections they already applied → confirm, don't redo
- Corrections not yet applied → apply
- Changes in their version not from the transcript → preserve; they came from somewhere you can't see

Never revert a user's own edit because the transcript didn't mention it.

## Deliverable

Updated document plus a change table:

| Section | Change | Reason |
|---|---|---|
| 2.4 Distribution | Removed author names | Plan creators aren't distribution recipients |
| 12 Risks | Removed risk on unconfirmed names | Open item, not a risk |

Then state the closure count: *"14 corrections — 11 applied, 3 moved to Open Items pending confirmation."* The user has to defend this revision in the next review and needs to see the diff without re-reading the document.
