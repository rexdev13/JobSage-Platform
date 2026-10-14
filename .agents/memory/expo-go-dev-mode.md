---
name: Expo Go dev mode
description: Keep Replit's mobile preview on stock Expo Go when the project retains a development-client dependency.
---

When the Replit preview must open in stock Expo Go but the project retains `expo-dev-client` for its existing EAS profile, keep the dependency and EAS settings intact and add Expo CLI's `--go` flag to the managed dev command. Confirm the workflow says it is using Expo Go and emits an `exp://` URL.

**Why:** Expo CLI otherwise selected a development-client QR for this project, even after its SDK matched the installed Expo Go runtime.

**How to apply:** Use this for Expo Go preview workflows that also preserve a custom development-client profile; do not remove the package solely to change the QR target.
