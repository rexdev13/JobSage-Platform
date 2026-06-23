---
name: GCS File download pattern
description: How to read file content from object storage in the API server
---

The `getObjectEntityFile()` method returns a GCS `File` object (from `@google-cloud/storage`), NOT a browser `File` — it does not have `.arrayBuffer()` or `.text()` methods.

**Correct pattern:**
```ts
const gcsFile = await storage.getObjectEntityFile(storageKey);
const response = await storage.downloadObject(gcsFile); // returns a standard fetch Response
const buffer = Buffer.from(await response.arrayBuffer());
const base64 = buffer.toString("base64");
```

**Why:** The GCS File is a cloud storage reference object. `downloadObject()` streams it to a `Response` which is a standard Fetch API Response with `.arrayBuffer()`, `.text()`, etc.

**How to apply:** Any route that needs to read raw file bytes (e.g. for AI vision, PDF parsing, base64 encoding) must go through `downloadObject()` first.
