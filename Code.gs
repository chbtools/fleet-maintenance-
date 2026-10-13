/**
 * Fleet Maintenance Log — Google Sheets backend
 * Paste this into Extensions > Apps Script of a new Google Sheet.
 * Change ACCESS_CODE below to your own shop code before deploying.
 */
const ACCESS_CODE = 'CHANGE-ME';

const COLUMNS = {
  units: ['id', 'unit', 'type', 'name', 'make', 'model', 'year', 'serial',
          'meterType', 'meter', 'pmMeter', 'pmDays', 'status', 'notes', 'createdAt'],
  records: ['id', 'date', 'unitId', 'unitNumber', 'kind', 'status', 'description', 'parts',
            'meter', 'laborHours', 'partsCost', 'laborCost', 'otherCost', 'total',
            'vendor', 'createdAt', 'updatedAt']
};
const NUMERIC = ['meter', 'pmMeter', 'pmDays', 'laborHours', 'partsCost', 'laborCost', 'otherCost', 'total'];

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad request' }); }
  return handle(p);
}
function doGet() {
  return out({ ok: true, message: 'Fleet Maintenance Log backend is running.' });
}

function handle(p) {
  try {
    if (String(p.code || '') !== ACCESS_CODE) return out({ ok: false, error: 'unauthorized' });
    if (p.action === 'list') return out({ ok: true, units: readAll('units'), records: readAll('records') });

    if (!COLUMNS[p.collection]) return out({ ok: false, error: 'unknown collection' });
    if (!p.id || !/^[A-Za-z0-9_-]{4,40}$/.test(p.id)) return out({ ok: false, error: 'bad id' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (p.action === 'set') writeDoc(p.collection, p.id, p.data || {});
      else if (p.action === 'update') {
        const cur = readDoc(p.collection, p.id);
        if (!cur) return out({ ok: false, error: 'not found' });
        writeDoc(p.collection, p.id, Object.assign(cur, p.data || {}));
      }
      else if (p.action === 'delete') deleteDoc(p.collection, p.id);
      else return out({ ok: false, error: 'unknown action' });
    } finally { lock.releaseLock(); }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  const cols = COLUMNS[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Keep text columns as plain text so dates and serials aren't reformatted.
    cols.forEach((c, i) => {
      const r = sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1);
      if (NUMERIC.indexOf(c) === -1) r.setNumberFormat('@');
      else if (/Cost|total/.test(c)) r.setNumberFormat('$#,##0.00');
    });
  }
  return sh;
}

function toObj(cols, row, name) {
  const o = {};
  cols.forEach((c, i) => {
    let v = row[i];
    if (v instanceof Date) v = c === 'date' ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : v.toISOString();
    if (NUMERIC.indexOf(c) !== -1) v = (v === '' || v === null) ? null : Number(v);
    else v = v === null ? '' : String(v);
    o[c] = v;
  });
  return o;
}

function readAll(name) {
  const sh = sheet(name), cols = COLUMNS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => toObj(cols, r, name));
}

function findRow(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function readDoc(name, id) {
  const sh = sheet(name), r = findRow(sh, id);
  if (!r) return null;
  return toObj(COLUMNS[name], sh.getRange(r, 1, 1, COLUMNS[name].length).getValues()[0], name);
}

function writeDoc(name, id, data) {
  const sh = sheet(name), cols = COLUMNS[name];
  data.id = id;
  if (name === 'records') {
    data.total = (Number(data.partsCost) || 0) + (Number(data.laborCost) || 0) + (Number(data.otherCost) || 0);
  }
  const row = cols.map(c => {
    const v = data[c];
    if (v === null || v === undefined) return '';
    return NUMERIC.indexOf(c) !== -1 ? Number(v) : String(v).slice(0, 5000);
  });
  const r = findRow(sh, id) || sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, cols.length).setValues([row]);
}

function deleteDoc(name, id) {
  const sh = sheet(name), r = findRow(sh, id);
  if (r) sh.deleteRow(r);
}

/** Run once from the editor to create the two tabs and authorize the script. */
function setup() {
  sheet('units');
  sheet('records');
}
