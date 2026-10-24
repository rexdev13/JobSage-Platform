---
name: Candidate navigation screens
description: UX rule for candidate tools that are selected from the persistent sidebar.
---

**Rule:** When candidates select CV Enhancement from navigation, open a full workspace page rather than a modal or slide-over. Keep it as a route so the normal active sidebar state identifies the current section.

**Why:** The user requested a full-screen experience consistent with other workspace pages and an active red sidebar item while CV Enhancement is selected.

**How to apply:** For future navigation-driven candidate tools where persistent active navigation matters, render the destination within `AppLayout`, use a real route link, and keep candidate-only access. Point other entry buttons, such as the Documents page CTA, to the same route.
