'use strict';
// JSON-file storage. Small and dependency-free: fine for one person or a small team.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const S = require('../public/js/shared.js');

const KEY_ROLES = ['inbox', 'app', 'admin'];
const ROLE_RANK = { inbox: 1, app: 2, admin: 3 };

function hashKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}
function newSecret(prefix) {
  return prefix + crypto.randomBytes(24).toString('base64url');
}

class Store extends EventEmitter {
  constructor({ dataDir, timeZone }) {
    super();
    this.file = path.join(dataDir, 'db.json');
    this.timeZone = timeZone;
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = this._load();
    this.saveTimer = null;
  }

  _load() {
    let db = null;
    if (fs.existsSync(this.file)) db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    db = db || {};
    db.version = 1;
    db.tasks = db.tasks || [];
    db.categories = db.categories || S.DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    db.keys = db.keys || [];
    db.webhooks = db.webhooks || [];
    db.connectors = db.connectors || [];
    return db;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  ctx() {
    return {
      now: new Date().toISOString(),
      today: S.todayIn(this.timeZone),
      timeZone: this.timeZone,
      categories: this.db.categories,
      find: (id) => this.getTask(id),
    };
  }

  // ---------- tasks ----------
  listTasks(filter = {}) {
    let list = this.db.tasks;
    if (filter.status === 'open') list = list.filter((t) => !t.done);
    if (filter.status === 'done') list = list.filter((t) => t.done);
    if (filter.status === 'doing') list = list.filter((t) => S.statusOf(t) === 'doing');
    if (filter.category) list = list.filter((t) => t.category === filter.category);
    if (filter.source) list = list.filter((t) => t.source === filter.source);
    if (filter.from) list = list.filter((t) => t.due && t.due >= filter.from);
    if (filter.to) list = list.filter((t) => t.due && t.due <= filter.to);
    if (filter.q) {
      const q = filter.q.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q));
    }
    if (filter.updatedSince) list = list.filter((t) => t.updatedAt > filter.updatedSince);
    return list;
  }

  getTask(id) {
    return this.db.tasks.find((t) => t.id === id) || null;
  }

  _addCategoryFrom(fields) {
    if (fields._newCategory) {
      this.db.categories.push(fields._newCategory);
      this.emit('event', 'categories.updated', { categories: this.db.categories });
    }
  }

  /**
   * Creates a task, or updates one when `id` exists or `externalId` matches a task from the same source.
   * Returns { task, created }.
   */
  upsertTask(input, source) {
    const ctx = this.ctx();
    const fields = S.normalizeFields(input, ctx);
    const id = typeof input === 'object' && typeof input.id === 'string' ? input.id.slice(0, 120) : null;
    let existing = id ? this.getTask(id) : null;
    if (!existing && fields.externalId) {
      existing = this.db.tasks.find((t) => t.externalId === fields.externalId && t.source === source.source) || null;
    }
    this._addCategoryFrom(fields);
    if (existing) {
      const task = this._update(existing, fields, ctx, source.source);
      return { task, created: false };
    }
    const extra = { source: source.source, sourceName: fields.sourceName || source.sourceName || null };
    if (id) extra.id = id;
    if (typeof input === 'object') {
      for (const k of ['seriesId', 'spawnedId']) if (typeof input[k] === 'string') extra[k] = input[k];
    }
    const task = S.createTask(fields, ctx, extra);
    this.db.tasks.push(task);
    this.save();
    this.emit('event', 'task.created', { task });
    if (task.done) this.emit('event', 'task.completed', { task });
    return { task, created: true };
  }

  /** origin: who made the change (e.g. "connector:n_…" during a sync), so changes are not echoed back to it. */
  updateTask(id, input, origin) {
    const existing = this.getTask(id);
    if (!existing) return null;
    const ctx = this.ctx();
    const fields = S.normalizeFields(input, ctx);
    this._addCategoryFrom(fields);
    return this._update(existing, fields, ctx, origin);
  }

  _update(existing, fields, ctx, origin) {
    let task = S.patchTask(existing, fields, ctx);
    if ((fields.done === undefined || fields.done === existing.done) && sameTask(task, existing)) return existing;
    let spawn = null;
    let removeId = null;
    if (fields.done !== undefined && fields.done !== existing.done) {
      const r = S.setDone(task, fields.done, ctx);
      task = r.task;
      spawn = r.spawn;
      removeId = r.removeId;
    }
    this._replace(task);
    this.emit('event', 'task.updated', { task });
    if (S.statusOf(task) !== S.statusOf(existing)) this.emit('statusChanged', task, S.statusOf(existing), origin || null);
    if (task.done && !existing.done) this.emit('event', 'task.completed', { task });
    if (spawn) {
      this.db.tasks.push(spawn);
      this.emit('event', 'task.created', { task: spawn });
    }
    if (removeId) this.deleteTask(removeId);
    this.save();
    return task;
  }

  _replace(task) {
    const i = this.db.tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) this.db.tasks[i] = task;
  }

  /** Ticks one step; finishing the last step finishes the task. Returns null if the task or step is unknown. */
  completeStep(id, stepId) {
    const task = this.getTask(id);
    if (!task || !(task.subtasks || []).some((x) => x.id === stepId)) return null;
    const { fields, allDone } = S.completeStep(task, stepId, this.ctx());
    let updated = this.updateTask(id, fields);
    if (allDone && !updated.done) updated = this.updateTask(id, { done: true });
    return updated;
  }

  deleteTask(id) {
    const i = this.db.tasks.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const [task] = this.db.tasks.splice(i, 1);
    this.save();
    this.emit('event', 'task.deleted', { task });
    return task;
  }

  // ---------- categories ----------
  addCategory({ name, color }) {
    if (!name || !String(name).trim()) throw new S.ValidationError('name is required', 'name');
    const c = { id: S.uid('c_'), name: String(name).trim().slice(0, 40), color: S.validColor(color) ? color : 'slate' };
    this.db.categories.push(c);
    this._categoriesChanged();
    return c;
  }
  updateCategory(id, { name, color }) {
    const c = this.db.categories.find((x) => x.id === id);
    if (!c) return null;
    if (name !== undefined && String(name).trim()) c.name = String(name).trim().slice(0, 40);
    if (color !== undefined && S.validColor(color)) c.color = color;
    this._categoriesChanged();
    return c;
  }
  deleteCategory(id) {
    const i = this.db.categories.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.db.categories.splice(i, 1);
    const now = new Date().toISOString();
    for (const t of this.db.tasks) {
      if (t.category === id) {
        t.category = null;
        t.updatedAt = now;
      }
    }
    this._categoriesChanged();
    return true;
  }
  _categoriesChanged() {
    this.save();
    this.emit('event', 'categories.updated', { categories: this.db.categories });
  }

  // ---------- API keys ----------
  /**
   * Roles: "inbox" can only send tasks in (safe to put in a link), "app" can read and change tasks,
   * "admin" can do everything. expiresInDays: 0 or empty = never.
   */
  createKey({ name, role, expiresInDays }) {
    const secret = newSecret('x10_');
    const days = Math.max(0, Math.min(3650, Math.floor(Number(expiresInDays) || 0)));
    const key = {
      id: S.uid('k_'),
      name: String(name || 'แอปใหม่').trim().slice(0, 60) || 'แอปใหม่',
      role: KEY_ROLES.includes(role) ? role : 'app',
      hash: hashKey(secret),
      prefix: secret.slice(0, 8),
      createdAt: new Date().toISOString(),
      expiresAt: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
      lastUsedAt: null,
    };
    this.db.keys.push(key);
    this.flush();
    return { key, secret };
  }
  /** Replaces a key's secret (its old link stops working at once); name, role and expiry stay. */
  rotateKey(id) {
    const key = this.db.keys.find((k) => k.id === id);
    if (!key) return 'not_found';
    if (key.role === 'admin') return 'admin';
    const secret = newSecret('x10_');
    key.hash = hashKey(secret);
    key.prefix = secret.slice(0, 8);
    key.rotatedAt = new Date().toISOString();
    this.flush();
    return { key, secret };
  }
  findKey(secret) {
    if (!secret) return null;
    const h = hashKey(secret);
    const hb = Buffer.from(h, 'hex');
    return this.db.keys.find((k) => {
      const kb = Buffer.from(k.hash, 'hex');
      return kb.length === hb.length && crypto.timingSafeEqual(kb, hb) && !(k.expiresAt && Date.parse(k.expiresAt) <= Date.now());
    }) || null;
  }
  touchKey(key) {
    const now = Date.now();
    if (!key.lastUsedAt || now - Date.parse(key.lastUsedAt) > 60_000) {
      key.lastUsedAt = new Date(now).toISOString();
      this.save();
    }
  }
  deleteKey(id) {
    const k = this.db.keys.find((x) => x.id === id);
    if (!k) return 'not_found';
    if (k.role === 'admin' && this.db.keys.filter((x) => x.role === 'admin').length === 1) return 'last_admin';
    this.db.keys = this.db.keys.filter((x) => x.id !== id);
    this.save();
    return 'ok';
  }

  // ---------- webhooks ----------
  createWebhook({ url, events, name }) {
    const wh = {
      id: S.uid('w_'),
      name: String(name || '').trim().slice(0, 60) || hostOf(url),
      url: checkUrl(url),
      events: normalizeEvents(events),
      secret: newSecret('whsec_'),
      active: true,
      createdAt: new Date().toISOString(),
      lastDeliveryAt: null,
      lastStatus: null,
      lastError: null,
    };
    this.db.webhooks.push(wh);
    this.save();
    return wh;
  }
  updateWebhook(id, body) {
    const wh = this.db.webhooks.find((w) => w.id === id);
    if (!wh) return null;
    if (body.url !== undefined) wh.url = checkUrl(body.url);
    if (body.events !== undefined) wh.events = normalizeEvents(body.events);
    if (body.name !== undefined) wh.name = String(body.name).trim().slice(0, 60) || wh.name;
    if (body.active !== undefined) wh.active = !!body.active;
    this.save();
    return wh;
  }
  deleteWebhook(id) {
    const n = this.db.webhooks.length;
    this.db.webhooks = this.db.webhooks.filter((w) => w.id !== id);
    this.save();
    return this.db.webhooks.length !== n;
  }

  // ---------- connectors (pull tasks from other apps' APIs) ----------
  createConnector(body) {
    const c = { id: S.uid('n_'), active: true, createdAt: new Date().toISOString(), lastSyncAt: null, lastStatus: null, lastError: null, lastCount: 0 };
    Object.assign(c, cleanConnector(body, true));
    this.db.connectors.push(c);
    this.save();
    return c;
  }
  updateConnector(id, body) {
    const c = this.db.connectors.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, cleanConnector(body, false));
    this.save();
    return c;
  }
  deleteConnector(id) {
    const n = this.db.connectors.length;
    this.db.connectors = this.db.connectors.filter((x) => x.id !== id);
    this.save();
    return this.db.connectors.length !== n;
  }
}

const COMPARED = ['title', 'notes', 'category', 'due', 'time', 'reminder', 'repeat', 'priority', 'status', 'externalId', 'sourceName'];
function sameTask(a, b) {
  if (COMPARED.some((k) => (a[k] ?? null) !== (b[k] ?? null))) return false;
  const subs = (t) => JSON.stringify((t.subtasks || []).map((s) => [s.title, s.done, s.detail || '']));
  return subs(a) === subs(b);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'webhook';
  }
}
function checkUrl(url, allowDemo) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new S.ValidationError('url must be a valid http(s) URL', 'url');
  }
  if (!(u.protocol === 'http:' || u.protocol === 'https:' || (allowDemo && u.protocol === 'demo:'))) {
    throw new S.ValidationError('url must start with http:// or https://', 'url');
  }
  return u.toString();
}
function normalizeEvents(events) {
  if (events === undefined || events === null) return ['*'];
  if (!Array.isArray(events) || !events.length) throw new S.ValidationError('events must be a non-empty array', 'events');
  for (const e of events) {
    if (e !== '*' && !S.EVENTS.includes(e)) throw new S.ValidationError(`Unknown event "${e}"`, 'events');
  }
  return events;
}
function cleanConnector(body, isNew) {
  const out = {};
  if (isNew || body.name !== undefined) out.name = String(body.name || '').trim().slice(0, 60) || 'API';
  if (isNew || body.url !== undefined) out.url = checkUrl(body.url, true);
  if (isNew || body.method !== undefined) out.method = ['GET', 'POST'].includes(String(body.method || 'GET').toUpperCase()) ? String(body.method || 'GET').toUpperCase() : 'GET';
  if (isNew || body.headers !== undefined) {
    const h = body.headers && typeof body.headers === 'object' ? body.headers : {};
    out.headers = Object.fromEntries(Object.entries(h).filter(([k, v]) => /^[\w-]+$/.test(k) && typeof v === 'string').slice(0, 20));
  }
  if (isNew || body.body !== undefined) out.body = body.body ? String(body.body).slice(0, 20000) : '';
  if (isNew || body.itemsPath !== undefined) out.itemsPath = String(body.itemsPath || '').trim();
  if (isNew || body.mapping !== undefined) {
    const m = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
    out.mapping = {};
    for (const k of ['title', 'notes', 'due', 'time', 'priority', 'done', 'status', 'externalId', 'category', 'reminder']) {
      if (typeof m[k] === 'string' && m[k].trim()) out.mapping[k] = m[k].trim();
    }
  }
  if (isNew || body.category !== undefined) out.category = body.category ? String(body.category) : null;
  // Which app from the catalog this is, and what was typed into its form (keys included; admin-only).
  if (isNew || body.app !== undefined) out.app = /^[a-z0-9-]{1,30}$/.test(body.app || '') ? body.app : null;
  if (isNew || body.appValues !== undefined) {
    const v = body.appValues && typeof body.appValues === 'object' ? body.appValues : {};
    out.appValues = Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[\w-]{1,30}$/.test(k) && typeof x === 'string').slice(0, 12).map(([k, x]) => [k, x.slice(0, 2000)]));
  }
  if (isNew || body.interval !== undefined) out.interval = Math.max(0, Math.min(1440, Number(body.interval) || 0));
  if (isNew || body.missingDone !== undefined) out.missingDone = !!body.missingDone;
  if (isNew || body.writeBack !== undefined) {
    const wb = body.writeBack && typeof body.writeBack === 'object' ? body.writeBack : null;
    out.writeBack = wb && typeof wb.url === 'string' && /^https?:\/\//.test(wb.url)
      ? {
        method: ['PATCH', 'PUT', 'POST'].includes(String(wb.method).toUpperCase()) ? String(wb.method).toUpperCase() : 'PATCH',
        url: wb.url.slice(0, 500),
        body: typeof wb.body === 'string' ? wb.body.slice(0, 2000) : '{"status":"{{status}}"}',
        status: Object.fromEntries(['todo', 'doing', 'done'].map((k) => [k, wb.status && typeof wb.status[k] === 'string' ? wb.status[k].slice(0, 40) : ''])),
      }
      : null;
  }
  if (body.active !== undefined) out.active = !!body.active;
  return out;
}

module.exports = { Store, hashKey, newSecret, checkUrl, ROLE_RANK };
