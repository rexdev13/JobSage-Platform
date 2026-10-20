---
name: Expo notification web loading
description: Keep Expo Notifications out of web previews without breaking native component tests
---

Static imports of `expo-notifications` are evaluated before a `Platform.OS` guard, so guarded calls alone do not prevent the package's web implementation from running. Its browser build can emit push-token-listener warnings even when native-only effects are skipped.

A component-level dynamic import avoided eager web loading but bypassed this repository's React Native Jest module mock and caused push-registration tests to fail.

**Why:** the browser preview needs the native notification package excluded at module load, while tests and native registration behavior need a predictable mocked component import.

**How to apply:** prefer Expo platform-specific modules for UI components. If a root bootstrap must load notification handling lazily, guard that import by platform there; keep the tested push component's import predictable. Verify both browser console output and native component tests.

Stock Expo Go needs a separate execution-environment guard, not just a native-platform check: remote push is unavailable there even though the OS is Android or iOS. Gate module evaluation itself, including root notification handlers, while retaining push in installed development and production builds.

**Why:** importing the remote-push module during Expo Go startup can emit unsupported-functionality errors before any candidate opts in. Checking permissions later cannot prevent module initialization.

**How to apply:** a shared synchronous guarded loader with type-only notification imports keeps Expo Go and web from evaluating the package, while conditional `require` preserves Jest's native notification mock. Verify the unavailable-runtime branch never evaluates the module and retain installed-build registration tests.
