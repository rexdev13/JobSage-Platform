---
name: Expo notification web loading
description: Keep Expo Notifications out of web previews without breaking native component tests
---

Static imports of `expo-notifications` are evaluated before a `Platform.OS` guard, so guarded calls alone do not prevent the package's web implementation from running. Its browser build can emit push-token-listener warnings even when native-only effects are skipped.

A component-level dynamic import avoided eager web loading but bypassed this repository's React Native Jest module mock and caused push-registration tests to fail.

**Why:** the browser preview needs the native notification package excluded at module load, while tests and native registration behavior need a predictable mocked component import.

**How to apply:** prefer Expo platform-specific modules for UI components. If a root bootstrap must load notification handling lazily, guard that import by platform there; keep the tested push component's import predictable. Verify both browser console output and native component tests.
