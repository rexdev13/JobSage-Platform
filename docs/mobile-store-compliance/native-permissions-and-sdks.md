# Native permissions and SDK inventory

Status: **least-privilege source cleanup applied; resolved iOS/Android manifests and device prompts remain unverified.**

## Current source evidence

- No direct mobile source imports of `expo-location` or `expo-image-picker` were found. Both packages were removed from the mobile artifact and lockfile after inspecting their Android manifests: location carried location permissions, and image picker carried camera and legacy storage permissions.
- `expo-document-picker` remains as a declared module; its runtime use and exact behavior must be confirmed against the mobile source/build. Native WebView file chooser behavior is device/OS-owned and has not been physically tested.
- `expo-file-system` and `expo-sharing` are used to download and share generated files. They must be tested for cache cleanup, app sandbox boundaries, sheet hand-off and error/cancel states.
- No explicit native request was found for location, camera, contacts, calendar-event access, or notification permission. Google Calendar access is a first-party, optional marketer workflow using OAuth in the web product; it is not an iOS/Android contacts/calendar permission.
- The API has a push-token model, but the mobile artifact does not yet register for push or prompt for notification permission.
- No generated `ios/` or `android/` project, signed archive/APK/AAB, or app-owned `PrivacyInfo.xcprivacy` was inspected. Package removal reduces manifest-merging risk but does not prove the final manifest contains no such permissions.

## Release permission matrix

| Capability | Shipped-source status | Required before permission/API use |
|---|---|---|
| Location | No feature use found; unused native module removed | Do not add unless a specific feature needs it; explain purpose before asking and keep manual region entry available. |
| Camera | No direct Expo camera/ImagePicker feature | If identity/photo capture is shipped, add a user-initiated flow, precise pre-prompt explanation, denial/cancel fallback, privacy disclosures and device tests. |
| Photos / document chooser | File/document paths exist; native WebView picker not accepted on devices | Limit selection to user-chosen documents; test iOS/Android file and camera chooser behavior, MIME/size limits, cancellation, sandbox copies, upload progress and removal. |
| Contacts | No feature use found | Keep undeclared/unrequested. |
| Calendar event permission | No native OS calendar API found; marketer scheduling uses Google OAuth in the web app | Keep server integration scopes separate; test role restriction and OAuth revocation. |
| Notifications | Registration and OS prompt flow not implemented/verified | Keep permission unrequested until value explanation, opt-in, token revocation and account-deletion cleanup are complete. |
| Filesystem / share sheet | Used for candidate-generated file downloads | Test private cache, cleanup on logout/account change, temporary share copy, offline/error states and access after deletion. |

## Build evidence needed

1. Run Expo prebuild/EAS build only after owner-approved app identifiers and signing setup are supplied.
2. Review the resolved iOS `Info.plist`, merged Android manifest, package/SDK inventory, Apple privacy manifests and required-reason API declarations.
3. On physical iOS and Android devices, capture the first-use sequence, system prompt text, denial/revocation behavior and data flow for each capability.
4. Reconcile actual permissions and SDK collection with [`apple-privacy-labels.md`](apple-privacy-labels.md), [`google-data-safety.md`](google-data-safety.md) and store-console disclosures.

Do not describe package/config inspection as permission-prompt or device acceptance evidence.
