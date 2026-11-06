---
name: extract-requirements-from-video
description: Extract requirement text from a video or audio recording (transcribed locally with faster-whisper) or an existing transcript into citable, timestamped requirement fragments. Use when a manual input, Confluence attachment, or recording contains spoken requirements. Skip when a transcript-equivalent already exists as plain text/Confluence content — read it directly instead of routing through this skill.
---
# Extract requirements from video / transcript

## How it works
1. **A recording is available** (audio or video file in the repo or the target project): call
   `transcribe_media` with `filePath` (and `project` for a target project). It returns timed
   segments and each carries a ready citation `transcript:<file>@HH:MM:SS`. Use a small model
   (`tiny`/`base`) for a first look and `small` or larger for the record; set `language` if you know it.
   Split the segments into requirement fragments:
   `{ text, sourceType: "video", sourceId: "<file>", location: "<HH:MM:SS>" }`.
2. **The tool says it is not set up** (`not-installed` or `python-not-found`): tell the user to run
   `revab whisper-setup` once (a private Python environment; the first run also downloads the model),
   and meanwhile ask for a transcript. Do not guess content from the file name.
3. **A transcript already exists** (text file, Confluence page, meeting notes): read it directly
   instead; do not transcribe again.
4. **Quality checks.** Low `languageProbability`, a very short transcript for a long recording, or
   repeated phrases usually mean wrong language, silence or noise: say so, and retry with `language`
   set or a larger model before reporting. Names, numbers and product terms are the usual
   mistakes: flag them for confirmation instead of treating them as certain.
5. Never invent dialogue, UI steps, or requirements that are not in the transcript actually reviewed.

On-screen content (slides, UI shown but not spoken) is **not** captured: frame sampling is not
implemented. Say so when a requirement depends on something shown rather than said.

## Output
Same requirement-fragment shape as other extraction skills, feeding the same
researcher brief / test-planner input, each with a timestamp citation.

## Not yet implemented
Periodic frame sampling for on-screen text. Track it as a known gap in `knowledge/learnings.md`.

## Rules
- Every fragment must cite a timestamp/location in the source video or transcript.
- Flag unclear or inaudible sections explicitly rather than filling gaps with guesses.
