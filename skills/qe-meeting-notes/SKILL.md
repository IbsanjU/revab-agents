---
name: qe-meeting-notes
description: Turn a QE meeting transcript or pasted notes into terse, cited notes - decisions, actions with owner role and due date, risks, open questions, scope changes. Use when the user shares a transcript, recording text or rough notes from a planning, sync, triage or sign-off meeting. Skip when the notes are already clean and the user only wants a document built from them.
---
# QE meeting notes

Meetings produce decisions that people later disagree about. These notes record what was actually said, by which role, where in the source, and what is still open.

## Steps
1. **Get the text.** Use a transcript or notes as given. If you only have a recording and no transcription tool is available here, ask for a pasted transcript; never summarize audio you cannot read. Say plainly when the text came from automatic transcription.
2. **Fix terms before writing.** Reuse the project glossary if one exists (`projects/<project>/glossary.md`), else ask for one. Transcripts garble names, IDs and acronyms: correct what the glossary settles, and put everything else in **Unverified terms**. Do not guess.
3. **Extract**, every item cited to its place in the source:
   - **Decisions** - what, and the role that stated it.
   - **Actions** - what, owner role, due date.
   - **Risks and dependencies.**
   - **Open questions** - with who should answer.
   - **Scope changes** - added, removed, moved.
   - **Dates** - check each against the holidays and absences you were given; if none were given, say the dates were not checked.
4. **Compare with earlier notes** on the same project, if any. A decision that replaces an earlier one is marked as superseding it, with a pointer. Never delete the earlier one.
5. **Write the notes** in the format below. Save only to a folder the user confirmed inside a manifest project (suggest `projects/<project>/notes/`); otherwise return the text.

## Citations (hard rule 9)
Cite each decision, action, risk and question with a form that can be opened: `transcript:<id>@HH:MM:SS` for a transcript (write `[12:04]` as `00:12:04`), or `path/to/notes.md:<line>` for pasted notes. If an item has no locatable source, mark it `uncited` and say why; do not invent a timestamp.

## Output
1. **Summary** - three lines at most.
2. **Decisions** - one line each, with role and citation.
3. **Actions** - table: action, owner role, due, source.
4. **Risks / dependencies** - one line each, with source.
5. **Open questions** - one line each, who should answer, source.
6. **Changes since last notes** - only if earlier notes exist.
7. **Unverified terms** - names, IDs or terms that may be transcription errors.

## Rules
- A decision is a decision only if someone with authority stated it. "We should probably" and "maybe" are open questions, and two people's remarks are never merged into one decision.
- Never invent an owner or a date. Write `owner TBC` or `date TBC`.
- Use the source's own wording and acronyms. Do not rename things.
- Phrases, not paragraphs. No filler.
- Roles, not personal names, unless the user asks for names.
- Leave out opinions about individuals. Record actions and risks only.
- Do not put secrets or personal data in the notes.
