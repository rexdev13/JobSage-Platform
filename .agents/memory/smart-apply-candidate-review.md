---
name: Smart Apply candidate review
description: Product rules for candidate confirmation of AI application drafts and CV-extracted profile fields.
---

Non-empty AI-generated or restored application answers must receive an explicit candidate confirmation before submission; edits invalidate that confirmation, and model confidence or `needsReview` flags cannot waive it. Every retained AI-generated factual sentence must be matched server-side to a candidate-profile or CV phrase and show that source; unsupported sentences stay blank. Leave answers blank when the profile has no structured source for the requested personal detail. CV extraction must be explicitly confirmed before saving, and first-time profiles must not silently fill required candidate facts with defaults.

**Why:** The benchmark found unsupported claims even when models reported high confidence, and hidden CV bootstrap defaults could record unreviewed profile facts. A visible source link improves traceability but does not establish truth or replace the candidate's confirmation.

**How to apply:** Preserve the confirmation gate across Smart Apply, assisted application, and CV-to-profile flows. Treat a new or restored draft as unconfirmed, and require user-entered values where the profile schema has required facts but extraction has none. Never treat model confidence or a model-supplied citation as evidence.

For the Professional Strengths profile field, candidates may request an AI-written draft from their own CV, review exact supporting CV excerpts, and edit or add their own text before saving. Never generate from a different candidate's CV or save an AI draft automatically.

**Why:** The product owner explicitly requires strengths to be written by AI from the candidate's CV while preserving room for the candidate's own additions and review.

**How to apply:** Keep CV generation an explicit action, enforce ownership and source grounding server-side, show evidence before the candidate adopts the draft, and keep the editable profile field as the final saved source.
