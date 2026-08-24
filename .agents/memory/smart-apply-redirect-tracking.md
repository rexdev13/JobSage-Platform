---
name: Smart Apply redirect tracking
description: Preserve one application record when employer sites redirect to a confirmation page.
---

For JOBSAGE-originated external applications, the original outbound URL is the
application tracker identity. The extension must retain it across ATS redirects
and use it when confirming or manually logging an application.

**Why:** Employer confirmation pages commonly have a different URL and generic
success-page text. Matching on the confirmation URL creates a duplicate record
or replaces the vacancy title and employer captured at the JOBSAGE click.

**How to apply:** Keep first-party role, title, and employer metadata
authoritative. Map `pageUrl` to the application URL only for standalone
extension usage that has no originating JOBSAGE click. Any retry protection
must serialize work by candidate and original URL. Retain a tab's originating
URL only for a bounded redirect or form-submission flow; clear it on ordinary
cross-site navigation and expiry so later browsing cannot confirm a stale role.