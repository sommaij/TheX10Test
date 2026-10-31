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

test('status: in progress, done and words from other apps', () => {
  assert.equal(S.parseStatus('in_progress'), 'doing');
  assert.equal(S.parseStatus('In Progress'), 'doing');
  assert.equal(S.parseStatus('กำลังทำ'), 'doing');
  assert.equal(S.parseStatus('completed'), 'done');
  assert.equal(S.parseStatus('open'), 'todo');
  const f = S.normalizeFields({ title: 'x', status: 'doing' }, ctx);
  assert.deepEqual([f.status, f.done], ['doing', false]);
  const d = S.normalizeFields({ title: 'x', status: 'done' }, ctx);
  assert.deepEqual([d.status, d.done], ['done', true]);
  // done=true wins over a contradictory status
  const c = S.normalizeFields({ title: 'x', done: true, status: 'doing' }, ctx);
  assert.deepEqual([c.status, c.done], ['done', true]);
});

test('status stays in step with done through edits and completion', () => {
  const t = S.createTask({ title: 'ซ่อมแอร์', status: 'doing' }, ctx);
  assert.equal(t.status, 'doing');
  const c = Object.assign({}, ctx, { find: () => null });
  const done = S.setDone(t, true, c).task;
  assert.equal(done.status, 'done');
  // reopening an in-progress task keeps it in progress
  assert.equal(S.setDone(Object.assign({}, done, { status: 'doing' }), false, c).task.status, 'doing');
  assert.equal(S.setDone(done, false, c).task.status, 'todo');
  // an edit cannot leave a finished task "in progress"
  assert.equal(S.patchTask(done, { status: 'doing' }, ctx).status, 'done');
});

test('buckets and widget payload summarise the day', () => {
  const mk = (f) => S.createTask(Object.assign({ title: 't' }, f), ctx);
  const tasks = [
    mk({ title: 'late', due: '2026-10-30' }),
    mk({ title: 'today 9', due: '2026-10-31', time: '09:00' }),
    mk({ title: 'today 8', due: '2026-10-31', time: '08:00', category: 'work' }),
    mk({ title: 'doing', due: '2026-10-29', status: 'doing' }),
    mk({ title: 'later', due: '2026-11-03' }),
    mk({ title: 'far', due: '2027-01-01' }),
    mk({ title: 'someday' }),
    Object.assign(mk({ title: 'finished', due: '2026-10-31' }), { done: true, status: 'done', doneAt: '2026-10-31T03:00:00.000Z' }),
  ];
  const b = S.buckets(tasks, '2026-10-31', 'Asia/Bangkok');
  assert.deepEqual(b.doing.map((t) => t.title), ['doing']);
  assert.deepEqual(b.overdue.map((t) => t.title), ['late']);
  assert.deepEqual(b.today.map((t) => t.title), ['today 8', 'today 9']);
  assert.equal(b.doneToday.length, 1);
  assert.equal(S.nextUp(b).title, 'doing');

  const w = S.widgetPayload(tasks, S.DEFAULT_CATEGORIES, ctx);
  assert.equal(w.today, '2026-10-31');
  assert.equal(w.openCount, 7);
  assert.deepEqual(w.doneDays, { '2026-10-31': 1 });
  assert.ok(!w.tasks.some((t) => t.title === 'far'), 'only the next two weeks');
  const t8 = w.tasks.find((t) => t.title === 'today 8');
  assert.equal(t8.color, S.COLOR_HEX.blue);
  assert.equal(t8.category, 'งาน');
});

test('steps keep details and record when each was finished', () => {
  const t = S.createTask(S.normalizeFields({ title: 'ซ่อมแอร์', steps: [
    { title: 'รับแจ้ง', detail: 'แขกแจ้ง 09:10', done: true },
    'ตรวจสอบหน้างาน',
    { name: 'ซ่อม', note: 'ล้างคอยล์' },
  ] }, ctx), ctx);
  assert.deepEqual(t.subtasks.map((x) => [x.title, x.detail, x.done]), [['รับแจ้ง', 'แขกแจ้ง 09:10', true], ['ตรวจสอบหน้างาน', '', false], ['ซ่อม', 'ล้างคอยล์', false]]);
  const info = S.stepInfo(t);
  assert.deepEqual([info.total, info.done, info.index, info.current.title], [3, 1, 2, 'ตรวจสอบหน้างาน']);

  // ticking a step starts the task and stamps the time
  const later = Object.assign({}, ctx, { now: '2026-10-31T05:00:00.000Z' });
  const r = S.completeStep(t, t.subtasks[1].id, later);
  assert.equal(r.allDone, false);
  assert.equal(r.fields.status, 'doing');
  const next = S.patchTask(t, r.fields, later);
  assert.equal(next.status, 'doing');
  assert.equal(next.subtasks[1].doneAt, '2026-10-31T05:00:00.000Z');
  assert.equal(S.stepInfo(next).current.title, 'ซ่อม');
  // un-ticking clears the time; the last step reports allDone
  const undone = S.patchTask(next, { subtasks: next.subtasks.map((x, i) => (i === 1 ? Object.assign({}, x, { done: false }) : x)) }, later);
  assert.equal(undone.subtasks[1].doneAt, null);
  assert.equal(S.completeStep(next, next.subtasks[2].id, later).allDone, true);
});

test('widget payload carries steps', () => {
  const t = S.createTask(S.normalizeFields({ title: 'x', due: 'today', steps: [{ title: 'a', done: true }, 'b'] }, ctx), ctx);
  const w = S.widgetPayload([t], S.DEFAULT_CATEGORIES, ctx);
  assert.deepEqual(w.tasks[0].steps.map((x) => [x.title, x.done]), [['a', true], ['b', false]]);
});

test('theme colours stay readable for any chosen colour', () => {
  for (const hex of ['#0a7a70', '#ffe600', '#f5f5f5', '#000000', '#7a3fb8', '#d2541f']) {
    const t = S.accentTheme(hex);
    assert.ok(S.contrast(t.light.accent, '#ffffff') >= 4.5, `light accent for ${hex}`);
    assert.ok(S.contrast(t.dark.accent, '#151d1b') >= 6, `dark accent for ${hex}`);
    assert.ok(S.contrast(t.dark.accent, t.dark.accentInk) >= 4.5, `text on dark accent for ${hex}`);
    assert.match(t.light.accentSoft, /^#[0-9a-f]{6}$/);
  }
  assert.equal(S.accentTheme('not a colour').light.accent, S.accentTheme('#0a7a70').light.accent);
});

test('custom category colours reach the widget payload', () => {
  const cats = [{ id: 'x', name: 'สปา', color: '#FF7F50' }];
  const t = S.createTask({ title: 'นวด', category: 'x', due: '2026-10-31' }, ctx);
  const w = S.widgetPayload([t], cats, ctx, '#1f5fbf');
  assert.equal(w.tasks[0].color, '#ff7f50');
  assert.ok(w.theme.light.accent && w.theme.dark.accent);
  assert.equal(S.categoryHex('blue'), S.COLOR_HEX.blue);
  assert.ok(S.validColor('#123abc') && S.validColor('rose') && !S.validColor('red'));
});

test('finds the task list and suggests a mapping', () => {
  const r = S.findTaskList({ ok: true, data: { meta: { page: 1 }, items: [
    { uuid: 'a1', name: 'ซ่อมไฟ', state: 'in_progress', deadline: '2026-11-02', detail: 'ห้อง 305' },
    { uuid: 'a2', name: 'ล้างสระ', state: 'open', deadline: '2026-11-03' },
  ] } });
  assert.equal(r.itemsPath, 'data.items');
  assert.equal(r.count, 2);
  assert.deepEqual(r.mapping, { title: 'name', notes: 'detail', due: 'deadline', status: 'state', externalId: 'uuid' });
  assert.equal(S.findTaskList({ users: [{ email: 'x' }] }), null);
  assert.deepEqual(S.inferMapping({ name: 'x', status: { status: 'in progress' }, priority: { priority: 'high' } }), { title: 'name', status: 'status.status', priority: 'priority.priority' });
});

test('discovers an API from its OpenAPI spec and reports when a key is needed', async () => {
  const spec = { openapi: '3.0.0', servers: [{ url: '/api' }], components: { securitySchemes: { k: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
    paths: { '/work-items': { get: {} }, '/work-items/{id}': { get: {} }, '/users': { get: {} } } };
  const items = { results: [{ id: 7, title: 'ตรวจห้อง 1203', due_date: '2026-11-01', status: 'todo' }] };
  const fakeFetch = async (url, { headers }) => {
    const reply = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (url === 'https://tf.example/openapi.json') return reply(200, spec);
    if (url === 'https://tf.example/api/work-items') return headers['X-API-Key'] === 'k1' ? reply(200, items) : reply(401, { error: 'no key' });
    if (url === 'https://tf.example') return reply(200, '<!doctype html><html></html>');
    return reply(404, 'not found');
  };
  const noKey = await S.discoverApi('https://tf.example/', {}, { fetch: fakeFetch });
  assert.equal(noKey.best, null);
  assert.deepEqual(noKey.needsKey.map((x) => x.url), ['https://tf.example/api/work-items']);
  assert.match(noKey.specs[0].auth, /X-API-Key/);
  const withKey = await S.discoverApi('https://tf.example', { 'X-API-Key': 'k1' }, { fetch: fakeFetch });
  assert.equal(withKey.best.url, 'https://tf.example/api/work-items');
  assert.equal(withKey.best.itemsPath, 'results');
  assert.deepEqual(withKey.best.mapping, { title: 'title', due: 'due_date', status: 'status', externalId: 'id' });
});

test('app templates turn each app\'s documented response into tasks', () => {
  const app = (id) => S.APP_CATALOG.find((a) => a.id === id);
  const check = (id, values, response) => {
    const conf = app(id).build(values);
    return { conf, items: S.mapResponse(response, conf, ctx).items };
  };
  const trello = check('trello', { key: 'K', token: 'T', board: 'b1' }, [{ id: 'c1', name: 'จัดดอกไม้ล็อบบี้', desc: 'โทนขาว', due: '2026-11-01T03:00:00.000Z', dueComplete: false }]);
  assert.match(trello.conf.url, /boards\/b1\/cards.*key=K&token=T/);
  assert.deepEqual([trello.items[0].title, trello.items[0].due, trello.items[0].time, trello.items[0].done], ['จัดดอกไม้ล็อบบี้', '2026-11-01', '10:00', false]);

  const clickup = check('clickup', { key: 'pk_1', list: '99' }, { tasks: [{ id: 'x9', name: 'ซ่อมปั๊มน้ำ', description: '', due_date: '1793404800000', status: { status: 'in progress' }, priority: { priority: 'urgent' } }] });
  assert.equal(clickup.conf.headers.Authorization, 'pk_1');
  assert.deepEqual([clickup.items[0].status, clickup.items[0].priority, clickup.items[0].due], ['doing', 2, '2026-10-31']);

  const asana = check('asana', { key: 'tok', project: '123' }, { data: [{ gid: '555', name: 'ประชุมทีมขาย', notes: 'วาระ Q4', due_on: '2026-11-04', completed: true }] });
  assert.equal(asana.conf.headers.Authorization, 'Bearer tok');
  assert.deepEqual([asana.items[0].title, asana.items[0].due, asana.items[0].done, asana.items[0].externalId], ['ประชุมทีมขาย', '2026-11-04', true, '555']);

  const gh = check('github', { repo: 'sommaij/TheX10Test' }, [{ number: 12, title: 'แก้สีปุ่ม', body: 'ปุ่มบันทึก', state: 'closed' }]);
  assert.match(gh.conf.url, /repos\/sommaij\/TheX10Test\/issues/);
  assert.equal(gh.conf.headers.Authorization, undefined);
  assert.deepEqual([gh.items[0].status, gh.items[0].done, gh.items[0].externalId], ['done', true, '12']);

  const tf = app('taskflow').build({ url: 'https://taskflow.thex10smile.com/', key: ' tfk_abc ', scope: 'open', done: 'DONE', itemsPath: 'tasks' });
  assert.deepEqual([tf.url, tf.headers['x-api-key'], tf.itemsPath, tf.missingDone], ['https://taskflow.thex10smile.com/api/external/my-tasks?status=TODO,IN_PROGRESS', 'tfk_abc', 'tasks', true]);
  assert.deepEqual(tf.writeBack.status, { todo: 'TODO', doing: 'IN_PROGRESS', done: 'DONE' });
  assert.equal(app('taskflow').build({ key: 'k', scope: 'all' }).url, 'https://taskflow.thex10smile.com/api/external/my-tasks');
});

test('write-back request: status change becomes the source app\'s PATCH', () => {
  const conn = { id: 'n1', headers: { 'x-api-key': 'k' }, writeBack: { method: 'PATCH', url: 'https://tf.example/api/external/tasks/{{id}}', body: '{"status":"{{status}}"}', status: { todo: 'TODO', doing: 'IN_PROGRESS', done: 'DONE' } } };
  const t = Object.assign(S.createTask({ title: 'x', status: 'doing' }, ctx), { source: 'connector:n1', externalId: '1116' });
  assert.deepEqual(S.writeBackRequest(conn, t), { method: 'PATCH', url: 'https://tf.example/api/external/tasks/1116', headers: { 'Content-Type': 'application/json', 'x-api-key': 'k' }, body: '{"status":"IN_PROGRESS"}' });
  assert.equal(S.writeBackRequest(conn, Object.assign({}, t, { source: 'app' })), null, 'only tasks from that connection');
  conn.writeBack.status.done = '';
  assert.equal(S.writeBackRequest(conn, Object.assign({}, t, { done: true, status: 'done' })), null, 'empty = do not send');
});

test('writeBackRetryable: keep a status for later only when retrying can help', () => {
  for (const s of [401, 403, 408, 429, 500, 502, 503]) assert.equal(S.writeBackRetryable(s), true, `retry ${s}`);
  for (const s of [400, 404, 409, 422]) assert.equal(S.writeBackRetryable(s), false, `give up ${s}`);
});
