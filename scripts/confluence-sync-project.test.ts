import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldDownloadAttachment } from "./confluence-sync-project.js";

test("shouldDownloadAttachment allows when no filters are set", () => {
  const result = shouldDownloadAttachment(
    { id: "1", title: "sample.pdf", mediaType: "application/pdf", sizeBytes: 1234 },
    {
      attachmentMediaTypes: new Set<string>(),
      attachmentExtensions: new Set<string>(),
    }
  );
  assert.equal(result.allowed, true);
});

test("shouldDownloadAttachment blocks by max size", () => {
  const result = shouldDownloadAttachment(
    { id: "1", title: "big.pdf", mediaType: "application/pdf", sizeBytes: 2000 },
    {
      maxAttachmentBytes: 1500,
      attachmentMediaTypes: new Set<string>(),
      attachmentExtensions: new Set<string>(),
    }
  );
  assert.equal(result.allowed, false);
  assert.match(result.reason, /size_above_max/);
});

test("shouldDownloadAttachment blocks by media type filter", () => {
  const result = shouldDownloadAttachment(
    { id: "1", title: "sample.png", mediaType: "image/png", sizeBytes: 1000 },
    {
      attachmentMediaTypes: new Set<string>(["application/pdf"]),
      attachmentExtensions: new Set<string>(),
    }
  );
  assert.equal(result.allowed, false);
  assert.match(result.reason, /media_type_filtered/);
});

test("shouldDownloadAttachment blocks by extension filter", () => {
  const result = shouldDownloadAttachment(
    { id: "1", title: "sample.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 1000 },
    {
      attachmentMediaTypes: new Set<string>(),
      attachmentExtensions: new Set<string>([".pdf"]),
    }
  );
  assert.equal(result.allowed, false);
  assert.match(result.reason, /extension_filtered/);
});
