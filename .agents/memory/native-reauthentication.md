---
name: Native reauthentication boundaries
description: Why a recent web/native session exchange is not recent user reauthentication for destructive actions.
---

A newly issued native or website-exchange capability must not satisfy the recent-reauthentication requirement for account erasure or similarly destructive actions by its issuance time alone.

**Why:** An already authenticated website session can exchange capabilities without asking the person to authenticate again. The resulting capability can be new while the underlying authentication is old.

**How to apply:** When implementing deletion or sensitive account controls, require explicit recent user verification or carry verified authentication age across the exchange. Do not substitute the new capability's creation time.

Email-code proofs created for personal-data access or export are purpose-scoped, short-lived, single-use, and bound to the verified account and current authentication session. They must never authorize account deletion or another destructive action; those actions require their own approved reauthentication flow.

**Why:** A proof for reading or exporting data does not establish the user's intent to erase an account, and reusing it would collapse distinct authorization boundaries.

**How to apply:** Keep privacy-access proofs restricted to their declared purpose. Do not add deletion as an accepted purpose or reuse the same proof token for destructive endpoints.
