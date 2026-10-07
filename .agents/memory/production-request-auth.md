---
name: In-process production request authentication
description: Keep secrets out of command-line arguments when making authenticated production API requests from the workspace.
---

Send authenticated production requests through an in-process client that reads the secret from the environment and attaches it in memory. Log only status and bounded response metrics; do not enable shell tracing or print process command lines.

**Why:** Command-line arguments can expose secret headers in process listings and diagnostic output, even when the environment value itself is never echoed.

**How to apply:** For one-off internal production endpoints, use a small Python or Node HTTP client reading the Replit secret from its process environment. Avoid shell-expanded `curl -H` authorization arguments.
