# Credential Checklist

Never commit real credential values. Store local values in `.env.local` or the
relevant provider console. This checklist records what must exist, where it is
used, and how to verify it.

## Supabase

Required:

- `SUPABASE_URL`
  - Used by desktop cloud provider and verification scripts.
  - Store in `.env.local`.
- `SUPABASE_ANON_KEY`
  - Used by mobile app, desktop cloud provider, and verification scripts.
  - Store in `.env.local`.
- `EXPO_PUBLIC_SUPABASE_URL`
  - Used by Expo mobile bundle.
  - Store in `.env.local`.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - Used by Expo mobile bundle.
  - Store in `.env.local`.
- `SUPABASE_DB_PASSWORD`
  - Used only for direct database/admin operations when needed.
  - Store in `.env.local`; do not expose to clients.

Admin only:

- `SUPABASE_SERVICE_ROLE_KEY`
  - Use only for trusted admin scripts or provider console work.
  - Never use in mobile, Electron renderer, or desktop cloud mode.
  - Never commit or log.

Verify:

```powershell
npm run verify:supabase-schema
```

## Desktop Cloud Session

Required only for local desktop cloud smoke:

- `ASKEWLY_COMMAND_SCHEDULE_MODE=cloud`
- `ASKEWLY_COMMAND_SUPABASE_ACCESS_TOKEN`

Rules:

- The access token must be a normal signed-in user JWT.
- Do not use `SUPABASE_SERVICE_ROLE_KEY`.
- Do not commit the token.
- Prefer short-lived local verification over long-term token storage.

Verify:

```powershell
npm run verify:desktop-cloud-schedule
```

## Google OAuth

Required:

- Google Cloud OAuth web client ID.
- Google Cloud OAuth web client secret.
- Authorized redirect URI:
  - `https://govkdpvdrnleevnkckda.supabase.co/auth/v1/callback`

Environment placeholders:

- `GOOGLE_OAUTH_WEB_CLIENT_ID`
- `GOOGLE_OAUTH_WEB_CLIENT_SECRET`
- `GOOGLE_OAUTH_IOS_CLIENT_ID`
- `GOOGLE_OAUTH_ANDROID_CLIENT_ID`

Current MVP requirement:

- Supabase Auth Google provider must be enabled with the web client values.
- Native iOS/Android client IDs can be added when store bundle IDs are finalized.

Verify:

- Mobile Google sign-in returns to `askewlycommand://auth`.
- A new Google user gets a personal workspace and default task sources.

## Kakao OAuth

Required:

- Kakao REST API key.
- Kakao client secret.
- Kakao Login enabled.
- Kakao platform redirect URI:
  - `https://govkdpvdrnleevnkckda.supabase.co/auth/v1/callback`
- Required consent items enabled:
  - profile nickname
  - profile image
  - account email

Environment placeholders:

- `KAKAO_REST_API_KEY`
- `KAKAO_CLIENT_SECRET`

Verify:

- Mobile Kakao sign-in returns to `askewlycommand://auth`.
- No `KOE205` error appears during consent.

## Native Redirects

Required:

- `EXPO_SCHEME=askewlycommand`
- `EXPO_REDIRECT_PATH=auth`
- Supabase Site URL:
  - `askewlycommand://auth`
- Supabase Redirect URLs:
  - `askewlycommand://auth`
  - `workspacepulse://auth` (temporary legacy redirect during installed-client migration)
  - `http://localhost:8082/auth`

Verify:

```powershell
npm --prefix mobile run typecheck
```

Then run a mobile OAuth smoke on a device.

## Android Local Device

Required for USB smoke:

- Android device connected over USB.
- USB debugging enabled.
- `adb devices` shows the phone as `device`.

Verify:

```powershell
adb devices
adb shell monkey -p com.askewly.command 1
```

For debug-only token extraction during verification:

```powershell
adb exec-out run-as com.askewly.command cat databases/RKStorage
```

This works only with a debuggable build. Do not rely on it for production.

## Email/Password Signup

Current product path does not require email/password signup. OAuth is enough for
MVP onboarding.

If email/password testing is needed:

- Supabase built-in email provider has a low project-wide email-send rate limit.
- Configure custom SMTP before running repeated signup tests.
- Avoid using disposable/example domains; Supabase Auth may reject them.

## Forbidden

- Committing `.env.local`.
- Putting access tokens in docs, ROADMAP, phase files, screenshots, or logs.
- Using the service role key in client-side code.
- Treating the original M4/vault path as a requirement for third-party users.
