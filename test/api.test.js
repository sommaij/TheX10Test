'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');
const { sign } = require('../server/webhooks');

const ADMIN = 'x10_test_admin_key_123456';

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-'));
  const app = createApp({ dataDir, adminKey: ADMIN, timeZone: 'Asia/Bangkok', webhookRetryDelays: [], log: () => {} });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, p, body, key = ADMIN, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: Object.assign(key ? { Authorization: `Bearer ${key}` } : {}, body !== undefined ? { 'Content-Type': 'application/json' } : {}, headers),
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { app, base, call, dataDir };
}

test('API: auth, create, list, update, complete, delete', async (t) => {
  const { app, call } = await start();
  t.after(() => app.close());

  assert.equal((await call('GET', '/api/v1/health', undefined, null)).status, 200);
  assert.equal((await call('GET', '/api/v1/tasks', undefined, null)).status, 401);
  assert.equal((await call('GET', '/api/v1/tasks', undefined, 'wrong')).status, 401);

  // another app gets its own key
  const k = await call('POST', '/api/v1/keys', { name: 'LINE Bot' });
  assert.equal(k.status, 201);
  const appKey = k.body.secret;
  assert.ok(appKey.startsWith('x10_'));
  assert.equal(k.body.key.hash, undefined);
  assert.equal((await call('GET', '/api/v1/keys', undefined, appKey)).status, 403);

  // lenient payload from another app
  const c = await call('POST', '/api/v1/tasks', { text: 'ส่งรายงานยอดขาย', due_date: '2026-11-02T09:00', category: 'งาน', priority: 'high' }, appKey);
  assert.equal(c.status, 201);
  const task = c.body.task;
  assert.equal(task.title, 'ส่งรายงานยอดขาย');
  assert.equal(task.due, '2026-11-02');
  assert.equal(task.time, '09:00');
  assert.equal(task.category, 'work');
  assert.equal(task.priority, 1);
  assert.equal(task.source, `key:${k.body.key.id}`);
  assert.equal(task.sourceName, 'LINE Bot');

  // same externalId from the same app updates instead of duplicating
  const a = await call('POST', '/api/v1/tasks', { title: 'A', externalId: 'ext-1' }, appKey);
  const b = await call('POST', '/api/v1/tasks', { title: 'A (แก้ไข)', externalId: 'ext-1' }, appKey);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.body.task.id, a.body.task.id);

  // plain text body and query-string key (for apps that cannot set headers)
  const txt = await call('POST', `/api/v1/tasks?key=${appKey}`, 'โทรหาลูกค้า', null, { 'Content-Type': 'text/plain' });
  assert.equal(txt.status, 201);
  assert.equal(txt.body.task.title, 'โทรหาลูกค้า');

  const bad = await call('POST', '/api/v1/tasks', { title: 'x', due: 'someday' }, appKey);
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.field, 'due');

  const list = await call('GET', '/api/v1/tasks?status=open', undefined, appKey);
  assert.equal(list.body.count, 3);

  const p = await call('PATCH', `/api/v1/tasks/${task.id}`, { title: 'ส่งรายงานยอดขาย Q4' }, appKey);
  assert.equal(p.body.task.title, 'ส่งรายงานยอดขาย Q4');

  const done = await call('POST', `/api/v1/tasks/${task.id}/complete`, undefined, appKey);
  assert.equal(done.body.task.done, true);
  assert.ok(done.body.task.doneAt);

  const doing = await call('PATCH', `/api/v1/tasks/${a.body.task.id}`, { status: 'in progress' }, appKey);
  assert.deepEqual([doing.body.task.status, doing.body.task.done], ['doing', false]);
  assert.deepEqual((await call('GET', '/api/v1/tasks?status=doing', undefined, appKey)).body.tasks.map((x) => x.id), [a.body.task.id]);
  const widget = await call('GET', '/api/v1/widget', undefined, appKey);
  assert.equal(widget.status, 200);
  assert.equal(widget.body.tasks.find((x) => x.id === a.body.task.id).status, 'doing');
  assert.equal(widget.body.doneDays[widget.body.today], 1);

  const del = await call('DELETE', `/api/v1/tasks/${task.id}`, undefined, appKey);
  assert.equal(del.status, 200);
  assert.equal((await call('GET', `/api/v1/tasks/${task.id}`, undefined, appKey)).status, 404);
});

test('API: repeating task spawns next occurrence on the server', async (t) => {
  const { app, call } = await start();
  t.after(() => app.close());
  const c = await call('POST', '/api/v1/tasks', { id: 't_repeat1', title: 'รดน้ำต้นไม้', due: '2099-01-01', repeat: 'daily' });
  const r = await call('PATCH', `/api/v1/tasks/${c.body.task.id}`, { done: true });
  assert.equal(r.body.spawned.id, 't_repeat1@2099-01-02');
  assert.equal(r.body.spawned.due, '2099-01-02');
  // undo removes it again
  await call('PATCH', `/api/v1/tasks/${c.body.task.id}`, { done: false });
  assert.equal((await call('GET', '/api/v1/tasks/t_repeat1@2099-01-02')).status, 404);
});

test('API: bulk import and data persists across restarts', async (t) => {
  const { app, call, dataDir } = await start();
  const r = await call('POST', '/api/v1/tasks', [{ title: 'หนึ่ง' }, { title: '' }, { name: 'สาม', category: 'ฝ่ายช่าง' }]);
  assert.equal(r.body.results.length, 3);
  assert.ok(r.body.results[1].error);
  const cats = await call('GET', '/api/v1/categories');
  assert.ok(cats.body.categories.some((c) => c.name === 'ฝ่ายช่าง'));
  await app.close();

  const again = createApp({ dataDir, adminKey: ADMIN, log: () => {} });
  t.after(() => again.close());
  assert.equal(again.store.db.tasks.length, 2);
});

test('API: webhooks are signed and delivered', async (t) => {
  const { app, call } = await start();
  const received = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.end('ok');
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await app.close();
    receiver.close();
  });

  const w = await call('POST', '/api/v1/webhooks', { url: `http://127.0.0.1:${receiver.address().port}/hook`, events: ['task.completed'] });
  assert.equal(w.status, 201);
  assert.ok(w.body.webhook.secret.startsWith('whsec_'));
  assert.equal((await call('POST', '/api/v1/webhooks', { url: 'ftp://x' })).status, 422);

  const c = await call('POST', '/api/v1/tasks', { title: 'ตรวจห้อง 1203' });
  await call('PATCH', `/api/v1/tasks/${c.body.task.id}`, { done: true });
  for (let i = 0; i < 50 && !received.length; i++) await new Promise((r) => setTimeout(r, 20));

  assert.equal(received.length, 1, 'only the subscribed event is delivered');
  const { headers, body } = received[0];
  assert.equal(headers['x-x10-event'], 'task.completed');
  assert.equal(headers['x-x10-signature'], sign(w.body.webhook.secret, body));
  assert.equal(JSON.parse(body).data.task.title, 'ตรวจห้อง 1203');
});

test('API: connectors pull tasks from another app and do not duplicate', async (t) => {
  const { app, call } = await start();
  let payload = { data: { rows: [{ code: 'A1', job: 'ซ่อมไฟ', when: '2099-03-01' }, { code: 'A2', job: 'ล้างสระ', when: '2099-03-02' }] } };
  const other = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer other-secret') {
      res.writeHead(401);
      return res.end('{}');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await app.close();
    other.close();
  });

  const config = {
    name: 'ระบบซ่อมบำรุง',
    url: `http://127.0.0.1:${other.address().port}/jobs`,
    headers: { Authorization: 'Bearer other-secret' },
    itemsPath: 'data.rows',
    mapping: { title: 'งาน: {{job}}', due: 'when', externalId: 'code' },
    category: 'work',
  };
  const preview = await call('POST', '/api/v1/connectors/preview', config);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.total, 2);
  assert.equal(preview.body.items[0].title, 'งาน: ซ่อมไฟ');

  const created = await call('POST', '/api/v1/connectors', config);
  const id = created.body.connector.id;
  const s1 = await call('POST', `/api/v1/connectors/${id}/sync`);
  assert.deepEqual([s1.body.created, s1.body.updated], [2, 0]);

  payload.data.rows[0].job = 'ซ่อมไฟทางเดิน';
  const s2 = await call('POST', `/api/v1/connectors/${id}/sync`);
  assert.deepEqual([s2.body.created, s2.body.updated], [0, 1]);

  const tasks = (await call('GET', `/api/v1/tasks?source=connector:${id}`)).body.tasks;
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find((x) => x.externalId === 'A1').title, 'งาน: ซ่อมไฟทางเดิน');
  assert.equal(tasks[0].sourceName, 'ระบบซ่อมบำรุง');

  // finished in X10 while the other system still says "open": stays done after the next sync
  payload.data.rows[1].status = 'open';
  await call('PATCH', `/api/v1/tasks/${tasks.find((x) => x.externalId === 'A2').id}`, { done: true });
  await call('POST', `/api/v1/connectors/${id}/sync`);
  const a2 = (await call('GET', `/api/v1/tasks?source=connector:${id}`)).body.tasks.find((x) => x.externalId === 'A2');
  assert.equal(a2.done, true);

  const bad = await call('PATCH', `/api/v1/connectors/${id}`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(bad.status, 200);
  const s3 = await call('POST', `/api/v1/connectors/${id}/sync`);
  assert.equal(s3.status, 502);
  assert.match(s3.body.error.message, /401/);
});

test('API: live stream sends events', async (t) => {
  const { app, base, call } = await start();
  t.after(() => app.close());
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/v1/stream?access_token=${ADMIN}`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  await call('POST', '/api/v1/tasks', { title: 'สด ๆ' });
  let text = '';
  while (!text.includes('task.created')) text += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  assert.match(text, /สด ๆ/);
});

test('serves the app and blocks path traversal', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const html = await fetch(base + '/');
  assert.match(html.headers.get('content-type'), /text\/html/);
  const deep = await fetch(base + '/calendar');
  assert.equal(deep.status, 200);
  const trav = await fetch(base + '/%2e%2e/package.json');
  assert.notEqual(trav.status, 200);
});
