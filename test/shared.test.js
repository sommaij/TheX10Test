'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/js/shared.js');

const ctx = { today: '2026-10-31', timeZone: 'Asia/Bangkok', categories: S.DEFAULT_CATEGORIES, now: '2026-10-31T02:00:00.000Z' };

test('accepts the field names other apps use', () => {
  const f = S.normalizeFields({ text: 'ซื้อนม', description: 'ร้านหน้าปากซอย', dueDate: 'tomorrow', time: '9:05', category: 'ส่วนตัว', completed: false }, ctx);
  assert.equal(f.title, 'ซื้อนม');
  assert.equal(f.notes, 'ร้านหน้าปากซอย');
  assert.equal(f.due, '2026-11-01');
  assert.equal(f.time, '09:05');
  assert.equal(f.category, 'personal');
  assert.equal(f.done, false);
});

test('plain string becomes a title', () => {
  assert.deepEqual(S.normalizeFields('โทรหาแม่', ctx), { title: 'โทรหาแม่' });
});

test('parses dates in several formats and time zones', () => {
  assert.deepEqual(S.parseWhen('2026-11-05', ctx), { due: '2026-11-05' });
  assert.deepEqual(S.parseWhen('2026-11-05T14:30', ctx), { due: '2026-11-05', time: '14:30' });
  // 17:30 UTC is 00:30 the next day in Bangkok
  assert.deepEqual(S.parseWhen('2026-11-05T17:30:00Z', ctx), { due: '2026-11-06', time: '00:30' });
  assert.deepEqual(S.parseWhen('05/11/2569', ctx), { due: '2026-11-05' });
  assert.deepEqual(S.parseWhen('พรุ่งนี้', ctx), { due: '2026-11-01' });
  assert.deepEqual(S.parseWhen(null, ctx), { due: null, time: null });
  assert.throws(() => S.parseWhen('2026-02-30', ctx), S.ValidationError);
  assert.throws(() => S.parseWhen('someday', ctx), S.ValidationError);
});

test('reminder, repeat and priority are lenient', () => {
  assert.equal(S.parseReminder('1h'), 60);
  assert.equal(S.parseReminder(true), 0);
  assert.equal(S.parseReminder('none'), null);
  assert.equal(S.parseRepeat('ทุกสัปดาห์'), 'weekly');
  assert.throws(() => S.parseRepeat('fortnightly'), S.ValidationError);
  assert.equal(S.parsePriority('urgent'), 2);
  assert.equal(S.parsePriority('สำคัญ'), 1);
  assert.equal(S.parsePriority(9), 2);
});

test('unknown category name is created', () => {
  const f = S.normalizeFields({ title: 'x', category: 'ฝ่ายช่าง' }, ctx);
  assert.equal(f._newCategory.name, 'ฝ่ายช่าง');
  assert.equal(f.category, f._newCategory.id);
});

test('rejects tasks without a title', () => {
  assert.throws(() => S.createTask(S.normalizeFields({ notes: 'no title' }, ctx), ctx), /title is required/);
  assert.throws(() => S.normalizeFields({ title: '   ' }, ctx), /must not be empty/);
});

test('repeating task spawns the next occurrence with a stable id', () => {
  const t = S.createTask({ title: 'ประชุมทีม', due: '2026-10-30', repeat: 'weekdays', subtasks: [{ id: 's1', title: 'agenda', done: true }] }, ctx);
  const tasks = [t];
  const c = Object.assign({}, ctx, { find: (id) => tasks.find((x) => x.id === id) });
  const r = S.setDone(t, true, c);
  assert.equal(r.task.done, true);
  // Fri 30 Oct (overdue) -> next weekday on/after today (Sat 31) is Mon 2 Nov
  assert.equal(r.spawn.due, '2026-11-02');
  assert.equal(r.spawn.id, `${t.id}@2026-11-02`);
  assert.equal(r.spawn.subtasks[0].done, false);
  tasks.push(r.spawn);
  // undo removes the untouched next occurrence
  const u = S.setDone(r.task, false, c);
  assert.equal(u.task.done, false);
  assert.equal(u.removeId, r.spawn.id);
});

test('monthly repeat clamps to the end of the month', () => {
  assert.equal(S.nextDue('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(S.nextDue('2028-02-29', 'yearly'), '2029-02-28');
});

test('maps a nested API response with templates', () => {
  const json = S.demoFeed('hotel-pms', '2026-10-31');
  const preset = S.PRESETS.find((p) => p.id === 'demo-pms').config;
  const r = S.mapResponse(json, preset, ctx);
  assert.equal(r.total, 4);
  assert.equal(r.errors.length, 0);
  assert.equal(r.items[0].title, 'ทำความสะอาด ห้อง 1203');
  assert.equal(r.items[0].due, '2026-10-31');
  assert.equal(r.items[0].time, '11:00');
  assert.equal(r.items[0].externalId, 'HK-1203');
  assert.equal(r.items[1].priority, 2);
});

test('auto-detects common list wrappers and ids', () => {
  const r = S.mapResponse({ results: [{ id: 7, name: 'A', completed: true }, { foo: 1 }] }, { mapping: {} }, ctx);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].title, 'A');
  assert.equal(r.items[0].externalId, '7');
  assert.equal(r.items[0].done, true);
  assert.equal(r.errors.length, 1);
});
