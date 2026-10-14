# Native permissions and SDK inventory

Status: **least-privilege source cleanup applied; resolved iOS/Android manifests and device prompts remain unverified.**

## Current source evidence

- No direct mobile source imports of `expo-location` or `expo-image-picker` were found. Both packages were removed from the mobile artifact and lockfile after inspecting their Android manifests: location carried location permissions, and image picker carried camera and legacy storage permissions.
- The native Documents route uses `expo-document-picker`, validates its allowlist and size limit, copies selected content to app-owned cache, and uploads through the authenticated API client. Employer ATS file-picker behavior inside WebView remains device/OS-owned and unverified.
- `expo-file-system` and `expo-sharing` support private downloads and sharing. iOS PDF preview uses a local WebView; Android opens the system share sheet. Temporary document staging and individual preview cleanup have synthetic coverage, not device evidence.
- No native request was found for location, camera, contacts, or calendar-event access. Notification permission is requested only after the candidate explicitly enables notifications. Google Calendar access is a first-party, optional marketer workflow using OAuth in the web product; it is not an iOS/Android contacts/calendar permission.
- Native push registration and the server delivery/receipt pipeline are implemented in source. Real OS token registration, provider delivery, and receipt handling remain unverified on devices.
- No generated `ios/` or `android/` project, signed archive/APK/AAB, or app-owned `PrivacyInfo.xcprivacy` was inspected. Package removal reduces manifest-merging risk but does not prove the final manifest contains no such permissions.

## Release permission matrix

| Capability | Shipped-source status | Required before permission/API use |
|---|---|---|
| Location | No feature use found; unused native module removed | Do not add unless a specific feature needs it; explain purpose before asking and keep manual region entry available. |
| Camera | No camera capture is shipped; the document picker can select user-owned image files without requesting camera permission | Keep camera access absent unless a defined identity/photo flow requires it; then add a user-initiated, explained permission request, denial/cancel fallback, privacy disclosure and device tests. |
| Photos / document chooser | Native candidate document picker, private staged upload, offline retry, cancel/background handling and XHR transfer progress are implemented | Verify iOS/Android chooser behavior and employer ATS WebView file input, file type/size enforcement, cancellation, cache cleanup, progress, PDF preview and removal on devices. |
| Contacts | No feature use found | Keep undeclared/unrequested. |
| Calendar event permission | No native OS calendar API found; marketer scheduling uses Google OAuth in the web app | Keep server integration scopes separate; test role restriction and OAuth revocation. |
| Notifications | Explicit opt-in, permission-denial/settings path, account-bound token registration/revocation, and server delivery/receipt source are implemented | Verify permission denial/revocation, token lifecycle, provider delivery and receipts on physical devices; preserve the disabled account-deletion gate. |
| Filesystem / share sheet | First-party private downloads, iOS PDF preview, Android share sheet, and owner-scoped temporary cleanup are implemented | Verify app sandbox boundaries, share-sheet hand-off, PDF viewing, logout/account change cleanup, offline/error states and access after deletion on devices. |

## Build evidence needed

1. Run Expo prebuild/EAS build only after owner-approved app identifiers and signing setup are supplied.
2. Review the resolved iOS `Info.plist`, merged Android manifest, package/SDK inventory, Apple privacy manifests and required-reason API declarations.
3. On physical iOS and Android devices, capture the first-use sequence, system prompt text, denial/revocation behavior and data flow for each capability.
4. Reconcile actual permissions and SDK collection with [`apple-privacy-labels.md`](apple-privacy-labels.md), [`google-data-safety.md`](google-data-safety.md) and store-console disclosures.

Do not describe package/config inspection as permission-prompt or device acceptance evidence.
