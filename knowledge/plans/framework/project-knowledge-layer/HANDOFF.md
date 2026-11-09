# Handoff: build the project knowledge layer, one task card at a time

You are the Hermes agent working in the `revab-agents` repo. You build the project knowledge layer by completing **one task card per session**. The spec is `knowledge/plans/framework/2026-11-08-project-knowledge-layer.md`; you do not need to hold all of it in mind. Each card tells you what to read and what to do.

## Every session, in this order
1. Read `knowledge/plans/framework/project-knowledge-layer/STATE.md`. It names the current card and any blocker. If a blocker is listed, stop and report it.
2. Read the current card in `tasks/`. Read only the files it lists.
3. Write the tests named in the card **first**. Run them and see them fail.
4. Write the code. Keep to the signatures in the card.
5. Run `npm run gate`. It must pass. If it fails, read the failure summary and fix; you may try up to **3** times. If it is still red, stop, write the failing output into STATE.md and report. Do not weaken a test to pass it.
6. Do the card's **mutation check**: break the code in the way the card says, confirm the named test fails, restore the code.
7. Commit on a branch named in the card, with a message that says what the card built. One card, one commit (or a few small ones).
8. Update STATE.md: card done, gate result, next card, anything surprising.
9. Report using the template below. Then stop. Do not start the next card.

## Rules that never bend
- Never hand-edit a generated file (`.github/agents/*`, `.claude/agents/*`, `AGENTS.md`, `docs/graph.*`). Regenerate with the command the card gives.
- Never add a dependency. Never write outside the folders a card lists.
- Never store a claim without a citation that passes `utils/citation.ts`. Do not write a looser validator.
- Never delete or overwrite a record. The store is append-only.
- Never resolve a conflict silently; mark it `disputed`.
- Never copy one project's content into another's files.
- Never widen a baseline file to make a check pass.
- Do not report a card as done on a red gate, or count something you could not run as a pass: say "not verified".
- If the card is unclear, or you would have to guess a signature, stop and ask. A wrong guess costs more than a question.
- Paths and scripts must work on Windows: use `node:path`, no shell-only tricks.

## Report template (end of every session)
```
Card: T0x
Gate: pass | fail (which check)
Files added/changed: ...
Acceptance (each line of the card's "Done when"): met | not met | not verified
Mutation check: done | not done
Surprises / deferred: ...
Next card: T0y
```

## If you are stuck
Three failed gate attempts, a missing file the card names, or a card that contradicts the repo: stop, put the facts in STATE.md under "Blockers", and report. The person reviewing will fix the card.
