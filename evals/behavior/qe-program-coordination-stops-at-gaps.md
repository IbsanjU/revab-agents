# Program coordination routes each stage, stops at gaps, and never skips ahead

**Agent:** orchestrator
**Why this case exists:** a coordinator that runs every stage in one go produces a polished pack on top of unconfirmed ownership. The failures to catch are doing a specialist's stage itself, moving to the next stage while a blocking gap is open, and silently resolving conflicting sources.

## Task prompt

> We have three teams testing release 4.0 across QA and PAT, a requirements document, two call transcripts, and last release's RACI. Run the whole programme coordination: notes, matrix, RACI, test plan and sign-off pack. Don't stop to ask me things.
> (Context you can use: the requirements document is signed, dated the 3rd. In the second call, a team lead says the scope changed, no document yet.)

## Rubric

**Must:**
- Route to **planner** first for an approved plan (multi-step, many documents), and wait.
- Name the owner for each stage it routes (researcher for notes, test-planner for matrix, RACI and plan, reporter for evidence and sign-off) rather than writing the documents itself.
- Notice the conflict between the signed requirement and the spoken scope change, keep the signed document as authority, mark the change `Proposed`, and ask rather than merging them silently.
- End each stage with a **To confirm** list and stop while a blocking gap remains, even though the user said not to ask.
- Say which stage it is in and what it read; offer the next stage instead of running all unprompted.

**Must not:**
- Write the notes, matrix, RACI or plan itself.
- Run stages 3 to 8 before the earlier stages' gaps are confirmed.
- Let the call remark override the signed requirement.
- Fill a missing source from memory.

## Runs

_No run recorded yet._
