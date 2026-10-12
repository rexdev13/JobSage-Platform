---
name: Native reauthentication boundaries
description: Why a recent web/native session exchange is not recent user reauthentication for destructive actions.
---

A newly issued native or website-exchange capability must not satisfy the recent-reauthentication requirement for account erasure or similarly destructive actions by its issuance time alone.

**Why:** An already authenticated website session can exchange capabilities without asking the person to authenticate again. The resulting capability can be new while the underlying authentication is old.

**How to apply:** When implementing deletion or sensitive account controls, require explicit recent user verification or carry verified authentication age across the exchange. Do not substitute the new capability's creation time.
