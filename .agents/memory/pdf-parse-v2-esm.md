---
name: pdf-parse v2 ESM class API
description: How to use pdf-parse v2.x in a vitest (ESM) context — it exports a class, not a function.
---

## Rule
In vitest's ESM context, `await import("pdf-parse")` resolves to the ESM build which exports `PDFParse` as a named class — not a bare function and not `.default`.

**How to use:**
```typescript
const { PDFParse } = await import("pdf-parse") as unknown as {
  PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
    getText(params?: Record<string, unknown>): Promise<{ text: string; total: number }>;
  };
};
const parser = new PDFParse({ data: buf });
const result = await parser.getText();
// result.text — extracted text; result.total — page count
```

`getText()` calls `load()` internally; there is **no `init()` method**.

**Production (tsx) path** uses the CJS build where `(await import("pdf-parse")).default` is the original parse function. That pattern continues to work in production routes.

**Why:** pdf-parse v2.x is a pure-ESM package (`"type": "module"` in package.json). Vitest resolves the ESM entry (`dist/pdf-parse/esm/index.js`) which re-exports the `PDFParse` class; tsx resolves the CJS entry (`dist/pdf-parse/cjs/index.cjs`) which wraps it in a default-export function. The two environments see different shapes.
