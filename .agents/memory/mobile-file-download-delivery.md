---
name: Mobile file download delivery
description: Deliver downloadable files when Replit's static asset preview blocks downloads on mobile.
---

Do not rely on a static HTML asset preview for mobile downloads; its preview frame can block browser downloads even when the page has a working download button. For a one-off private file, use a short-lived signed GET URL from private object storage with `Content-Disposition: attachment`; do not place importer data in an unconditional public-object path.

**Why:** the mobile preview explicitly reported that it could not download files, so the embedded download page was not a usable delivery path.

**How to apply:** provide a direct URL that the phone's browser can open outside the preview. Verify the response status, attachment header, byte count, and file hash; tell the user when the signed link expires.