# ADR 0002 - Distribution and PWA Retention

## Status

Accepted - 2026-06-21

## Context

Askewly Command now has a working cloud-mode path:

- Expo React Native mobile app with Google/Kakao OAuth.
- Supabase Auth/Postgres/RLS as the cloud source of truth.
- Electron desktop widget with legacy local mode and optional cloud schedule mode.
- Cross-device propagation and RLS isolation smoke have passed.

The project also still has a legacy PWA/M4/vault path. That path is valuable for
the original personal workflow, but it is not suitable as the default onboarding
path for third-party users because it depends on private infrastructure.

M7 must decide whether to keep the PWA, what the primary mobile surface is, and
what the next distribution path should be.

## Decision

Use the Expo React Native app as the primary mobile surface for cloud-mode
users.

Keep the PWA as a legacy/fallback surface for the existing M4/vault workflow.
Do not invest in the PWA as the primary third-party distribution channel.

Use this distribution ladder:

1. **Local Android debug/release APK** for operator smoke and rapid iteration.
2. **Android internal testing track or direct APK sharing** for the first small
   external testers.
3. **iOS TestFlight and Play Store/App Store work** only after a dedicated
   distribution automation milestone.

Keep the Electron desktop widget as a local desktop app for now. Desktop cloud
mode may use a manually supplied user JWT for smoke, but a production desktop
auth flow is a future milestone.

## Consequences

Positive:

- Third-party onboarding no longer depends on the author's M4/vault/PWA path.
- Native OAuth, mobile session persistence, and device smoke are the product
  path that gets active investment.
- PWA remains available as a low-risk fallback for the original personal setup.
- Store submission and installer work are not mixed into the auth/data/RLS
  milestone.

Tradeoffs:

- Release artifacts are still manual. Store automation, signing, and update
  policy are explicitly deferred.
- Desktop cloud mode still needs a better user auth flow before real
  third-party desktop distribution.
- Keeping PWA and native app in the repo means docs must clearly state which
  path is current for new users.

## Follow-Up

- Create a later milestone for App Store/TestFlight/Play Store distribution
  automation.
- Create a later milestone for desktop cloud sign-in instead of manual JWT
  configuration.
- Revisit PWA removal only after the native cloud path has stable external users.
