---
name: extract-requirements-from-image
description: Extract requirement text from an image attachment (screenshot, whiteboard photo, diagram) into a citable requirement fragment. Use when a Jira/Confluence attachment or manual upload is an image and its content is needed for a test plan. Skip for born-digital text documents (Confluence pages, text-layer PDFs, DOCX) — use `confluence_get_page`/`read_pdf_text`/`read_docx_text` directly instead of OCR.
---
# Extract requirements from image

## Playbook
1. Download the attachment via `confluence_download_attachment` (or the equivalent
   Jira attachment path) and confirm the file is reachable.
2. **Structured diagrams first**: if the file is a draw.io/diagrams.net XML export
   (`.drawio`/`.xml`) or contains Mermaid/PlantUML source, use the media server's
   `read_diagram` tool — it returns a machine-readable `{ nodes, edges }` graph that
   is the preferred citation source (exact labels, no transcription risk).
3. **Raster images**: run the media server's `ocr_image` tool (local tesseract; no
   data leaves the machine). Prefer its block output — each block carries a bounding
   box and a confidence score, so headings/labels can be told apart from body text.
   Discard or flag blocks with low confidence; never "fix up" garbled OCR by guessing.
4. **Scanned PDFs**: if the attachment is an image-only PDF, use `ocr_pdf` (per-page
   OCR) instead of `read_pdf_text`.
5. Cross-check with native vision if available: when the calling model can read the
   image directly, use it to *verify* the OCR/diagram output, not to replace it —
   the tool output is the citation source.
6. For raster flowcharts/diagrams (no parseable structure), combine `ocr_image` block
   output with visual layout interpretation and mark the result explicitly as
   **best-effort, needs human confirmation**.

## Output format
Produce a requirement fragment record:
```
{ text, sourceType: "image", sourceId: "<attachment id/url>", location: "<page/coords or ocr block bbox>" }
```
For diagrams, `text` may be a node/edge summary (e.g. "Login page --submit--> Validation").
Feed this into the researcher brief / test-planner input alongside Jira/Confluence
sources — it must carry the same citation weight, not be treated as lower-confidence
without saying so.

## Rules
- Never invent or guess requirement text from an image you cannot clearly read.
- Always state explicitly which parts of the image were illegible/ambiguous (include
  the OCR confidence for anything borderline).
- Raster-diagram interpretations are best-effort: get user confirmation before any
  generated test case cites them.
