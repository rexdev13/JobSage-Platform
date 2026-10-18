---
name: Publish foreign-key prerequisites
description: Handle publish diffs that add foreign keys before their missing referenced unique keys.
---

When a publish diff adds a foreign key and its referenced composite unique key is also absent from production, inspect statement order rather than assuming the diff will create the prerequisite first. This project's diff places the foreign key additions before the new unique constraint, so a one-pass migration fails even when development has the key.

**Why:** PostgreSQL rejects a foreign key unless the target columns already have a matching unique or primary key at the moment the foreign key is added.

**How to apply:** Keep the supporting key in the schema source and development database. If Publish orders it after dependent foreign keys, stage the change through normal publishing: first publish the key without those foreign keys, then restore the foreign keys in development and publish again after the key exists in production. Never work around this with direct production DDL or deployment-time migration code.
