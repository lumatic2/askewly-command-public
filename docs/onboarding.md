# Onboarding

Askewly Command now has two supported paths:

- **Cloud mode**: Expo mobile app + Supabase Auth/Postgres + Electron cloud widget.
- **Legacy mode**: personal Electron widget + local markdown schedule + M4/vault sync/PWA.

New users should use cloud mode. Legacy mode is kept for the original personal
workflow and should not be required for third-party onboarding.

## User Onboarding

1. Install or open the mobile build provided by the operator.
2. Sign in with Google or Kakao.
3. Confirm the dashboard shows `Today`, `Deadlines`, and `Backlog`.
4. Add one Backlog item.
5. Tap `Refresh` or wait for the foreground refresh interval.
6. If using the desktop widget, ask the operator to configure desktop cloud mode
   for the same account session.

Expected result:

- The user gets a personal workspace.
- The three default task sources are created automatically.
- Another user cannot read or update this workspace.

## Operator Setup

Install dependencies:

```powershell
npm install
npm --prefix mobile install
```

Create `.env.local` from `.env.example` and fill only local secret values:

```powershell
Copy-Item .env.example .env.local
```

Do not commit `.env.local`, OAuth secrets, service role keys, database
passwords, or user access tokens.

## Supabase Setup

Use the existing `dashboard` Supabase project unless intentionally creating a
fresh environment.

Required configuration:

- Project URL and anon key in `.env.local`.
- Google and Kakao providers enabled in Supabase Auth.
- Site URL: `askewlycommand://auth`.
- Redirect URLs:
  - `askewlycommand://auth`
  - `workspacepulse://auth` (temporary legacy redirect during installed-client migration)
  - `http://localhost:8082/auth`
- Database migrations applied from `supabase/migrations/`.

Verify schema:

```powershell
npm run verify:supabase-schema
```

## Mobile Setup

The mobile app is an Expo React Native app under `mobile/`.

Required public env values:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Run typecheck:

```powershell
npm --prefix mobile run typecheck
```

Build and install a local Android debug build:

```powershell
.\mobile\android\gradlew.bat -p mobile\android app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeArchitectures=arm64-v8a
adb install -r mobile\android\app\build\outputs\apk\debug\app-debug.apk
adb shell monkey -p com.askewly.command 1
```

Build and install a local Android release build:

```powershell
.\mobile\android\gradlew.bat -p mobile\android app:assembleRelease --configure-on-demand --build-cache -PreactNativeArchitectures=arm64-v8a
adb install -r mobile\android\app\build\outputs\apk\release\app-release.apk
```

## Desktop Cloud Widget Setup

The Electron widget defaults to legacy local file mode. Enable cloud mode only
when the widget should read/write Supabase tasks:

```env
ASKEWLY_COMMAND_SCHEDULE_MODE=cloud
SUPABASE_URL=
SUPABASE_ANON_KEY=
ASKEWLY_COMMAND_SUPABASE_ACCESS_TOKEN=
```

`ASKEWLY_COMMAND_SUPABASE_ACCESS_TOKEN` must be a user session token. Do not use
the service role key in the desktop widget.

Run desktop cloud smoke:

```powershell
npm run verify:desktop-cloud-schedule
```

Run legacy local regression:

```powershell
npm run test:schedule-interactions
```

## Cross-Device Verification

Use the same signed-in user on mobile and desktop cloud mode.

Required checks:

```powershell
npm run verify:desktop-cloud-schedule
npm run verify:rls-isolation
```

Known M6 evidence:

- Desktop provider -> mobile UI propagation passed at 2.37 seconds.
- A second Google OAuth user saw only their own workspace and got zero rows for
  read/update against the first user's workspace.

## Troubleshooting

- `KOE205`: Kakao Login requested a consent item not enabled in Kakao
  Developers. Enable the required Kakao Login consent items.
- `permission denied for table workspaces`: authenticated grants are missing or
  migrations were not applied.
- `email rate limit exceeded`: Supabase built-in email provider allows only a
  small number of email sends per hour. OAuth login avoids this for smoke tests.
- Desktop cloud mode says a token is missing: sign in on mobile or another
  client and provide a user JWT only for local smoke. Do not commit it.
