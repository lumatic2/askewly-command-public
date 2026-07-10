#!/usr/bin/env node
'use strict';

// Live Google Calendar E2E for widget v2 event editing (S4 polish round 2).
// Creates a temp event via gws directly, drives it through
// widget/data-service.js#eventUpdate / #eventDelete (the same functions the
// renderer's IPC handlers call), and verifies each step against a fresh
// `calendar.events.list` read. Always cleans up the temp event, even on
// failure. Prints only counts/booleans + the temp title (no tokens/ids of
// real user data).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dataService = require('../widget/data-service');

function gwsCommand() {
  if (process.env.GWS_BIN) return process.env.GWS_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const installedExe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws.exe');
    if (fs.existsSync(installedExe)) return installedExe;
  }
  return 'gws';
}

function runGws(args, allowFailure = false) {
  const result = spawnSync(gwsCommand(), args, { encoding: 'utf8' });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error && !allowFailure) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(stdout || stderr || `gws exited ${result.status}`);
  return stdout ? JSON.parse(stdout) : {};
}

function kstTodayDateStr() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function listEventsToday() {
  const today = kstTodayDateStr();
  const response = runGws([
    'calendar', 'events', 'list',
    '--params', JSON.stringify({
      calendarId: 'primary',
      timeMin: `${today}T00:00:00+09:00`,
      timeMax: `${today}T23:59:59+09:00`,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50
    }),
    '--format', 'json'
  ]);
  return response.items || [];
}

const TEMP_TITLE = '위젯 일정편집 E2E';
let tempEventId = null;
let failed = false;

async function main() {
  const today = kstTodayDateStr();
  const startIso = `${today}T14:00:00+09:00`;
  const endIso = `${today}T14:30:00+09:00`;

  const created = runGws([
    'calendar', 'events', 'insert',
    '--params', JSON.stringify({ calendarId: 'primary', sendUpdates: 'none' }),
    '--json', JSON.stringify({ summary: TEMP_TITLE, start: { dateTime: startIso }, end: { dateTime: endIso } }),
    '--format', 'json'
  ]);
  tempEventId = created.id;
  if (!tempEventId) throw new Error('gws calendar events insert did not return an id');
  console.log(`created: true (title=${TEMP_TITLE})`);

  const afterCreate = listEventsToday();
  const foundAfterCreate = afterCreate.some((event) => event.id === tempEventId);
  console.log(`foundAfterCreate: ${foundAfterCreate}`);
  if (!foundAfterCreate) throw new Error('temp event not found via events.list after create');

  const newTitle = `${TEMP_TITLE} (수정됨)`;
  const newStartIso = `${today}T15:00:00+09:00`;
  const newEndIso = `${today}T15:30:00+09:00`;
  const newLocation = '회의실 A';
  const newDescription = '위젯 일정편집 E2E 메모';
  const updated = dataService.eventUpdate({
    id: tempEventId,
    summary: newTitle,
    startIso: newStartIso,
    endIso: newEndIso,
    location: newLocation,
    description: newDescription
  }, runGws);
  const updateOk = updated.summary === newTitle && updated.start === newStartIso && updated.end === newEndIso;
  console.log(`updateOk: ${updateOk}`);
  if (!updateOk) throw new Error(`eventUpdate result mismatch: ${JSON.stringify(updated)}`);

  const detailUpdateOk = updated.location === newLocation && updated.description === newDescription;
  console.log(`detailUpdateOk: ${detailUpdateOk}`);
  if (!detailUpdateOk) throw new Error(`eventUpdate location/description mismatch: ${JSON.stringify(updated)}`);

  const afterUpdate = listEventsToday();
  const updatedEvent = afterUpdate.find((event) => event.id === tempEventId);
  const verifiedAfterUpdate = !!updatedEvent && updatedEvent.summary === newTitle && updatedEvent.start?.dateTime === newStartIso;
  console.log(`verifiedAfterUpdate: ${verifiedAfterUpdate}`);
  if (!verifiedAfterUpdate) throw new Error('updated event not reflected in fresh events.list read');

  const verifiedDetailAfterUpdate = updatedEvent.location === newLocation && updatedEvent.description === newDescription;
  console.log(`verifiedDetailAfterUpdate: ${verifiedDetailAfterUpdate}`);
  if (!verifiedDetailAfterUpdate) throw new Error('updated location/description not reflected in fresh events.list read');

  const deleteResult = dataService.eventDelete({ id: tempEventId }, runGws);
  console.log(`deleted: ${deleteResult.deleted === true}`);

  const afterDelete = listEventsToday();
  const goneAfterDelete = !afterDelete.some((event) => event.id === tempEventId);
  console.log(`goneAfterDelete: ${goneAfterDelete}`);
  if (!goneAfterDelete) throw new Error('event still present via events.list after delete');

  // Delete already succeeded — nothing left to clean up.
  tempEventId = null;
}

main()
  .catch((error) => {
    failed = true;
    console.error('widget calendar e2e FAILED:', error.message || error);
  })
  .finally(() => {
    if (tempEventId) {
      // Best-effort cleanup: the temp event still exists (failure happened
      // before or during the delete step).
      const cleanupResult = spawnSync(gwsCommand(), [
        'calendar', 'events', 'delete',
        '--params', JSON.stringify({ calendarId: 'primary', eventId: tempEventId, sendUpdates: 'none' }),
        '--format', 'json'
      ], { encoding: 'utf8' });
      console.log(`cleanupRan: true, cleanupExitCode: ${cleanupResult.status}`);
    } else {
      console.log('cleanupRan: false (no temp event left to remove)');
    }
    if (failed) process.exitCode = 1;
    else console.log('widget calendar e2e verify ok: create/update/verify/delete/verify against live Google Calendar');
  });
