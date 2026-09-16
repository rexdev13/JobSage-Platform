---
name: Contact enrichment source order
description: Why stored vacancy and employer evidence must be harvested before paid contact discovery.
---

Contact enrichment must first scan current, non-dead stored vacancy content and matching persisted employer contacts. Only after that backlog is drained may paid official-website search run. Every accepted contact keeps its source and evidence, and existing sponsor contacts are never overwritten. Job-board vacancy rows may have null descriptions because parsers retain only listing-card fields, so ingest must extract from the fetched advert before shared persistence.

**Why:** Stored vacancy descriptions can already contain published recruitment addresses. Paying to rediscover those contacts wastes credits and can delay Send CV availability.

**How to apply:** Any future contact worker or scheduler change must preserve the database-only stage as stage zero, keep it fetch-free, and make paid search conditional on completion of the stored-data pass. At ingest, run the existing published-email extractor against full advert HTML/text before the upsert transaction, then persist only validated, evidence-backed emails with a COALESCE/no-overwrite write.