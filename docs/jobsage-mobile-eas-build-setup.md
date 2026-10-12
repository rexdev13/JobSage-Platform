# JOBSAGE EAS build profiles

Status: **profiles prepared; builds not run.** The existing app identity has no owner-approved iOS bundle identifier, Android application ID, or EAS project/account link. They are deliberately not guessed. The configured production website origin is also required at build time as `EXPO_PUBLIC_DOMAIN`; obtain the approved value through the deployment/owner process, not by substituting a development host.

## Profiles

`artifacts/jobsage-mobile/eas.json` defines:

- `development`: signed internal development client.
- `preview`: internal builds; Android output is an installable APK; iOS uses internal device distribution.
- `production`: Android App Bundle and iOS store-distribution configuration; production build numbers auto-increment locally.
- `submit.production`: deliberately empty; there are no store credentials or submission identifiers in source.

`artifacts/jobsage-mobile/app.json` keeps the existing version `1.0.0` and starts the local iOS build number and Android version code at `1`. Do not run a production build until the owner-approved bundle/package IDs, EAS project/account, Apple signing access, and production `EXPO_PUBLIC_DOMAIN` are configured. A build command may prompt for a missing identifier; do not accept a generated/default identifier.

## Commands after owner setup

Run from `artifacts/jobsage-mobile` on Windows PowerShell or another supported host with the EAS CLI authenticated to the approved project:

```powershell
eas build --profile development --platform android
eas build --profile preview --platform android
eas build --profile preview --platform ios
eas build --profile production --platform android
eas build --profile production --platform ios
```

These build commands do not submit an app. No `eas submit` command is authorized here. For production builds, review local version-code changes after EAS increments them and preserve unrelated working-tree changes.

The Expo documentation describes build profiles and platform-specific outputs at [Configure EAS Build with eas.json](https://docs.expo.dev/build/eas-json) and app identity at [Build configuration process](https://docs.expo.dev/build-reference/build-configuration). The current configuration has only been parsed as JSON and through Expo's public config command; no EAS CLI schema validation, native prebuild, cloud build, signing or physical-device installation has been performed.
