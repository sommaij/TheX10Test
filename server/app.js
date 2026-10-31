'use strict';
// HTTP server: serves the phone app (public/) and the REST API (/api/v1).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store, hashKey, checkUrl, ROLE_RANK } = require('./store');
const { WebhookDispatcher } = require('./webhooks');
const { ConnectorRunner } = require('./connectors');
const S = require('../public/js/shared.js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'too_large', 'Request body is larger than 1 MB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      const type = (req.headers['content-type'] || '').toLowerCase();
      try {
        if (type.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(raw)));
        if (type.startsWith('text/plain')) return resolve({ title: raw.trim() });
        return resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'invalid_json', 'Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getSecret(req, url) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']).trim();
  return url.searchParams.get('access_token') || url.searchParams.get('key') || null;
}

function publicKey(k) {
  const { hash, ...rest } = k;
  return rest;
}

function createApp(options = {}) {
  const log = options.log || ((...a) => console.log(new Date().toISOString(), ...a));
  const timeZone = options.timeZone || process.env.X10_TIMEZONE || 'Asia/Bangkok';
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const store = new Store({ dataDir, timeZone });
  const webhooks = new WebhookDispatcher(store, { retryDelays: options.webhookRetryDelays, log });
  const connectors = new ConnectorRunner(store, { log });
  const streams = new Set();
  let bootstrapSecret = null;

  // Admin key: from X10_ADMIN_KEY, or generated once on first start.
  const envKey = options.adminKey ?? process.env.X10_ADMIN_KEY;
  if (envKey && !store.findKey(envKey)) {
    const { key } = store.createKey({ name: 'ผู้ดูแล (จาก X10_ADMIN_KEY)', role: 'admin' });
    key.hash = hashKey(envKey);
    key.prefix = envKey.slice(0, 8);
    store.flush();
  } else if (!envKey && !store.db.keys.some((k) => k.role === 'admin')) {
    const { secret } = store.createKey({ name: 'ผู้ดูแล', role: 'admin' });
    bootstrapSecret = secret;
  }

  store.on('event', (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) res.write(msg);
    if (event.startsWith('task.')) webhooks.dispatch(event, data);
  });

  const routes = [];
  const route = (method, pattern, role, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, role, handler });
  };

  // ---------- public ----------
  route('GET', '/api/v1/health', null, () => ({ ok: true, name: 'X10 Tasks', version: S.VERSION, timeZone, today: S.todayIn(timeZone) }));

  // ---------- tasks ----------
  route('GET', '/api/v1/tasks', 'app', ({ url }) => {
    const q = Object.fromEntries(url.searchParams);
    const tasks = store.listTasks({ status: q.status, category: q.category, source: q.source, from: q.from, to: q.to, q: q.q, updatedSince: q.updatedSince });
    return { tasks, count: tasks.length };
  });
  function receiveTasks({ body, key, res }) {
    const source = key.role === 'admin' ? { source: 'app', sourceName: null } : { source: `key:${key.id}`, sourceName: key.name };
    if (Array.isArray(body)) {
      if (body.length > 500) throw new HttpError(400, 'too_many', 'Send at most 500 tasks at once');
      const results = body.map((item, index) => {
        try {
          const r = store.upsertTask(item, source);
          return { index, created: r.created, task: r.task };
        } catch (e) {
          if (e instanceof S.ValidationError) return { index, error: e.message };
          throw e;
        }
      });
      return { results };
    }
    const r = store.upsertTask(body, source);
    res.statusCode = r.created ? 201 : 200;
    return { task: r.task, created: r.created };
  }
  route('POST', '/api/v1/tasks', 'inbox', receiveTasks);
  // The key is part of the link, for apps that can only be given a URL (LINE, Zapier, Make, Google Sheets…).
  route('POST', '/api/v1/hooks/:secret', null, (ctx) => {
    const key = store.findKey(ctx.params.secret);
    if (!key) throw new HttpError(401, 'unauthorized', 'This link is invalid, expired or was replaced');
    store.touchKey(key);
    return receiveTasks(Object.assign({}, ctx, { key }));
  });
  route('GET', '/api/v1/tasks/:id', 'app', ({ params }) => {
    const task = store.getTask(params.id);
    if (!task) throw new HttpError(404, 'not_found', 'Task not found');
    return { task };
  });
  route('PATCH', '/api/v1/tasks/:id', 'app', ({ params, body }) => {
    const before = store.getTask(params.id);
    const task = store.updateTask(params.id, body);
    if (!task) throw new HttpError(404, 'not_found', 'Task not found');
    const spawned = task.spawnedId && task.spawnedId !== before.spawnedId ? store.getTask(task.spawnedId) : null;
    return { task, spawned };
  });
  route('POST', '/api/v1/tasks/:id/complete', 'app', ({ params }) => {
    const task = store.updateTask(params.id, { done: true });
    if (!task) throw new HttpError(404, 'not_found', 'Task not found');
    return { task, spawned: task.spawnedId ? store.getTask(task.spawnedId) : null };
  });
  route('POST', '/api/v1/tasks/:id/steps/:stepId/complete', 'app', ({ params }) => {
    const task = store.completeStep(params.id, params.stepId);
    if (!task) throw new HttpError(404, 'not_found', 'Task or step not found');
    return { task, spawned: task.done && task.spawnedId ? store.getTask(task.spawnedId) : null };
  });
  route('DELETE', '/api/v1/tasks/:id', 'app', ({ params }) => {
    const task = store.deleteTask(params.id);
    if (!task) throw new HttpError(404, 'not_found', 'Task not found');
    return { deleted: task.id };
  });

  // Compact summary for home-screen widgets (Android app refreshes from here when it is closed).
  route('GET', '/api/v1/widget', 'app', () => S.widgetPayload(store.db.tasks, store.db.categories, store.ctx()));

  // ---------- categories ----------
  route('GET', '/api/v1/categories', 'app', () => ({ categories: store.db.categories }));
  route('POST', '/api/v1/categories', 'admin', ({ body, res }) => {
    res.statusCode = 201;
    return { category: store.addCategory(body) };
  });
  route('PATCH', '/api/v1/categories/:id', 'admin', ({ params, body }) => {
    const category = store.updateCategory(params.id, body);
    if (!category) throw new HttpError(404, 'not_found', 'Category not found');
    return { category };
  });
  route('DELETE', '/api/v1/categories/:id', 'admin', ({ params }) => {
    if (!store.deleteCategory(params.id)) throw new HttpError(404, 'not_found', 'Category not found');
    return { deleted: params.id };
  });

  // ---------- API keys for other apps ----------
  route('GET', '/api/v1/keys', 'admin', () => ({ keys: store.db.keys.map(publicKey) }));
  route('POST', '/api/v1/keys', 'admin', ({ body, res }) => {
    const { key, secret } = store.createKey({ name: body.name, role: body.role, expiresInDays: body.expiresInDays });
    res.statusCode = 201;
    return { key: publicKey(key), secret };
  });
  route('POST', '/api/v1/keys/:id/rotate', 'admin', ({ params }) => {
    const r = store.rotateKey(params.id);
    if (r === 'not_found') throw new HttpError(404, 'not_found', 'Key not found');
    if (r === 'admin') throw new HttpError(409, 'admin_key', 'Admin keys are replaced with: node server/index.js --new-admin-key');
    return { key: publicKey(r.key), secret: r.secret };
  });
  route('DELETE', '/api/v1/keys/:id', 'admin', ({ params }) => {
    const r = store.deleteKey(params.id);
    if (r === 'not_found') throw new HttpError(404, 'not_found', 'Key not found');
    if (r === 'last_admin') throw new HttpError(409, 'last_admin', 'Cannot delete the last admin key');
    return { deleted: params.id };
  });

  // ---------- webhooks (send events to other apps) ----------
  route('GET', '/api/v1/webhooks', 'admin', () => ({ webhooks: store.db.webhooks }));
  route('POST', '/api/v1/webhooks', 'admin', ({ body, res }) => {
    res.statusCode = 201;
    return { webhook: store.createWebhook(body) };
  });
  route('PATCH', '/api/v1/webhooks/:id', 'admin', ({ params, body }) => {
    const webhook = store.updateWebhook(params.id, body);
    if (!webhook) throw new HttpError(404, 'not_found', 'Webhook not found');
    return { webhook };
  });
  route('DELETE', '/api/v1/webhooks/:id', 'admin', ({ params }) => {
    if (!store.deleteWebhook(params.id)) throw new HttpError(404, 'not_found', 'Webhook not found');
    return { deleted: params.id };
  });
  route('POST', '/api/v1/webhooks/:id/test', 'admin', async ({ params }) => {
    const wh = store.db.webhooks.find((w) => w.id === params.id);
    if (!wh) throw new HttpError(404, 'not_found', 'Webhook not found');
    const sample = S.createTask({ title: 'ทดสอบ webhook จาก X10 Tasks' }, { now: new Date().toISOString() }, { id: 't_test' });
    const r = await webhooks.deliver(wh, { id: S.uid('evt_'), event: 'ping', createdAt: new Date().toISOString(), data: { task: sample } }, webhooks.retryDelays.length);
    return { delivered: !r.error, status: r.status, error: r.error };
  });

  // ---------- connectors (pull from other apps' APIs) ----------
  route('GET', '/api/v1/connectors', 'admin', () => ({ connectors: store.db.connectors }));
  route('POST', '/api/v1/connectors/preview', 'admin', async ({ body }) => {
    try {
      return await connectors.preview(Object.assign({}, body, { url: checkUrl(body.url, true) }));
    } catch (e) {
      if (e instanceof S.ValidationError) throw e;
      throw new HttpError(502, 'fetch_failed', e.message);
    }
  });
  // Looks for another app's task API (OpenAPI specs, usual paths) from the server, where CORS does not apply.
  route('POST', '/api/v1/connectors/discover', 'admin', async ({ body }) => {
    const url = checkUrl(body.url);
    const headers = body.headers && typeof body.headers === 'object' ? Object.fromEntries(Object.entries(body.headers).filter(([k, v]) => /^[\w-]+$/.test(k) && typeof v === 'string')) : {};
    const r = await S.discoverApi(url, headers, { fetch: (u, o) => fetch(u, Object.assign({ redirect: 'follow' }, o)), timeoutMs: 8000, exact: !!body.exact });
    r.found = r.found.slice(0, 6).map(({ items, ...rest }) => rest);
    r.best = r.found[0] || null;
    return r;
  });
  route('POST', '/api/v1/connectors', 'admin', ({ body, res }) => {
    res.statusCode = 201;
    return { connector: store.createConnector(body) };
  });
  route('PATCH', '/api/v1/connectors/:id', 'admin', ({ params, body }) => {
    const connector = store.updateConnector(params.id, body);
    if (!connector) throw new HttpError(404, 'not_found', 'Connector not found');
    return { connector };
  });
  route('DELETE', '/api/v1/connectors/:id', 'admin', ({ params }) => {
    if (!store.deleteConnector(params.id)) throw new HttpError(404, 'not_found', 'Connector not found');
    return { deleted: params.id };
  });
  route('POST', '/api/v1/connectors/:id/sync', 'admin', async ({ params }) => {
    const c = store.db.connectors.find((x) => x.id === params.id);
    if (!c) throw new HttpError(404, 'not_found', 'Connector not found');
    try {
      return Object.assign({ connector: c }, await connectors.sync(c));
    } catch (e) {
      throw new HttpError(502, 'fetch_failed', e.message);
    }
  });

  // ---------- export ----------
  route('GET', '/api/v1/export', 'admin', () => ({
    exportedAt: new Date().toISOString(),
    version: S.VERSION,
    tasks: store.db.tasks,
    categories: store.db.categories,
  }));

  async function handleApi(req, res, url) {
    const match = routes.map((r) => ({ r, m: r.method === req.method && url.pathname.match(r.re) })).find((x) => x.m);
    if (!match) {
      const exists = routes.some((r) => url.pathname.match(r.re));
      throw new HttpError(exists ? 405 : 404, exists ? 'method_not_allowed' : 'not_found', exists ? 'Method not allowed' : 'Unknown API endpoint');
    }
    const { r, m } = match;
    let key = null;
    if (r.role) {
      key = store.findKey(getSecret(req, url));
      if (!key) throw new HttpError(401, 'unauthorized', 'Missing, invalid or expired API key. Send "Authorization: Bearer <key>".');
      if ((ROLE_RANK[key.role] || 0) < ROLE_RANK[r.role]) {
        throw new HttpError(403, 'forbidden', r.role === 'admin' ? 'This endpoint needs an admin key' : 'This key can only send tasks in');
      }
      store.touchKey(key);
    }
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
    res.statusCode = 200;
    const result = await r.handler({ req, res, url, params, body, key });
    send(res, res.statusCode, result);
  }

  function handleStream(req, res, url) {
    const key = store.findKey(getSecret(req, url));
    if (!key) return send(res, 401, { error: { code: 'unauthorized', message: 'Missing or invalid API key' } });
    if (key.role === 'inbox') return send(res, 403, { error: { code: 'forbidden', message: 'This key can only send tasks in' } });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ today: S.todayIn(timeZone) })}\n\n`);
    streams.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      streams.delete(res);
    });
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed' } });
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.resolve(PUBLIC_DIR, '.' + rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: { code: 'forbidden', message: 'Forbidden' } });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(rel)) return send(res, 404, { error: { code: 'not_found', message: 'Not found' } });
      file = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(file);
    const noCache = ext === '.html' || file.endsWith('sw.js') || ext === '.webmanifest';
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/api/v1/stream' && req.method === 'GET') return handleStream(req, res, url);
      try {
        await handleApi(req, res, url);
      } catch (e) {
        if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
        if (e instanceof S.ValidationError) return send(res, 422, { error: { code: 'invalid', field: e.field || null, message: e.message } });
        log('error', e);
        return send(res, 500, { error: { code: 'server_error', message: 'Something went wrong on the server' } });
      }
      return;
    }
    serveStatic(req, res, url);
  });

  connectors.start(options.connectorTickMs || 60_000);

  return {
    server,
    store,
    bootstrapSecret,
    close() {
      connectors.close();
      webhooks.close();
      for (const res of streams) res.end();
      streams.clear();
      store.flush();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createApp };
