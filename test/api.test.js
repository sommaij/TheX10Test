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

test('API: complete steps one by one; the last step finishes the task', async (t) => {
  const { app, call } = await start();
  t.after(() => app.close());
  const c = await call('POST', '/api/v1/tasks', { title: 'ทำความสะอาดห้อง 1203', steps: ['เก็บผ้า', { title: 'ห้องน้ำ', detail: 'สุขภัณฑ์ กระจก' }] });
  const [s1, s2] = c.body.task.subtasks;
  assert.equal(s2.detail, 'สุขภัณฑ์ กระจก');
  const a = await call('POST', `/api/v1/tasks/${c.body.task.id}/steps/${s1.id}/complete`);
  assert.deepEqual([a.body.task.status, a.body.task.done], ['doing', false]);
  assert.ok(a.body.task.subtasks[0].doneAt);
  const b = await call('POST', `/api/v1/tasks/${c.body.task.id}/steps/${s2.id}/complete`);
  assert.deepEqual([b.body.task.status, b.body.task.done], ['done', true]);
  assert.equal((await call('POST', `/api/v1/tasks/${c.body.task.id}/steps/nope/complete`)).status, 404);
});

test('API: key links, send-only keys, expiry and new links', async (t) => {
  const { app, call, base } = await start();
  t.after(() => app.close());

  // a send-only key: can add tasks, cannot read them
  const k = await call('POST', '/api/v1/keys', { name: 'LINE OA', role: 'inbox', expiresInDays: 30 });
  assert.equal(k.body.key.role, 'inbox');
  assert.ok(Date.parse(k.body.key.expiresAt) > Date.now() + 29 * 86400000);
  const secret = k.body.secret;
  assert.equal((await call('POST', '/api/v1/tasks', { title: 'จากหัวเรื่อง' }, secret)).status, 201);
  assert.equal((await call('GET', '/api/v1/tasks', undefined, secret)).status, 403);
  assert.equal((await fetch(`${base}/api/v1/stream?access_token=${secret}`)).status, 403);

  // the link carries the key: no header needed, any body format
  const hook = `/api/v1/hooks/${secret}`;
  const viaLink = await call('POST', hook, { text: 'แขกห้อง 305 ขอหมอนเพิ่ม', due: 'today' }, null);
  assert.equal(viaLink.status, 201);
  assert.equal(viaLink.body.task.sourceName, 'LINE OA');
  const form = await fetch(base + hook, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'title=' + encodeURIComponent('เติมน้ำดื่ม ห้อง 210') });
  assert.equal(form.status, 201);
  assert.equal((await call('POST', '/api/v1/hooks/x10_wrong', { title: 'x' }, null)).status, 401);

  // a new link replaces the old one at once
  const r = await call('POST', `/api/v1/keys/${k.body.key.id}/rotate`);
  assert.notEqual(r.body.secret, secret);
  assert.equal(r.body.key.role, 'inbox');
  assert.equal((await call('POST', hook, { title: 'เก่า' }, null)).status, 401);
  assert.equal((await call('POST', `/api/v1/hooks/${r.body.secret}`, { title: 'ใหม่' }, null)).status, 201);
  const admins = (await call('GET', '/api/v1/keys')).body.keys.filter((x) => x.role === 'admin');
  assert.equal((await call('POST', `/api/v1/keys/${admins[0].id}/rotate`)).status, 409);

  // expired keys stop working
  const e = await call('POST', '/api/v1/keys', { name: 'ชั่วคราว', role: 'app', expiresInDays: 1 });
  app.store.db.keys.find((x) => x.id === e.body.key.id).expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call('GET', '/api/v1/tasks', undefined, e.body.secret)).status, 401);
  assert.equal((await call('POST', `/api/v1/hooks/${e.body.secret}`, { title: 'x' }, null)).status, 401);
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

test('API: discovers another app\'s task API from the server', async (t) => {
  const { app, call } = await start();
  const other = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/swagger.json') return res.end(JSON.stringify({ swagger: '2.0', basePath: '/v2', securityDefinitions: { b: { type: 'apiKey', in: 'header', name: 'Authorization' } }, paths: { '/jobs': { get: {} } } }));
    if (req.url === '/v2/jobs') {
      if (req.headers.authorization !== 'Bearer tf-key') {
        res.writeHead(401);
        return res.end('{}');
      }
      return res.end(JSON.stringify({ data: [{ job_id: 'J1', title: 'ตรวจห้อง 1203', deadline: '2099-01-02', stage: 'doing' }] }));
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await app.close();
    other.close();
  });
  const base = `http://127.0.0.1:${other.address().port}`;
  const noKey = await call('POST', '/api/v1/connectors/discover', { url: base });
  assert.equal(noKey.body.best, null);
  assert.equal(noKey.body.needsKey[0].url, `${base}/v2/jobs`);
  const r = await call('POST', '/api/v1/connectors/discover', { url: base, headers: { Authorization: 'Bearer tf-key' } });
  assert.equal(r.body.best.url, `${base}/v2/jobs`);
  assert.equal(r.body.best.itemsPath, 'data');
  assert.equal(r.body.best.mapping.status, 'stage');

  // save it as an app connection and sync
  const c = await call('POST', '/api/v1/connectors', { name: 'TaskFlow', app: 'taskflow', appValues: { url: base, key: 'tf-key' }, url: r.body.best.url, headers: { Authorization: 'Bearer tf-key' }, itemsPath: 'data', mapping: Object.assign({ externalId: 'job_id' }, r.body.best.mapping) });
  assert.equal(c.body.connector.app, 'taskflow');
  assert.equal(c.body.connector.mapping.status, 'stage');
  const s = await call('POST', `/api/v1/connectors/${c.body.connector.id}/sync`);
  assert.equal(s.body.created, 1);
  const task = (await call('GET', `/api/v1/tasks?source=connector:${c.body.connector.id}`)).body.tasks[0];
  assert.deepEqual([task.title, task.status, task.externalId], ['ตรวจห้อง 1203', 'doing', 'J1']);
});

test('API: TaskFlow two-way sync (pull my-tasks, send status changes back)', async (t) => {
  const S = require('../public/js/shared.js');
  const { app, call } = await start();
  // A stand-in for TaskFlow's external API, following the documented routes.
  const tf = { 1116: { id: 1116, title: 'ตรวจรับของห้องครัว', status: 'TODO', dueDate: '2099-03-01' }, 1117: { id: 1117, title: 'สรุปยอดเบิกของ', status: 'IN_PROGRESS' } };
  const patches = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-api-key'] !== 'tfk_test_key') {
      res.writeHead(401);
      return res.end('{"error":"invalid key"}');
    }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/external/my-tasks') {
      const want = (url.searchParams.get('status') || '').split(',').filter(Boolean);
      return res.end(JSON.stringify({ tasks: Object.values(tf).filter((x) => !want.length || want.includes(x.status)) }));
    }
    const m = url.pathname.match(/^\/api\/external\/tasks\/(\d+)$/);
    if (req.method === 'PATCH' && m && tf[m[1]]) {
      let body = '';
      req.on('data', (c) => (body += c));
      return req.on('end', () => {
        const patch = JSON.parse(body);
        patches.push([Number(m[1]), patch.status]);
        Object.assign(tf[m[1]], patch);
        res.end(JSON.stringify({ task: tf[m[1]] }));
      });
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await app.close();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const values = { key: 'tfk_test_key', scope: 'open', done: 'DONE', url: base };
  const conf = S.APP_CATALOG.find((a) => a.id === 'taskflow').build(values);
  assert.equal(conf.url, `${base}/api/external/my-tasks?status=TODO,IN_PROGRESS`);
  assert.equal(conf.headers['x-api-key'], 'tfk_test_key');

  // reading the real response fills in where the list is and how fields map
  const d = await call('POST', '/api/v1/connectors/discover', { url: conf.url, headers: conf.headers, exact: true });
  assert.equal(d.body.tried, 1);
  assert.equal(d.body.best.itemsPath, 'tasks');
  assert.deepEqual(d.body.best.mapping, { title: 'title', due: 'dueDate', status: 'status', externalId: 'id' });

  const c = await call('POST', '/api/v1/connectors', Object.assign({}, conf, { name: 'TaskFlow', app: 'taskflow', appValues: values, itemsPath: 'tasks', mapping: d.body.best.mapping }));
  const id = c.body.connector.id;
  assert.equal((await call('POST', `/api/v1/connectors/${id}/sync`)).body.created, 2);
  const list = () => call('GET', `/api/v1/tasks?source=connector:${id}`).then((r) => r.body.tasks);
  const byRef = async (ref) => (await list()).find((x) => x.externalId === ref);
  assert.equal((await byRef('1117')).status, 'doing');
  assert.equal(patches.length, 0, 'syncing does not echo statuses back');

  // start and finish in X10 -> TaskFlow follows
  const kitchen = await byRef('1116');
  await call('PATCH', `/api/v1/tasks/${kitchen.id}`, { status: 'doing' });
  await call('POST', `/api/v1/tasks/${kitchen.id}/complete`);
  for (let i = 0; i < 50 && patches.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(patches, [[1116, 'IN_PROGRESS'], [1116, 'DONE']]);

  // finished in TaskFlow -> gone from the open list -> ticked in X10, without sending anything back
  tf[1117].status = 'DONE';
  await call('POST', `/api/v1/connectors/${id}/sync`);
  const sums = await byRef('1117');
  assert.deepEqual([sums.done, sums.status], [true, 'done']);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(patches.length, 2);
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
