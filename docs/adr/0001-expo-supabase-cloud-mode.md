# ADR 0001: Expo + Supabase Cloud Mode

Date: 2026-06-21

## Status

Accepted for planning. Implementation is blocked until required credentials are issued.

## Context

Askewly Command began as a personal Electron widget backed by local schedule files, M4 vault sync, and a mobile PWA. The next product goal is to let third-party users use the same experience from a native mobile app and a PC widget without owning the author's vault/M4 setup.

The mobile stack decision must support:

- Google and Kakao login.
- Native mobile UX beyond the current PWA.
- Shared product logic with the existing JavaScript/Electron codebase.
- A cloud source of truth with per-user isolation.
- A migration path that does not break the current personal legacy workflow.

## Decision

Use Expo React Native for the native mobile app and Supabase for auth and cloud data.

- Mobile app: Expo React Native.
- Auth: Supabase Auth with Google and Kakao OAuth.
- Cloud database: Supabase Postgres with RLS.
- PC widget: existing Electron app gains a cloud mode.
- Legacy mode: existing M4/vault/PWA sync remains available for the personal workflow.

## Rationale

Expo keeps the mobile implementation in the JavaScript/TypeScript ecosystem already used by Electron and the PWA. It also provides standard mobile app build/update tooling and OAuth/deep-link primitives such as redirect URI generation.

Supabase provides OAuth provider integration, React Native auth guidance, Postgres storage, and RLS. It is a good fit for the product's first cloud source of truth because the core data model is relational and user/workspace isolation is required from the beginning.

Flutter was considered. It has strong mobile UI quality and performance, but it introduces Dart and makes shared logic with the existing JavaScript/Electron surfaces more expensive. Capacitor was considered as a fast PWA wrapper, but it does not sufficiently improve the native UX target.

## Consequences

- The repo will likely add `mobile/`, `shared/`, and `supabase/` directories.
- OAuth work must be tested in real development builds, not only in a browser/PWA context.
- RLS policies become a release blocker for cloud mode.
- The project now has two supported data paths during migration: legacy local/vault mode and cloud Supabase mode.

## Credential Requirements

Do not commit secret values.

- Supabase project URL and anon key.
- Supabase service role key for admin/migration workflows only.
- Google OAuth credentials for web/iOS/Android redirect surfaces.
- Kakao REST API key and client secret.
- Native app scheme and redirect URI allowlist entries.

## References

- Supabase React Native Auth docs: https://supabase.com/docs/guides/auth/quickstarts/react-native
- Supabase Google login docs: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase Kakao login docs: https://supabase.com/docs/guides/auth/social-login/auth-kakao
- Expo AuthSession redirect URI docs: https://docs.expo.dev/
