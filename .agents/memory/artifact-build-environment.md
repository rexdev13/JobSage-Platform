---
name: Artifact build environment
description: Per-artifact build variables are injected by managed workflows, not by the root recursive build.
---

Vite artifacts can require distinct `PORT` and `BASE_PATH` values. A root recursive build cannot correctly supply one shared `BASE_PATH` to every artifact, so a bare aggregate build may fail before the app build itself is evaluated.

**Why:** The missing-variable failures were resolved by building each artifact with its own configured values; the resulting API, web, mockup, extension, and mobile builds passed.

**How to apply:** When validating multiple artifacts outside their managed workflows, read each artifact's configured environment and run its build with those values. Do not treat an aggregate wrapper's missing environment as an application-code failure, and do not share one artifact's base path with another.
