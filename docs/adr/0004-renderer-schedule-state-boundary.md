# ADR 0004: Renderer Schedule State Boundary

## Status

Accepted.

## Context

The Electron renderer currently keeps most UI behavior in `renderer/renderer.js`. Schedule rendering, optimistic UI updates, IPC mutation calls, drag/drop, edit dialogs, archive filtering, tab behavior, and unrelated panels share one file and one implicit global state.

M15 separated cloud task meanings (`done` vs `archived`), but a renderer regression remained possible because mutation handlers could pass a Today-only cloud response into the same `render()` function that expects the full widget state. When that happens, the schedule area can temporarily clear until the next full refresh.

## Decision

Schedule mutation responses must cross a single normalization boundary before touching the DOM.

- `render(state)` accepts only full widget state.
- Today-only schedule responses are merged into the previous full widget state before full rendering.
- Schedule row state changes such as completion may patch the affected row immediately, but the confirmed server response still goes through the same normalization boundary.
- Mutation handlers should call a shared commit helper instead of duplicating optimistic update, rollback, confirmation merge, and error handling.
- The refactor is limited to the PC widget schedule surface. It does not change Supabase schema, mobile UI, auth, or unrelated Electron tabs.

## Consequences

This keeps the current vanilla DOM renderer and avoids a broad rewrite. The short-term cost is introducing state helper functions around existing code instead of replacing the whole renderer. The benefit is that schedule regressions become testable: no handler should be able to blank the schedule by rendering a partial response as a full app state.

## Verification

- Existing local interaction smoke: `npm run test:schedule-interactions`
- Existing cloud smoke: `npm run verify:desktop-cloud-schedule`
- Daily/cross-device guards: `npm run verify:daily-rollover`, `npm run verify:cross-device-sync`
- Historical M16 evidence is archived with the old milestone notes; the commands above are the maintained regression checks.
