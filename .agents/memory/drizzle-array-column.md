---
name: Drizzle array column insert type issue
description: text("col").array() columns in drizzle-orm require explicit any cast in .values() and .set() because drizzle TypeScript types don't properly narrow PgArray insert types.
---

# Drizzle array column insert/update type issue

## The rule
When inserting or updating a `text("col").array()` column in drizzle-orm, you must cast the value with `as any` in both `.values({})` and `.set({})` calls.

```typescript
// WRONG — TypeScript error TS2322: string[] not assignable to string | SQL | null
.values({ languages: d.languages ?? null })

// CORRECT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
.values({ languages: (d.languages ?? null) as any })
```

**Why:** drizzle-orm's TypeScript overloads for `.values()` and `.set()` infer the column insert type as the base element type (`string | SQL | null | undefined`) rather than the array type (`string[] | SQL | null | undefined`). This is a known gap in drizzle's type system. The runtime behavior is correct — drizzle serializes `string[]` to PostgreSQL array format based on the column definition.

**How to apply:** Any time you add a `.array()` column to a drizzle schema and need to INSERT or UPDATE it, add the `as any` cast. SELECT types work fine without casts.

Also: changing a PostgreSQL column from `text` to `text[]` requires a manual SQL migration with USING clause — drizzle-kit push will fail without it:
```sql
ALTER TABLE profiles ALTER COLUMN languages TYPE text[]
  USING CASE WHEN languages IS NULL THEN NULL ELSE ARRAY[languages] END;
```
