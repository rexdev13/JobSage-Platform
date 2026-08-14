---
name: pdf-parse v2 class API — all runtimes
description: pdf-parse v2.x exports PDFParse as a named class in every runtime. The old .default function pattern is broken everywhere.
---

## Rule
In **every** runtime (vitest ESM, tsx dev, Node CJS via `createRequire`), pdf-parse v2.x exports
`PDFParse` as a **named class** — not a bare function and not `.default`.

The old pattern `(await import("pdf-parse")).default` and `require("pdf-parse")` both return
`undefined` or the module object, **never** the parse function. Calling them throws
`TypeError: pdfParse is not a function`.

**Correct pattern — dynamic import (ESM / tsx routes):**
```typescript
const { PDFParse } = (await import("pdf-parse")) as unknown as {
  PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
    getText(): Promise<{ text: string; total: number }>;
  };
};
const parsed = await new PDFParse({ data: buf }).getText();
const text = parsed.text.trim();
```

**Correct pattern — createRequire (CJS files like cvParser.ts):**
```typescript
const { PDFParse } = require("pdf-parse") as {
  PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
    getText(): Promise<{ text: string }>;
  };
};
const parsed = await new PDFParse({ data: buffer }).getText();
```

`getText()` calls `load()` internally — **no separate `init()` method exists**.

**Why:** pdf-parse v2.x is a pure-ESM package (`"type": "module"`). Both its ESM and CJS
builds export `PDFParse` as a named class member. The v1.x default-function export no longer
exists. This broke 4 call sites simultaneously: `cvEnhancement.ts`, `coverLetter.ts`,
`speculativeApplications.ts`, and `cvParser.ts`.

**Also note:** pdfkit's `characterSpacing` option causes pdf-parse to extract text with spaces
between every letter (`P R O F E S S I O N A L`). Do not use `characterSpacing` on text
that needs to be machine-readable after PDF round-trip.
