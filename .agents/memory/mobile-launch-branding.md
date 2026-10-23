---
name: Mobile launch branding
description: Owner feedback distinguishing native app icon and loading treatment from the approved company wordmark.
---

Do not invent or substitute a new JOBSAGE logo for the mobile launcher. Preserve the pre-existing J app mark and supplied full company wordmark/tagline. The in-app startup screen must not return to a near-black typed-JOBSAGE-and-spinner treatment.

**Why:** The owner objected that the newly introduced briefcase/ascending-arrow symbol had not been authorized as a new logo. Approval of the existing company wordmark does not authorize inventing a replacement brand mark.

**How to apply:** Reuse only approved JOBSAGE artwork for native icon and launch assets. Separate OS launch screens from the in-app network-loading state. Expo Go cannot establish the appearance of installed native icons or release splash screens; report native-build verification limits explicitly.

Prioritize an entirely visible full lockup over equal native logo widths across platforms. Android may require a smaller logo than iOS.

**Why:** Android's system splash uses an icon canvas and safe-circle mask even with `contain`; increasing the image width can crop a wide logo before React mounts.

**How to apply:** Check the installed Expo plugin's native canvas and Android safe region when sizing splash artwork. Match the in-app handoff to each platform's native size rather than enlarging the Android native image.
