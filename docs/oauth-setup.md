# OAuth Setup

## Naming

- Supabase project name: `dashboard`
- Supabase project ref: `govkdpvdrnleevnkckda`
- Product display name: `Askewly Command`
- Native redirect scheme: `askewlycommand://auth`
- Default region: `ap-northeast-2`

## Supabase

Create the Supabase project first. The project reference becomes part of the provider callback URL:

```text
https://govkdpvdrnleevnkckda.supabase.co/auth/v1/callback
```

Store the project URL and anon key in `.env.local`. Do not commit service role keys or OAuth client secrets.

Authentication URL configuration:

- Site URL: `askewlycommand://auth`
- Redirect URLs:
  - `askewlycommand://auth`
  - `workspacepulse://auth` (temporary legacy redirect during installed-client migration)
  - `http://localhost:8082/auth`

## Google

Create a Google OAuth web client for Supabase Auth.

- Google Cloud project name: `dashboard`
- Google Cloud project ID: `dashboard-500017`
- App name: `Askewly Command`
- OAuth client name: `Askewly Command Web`
- Authorized redirect URI: `https://govkdpvdrnleevnkckda.supabase.co/auth/v1/callback`
- Supabase provider values: Google client ID and client secret

Native iOS/Android client IDs can be added when Expo bundle identifiers are finalized.

Status: configured in Google Cloud and enabled in Supabase Auth.

## Kakao

Create a Kakao Developers app for Supabase Auth.

- App name: `Askewly Command`
- Kakao app ID: `1491877`
- Platform redirect URI: `https://govkdpvdrnleevnkckda.supabase.co/auth/v1/callback`
- Supabase provider values: Kakao REST API key and client secret

Enable Kakao Login before testing provider sign-in.

Status: configured in Kakao Developers and enabled in Supabase Auth. The app was converted to a personal developer Biz App so Kakao can provide required `profile_nickname`, `profile_image`, and `account_email` consent items.

## Local Files

Use `.env.local` for local development:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
GOOGLE_OAUTH_WEB_CLIENT_ID=
GOOGLE_OAUTH_WEB_CLIENT_SECRET=
KAKAO_REST_API_KEY=
KAKAO_CLIENT_SECRET=
EXPO_SCHEME=askewlycommand
EXPO_REDIRECT_PATH=auth
```
