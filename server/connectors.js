'use strict';
// Pulls tasks from other apps' APIs on a schedule and upserts them by externalId.
const S = require('../public/js/shared.js');

const MAX_BYTES = 2 * 1024 * 1024;

async function fetchJson(config, ctx, timeoutMs) {
  if (config.url.startsWith('demo://')) {
    const feed = S.demoFeed(config.url.slice('demo://'.length).replace(/\/$/, ''), ctx.today);
    if (!feed) throw new Error('Unknown demo feed');
    return feed;
  }
  const method = config.method === 'POST' ? 'POST' : 'GET';
  const headers = Object.assign({ Accept: 'application/json' }, config.headers || {});
  if (method === 'POST' && config.body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(config.url, {
    method,
    headers,
    body: method === 'POST' && config.body ? config.body : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('Response is larger than 2 MB');
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(config.url).host}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Response is not JSON');
  }
}

class ConnectorRunner {
  constructor(store, { timeoutMs = 15000, log = () => {} } = {}) {
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.running = new Set();
    this.timer = null;
  }

  async preview(config) {
    const ctx = this.store.ctx();
    const json = await fetchJson(config, ctx, this.timeoutMs);
    const mapped = S.mapResponse(json, config, ctx);
    return {
      total: mapped.total,
      errors: mapped.errors.slice(0, 20),
      items: mapped.items.slice(0, 20).map((f) => {
        const { _newCategory, ...rest } = f;
        return rest;
      }),
      sample: S.extractItems(json, config.itemsPath)[0] ?? null,
    };
  }

  async sync(connector) {
    if (this.running.has(connector.id)) return { skipped: true };
    this.running.add(connector.id);
    const source = { source: `connector:${connector.id}`, sourceName: connector.name };
    try {
      const ctx = this.store.ctx();
      const json = await fetchJson(connector, ctx, this.timeoutMs);
      const mapped = S.mapResponse(json, connector, ctx);
      let created = 0;
      let updated = 0;
      for (const fields of mapped.items) {
        const input = Object.assign({}, fields);
        delete input._newCategory;
        if (input.category === undefined && connector.category) input.category = connector.category;
        if (fields._newCategory) input.category = fields._newCategory.name;
        const before = this.store.db.tasks.find((t) => t.externalId === fields.externalId && t.source === source.source);
        // The other system may mark work done, but never un-ticks what was finished in X10.
        if (input.done === false) {
          delete input.done;
          if (before && before.done) delete input.status;
        }
        const r = this.store.upsertTask(input, source);
        if (r.created) created++;
        else if (before && r.task !== before) updated++;
      }
      Object.assign(connector, { lastSyncAt: new Date().toISOString(), lastStatus: 'ok', lastError: mapped.errors.length ? `${mapped.errors.length} รายการอ่านไม่ได้: ${mapped.errors[0].message}` : null, lastCount: mapped.items.length });
      this.store.save();
      return { created, updated, total: mapped.total, errors: mapped.errors.slice(0, 20) };
    } catch (e) {
      Object.assign(connector, { lastSyncAt: new Date().toISOString(), lastStatus: 'error', lastError: e.message });
      this.store.save();
      this.log(`connector ${connector.id} failed: ${e.message}`);
      throw e;
    } finally {
      this.running.delete(connector.id);
    }
  }

  start(everyMs = 60_000) {
    this.timer = setInterval(() => this.tick(), everyMs);
    this.timer.unref?.();
  }

  tick() {
    const now = Date.now();
    for (const c of this.store.db.connectors) {
      if (!c.active || !c.interval) continue;
      const last = c.lastSyncAt ? Date.parse(c.lastSyncAt) : 0;
      if (now - last >= c.interval * 60_000) this.sync(c).catch(() => {});
    }
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { ConnectorRunner, fetchJson };
