/**
 * Fleet Maintenance Log — Google Sheets backend
 * Paste this into Extensions > Apps Script of the fleet Google Sheet.
 * Change ACCESS_CODE below to your own shop code before the first deploy.
 * On an existing deployment, leave ACCESS_CODE as it is and redeploy a new version.
 *
 * The script creates any missing tabs and appends any missing header columns.
 * It does not delete rows, rename tabs, or rewrite existing cells except the
 * header labels it owns when a column is new.
 */
const ACCESS_CODE = 'CHANGE-ME';

var COLUMNS = {
  units: ['id', 'unit', 'type', 'name', 'make', 'model', 'year', 'serial',
    'meterType', 'meter', 'pmMeter', 'pmDays', 'status', 'notes', 'createdAt',
    'warrantyExpires', 'certExpires', 'registrationExpires'],
  records: ['id', 'date', 'unitId', 'unitNumber', 'kind', 'status', 'description', 'parts',
    'meter', 'laborHours', 'partsCost', 'laborCost', 'otherCost', 'total',
    'vendor', 'createdAt', 'updatedAt',
    'stage', 'workDone', 'priority', 'assignedTo', 'assignedName', 'dueDate', 'requestedBy',
    'partsList', 'laborRate', 'completedAt', 'source', 'checkId', 'checkLog',
    'downtimeHours', 'photos', 'pmTaskId', 'pmLevelName',
    'approvalBy', 'approvalAt', 'approvalNote', 'approvalDecision'],
  employees: ['id', 'name', 'role', 'phone', 'email', 'smsCarrier', 'createdAt'],
  checks: ['id', 'unitId', 'unitNumber', 'unitType', 'date', 'at', 'driver', 'driverId',
    'shift', 'meter', 'result', 'notes', 'items', 'defects', 'photos', 'workOrderId', 'createdAt'],
  levels: ['id', 'unitId', 'name', 'basis', 'everyMeter', 'everyDays', 'active', 'legacy', 'notes', 'createdAt'],
  pmTasks: ['id', 'unitId', 'levelId', 'name', 'instructions', 'partsJson', 'active',
    'lastCompletedAt', 'lastMeter', 'lastWoId', 'createdAt'],
  checklists: ['id', 'unitType', 'items', 'updatedAt'],
  settings: ['id', 'digestOn', 'dateSoonDays', 'recipients', 'includeSms', 'appUrl', 'updatedAt']
};

var NUMERIC = ['meter', 'pmMeter', 'pmDays', 'laborHours', 'partsCost', 'laborCost', 'otherCost', 'total',
  'laborRate', 'downtimeHours', 'everyMeter', 'everyDays', 'lastMeter', 'dateSoonDays'];
var DATA = ['units', 'records', 'employees', 'checks', 'levels', 'pmTasks', 'checklists', 'settings'];
var DATE_FIELDS = [['warrantyExpires', 'Warranty'], ['certExpires', 'Certification'], ['registrationExpires', 'Registration']];

/* ---------- pure helpers (also used by the node tests) ---------- */

function num(v) {
  if (v === '' || v == null) return 0;
  var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  return isFinite(n) ? n : 0;
}

function isActiveFlag(v) {
  return v !== 'no' && v !== false && v !== 'false' && v !== 0 && v !== '0';
}

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  n = n || 180;
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

function addDaysIso(iso, days) {
  var p = String(iso).split('-').map(Number);
  var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysBetweenIso(a, b) {
  var p = function (s) {
    var x = String(s).split('-').map(Number);
    return Date.UTC(x[0], x[1] - 1, x[2]);
  };
  return Math.round((p(b) - p(a)) / 86400000);
}

function startOfWeekIso(iso) {
  var p = String(iso).split('-').map(Number);
  var day = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return addDaysIso(iso, day === 0 ? -6 : 1 - day);
}

function warnDays(every) {
  every = num(every);
  if (every <= 1) return 0;
  if (every <= 7) return 1;
  return Math.max(2, Math.round(every * 0.1));
}

function findById(list, id) {
  for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i];
  return null;
}

function legacyLevelId(unitId) {
  var s = ('lv' + String(unitId || '').replace(/[^A-Za-z0-9]/g, '')).slice(0, 40);
  return s.length >= 4 ? s : 'lvlegacy';
}

function legacyTaskId(unitId) {
  var s = ('tk' + String(unitId || '').replace(/[^A-Za-z0-9]/g, '')).slice(0, 40);
  return s.length >= 4 ? s : 'tklegacy';
}

function stripNum(n) {
  return String(Math.round(num(n) * 100) / 100);
}

function mergeHeaders(existing, wanted) {
  var header = (existing || []).map(function (h) { return String(h || '').trim(); });
  while (header.length && !header[header.length - 1]) header.pop();
  var have = {};
  header.forEach(function (h) { if (h) have[h] = true; });
  (wanted || []).forEach(function (c) {
    if (!have[c]) { header.push(c); have[c] = true; }
  });
  return header;
}

function cellValue(col, v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object') {
    try { v = JSON.stringify(v); } catch (e) { v = ''; }
  }
  if (NUMERIC.indexOf(col) !== -1) {
    var n = Number(v);
    return isFinite(n) ? n : '';
  }
  return String(v).slice(0, 45000);
}

function applyRow(header, cols, existingRow, data) {
  var row = (existingRow || []).slice();
  while (row.length < header.length) row.push('');
  if (row.length > header.length) row.length = header.length;
  data = data || {};
  header.forEach(function (h, i) {
    if (!h || cols.indexOf(h) === -1) return;
    row[i] = cellValue(h, data[h]);
  });
  return row;
}

function rowToObject(header, cols, row) {
  var map = {};
  (header || []).forEach(function (h, i) {
    h = String(h || '').trim();
    if (h && map[h] === undefined) map[h] = i;
  });
  var o = {};
  cols.forEach(function (c) {
    var i = map[c];
    var v = (i == null || !row) ? '' : row[i];
    if (NUMERIC.indexOf(c) !== -1) o[c] = (v === '' || v == null) ? null : Number(v);
    else o[c] = v == null ? '' : String(v);
  });
  return o;
}

function curMeterOf(unit, records) {
  var m = num(unit && unit.meter);
  (records || []).forEach(function (r) {
    if (unit && r.unitId === unit.id && num(r.meter) > m) m = num(r.meter);
  });
  return m;
}

function woNum(r) {
  return 'WO-' + String(r && r.id || '').replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase();
}

function closedService(r) {
  return r && r.kind === 'Service' && r.status !== 'open' && r.stage !== 'rejected';
}

/**
 * Units that still use the old single PM interval become one level plus one task.
 * Existing levels are left alone. pmMeter and pmDays stay on the unit.
 */
function planLegacyPm(units, records, levels) {
  var have = {};
  (levels || []).forEach(function (l) { if (l && l.unitId) have[l.unitId] = true; });
  var out = [];
  (units || []).forEach(function (u) {
    if (!u || !u.id || have[u.id]) return;
    var hrs = num(u.pmMeter), days = num(u.pmDays);
    if (!(hrs > 0) && !(days > 0)) return;
    var basis = hrs > 0 && days > 0 ? 'both' : hrs > 0 ? 'meter' : 'calendar';
    var word = u.meterType === 'Miles' ? 'mi' : 'hrs';
    var name = basis === 'both' ? 'Service' : basis === 'meter' ? (stripNum(hrs) + ' ' + word) : ('Every ' + stripNum(days) + ' days');
    var svc = (records || []).filter(function (r) { return r.unitId === u.id && closedService(r); })
      .sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      })[0];
    var levelId = legacyLevelId(u.id);
    out.push({
      level: {
        id: levelId, unitId: u.id, name: name, basis: basis,
        everyMeter: hrs > 0 ? hrs : 0, everyDays: days > 0 ? days : 0,
        active: 'yes', legacy: 'yes',
        notes: 'Migrated from the single PM interval on this unit.',
        createdAt: ''
      },
      task: {
        id: legacyTaskId(u.id), unitId: u.id, levelId: levelId, name: 'Scheduled service',
        instructions: '', partsJson: '[]', active: 'yes',
        lastCompletedAt: svc && svc.date ? String(svc.date).slice(0, 10) : '',
        lastMeter: svc && num(svc.meter) > 0 ? num(svc.meter) : '',
        lastWoId: svc ? svc.id : '',
        createdAt: ''
      }
    });
  });
  return out;
}

function pmTaskInfo(unit, level, task, records, todayIso) {
  var off = function (summary) { return { status: 'off', summary: summary, suggested: '', openWoId: '' }; };
  if (!task || !isActiveFlag(task.active)) return off('Paused');
  if (!level) return off('This task needs a PM level.');
  if (!isActiveFlag(level.active)) return off('This level is paused.');
  var open = null;
  (records || []).forEach(function (r) {
    if (!open && r.pmTaskId === task.id && r.status === 'open') open = r;
  });
  var status = 'ok';
  var reasons = [];
  var suggested = '';
  var rank = { ok: 0, soon: 1, due: 2, overdue: 3 };
  var worse = function (a, b) { return rank[a] >= rank[b] ? a : b; };
  var consider = function (iso) { if (iso && (!suggested || iso < suggested)) suggested = iso; };
  var basis = level.basis;
  if (basis === 'calendar' || basis === 'both') {
    var every = num(level.everyDays);
    if (every > 0) {
      if (!task.lastCompletedAt) {
        status = worse(status, 'due');
        reasons.push('no PM logged yet');
        consider(todayIso);
      } else {
        var due = addDaysIso(String(task.lastCompletedAt).slice(0, 10), every);
        var left = daysBetweenIso(todayIso, due);
        consider(due);
        if (left < 0) { status = worse(status, 'overdue'); reasons.push(Math.abs(left) + ' day' + (left === -1 ? '' : 's') + ' over'); }
        else if (left === 0) { status = worse(status, 'due'); reasons.push('due today'); }
        else if (left <= warnDays(every)) { status = worse(status, 'soon'); reasons.push(left + ' day' + (left === 1 ? '' : 's') + ' left'); }
        else reasons.push(left + ' days left');
      }
    }
  }
  var metered = unit && unit.meterType !== 'None';
  if ((basis === 'meter' || basis === 'both') && metered) {
    var everyM = num(level.everyMeter);
    var word = unit.meterType === 'Miles' ? 'mi' : 'hrs';
    if (everyM > 0) {
      var hasLast = !(task.lastMeter === '' || task.lastMeter == null) && isFinite(Number(task.lastMeter));
      if (!hasLast) {
        status = worse(status, 'due');
        reasons.push('no meter at last PM');
        consider(todayIso);
      } else {
        var leftM = Number(task.lastMeter) + everyM - curMeterOf(unit, records);
        if (leftM <= 0) {
          status = worse(status, 'overdue');
          reasons.push(Math.abs(Math.round(leftM)) + ' ' + word + ' over');
          consider(todayIso);
        } else {
          if (leftM <= Math.max(1, everyM * 0.1)) status = worse(status, 'soon');
          reasons.push(Math.round(leftM) + ' ' + word + ' left');
        }
      }
    }
  }
  if (basis === 'meter' && unit && unit.meterType === 'None') {
    status = worse(status, 'due');
    reasons.push('unit has no meter');
  }
  var label = status === 'overdue' ? 'Overdue' : status === 'due' ? 'Due now' : status === 'soon' ? 'Due soon' : 'OK';
  var summary = [label].concat(reasons).join(' · ');
  if (open) summary += ' · work order already open';
  return { status: status, summary: summary, suggested: suggested, openWoId: open ? open.id : '' };
}

function dateAlerts(units, todayIso, soonDays) {
  if (!(num(soonDays) > 0)) soonDays = 30;
  var out = [];
  (units || []).forEach(function (u) {
    DATE_FIELDS.forEach(function (f) {
      var d = String(u[f[0]] || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      var left = daysBetweenIso(todayIso, d);
      if (left < 0) out.push({ unitId: u.id, unit: u.unit || '', label: f[1], when: d, state: 'overdue', left: left });
      else if (left <= soonDays) out.push({ unitId: u.id, unit: u.unit || '', label: f[1], when: d, state: 'soon', left: left });
    });
  });
  return out;
}

function lateJobs(records, todayIso) {
  return (records || []).filter(function (r) {
    return r.status === 'open' && r.dueDate && String(r.dueDate).slice(0, 10) < todayIso;
  });
}

function approvalJobs(records) {
  return (records || []).filter(function (r) {
    return r.status === 'open' && r.stage === 'approval';
  });
}

function hoursDownBetween(records, from, to) {
  var h = 0;
  (records || []).forEach(function (r) {
    var d = String(r.date || '').slice(0, 10);
    if (d && d >= from && d <= to) h += num(r.downtimeHours);
  });
  return Math.round(h * 10) / 10;
}

function smsAddress(phone, carrier) {
  var domain = String(carrier || '').trim().toLowerCase().replace(/^@/, '');
  if (!domain || domain.indexOf('.') === -1) return '';
  var digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  if (digits.length !== 10) return '';
  return digits + '@' + domain;
}

function parseIdList(raw) {
  try {
    var a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch (e) { return []; }
}

function buildDigest(input) {
  input = input || {};
  var todayIso = input.today;
  var settings = input.settings || {};
  if (String(settings.digestOn || 'no') !== 'yes') {
    return { send: false, message: 'Daily reminder is turned off in the app.' };
  }
  var soonDays = num(settings.dateSoonDays) > 0 ? num(settings.dateSoonDays) : 30;
  var ids = parseIdList(settings.recipients);
  var chosen = (input.employees || []).filter(function (e) { return ids.indexOf(String(e.id)) !== -1; });
  var pmLines = [];
  (input.pmTasks || []).forEach(function (task) {
    var unit = findById(input.units, task.unitId);
    var level = findById(input.levels, task.levelId);
    var info = pmTaskInfo(unit, level, task, input.records, todayIso);
    if (info.status === 'soon' || info.status === 'due' || info.status === 'overdue') {
      pmLines.push(clip((unit && unit.unit ? unit.unit : 'Unit') + ' — ' + (level && level.name ? level.name : 'PM') + ' — ' + (task.name || 'Task') + ': ' + info.summary));
    }
  });
  var late = lateJobs(input.records, todayIso).map(function (r) {
    var u = findById(input.units, r.unitId);
    return clip(woNum(r) + ' ' + ((u && u.unit) || r.unitNumber || '') + ': ' + (r.description || '') + ' — due ' + String(r.dueDate).slice(0, 10));
  });
  var dates = dateAlerts(input.units, todayIso, soonDays).map(function (d) {
    return clip(d.unit + ' ' + d.label.toLowerCase() + ' ' + (d.state === 'overdue' ? 'overdue' : 'due ' + d.when));
  });
  var waiting = approvalJobs(input.records).map(function (r) {
    var u = findById(input.units, r.unitId);
    return clip(woNum(r) + ' ' + ((u && u.unit) || r.unitNumber || '') + ': ' + (r.description || '') + (r.requestedBy ? ' — asked by ' + r.requestedBy : ''));
  });
  var sections = [];
  if (pmLines.length) sections.push('PM DUE OR COMING UP\n' + pmLines.join('\n'));
  if (late.length) sections.push('LATE WORK ORDERS\n' + late.join('\n'));
  if (dates.length) sections.push('WARRANTY, CERTIFICATION, REGISTRATION\n' + dates.join('\n'));
  if (waiting.length) sections.push('WAITING ON APPROVAL\n' + waiting.join('\n'));
  if (!sections.length) return { send: false, message: 'Nothing overdue, due soon, late, or waiting on approval.' };
  var wantSms = String(settings.includeSms || '') === 'yes';
  var recipients = [];
  chosen.forEach(function (e) {
    var email = String(e.email || '').trim();
    var sms = wantSms ? smsAddress(e.phone, e.smsCarrier) : '';
    if (email || sms) recipients.push({ name: e.name || email || sms, email: email, sms: sms });
  });
  if (!recipients.length) {
    return { send: false, message: 'Daily reminder is on, but nobody selected has an email or a carrier text address.' };
  }
  var counts = [];
  if (pmLines.length) counts.push(pmLines.length + ' PM');
  if (late.length) counts.push(late.length + ' late');
  if (dates.length) counts.push(dates.length + ' date' + (dates.length === 1 ? '' : 's'));
  if (waiting.length) counts.push(waiting.length + ' to approve');
  var subject = 'Fleet maintenance: ' + counts.join(', ');
  var body = sections.join('\n\n');
  var week = hoursDownBetween(input.records, startOfWeekIso(todayIso), todayIso);
  body += '\n\nHours down this week: ' + week;
  if (settings.appUrl) body += '\n\nOpen the log: ' + settings.appUrl;
  body += '\n\nSent by the fleet maintenance log. Turn this off under Team → Daily reminders.';
  var sms = clip(subject + (settings.appUrl ? ' ' + settings.appUrl : ''), 300);
  return { send: true, subject: subject, body: body, sms: sms, recipients: recipients, message: 'Ready to send to ' + recipients.length + '.' };
}

/* ---------- web app ---------- */

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad request' }); }
  return handle(p);
}

function doGet() {
  return out({ ok: true, message: 'Fleet Maintenance Log backend is running.', version: 2 });
}

function handle(p) {
  try {
    if (String(p.code || '') !== ACCESS_CODE) return out({ ok: false, error: 'unauthorized' });
    if (p.action === 'list') return listAll_();
    if (p.action === 'upload') return uploadPhoto_(p);
    if (p.action === 'batch') return batch_(p);
    if (!COLUMNS[p.collection]) return out({ ok: false, error: 'unknown collection' });
    if (!okId(p.id)) return out({ ok: false, error: 'bad id' });
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { applyOp_({ op: p.action, collection: p.collection, id: p.id, data: p.data || {} }); }
    finally { lock.releaseLock(); }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function listAll_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureAll_();
    migrateLegacyPm_();
    var body = { ok: true, version: 2 };
    DATA.forEach(function (name) { body[name] = readAll(name); });
    return out(body);
  } finally { lock.releaseLock(); }
}

function batch_(p) {
  var ops = p.ops || [];
  if (!Array.isArray(ops) || !ops.length || ops.length > 40) return out({ ok: false, error: 'bad batch' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ops.forEach(function (op) { applyOp_(op); });
  } finally { lock.releaseLock(); }
  return out({ ok: true });
}

function okId(id) { return /^[A-Za-z0-9_-]{4,40}$/.test(String(id || '')); }

function applyOp_(op) {
  var name = op.collection;
  var action = op.op || op.action;
  if (!COLUMNS[name]) throw new Error('unknown collection');
  if (!okId(op.id)) throw new Error('bad id');
  if (action === 'delete') { deleteDoc(name, op.id); return; }
  if (action !== 'set' && action !== 'update') throw new Error('bad op');
  var data = Object.assign({}, op.data || {});
  if (action === 'update') {
    var cur = readDoc(name, op.id);
    if (!cur) throw new Error('not found');
    data = Object.assign(cur, data);
  }
  writeDoc(name, op.id, data);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- sheets ---------- */

function ensureAll_() { DATA.forEach(function (name) { ensureSheet(name); }); }

function ensureSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cols = COLUMNS[name];
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    formatHeaderCols_(sh, cols, 1);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var merged = mergeHeaders(header, cols);
  var trimmed = header.map(function (h) { return String(h || '').trim(); });
  while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop();
  var same = trimmed.length === merged.length;
  if (same) {
    for (var i = 0; i < merged.length; i++) if (trimmed[i] !== merged[i]) { same = false; break; }
  }
  if (!same) {
    sh.getRange(1, 1, 1, merged.length).setValues([merged]).setFontWeight('bold');
    if (merged.length > trimmed.length) formatHeaderCols_(sh, merged.slice(trimmed.length), trimmed.length + 1);
  }
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  return sh;
}

function formatHeaderCols_(sh, cols, startCol) {
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  cols.forEach(function (c, i) {
    var range = sh.getRange(2, startCol + i, rows, 1);
    if (NUMERIC.indexOf(c) === -1) range.setNumberFormat('@');
    else if (/Cost|total|Rate|rate/.test(c)) range.setNumberFormat('$#,##0.00');
  });
}

function headerOf_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
}

function toObj(cols, row, header) {
  var copy = row.slice();
  header.forEach(function (h, i) {
    var v = copy[i];
    if (v instanceof Date) {
      if (h === 'createdAt' || h === 'updatedAt' || h === 'completedAt' || h === 'approvalAt' || h === 'at') copy[i] = v.toISOString();
      else copy[i] = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  });
  return rowToObject(header, cols, copy);
}

function readAll(name) {
  var sh = ensureSheet(name);
  var cols = COLUMNS[name];
  var header = headerOf_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = Math.max(header.length, 1);
  var idCol = header.indexOf('id');
  if (idCol < 0) idCol = 0;
  return sh.getRange(2, 1, last - 1, width).getValues()
    .filter(function (r) { return String(r[idCol] || '') !== ''; })
    .map(function (r) { return toObj(cols, r, header); });
}

function findRow(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function readDoc(name, id) {
  var sh = ensureSheet(name);
  var r = findRow(sh, id);
  if (!r) return null;
  var header = headerOf_(sh);
  var width = Math.max(header.length, 1);
  return toObj(COLUMNS[name], sh.getRange(r, 1, 1, width).getValues()[0], header);
}

function writeDoc(name, id, data) {
  var sh = ensureSheet(name);
  var cols = COLUMNS[name];
  data.id = id;
  if (name === 'records') data.total = num(data.partsCost) + num(data.laborCost) + num(data.otherCost);
  var header = headerOf_(sh);
  var width = Math.max(header.length, 1);
  var r = findRow(sh, id);
  var existing = [];
  if (r) existing = sh.getRange(r, 1, 1, width).getValues()[0];
  else r = sh.getLastRow() + 1;
  var row = applyRow(header, cols, existing, data);
  sh.getRange(r, 1, 1, row.length).setValues([row]);
}

function deleteDoc(name, id) {
  var sh = ensureSheet(name);
  var r = findRow(sh, id);
  if (r) sh.deleteRow(r);
}

function migrateLegacyPm_() {
  var plan = planLegacyPm(readAll('units'), readAll('records'), readAll('levels'));
  var now = new Date().toISOString();
  plan.forEach(function (p) {
    p.level.createdAt = now;
    p.task.createdAt = now;
    writeDoc('levels', p.level.id, p.level);
    writeDoc('pmTasks', p.task.id, p.task);
  });
  return plan.length;
}

/* ---------- photos ---------- */

function photosFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var it = DriveApp.getFoldersByName('Fleet Maintenance Photos');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('Fleet Maintenance Photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function uploadPhoto_(p) {
  var raw = String(p.data || '');
  var m = raw.match(/^data:([^;]+);base64,([\s\S]+)$/);
  var mime = String(p.mime || (m && m[1]) || 'image/jpeg').split(';')[0];
  var b64 = (m ? m[2] : raw).replace(/\s/g, '');
  if (!/^image\//.test(mime)) return out({ ok: false, error: 'not an image' });
  if (b64.length > 2800000) return out({ ok: false, error: 'photo too large' });
  var bytes = Utilities.base64Decode(b64);
  if (bytes.length > 2000000) return out({ ok: false, error: 'photo too large' });
  var name = String(p.name || 'photo.jpg').replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'photo.jpg';
  var file = photosFolder_().createFile(Utilities.newBlob(bytes, mime, name));
  var shared = false;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    shared = true;
  } catch (err) { shared = false; }
  var fileId = file.getId();
  return out({
    ok: true,
    fileId: fileId,
    name: file.getName(),
    shared: shared,
    url: 'https://drive.google.com/file/d/' + fileId + '/view',
    thumb: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400'
  });
}

/* ---------- daily reminder ---------- */

function loadDigestInput_() {
  ensureAll_();
  migrateLegacyPm_();
  var settings = { id: 'prefs', digestOn: 'no', dateSoonDays: 30, recipients: '[]', includeSms: 'no', appUrl: '', updatedAt: '' };
  readAll('settings').forEach(function (r) { if (r.id === 'prefs') settings = r; });
  return {
    today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    units: readAll('units'),
    records: readAll('records'),
    employees: readAll('employees'),
    levels: readAll('levels'),
    pmTasks: readAll('pmTasks'),
    settings: settings
  };
}

function dispatchDigest_(pack) {
  if (!pack.send) return pack.message;
  var sent = 0;
  var failed = [];
  var sendOne = function (to, subject, body, who) {
    try { MailApp.sendEmail(to, subject, body); sent++; }
    catch (err) { failed.push(who + ': ' + String(err && err.message || err)); }
  };
  pack.recipients.forEach(function (r) {
    if (r.email) sendOne(r.email, pack.subject, pack.body, r.name);
    if (r.sms) sendOne(r.sms, 'Fleet', pack.sms, r.name + ' text');
  });
  var msg = 'Reminder sent (' + sent + ').';
  if (failed.length) msg += ' Failed: ' + failed.join('; ');
  return msg;
}

function sendDailyDigest() {
  var msg = dispatchDigest_(buildDigest(loadDigestInput_()));
  try { SpreadsheetApp.getActive().toast(msg); } catch (e) {}
  return msg;
}

function removeDigestTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
  });
}

function installDailyDigest() {
  removeDigestTriggers_();
  ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(6).create();
  try {
    SpreadsheetApp.getActive().toast('Daily reminder installed for about 6:00 each morning (Apps Script timezone).');
  } catch (e) {}
}

function removeDailyDigest() {
  removeDigestTriggers_();
  try { SpreadsheetApp.getActive().toast('Daily reminder removed.'); } catch (e) {}
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fleet Maintenance')
    .addItem('Install daily reminder (about 6:00)', 'installDailyDigest')
    .addItem('Send reminder now', 'sendDailyDigest')
    .addItem('Remove daily reminder', 'removeDailyDigest')
    .addToUi();
}

/** Run once from the editor after pasting this file. Creates tabs, the photo folder, and migrates old PM intervals. */
function setup() {
  ensureAll_();
  photosFolder_();
  migrateLegacyPm_();
}
