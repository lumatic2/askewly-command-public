# Public Release Checklist

Askewly Command is currently private. Before changing repository visibility to public, treat public readiness as two separate checks:

1. Current tree readiness: no secret-bearing files, private QA artifacts, local tunnel config, or personal identifiers are tracked at `HEAD`.
2. History readiness: sensitive files that were ever committed are not still reachable from public git history.

## Current Tree Gate

Run:

```powershell
npm run verify:public-readiness
```

This checks tracked files for:

- local-only deployment configs such as `server/cloudflared-config.yml`
- APK QA logs/XML dumps under `docs/artifacts/apk-color-check/`
- known personal email strings
- known Cloudflare tunnel identifiers and local credentials paths
- common token formats

The verifier is intentionally conservative and should be extended when new private surfaces are added.

## Ignore Policy

The repo ignores:

- `.env*` except `.env.example`
- build outputs such as `dist/`, `web/dist/`, `release/`
- local QA/temp outputs such as `tmp/`, `archive/`, `.playwright-mcp/`
- APK/AAB release artifacts
- local deployment configs such as `server/cloudflared-config.yml`

Public examples should use template files, for example `server/cloudflared-config.example.yml`.

## History Gate

Removing a file from the current tree is not enough for a public GitHub repo. If a secret, token, private config, personal task export, or sensitive screenshot was ever committed, choose one of these before making the repo public:

- Preferred for portfolio release: create a fresh public repo from a sanitized snapshot or squash import.
- Alternative: rewrite history with a tool such as `git filter-repo`, then force-push after rotating any exposed credentials.

Do not switch GitHub visibility to public until the history gate is handled.

## Manual Review Before Public Toggle

- Confirm GitHub visibility is still private.
- Run `npm run verify:public-readiness`.
- Review `git ls-files` for unexpected logs, screenshots, exports, dumps, or local config.
- Rotate any credential that was ever committed, even if it has since been removed.
- Prefer sanitized demo screenshots over real personal workspace screenshots.
