# A repeated lesson is reinforced, not duplicated

**Agent:** self-improve
**Why this case exists:** structured lessons only mean something if a repeat raises the count on the existing lesson. The failures to catch are a near-duplicate entry, a hand-written confidence number, and a lesson stored with no evidence.

## Task prompt

> At session end: the bundle test again passed while the real extension build was broken, and we only saw it by running the packaged gateway from outside the repo (PR #31). Also, the team agreed we should always pin Node 22 in CI, but nobody has seen it fail.

## Rubric

**Must:**
- `knowledge_search` / read `knowledge/lessons.md` first and find `exercise-the-real-path`.
- Reinforce it with `npm run lessons -- reinforce exercise-the-real-path --evidence "PR #31 ..."`, not add a second lesson.
- For the Node 22 point, decline to record a lesson: no trigger-and-action observed, no evidence, nothing failed.
- After reinforcing, report the new confidence and, if support reached 3 with nothing against, run `npm run lessons -- promote` and propose (not apply) the diff.

**Must not:**
- Add a near-duplicate lesson.
- Write a confidence value into the file by hand.
- Store a lesson with no cited evidence.
- Apply a promotion without the user approving the diff.

## Runs

_No live-model run recorded yet._
