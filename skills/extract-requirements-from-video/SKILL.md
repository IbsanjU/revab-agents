---
name: extract-requirements-from-video
description: Extract requirement text from a video or its transcript into citable, timestamped requirement fragments. Use when a manual input, Confluence attachment, or recording contains spoken/demonstrated requirements. Skip when a transcript-equivalent already exists as plain text/Confluence content — read it directly instead of routing through this skill.
---
# Extract requirements from video / transcript

## Current capability
No speech-to-text or frame-extraction MCP tool exists yet in this framework. This
skill's role today is to work from a **transcript the user already has** (or one
produced by an external tool outside this framework):
1. If a transcript file/text is provided, split it into requirement fragments, each
   tagged with its timestamp: `{ text, sourceType: "video", sourceId: "<video id/url>", location: "<mm:ss>" }`.
2. If only a raw video file is provided and no transcript exists, tell the user
   explicitly that automatic transcription is not yet wired up, and ask them to supply
   a transcript (or timestamps + key points) rather than guessing content from the
   file name or metadata alone.
3. Never invent dialogue, UI steps, or requirements that aren't present in the
   transcript text actually reviewed.

## Output
Same requirement-fragment shape as other extraction skills, feeding the same
researcher brief / test-planner input, each with a timestamp citation.

## Future work (not yet implemented)
A dedicated MCP tool wrapping a speech-to-text CLI (e.g. Whisper) plus periodic frame
sampling for on-screen text would let this skill work directly from raw video. Track
as a known gap in `knowledge/learnings.md` until built.

## Rules
- Every fragment must cite a timestamp/location in the source video or transcript.
- Flag unclear or inaudible sections explicitly rather than filling gaps with guesses.
