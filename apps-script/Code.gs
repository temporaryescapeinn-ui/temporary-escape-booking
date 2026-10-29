/**
 * Apps Script Web App — backend for the customer-facing booking page ONLY.
 * Deliberately separate from the admin app's own Apps Script/Sheet/Google
 * account — see docs/customer-page-plan.md for why.
 *
 * Deploy: bind this script to its own spreadsheet (a NEW one, on a NEW
 * Google account), deploy as a Web App with "Execute as: Me" and "Who has
 * access: Anyone". Copy the deployed URL and a shared secret into
 * customer-page/app.js's BACKEND_URL / BACKEND_TOKEN constants.
 *
 * Two tabs:
 *  - Requests: append-only log of every submitted quote request, for your
 *    own history/reference. Nothing reads this back into the page.
 *  - Status: one row per room (roomKey, enabled, notice) plus a special
 *    "_site" row for a whole-page banner. Edit this sheet directly from
 *    your phone to disable a room or post a notice — no redeploy needed.
 *
 * Unlike the admin app's backend, the token here is NOT a real secret — it
 * ships inside a public webpage's JS, visible to anyone who views source.
 * It's still worth sending (keeps casual/automated noise out), but don't
 * rely on it for anything sensitive.
 */

const REQUESTS_HEADERS = ['timestamp', 'room', 'checkIn', 'checkOut', 'packageType', 'price'];
const STATUS_HEADERS = ['roomKey', 'enabled', 'notice'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let requests = ss.getSheetByName('Requests');
  if (!requests) {
    requests = ss.insertSheet('Requests');
    requests.appendRow(REQUESTS_HEADERS);
    requests.setFrozenRows(1);
  }

  let status = ss.getSheetByName('Status');
  if (!status) {
    status = ss.insertSheet('Status');
    status.appendRow(STATUS_HEADERS);
    status.setFrozenRows(1);
    status.appendRow(['_site', true, '']);
    status.appendRow(['standard', true, '']);
    status.appendRow(['white', true, '']);
    status.appendRow(['blue', true, '']);
  }

  getAvailabilitySheet_(); // see Availability.gs
}

function getSharedSecret_() {
  return PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
}

function checkAuth_(token) {
  const secret = getSharedSecret_();
  return !!secret && token === secret;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * doPost — one payload shape:
 *   { type: 'logRequest', token, room, checkIn, checkOut, packageType, price }
 */
function doPost(e) {
  const body = JSON.parse(e.postData.contents);

  if (!checkAuth_(body.token)) {
    return jsonResponse_({ ok: false, error: 'unauthorized' });
  }

  if (body.type === 'logRequest') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Requests');
    sheet.appendRow([
      new Date().toISOString(),
      body.room || '',
      body.checkIn || '',
      body.checkOut || '',
      body.packageType || '',
      body.price || '',
    ]);
    return jsonResponse_({ ok: true });
  }

  return jsonResponse_({ ok: false, error: 'unknown request type' });
}

/**
 * doGet — one query shape: ?type=status&token=...[&av=<cached version>]
 * Returns { ok: true, banner: string, disabledRooms: { roomKey: reason },
 * availability: null | { version, unchanged } | { version, checkedAt, days } }
 * (only rooms with enabled === FALSE appear in disabledRooms; `availability`
 * is built in Availability.gs).
 */
function doGet(e) {
  if (!checkAuth_(e.parameter.token)) {
    return jsonResponse_({ ok: false, error: 'unauthorized' });
  }

  if (e.parameter.type !== 'status') {
    return jsonResponse_({ ok: false, error: 'unknown request type' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Status');
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, STATUS_HEADERS.length).getValues() : [];

  let banner = '';
  const disabledRooms = {};

  rows.forEach((row) => {
    const [roomKey, enabled, notice] = row;
    if (roomKey === '_site') {
      banner = enabled === false ? '' : String(notice || '');
      return;
    }
    if (enabled === false) {
      disabledRooms[roomKey] = String(notice || 'Currently unavailable.');
    }
  });

  return jsonResponse_({
    ok: true,
    banner: banner,
    disabledRooms: disabledRooms,
    availability: availabilityFieldForStatus_(e.parameter),
  });
}
