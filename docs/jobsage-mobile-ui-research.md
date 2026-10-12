# JOBSAGE mobile research

Checked 12 October 2026. This is initial research, not a finished parity or store-readiness claim.

## Skills and capabilities evaluated

- Selected: Expo and mobile-ui for platform support, safe areas, keyboard behaviour and native accessibility; react-vite for preserving the website; pnpm-workspace and package-management for dependency alignment; web-search for official policy evidence; design for substantial UI implementation; testing for critical authentication and deletion journeys.
- Artifact registration already exists. No duplicate app or backend is needed.
- Skill discovery returned Expo and mobile-ui as relevant existing capabilities.
- No external skill, remote install script, template, or tracking SDK was installed. External code with unknown permissions, licence, data transmission or maintenance is not justified.
- Public product videos are secondary references, not policy evidence or a source of proprietary assets. No third-party branding is to be copied.

## Sources and adopted principles

| Source | Application to JOBSAGE |
|---|---|
| [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) | Predictable navigation and clearly described destructive actions; retain the existing website's exact route labels and ordering. Detailed component guidance still needs verification. |
| [React Native accessibility](https://reactnative.dev/docs/accessibility) | Explicit labels and roles, accessible state, text scaling, focus management and error announcements. |
| [React Native WebView guide](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md) | Distinguish controlled first-party content from untrusted employer content. Use native file handling and history integration; postMessage is transport, not proof of trust. |
| [Expo SDK 54 SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/) | Store native session credentials in keystore/keychain. Remove legacy plaintext copies only after migration succeeds. Uninstall is not guaranteed to erase iOS keychain items. |
| [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion) | Easy-to-find in-app account deletion, reauthentication, explicit scope and completion timing. Deactivation or contacting support alone is not sufficient. |
| [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) | In-app deletion path plus a public external deletion resource, associated-data handling and clear retention exceptions. |
| [Google Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) | Include data collected by controlled JOBSAGE WebView code and SDKs. Do not call identifiable information anonymous. |

## Existing risks found

1. Native bearer credentials were persisted in AsyncStorage and the app trusted cached user/role data at startup. The credential foundation is being changed to SecureStore and server session validation.
2. The existing native app is a limited companion; rebuilding website screens separately would create divergent features and permission behaviour.
3. The render-test configuration referenced a missing setup file, used a partial native stub, and mixed SDK 57 Jest tooling with SDK 54.
4. Long profile forms, upload progress, external application links, logout, session expiry, nested scrolling and keyboard interaction need route-specific verification. These are not yet audited to completion.
5. Existing legal copy refers to JOBSAGE without identifying a confirmed legal operator. Minimum age, retention exceptions and backup timing cannot be invented.

## Implementation decisions

- Preserve the authoritative responsive website and its guards; implement the requested native workspace rather than duplicating role navigation.
- Avoid pull-to-refresh during editing; use explicit retry for network failures.
- Preserve form state on ordinary navigation. Validate inline and keep the primary action reachable above the keyboard.
- Native document selection must use system pickers; camera access is contextual and optional. No broad storage, location or accessibility-service permission for Smart Apply.
- First-party privileged bridge messages require strict origin, ownership, expiry and payload validation. Employer pages cannot request privileged actions or read credentials.
- Smart Apply starts from an authenticated tracked vacancy event, never from an arbitrary ref query. It must preserve candidate review and strict submission evidence.
- Use existing JOBSAGE tokens and copy. No new navigation names, reordering, decorative redesign, placeholder actions or dummy production data.
- Account deletion, privacy settings and native Smart Apply must support screen readers, large text, contrast, touch targets, reduced motion and keyboard-safe dialogs.

## Pending evidence

Full route/parity inventory, platform-specific uploads/downloads, role tests, secure session exchange, ATS fixtures, native permissions, device validation and final store policy mapping remain to be completed. No UI or store-readiness conclusion is implied by this document.
