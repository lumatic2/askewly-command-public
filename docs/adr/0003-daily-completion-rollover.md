# ADR 0003: Daily Completion and Rollover

## Status

Accepted, 2026-06-22

## Context

Askewly Command now has two first-class cloud clients: the Electron PC widget and the Expo mobile app. Their completion behavior diverged:

- Mobile completion changed a task to `done` and kept it visible with completed styling.
- PC widget completion sent `completed`, which the cloud schedule source mapped to `archived`, removing the task from active lists.

This creates user-visible inconsistency and weakens cross-device verification because the same intent produces different active-list behavior.

## Decision

Use a two-stage completion model.

1. Completion means `status = 'done'`.
2. Archive means `status = 'archived'` and `archived_at` is set.
3. PC and mobile primary completion actions write `done`.
4. Archive is a separate explicit operation or the result of daily rollover.
5. Today is date-scoped by `scheduled_for`.
6. Daily rollover is idempotent and workspace-scoped:
   - Today `todo` or `doing` tasks with `scheduled_for < today` move to today.
   - Today `done` tasks with `scheduled_for < today` move to archive.
   - Deadlines and Backlog are not affected by Today rollover.

The product default timezone is Asia/Seoul for personal daily use. Implementation must avoid relying on UTC calendar dates where it would change the user's Today boundary.

## Consequences

- Users can complete a task on either client and see the same status on the other client.
- Active Today can become date-based without losing unfinished work.
- Completed tasks no longer vanish immediately on PC unless the user archives them or rollover archives them later.
- Existing verifiers that equate completion with archive must be updated.
- Legacy local markdown mode may keep its existing `completed` archive behavior unless the cloud-mode path is explicitly under test.

## Verification

- Shared status contract verification passes.
- Desktop cloud completion returns legacy `completed` mapped from cloud `done`, not archived.
- Mobile completion and PC completion produce the same cloud task status.
- Rollover dry-run and real-run prove unfinished old Today tasks move to today and old done Today tasks archive.
- Cross-device smoke covers completion parity and archive cleanup.
