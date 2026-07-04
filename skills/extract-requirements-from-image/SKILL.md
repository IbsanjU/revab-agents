---
name: extract-requirements-from-image
description: Extract requirement text from an image attachment (screenshot, whiteboard photo, diagram) into a citable requirement fragment. Use when a Jira/Confluence attachment or manual upload is an image and its content is needed for a test plan.
---
# Extract requirements from image

## Current capability
No OCR MCP tool exists yet in this framework (`revab-agents` has no vision/OCR
capability wired up). Until one is added, this skill's role is to:
1. Download the attachment via `confluence_download_attachment` (or the equivalent
   Jira attachment path) and confirm the file is reachable.
2. If the calling agent/model has native image-reading capability, read the image
   directly and transcribe only what is visibly legible — never infer or guess text
   that isn't clearly readable.
3. If no image-reading capability is available, tell the user explicitly that OCR is
   not yet automated and ask them to paste the text manually, rather than fabricating
   content.

## Output format (once text is obtained)
Produce a requirement fragment record:
```
{ text, sourceType: "image", sourceId: "<attachment id/url>", location: "<page/coords if known>" }
```
Feed this into the researcher brief / test-planner input alongside Jira/Confluence
sources — it must carry the same citation weight, not be treated as lower-confidence
without saying so.

## Future work (not yet implemented)
Adding a dedicated OCR MCP tool (e.g. wrapping `tesseract.js`) is the recommended next
step so this skill can extract text automatically instead of relying on native vision
or manual transcription. Track this as a known gap in `knowledge/learnings.md` until
built.

## Rules
- Never invent or guess requirement text from an image you cannot clearly read.
- Always state explicitly which parts of the image were illegible/ambiguous.
