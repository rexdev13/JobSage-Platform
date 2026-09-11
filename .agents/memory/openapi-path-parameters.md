---
name: OpenAPI path parameters
description: Constraint for keeping generated API clients aligned with parameterized routes.
---

OpenAPI path parameters must be declared in the path key itself, for example `/applications/{id}`. Declaring an `id` parameter under a non-parameterized `/applications` operation can generate a client for the wrong URL or attach the operation to an unrelated path.

**Why:** The generator uses the path template, not only the operation's parameter list, to build request URLs and mutation inputs.

**How to apply:** When adding a parameterized endpoint, verify the generated URL helper and mutation signature immediately after code generation, then run code generation a second time to confirm idempotence.