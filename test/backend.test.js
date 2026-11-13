const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const context = { console };
vm.createContext(context);
vm.runInContext(code, context);

const {
  mergeHeaders, applyRow, rowToObject, planLegacyPm, pmTaskInfo, dateAlerts,
  lateJobs, approvalJobs, hoursDownBetween, smsAddress, buildDigest, legacyLevelId,
  COLUMNS, NUMERIC
} = context;

const TODAY = '2026-11-13';

function test(name, fn) {
  try { fn(); console.log('ok  ' + name); }
  catch (err) { console.error('FAIL ' + name); throw err; }
}

test('mergeHeaders appends new columns after the existing header', () => {
  const old = ['id', 'unit', 'type', 'name', 'make', 'model', 'year', 'serial', 'meterType', 'meter', 'pmMeter', 'pmDays', 'status', 'notes', 'createdAt'];
  const merged = mergeHeaders(old, COLUMNS.units);
  assert.deepStrictEqual(merged.slice(0, old.length), old);
  assert.deepStrictEqual(merged.slice(old.length), ['warrantyExpires', 'certExpires', 'registrationExpires']);
});

test('mergeHeaders keeps a custom column and does not reorder it', () => {
  const merged = mergeHeaders(['id', 'unit', 'bay', ''], COLUMNS.units);
  assert.strictEqual(merged[0], 'id');
  assert.strictEqual(merged[1], 'unit');
  assert.strictEqual(merged[2], 'bay');
  assert.ok(merged.indexOf('warrantyExpires') > 2);
  assert.strictEqual(merged.filter(h => h === 'unit').length, 1);
});

test('applyRow writes stage without wiping a custom cell or shifting old columns', () => {
  const header = mergeHeaders(
    ['id', 'date', 'unitId', 'unitNumber', 'kind', 'status', 'description', 'parts', 'meter', 'laborHours', 'partsCost', 'laborCost', 'otherCost', 'total', 'vendor', 'createdAt', 'updatedAt', 'bay'],
    COLUMNS.records
  );
  const existing = header.map((h, i) => h === 'bay' ? 'north' : h === 'description' ? 'Leak' : h === 'id' ? 'abcd' : '');
  const data = rowToObject(header, COLUMNS.records, existing);
  data.stage = 'approval';
  data.description = 'Leak';
  const row = applyRow(header, COLUMNS.records, existing, data);
  assert.strictEqual(row[header.indexOf('description')], 'Leak');
  assert.strictEqual(row[header.indexOf('stage')], 'approval');
  assert.strictEqual(row[header.indexOf('bay')], 'north');
  assert.strictEqual(row[0], 'abcd');
});

test('blank numeric stays null and zero stays zero', () => {
  const header = ['id', 'meter', 'downtimeHours'];
  const obj = rowToObject(header, ['id', 'meter', 'downtimeHours'], ['abcd', '', 0]);
  assert.strictEqual(obj.meter, null);
  assert.strictEqual(obj.downtimeHours, 0);
});

test('legacy PM migration builds one level and keeps a unit that already has a level', () => {
  const units = [
    { id: 'fork01', unit: 'FL-07', meterType: 'Hours', meter: 2300, pmMeter: 250, pmDays: null },
    { id: 'both01', unit: 'TK-2', meterType: 'Miles', meter: 80000, pmMeter: 5000, pmDays: 180 },
    { id: 'days01', unit: 'GN-1', meterType: 'None', meter: null, pmMeter: null, pmDays: 90 },
    { id: 'none01', unit: 'TR-1', meterType: 'Hours', pmMeter: null, pmDays: null },
    { id: 'haslvl', unit: 'AC-1', meterType: 'Hours', pmMeter: 100, pmDays: null }
  ];
  const records = [
    { id: 'svc111', unitId: 'fork01', kind: 'Service', status: 'done', stage: 'done', date: '2026-09-01', meter: 2000, createdAt: '2026-09-01T12:00:00Z' },
    { id: 'rej111', unitId: 'fork01', kind: 'Service', status: 'done', stage: 'rejected', date: '2026-10-01', meter: 2100, createdAt: '2026-10-01T12:00:00Z' },
    { id: 'new111', unitId: 'fork01', kind: 'Service', status: 'open', date: '2026-11-01', meter: 2200, createdAt: '2026-11-01T12:00:00Z' }
  ];
  const plan = planLegacyPm(units, records, [{ id: 'lvl1', unitId: 'haslvl' }]);
  const ids = Array.from(plan.map(p => p.level.unitId)).sort();
  assert.deepStrictEqual(ids, ['both01', 'days01', 'fork01']);
  const fork = plan.find(p => p.level.unitId === 'fork01');
  assert.strictEqual(fork.level.name, '250 hrs');
  assert.strictEqual(fork.level.basis, 'meter');
  assert.strictEqual(fork.level.legacy, 'yes');
  assert.strictEqual(fork.level.everyMeter, 250);
  assert.strictEqual(fork.task.name, 'Scheduled service');
  assert.strictEqual(fork.task.lastCompletedAt, '2026-09-01');
  assert.strictEqual(fork.task.lastMeter, 2000);
  assert.strictEqual(fork.task.lastWoId, 'svc111');
  assert.strictEqual(fork.level.id, legacyLevelId('fork01'));
  assert.match(fork.level.id, /^[A-Za-z0-9_-]{4,40}$/);
  const both = plan.find(p => p.level.unitId === 'both01');
  assert.strictEqual(both.level.basis, 'both');
  assert.strictEqual(both.level.name, 'Service');
  const days = plan.find(p => p.level.unitId === 'days01');
  assert.strictEqual(days.level.basis, 'calendar');
  assert.strictEqual(days.level.name, 'Every 90 days');
});

test('running migration twice does not add a second level', () => {
  const units = [{ id: 'fork01', meterType: 'Hours', pmMeter: 250 }];
  const once = planLegacyPm(units, [], []);
  const twice = planLegacyPm(units, [], once.map(p => p.level));
  assert.strictEqual(twice.length, 0);
});

test('hour PM is overdue from the last service meter', () => {
  const unit = { id: 'fork01', meterType: 'Hours', meter: 2300 };
  const level = { id: 'lv', basis: 'meter', everyMeter: 250, everyDays: 0, active: 'yes' };
  const task = { id: 'tk', lastCompletedAt: '2026-09-01', lastMeter: 2000, active: 'yes' };
  const info = pmTaskInfo(unit, level, task, [], TODAY);
  assert.strictEqual(info.status, 'overdue');
  assert.match(info.summary, /50 hrs over/);
});

test('a meter reading on a work order counts toward the current meter', () => {
  const unit = { id: 'fork01', meterType: 'Hours', meter: 1000 };
  const level = { id: 'lv', basis: 'meter', everyMeter: 250, active: 'yes' };
  const task = { id: 'tk', lastMeter: 2000, lastCompletedAt: '2026-09-01', active: 'yes' };
  const info = pmTaskInfo(unit, level, task, [{ unitId: 'fork01', meter: 2300, pmTaskId: '' }], TODAY);
  assert.strictEqual(info.status, 'overdue');
});

test('day PM is due soon inside the warning window and ok outside it', () => {
  const unit = { id: 'u1', meterType: 'None' };
  const level = { id: 'lv', basis: 'calendar', everyDays: 90, active: 'yes' };
  const soon = pmTaskInfo(unit, level, { id: 'tk', lastCompletedAt: '2026-08-22', active: 'yes', lastMeter: '' }, [], TODAY);
  assert.strictEqual(soon.status, 'soon');
  const ok = pmTaskInfo(unit, level, { id: 'tk', lastCompletedAt: '2026-11-01', active: 'yes', lastMeter: '' }, [], TODAY);
  assert.strictEqual(ok.status, 'ok');
});

test('no PM history is due, and an open work order is reported', () => {
  const unit = { id: 'u1', meterType: 'Hours', meter: 10 };
  const level = { id: 'lv', basis: 'meter', everyMeter: 250, active: 'yes' };
  const task = { id: 'tk', lastCompletedAt: '', lastMeter: '', active: 'yes' };
  const info = pmTaskInfo(unit, level, task, [{ id: 'wo1', pmTaskId: 'tk', status: 'open' }], TODAY);
  assert.strictEqual(info.status, 'due');
  assert.strictEqual(info.openWoId, 'wo1');
  assert.match(info.summary, /already open/);
});

test('paused tasks are off', () => {
  const info = pmTaskInfo({ id: 'u', meterType: 'Hours' }, { active: 'yes', basis: 'calendar', everyDays: 7 }, { active: 'no', id: 't' }, [], TODAY);
  assert.strictEqual(info.status, 'off');
});

test('date alerts catch overdue and due-soon and skip dates that are fine', () => {
  const units = [{ id: 'u', unit: 'TK-2', warrantyExpires: '2027-06-01', certExpires: '2026-11-08', registrationExpires: '2026-11-25' }];
  const alerts = dateAlerts(units, TODAY, 30);
  assert.strictEqual(alerts.length, 2);
  assert.strictEqual(alerts.find(a => a.label === 'Certification').state, 'overdue');
  assert.strictEqual(alerts.find(a => a.label === 'Registration').state, 'soon');
});

test('late jobs and approval jobs follow the sheet fields', () => {
  const records = [
    { id: 'aaaa', status: 'open', dueDate: '2026-11-01', stage: 'open' },
    { id: 'bbbb', status: 'open', dueDate: '2026-11-20', stage: 'approval' },
    { id: 'cccc', status: 'done', dueDate: '2026-11-01', stage: 'done' }
  ];
  assert.strictEqual(lateJobs(records, TODAY).length, 1);
  assert.strictEqual(approvalJobs(records)[0].id, 'bbbb');
});

test('hours down this week ignores last month', () => {
  const records = [
    { date: '2026-11-13', downtimeHours: 6.5 },
    { date: '2026-11-09', downtimeHours: 1 },
    { date: '2026-10-02', downtimeHours: 20 }
  ];
  assert.strictEqual(hoursDownBetween(records, '2026-11-09', '2026-11-13'), 7.5);
});

test('sms address uses a 10-digit carrier gateway', () => {
  assert.strictEqual(smsAddress('(910) 555-0142', 'vtext.com'), '9105550142@vtext.com');
  assert.strictEqual(smsAddress('1-910-555-0142', '@txt.att.net'), '9105550142@txt.att.net');
  assert.strictEqual(smsAddress('555-0142', 'vtext.com'), '');
  assert.strictEqual(smsAddress('9105550142', ''), '');
});

test('digest stays quiet when it is off or there is nothing to say', () => {
  const quiet = buildDigest({ today: TODAY, settings: { digestOn: 'no' }, employees: [], units: [], records: [], levels: [], pmTasks: [] });
  assert.strictEqual(quiet.send, false);
  const empty = buildDigest({
    today: TODAY,
    settings: { digestOn: 'yes', recipients: '["e1"]', dateSoonDays: 30 },
    employees: [{ id: 'e1', name: 'Ana', email: 'ana@example.com' }],
    units: [{ id: 'u', unit: 'FL-07', meterType: 'Hours', meter: 100 }],
    records: [],
    levels: [{ id: 'lv', unitId: 'u', name: '250 hrs', basis: 'meter', everyMeter: 250, active: 'yes' }],
    pmTasks: [{ id: 'tk', unitId: 'u', levelId: 'lv', name: 'Oil', active: 'yes', lastCompletedAt: TODAY, lastMeter: 100 }]
  });
  assert.strictEqual(empty.send, false);
});

test('digest lists PM, late work, dates, and approvals and builds a text address', () => {
  const pack = buildDigest({
    today: TODAY,
    settings: { digestOn: 'yes', dateSoonDays: 30, recipients: '["mike"]', includeSms: 'yes', appUrl: 'https://chbtools.github.io/fleet-maintenance-/' },
    employees: [{ id: 'mike', name: 'Mike', email: 'mike@example.com', phone: '9105550142', smsCarrier: 'vtext.com' }],
    units: [{ id: 'fork', unit: 'FL-07', meterType: 'Hours', meter: 2300, certExpires: '2026-11-01' }],
    levels: [{ id: 'lv', unitId: 'fork', name: '250 hrs', basis: 'meter', everyMeter: 250, active: 'yes' }],
    pmTasks: [{ id: 'tk', unitId: 'fork', levelId: 'lv', name: 'Scheduled service', active: 'yes', lastCompletedAt: '2026-09-01', lastMeter: 2000 }],
    records: [
      { id: 'latewo1', unitId: 'fork', status: 'open', stage: 'open', dueDate: '2026-11-10', description: 'Hose leak', date: TODAY, downtimeHours: 4 },
      { id: 'aprvwo1', unitId: 'fork', status: 'open', stage: 'approval', dueDate: '2026-11-20', description: 'Seat belt', requestedBy: 'Ana' }
    ]
  });
  assert.strictEqual(pack.send, true);
  assert.match(pack.subject, /PM/);
  assert.match(pack.subject, /late/);
  assert.match(pack.subject, /date/);
  assert.match(pack.subject, /approve/);
  assert.match(pack.body, /PM DUE OR COMING UP/);
  assert.match(pack.body, /LATE WORK ORDERS/);
  assert.match(pack.body, /WAITING ON APPROVAL/);
  assert.match(pack.body, /certification overdue/);
  assert.match(pack.body, /Hours down this week: 4/);
  assert.strictEqual(pack.recipients[0].sms, '9105550142@vtext.com');
  assert.strictEqual(pack.recipients[0].email, 'mike@example.com');
});

test('digest does not invent a recipient', () => {
  const pack = buildDigest({
    today: TODAY,
    settings: { digestOn: 'yes', recipients: '[]', dateSoonDays: 30 },
    employees: [{ id: 'mike', email: 'mike@example.com' }],
    units: [{ id: 'u', unit: 'TK-2', certExpires: '2026-11-01' }],
    records: [], levels: [], pmTasks: []
  });
  assert.strictEqual(pack.send, false);
  assert.match(pack.message, /nobody selected/);
});

test('record columns still start with the original header', () => {
  assert.deepStrictEqual(Array.from(COLUMNS.records).slice(0, 17), [
    'id', 'date', 'unitId', 'unitNumber', 'kind', 'status', 'description', 'parts',
    'meter', 'laborHours', 'partsCost', 'laborCost', 'otherCost', 'total', 'vendor', 'createdAt', 'updatedAt'
  ]);
  assert.ok(COLUMNS.records.indexOf('stage') > 16);
  assert.ok(NUMERIC.indexOf('downtimeHours') >= 0);
});

console.log('all backend tests passed');
