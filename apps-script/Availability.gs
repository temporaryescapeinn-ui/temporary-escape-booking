/**
 * Availability hints ("temperature") for the booking page.
 *
 * A pull-through cache. When the page asks for its status, this file checks how
 * old its copy of the admin app's bookings is and, if it is due, pulls a fresh
 * copy from the MAIN backend (a different Apps Script, different Google
 * account) and boils it down to per-day counts in the Availability tab. Only
 * counts are kept: no guest data, no times. The page is then handed a level
 * from 0 to 3 per room group per day and turns it into a soft hint.
 *
 * Setup (Project Settings > Script Properties, in THIS project):
 *   MAIN_URL                  the main backend's deployed /exec URL
 *   MAIN_AVAILABILITY_SECRET  the value of AVAILABILITY_SECRET set on the main
 *                             backend (it unlocks that one read and nothing else)
 * With either unset, hints are simply switched off.
 *
 * Day rule: a booking counts toward every local date from its check-in date up
 * to the day before checkout, plus the checkout date only if checkout is after
 * noon (so a normal overnight stay does not make the morning it ends look
 * busy). A same-day stay counts toward that one date.
 *
 * Levels: Blue and White are single rooms, so any booking that day is level 3.
 * Standard is a pool: rooms in use / rooms switched on gives 1 (some), 2 (most,
 * from 60%), 3 (all). Level 0 shows nothing.
 */

const AVAILABILITY_SHEET_NAME = 'Availability';
const AVAILABILITY_HEADERS = ['date', 'standardInUse', 'whiteBooked', 'blueBooked'];

const AVAILABILITY_FRESH_MS = 5 * 60 * 1000; // ask the main backend at most this often
const AVAILABILITY_RETRY_MS = 60 * 1000; // after a failed attempt, wait this long
const AVAILABILITY_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // older than this: show nothing
const AVAILABILITY_DAYS = 25; // today through day 24: 21 ahead + a 3-night stay, with slack
const AVAILABILITY_LEVELS_REV = '1'; // bump when the level rules change so cached pages refresh

const AVAILABILITY_DAY_MS = 24 * 60 * 60 * 1000;
const AVAILABILITY_NOON_MS = 12 * 60 * 60 * 1000;

function availabilityProps_() {
  return PropertiesService.getScriptProperties();
}

function availabilityDayKey_(dayNumber) {
  return new Date(dayNumber * AVAILABILITY_DAY_MS).toISOString().slice(0, 10);
}

/** One row per local date in the window: [date, standard rooms in use, white
 * booked 0/1, blue booked 0/1]. `feed` is the main backend's availability reply. */
function buildAvailabilityRows_(feed) {
  const offsetMs = Number(feed.utcOffsetMinutes) * 60000;
  const startDay = Math.floor((Date.parse(feed.windowStart) + offsetMs) / AVAILABILITY_DAY_MS);

  const days = {};
  for (let i = 0; i < AVAILABILITY_DAYS; i++) {
    days[startDay + i] = { standard: {}, white: false, blue: false };
  }

  (feed.bookings || []).forEach((b, index) => {
    const checkIn = Date.parse(b.checkIn) + offsetMs;
    const checkOut = Date.parse(b.checkOut) + offsetMs;
    if (isNaN(checkIn) || isNaN(checkOut) || checkOut <= checkIn) return;
    const firstDay = Math.floor(checkIn / AVAILABILITY_DAY_MS);
    const checkOutDay = Math.floor(checkOut / AVAILABILITY_DAY_MS);
    let lastDay = checkOutDay - 1;
    if (checkOutDay === firstDay) lastDay = firstDay;
    else if (checkOut - checkOutDay * AVAILABILITY_DAY_MS > AVAILABILITY_NOON_MS) lastDay = checkOutDay;

    for (let d = firstDay; d <= lastDay && d < firstDay + 60; d++) {
      const cell = days[d];
      if (!cell) continue;
      if (b.room === 'white') cell.white = true;
      else if (b.room === 'blue') cell.blue = true;
      else cell.standard[b.roomId || 'booking-' + index] = true;
    }
  });

  return Object.keys(days)
    .map(Number)
    .sort((a, b) => a - b)
    .map((d) => [
      availabilityDayKey_(d),
      Object.keys(days[d].standard).length,
      days[d].white ? 1 : 0,
      days[d].blue ? 1 : 0,
    ]);
}

function getAvailabilitySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AVAILABILITY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AVAILABILITY_SHEET_NAME);
    sheet.appendRow(AVAILABILITY_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Replaces every data row, which is also what clears out yesterday's dates. */
function writeAvailabilityRows_(rows) {
  const sheet = getAvailabilitySheet_();
  const last = sheet.getLastRow();
  if (last >= 2) sheet.deleteRows(2, last - 1);
  if (rows.length === 0) return;
  // Plain text, so Sheets does not turn '2026-10-29' into a date.
  sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
  sheet.getRange(2, 1, rows.length, AVAILABILITY_HEADERS.length).setValues(rows);
}

function availabilityDateCell_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    // Only if Sheets converted the text anyway: read it back in the sheet's own timezone.
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
  }
  return String(value);
}

function readAvailabilityRows_() {
  const sheet = getAvailabilitySheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet
    .getRange(2, 1, last - 1, AVAILABILITY_HEADERS.length)
    .getValues()
    .filter((r) => r[0] !== '' && r[0] !== null)
    .map((r) => [availabilityDateCell_(r[0]), Number(r[1]) || 0, Number(r[2]) || 0, Number(r[3]) || 0]);
}

function fetchMainAvailability_(url, secret, knownVersion) {
  let full = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'action=availability&token=' + encodeURIComponent(secret);
  if (knownVersion) full += '&v=' + encodeURIComponent(knownVersion);
  const res = UrlFetchApp.fetch(full, { muteHttpExceptions: true, followRedirects: true });
  return JSON.parse(res.getContentText());
}

function availabilityDue_(props, now) {
  const checkedAt = Number(props.getProperty('AVAIL_CHECKED_AT')) || 0;
  const attemptAt = Number(props.getProperty('AVAIL_ATTEMPT_AT')) || 0;
  return now - checkedAt >= AVAILABILITY_FRESH_MS && now - attemptAt >= AVAILABILITY_RETRY_MS;
}

/** Pulls from the main backend if our copy is due for a check. Never throws and
 * never waits on another request: if one is already refreshing, we just serve
 * what we have. */
function refreshAvailabilityIfDue_() {
  const props = availabilityProps_();
  const url = props.getProperty('MAIN_URL');
  const secret = props.getProperty('MAIN_AVAILABILITY_SECRET');
  if (!url || !secret) return;
  if (!availabilityDue_(props, Date.now())) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;
  try {
    if (!availabilityDue_(props, Date.now())) return; // someone refreshed while we queued
    props.setProperty('AVAIL_ATTEMPT_AT', String(Date.now()));

    let feed = null;
    try {
      feed = fetchMainAvailability_(url, secret, props.getProperty('AVAIL_MAIN_VERSION'));
    } catch (err) {
      feed = null;
    }
    if (!feed || feed.ok !== true) return;

    if (feed.unchanged) {
      props.setProperty('AVAIL_CHECKED_AT', String(Date.now()));
      return;
    }

    writeAvailabilityRows_(buildAvailabilityRows_(feed));
    props.setProperties({
      AVAIL_MAIN_VERSION: String(feed.version),
      AVAIL_CHECKED_AT: String(Date.now()),
      AVAIL_STANDARD_TOTAL: String((feed.rooms && feed.rooms.standard) || 0),
      AVAIL_WHITE_ON: (feed.rooms && feed.rooms.white) > 0 ? '1' : '0',
      AVAIL_BLUE_ON: (feed.rooms && feed.rooms.blue) > 0 ? '1' : '0',
    });
  } finally {
    lock.releaseLock();
  }
}

function standardAvailabilityLevel_(inUse, total) {
  if (total <= 0 || inUse <= 0) return 0;
  const ratio = inUse / total;
  if (ratio >= 1) return 3;
  if (ratio >= 0.6) return 2;
  return 1;
}

/** What the page gets: null when there is nothing trustworthy to show, a tiny
 * { version, unchanged: true } when the page's cached copy is still right, or
 * { version, checkedAt, days: { 'YYYY-MM-DD': [standard, white, blue] } } with
 * levels 0-3. */
function availabilityForPage_(cachedVersion) {
  const props = availabilityProps_();
  const mainVersion = props.getProperty('AVAIL_MAIN_VERSION');
  const checkedAt = Number(props.getProperty('AVAIL_CHECKED_AT')) || 0;
  if (!mainVersion || Date.now() - checkedAt > AVAILABILITY_MAX_AGE_MS) return null;

  const version = mainVersion + '.' + AVAILABILITY_LEVELS_REV;
  if (cachedVersion && cachedVersion === version) {
    return { version: version, unchanged: true };
  }

  const total = Number(props.getProperty('AVAIL_STANDARD_TOTAL')) || 0;
  const whiteOn = props.getProperty('AVAIL_WHITE_ON') === '1';
  const blueOn = props.getProperty('AVAIL_BLUE_ON') === '1';
  const days = {};
  readAvailabilityRows_().forEach((r) => {
    days[r[0]] = [
      standardAvailabilityLevel_(r[1], total),
      whiteOn && r[2] ? 3 : 0,
      blueOn && r[3] ? 3 : 0,
    ];
  });
  return { version: version, checkedAt: new Date(checkedAt).toISOString(), days: days };
}

/** The status call's availability field. Hints must never break the page's
 * other data, so any failure just means "no hints". */
function availabilityFieldForStatus_(params) {
  try {
    refreshAvailabilityIfDue_();
    return availabilityForPage_(params.av);
  } catch (err) {
    return null;
  }
}

/** Run this from the editor (select it, click Run, open View > Logs / Execution
 * log) when hints do not appear. It makes one real call to the main backend and
 * says which step failed. It never prints a secret. */
function availabilityDiagnose() {
  const props = availabilityProps_();
  const url = props.getProperty('MAIN_URL');
  const secret = props.getProperty('MAIN_AVAILABILITY_SECRET');
  Logger.log('MAIN_URL set: ' + !!url + (url ? ' (ends with ' + url.slice(-5) + ')' : ''));
  Logger.log('MAIN_AVAILABILITY_SECRET set: ' + !!secret);
  if (!url || !secret) return 'Set the missing script property, then run this again.';
  if (!/\/exec$/.test(url)) Logger.log('WARNING: MAIN_URL should end with /exec (a /dev URL needs you to be signed in).');

  let res;
  try {
    res = UrlFetchApp.fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'action=availability&token=' + encodeURIComponent(secret), {
      muteHttpExceptions: true,
      followRedirects: true,
    });
  } catch (err) {
    Logger.log('Could not reach the main backend: ' + err);
    return 'Fetch failed. If the error mentions permissions, run setup once and approve "connect to an external service".';
  }
  const text = res.getContentText();
  Logger.log('HTTP ' + res.getResponseCode());
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (err) {
    Logger.log('Reply was not JSON (wrong URL, or a Google sign-in page). Starts with: ' + text.slice(0, 120));
    return 'Reply was not JSON.';
  }
  if (body.ok !== true) {
    Logger.log('Main backend said: ' + JSON.stringify(body) +
      ' -> "unauthorized" means the secret does not match AVAILABILITY_SECRET on the main backend, ' +
      'or the main backend has not been redeployed with the new version.');
    return 'Main backend refused.';
  }
  Logger.log('OK. Main backend returned ' + (body.bookings ? body.bookings.length : 0) + ' bookings in the window, rooms ' + JSON.stringify(body.rooms) + '.');
  Logger.log('Last pull attempt: ' + props.getProperty('AVAIL_ATTEMPT_AT') + ', last confirmed: ' + props.getProperty('AVAIL_CHECKED_AT'));
  return 'Main backend reachable. Hints should appear on the next page load (after a minute).';
}
