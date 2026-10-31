/* X10 Tasks — phone app. Works offline in the browser; syncs with the X10 server when connected. */
(function () {
  'use strict';
  const S = window.X10Shared;
  const DEMO = !!window.X10_DEMO;
  const STORAGE_KEY = 'x10tasks.v1';

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const enc = encodeURIComponent;
  const today = () => S.todayIn(undefined);
  const nowISO = () => new Date().toISOString();
  const toDate = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const fmt = (opts) => new Intl.DateTimeFormat('th-TH', opts);
  const F_SHORT = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
  const F_WEEKDAY = fmt({ weekday: 'long' });
  const F_MONTH_YEAR = fmt({ month: 'long', year: 'numeric' });
  const F_LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const RTF = new Intl.RelativeTimeFormat('th', { numeric: 'auto' });

  function ago(iso) {
    if (!iso) return 'ยังไม่เคย';
    const s = (Date.parse(iso) - Date.now()) / 1000;
    if (Math.abs(s) < 60) return 'เมื่อสักครู่';
    if (Math.abs(s) < 3600) return RTF.format(Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return RTF.format(Math.round(s / 3600), 'hour');
    return RTF.format(Math.round(s / 86400), 'day');
  }
  function dueLabel(due) {
    const td = today();
    if (due === td) return 'วันนี้';
    if (due === S.addDays(td, 1)) return 'พรุ่งนี้';
    if (due === S.addDays(td, -1)) return 'เมื่อวาน';
    return F_SHORT.format(toDate(due));
  }
  function hostOf(url) {
    try {
      return new URL(url).host || url;
    } catch {
      return url;
    }
  }

  // ---------- icons (24px, stroked) ----------
  const ICONS = {
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    tasks: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.5 6.5l1.5 1.5 2.5-3M3.5 12l1.5 1.5 2.5-3M3.5 17.5l1.5 1.5 2.5-3"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    plug: '<path d="M9 7V3M15 7V3"/><path d="M6.5 7h11v4a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    checklist: '<path d="M3.5 6.5l1.5 1.5 3-3M3.5 15.5l1.5 1.5 3-3"/><path d="M11 7h9.5M11 16h9.5"/>',
    note: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 13h7M9 17h5"/>',
    flag: '<path d="M5.5 21V4.5"/><path d="M5.5 4.5h11l-2 4 2 4h-11"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
    cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5A4 4 0 0 1 17 18.5z"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
    send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    inbox: '<path d="M3.5 13.5l2.5-8h12l2.5 8v6h-17z"/><path d="M3.5 13.5h5l1 2h5l1-2h5"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // ---------- state ----------
  function defaultState() {
    return {
      tasks: [],
      categories: S.DEFAULT_CATEGORIES.map((c) => Object.assign({}, c)),
      connectors: [],
      outbox: [],
      notified: {},
      settings: { theme: 'system', server: null, seeded: false, showDone: false, notify: false },
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const s = Object.assign(defaultState(), saved);
        s.settings = Object.assign(defaultState().settings, saved.settings || {});
        return s;
      }
    } catch (e) {
      /* storage unavailable — start fresh */
    }
    return defaultState();
  }
  let state = load();
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        /* storage full or blocked */
      }
    }, 80);
  }

  const ui = {
    view: 'tasks',
    category: 'all',
    search: '',
    searchOpen: false,
    calMonth: today().slice(0, 7),
    calDay: today(),
    serverHint: false,
    remote: { keys: [], webhooks: [], connectors: [], loaded: false, error: null },
    installPrompt: null,
  };

  function ctx() {
    return { now: nowISO(), today: today(), timeZone: undefined, categories: state.categories, find: findTask };
  }
  const findTask = (id) => state.tasks.find((t) => t.id === id) || null;
  const catOf = (id) => state.categories.find((c) => c.id === id) || null;
  const catColor = (id) => `var(--c-${(catOf(id) || { color: 'slate' }).color})`;

  // ---------- seed examples on first run ----------
  function seed() {
    if (state.settings.seeded || state.tasks.length || state.settings.server) return;
    const td = today();
    const c = ctx();
    const ex = (f) => S.createTask(f, c, { sample: true });
    state.tasks = [
      ex({ title: 'ส่งสรุปยอดจองประจำสัปดาห์', due: S.addDays(td, -1), time: '17:00', category: 'work', priority: 1 }),
      ex({ title: 'ประชุมทีมฝ่ายต้อนรับ', due: td, time: '09:30', category: 'work', repeat: 'weekdays', reminder: 15 }),
      ex({ title: 'ตรวจความเรียบร้อยวิลล่าก่อนแขก VIP เข้าพัก', due: td, time: '13:30', category: 'work', priority: 2, reminder: 30,
        subtasks: [{ title: 'ดอกไม้และการ์ดต้อนรับ', done: true }, { title: 'เช็กเครื่องปรับอากาศ', done: false }, { title: 'มินิบาร์ครบ', done: false }] }),
      ex({ title: 'ออกกำลังกาย 30 นาที', due: td, time: '18:00', category: 'personal', repeat: 'daily' }),
      ex({ title: 'ตอบอีเมลลูกค้ากลุ่มสัมมนา', due: td, time: '08:30', category: 'work', done: true }),
      ex({ title: 'จองตั๋วเครื่องบินไปเชียงใหม่', due: S.addDays(td, 1), time: '20:00', category: 'personal', reminder: 15 }),
      ex({ title: 'ซื้อของขวัญวันเกิดแม่', due: S.addDays(td, 4), category: 'birthday', notes: 'แม่ชอบผ้าไหมสีพาสเทล', reminder: 1440 }),
      ex({ title: 'หูฟังตัดเสียงรบกวน', category: 'wishlist', notes: 'รอโปรลดราคา 11.11' }),
    ];
    state.settings.seeded = true;
    save();
  }

  // ---------- local data operations (also the optimistic layer when synced) ----------
  function upsertLocal(task) {
    const i = state.tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) state.tasks[i] = task;
    else state.tasks.push(task);
  }
  function removeLocal(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
  }
  function takeNewCategory(fields) {
    if (fields._newCategory) {
      if (Sync.on) fields.category = null;
      else state.categories.push(fields._newCategory);
      delete fields._newCategory;
    }
    return fields;
  }
  function payload(task) {
    const out = {};
    for (const k of ['id', 'title', 'notes', 'category', 'due', 'time', 'reminder', 'repeat', 'priority', 'subtasks', 'done', 'externalId', 'sourceName', 'seriesId', 'spawnedId']) {
      if (task[k] !== undefined && task[k] !== null) out[k] = task[k];
    }
    return out;
  }

  function addTask(fields, extra) {
    takeNewCategory(fields);
    const task = S.createTask(fields, ctx(), extra);
    state.tasks.push(task);
    Sync.send('POST', '/tasks', payload(task), task.id);
    changed();
    return task;
  }
  function updateTask(id, fields) {
    const t = findTask(id);
    if (!t) return null;
    takeNewCategory(fields);
    const next = S.patchTask(t, fields, ctx());
    upsertLocal(next);
    Sync.send('PATCH', `/tasks/${enc(id)}`, fields, id);
    changed();
    return next;
  }
  function setTaskDone(id, done) {
    const t = findTask(id);
    if (!t) return null;
    const r = S.setDone(t, done, ctx());
    upsertLocal(r.task);
    if (r.spawn) upsertLocal(r.spawn);
    if (r.removeId) removeLocal(r.removeId);
    Sync.send('PATCH', `/tasks/${enc(id)}`, { done }, id);
    changed();
    return r;
  }
  function deleteTask(id) {
    const t = findTask(id);
    if (!t) return null;
    removeLocal(id);
    Sync.send('DELETE', `/tasks/${enc(id)}`, undefined, id);
    changed();
    return t;
  }
  function restoreTask(task) {
    upsertLocal(task);
    Sync.send('POST', '/tasks', payload(task), task.id);
    changed();
  }
  // Used by local (in-browser) imports: same rules as the server's upsert.
  function upsertFromSource(fields, source) {
    const existing = state.tasks.find((t) => t.externalId && t.externalId === fields.externalId && t.source === source.source);
    if (existing) {
      const patch = Object.assign({}, fields);
      const doneChange = patch.done !== undefined && patch.done !== existing.done;
      delete patch.done;
      takeNewCategory(patch);
      let next = S.patchTask(existing, patch, ctx());
      if (doneChange) next = S.setDone(next, fields.done, ctx()).task;
      const changedFields = ['title', 'notes', 'due', 'time', 'priority', 'category', 'done'].some((k) => (next[k] ?? null) !== (existing[k] ?? null));
      if (!changedFields) return 'same';
      upsertLocal(next);
      return 'updated';
    }
    takeNewCategory(fields);
    state.tasks.push(S.createTask(fields, ctx(), { source: source.source, sourceName: source.sourceName }));
    return 'created';
  }

  function changed(rerender = true) {
    save();
    if (rerender) render();
    Reminders.check();
  }

  // ---------- sync with the X10 server ----------
  const Sync = {
    status: 'local',
    es: null,
    flushing: false,
    retryTimer: null,
    get on() {
      return !!state.settings.server;
    },
    base() {
      const url = (state.settings.server && state.settings.server.url) || location.origin;
      return url.replace(/\/+$/, '') + '/api/v1';
    },
    async api(method, path, body, server) {
      const srv = server || state.settings.server;
      const base = server ? server.url.replace(/\/+$/, '') + '/api/v1' : this.base();
      let res;
      try {
        res = await fetch(base + path, {
          method,
          headers: Object.assign({ Authorization: 'Bearer ' + srv.key }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        const err = new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือที่อยู่เซิร์ฟเวอร์');
        err.network = true;
        throw err;
      }
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        /* empty body */
      }
      if (!res.ok) {
        const err = new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    },
    setStatus(s) {
      if (this.status === s) return;
      this.status = s;
      const pill = $('#sync-pill');
      if (pill) pill.outerHTML = syncPill();
      if (ui.view === 'connect') render();
    },
    pending(id) {
      return state.outbox.some((o) => o.id === id);
    },
    send(method, path, body, id) {
      if (!this.on) return;
      state.outbox.push({ method, path, body, id });
      save();
      this.flush();
    },
    async flush() {
      if (!this.on || this.flushing) return;
      this.flushing = true;
      let dirty = false;
      try {
        while (state.outbox.length && this.on) {
          const op = state.outbox[0];
          try {
            const data = await this.api(op.method, op.path, op.body);
            state.outbox.shift();
            if (data && data.task && !this.pending(data.task.id)) (upsertLocal(data.task), (dirty = true));
            if (data && data.spawned && !this.pending(data.spawned.id)) (upsertLocal(data.spawned), (dirty = true));
            this.setStatus('online');
          } catch (e) {
            if (e.network || e.status >= 500) {
              this.setStatus('offline');
              this.retryLater();
              break;
            }
            if (e.status === 401) {
              this.setStatus('unauthorized');
              break;
            }
            state.outbox.shift();
            if (e.status !== 404) toast(`บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ: ${e.message}`);
          }
        }
      } finally {
        this.flushing = false;
        save();
        if (dirty) render();
      }
    },
    retryLater() {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.start(), 15000);
    },
    async pull() {
      const [t, c] = await Promise.all([this.api('GET', '/tasks'), this.api('GET', '/categories')]);
      const pendingIds = new Set(state.outbox.map((o) => o.id));
      const local = new Map(state.tasks.map((x) => [x.id, x]));
      state.tasks = t.tasks.filter((x) => !pendingIds.has(x.id)).concat([...pendingIds].map((id) => local.get(id)).filter(Boolean));
      state.categories = c.categories;
      save();
      render();
      Reminders.check();
    },
    async start() {
      clearTimeout(this.retryTimer);
      if (!this.on) {
        this.stop();
        return;
      }
      this.setStatus('connecting');
      try {
        await this.flush();
        await this.pull();
        this.setStatus('online');
        this.connectStream();
      } catch (e) {
        this.setStatus(e.status === 401 ? 'unauthorized' : 'offline');
        if (e.status !== 401) this.retryLater();
      }
    },
    connectStream() {
      if (this.es) this.es.close();
      if (typeof EventSource === 'undefined' || !this.on) return;
      const es = new EventSource(`${this.base()}/stream?access_token=${enc(state.settings.server.key)}`);
      const live = (fn) => (e) => {
        try {
          fn(JSON.parse(e.data));
        } catch (err) {
          /* ignore malformed event */
        }
      };
      es.addEventListener('hello', () => {
        if (this.status !== 'online') this.start();
      });
      es.addEventListener('task.created', live(({ task }) => !this.pending(task.id) && (upsertLocal(task), changed())));
      es.addEventListener('task.updated', live(({ task }) => !this.pending(task.id) && (upsertLocal(task), changed())));
      es.addEventListener('task.deleted', live(({ task }) => !this.pending(task.id) && (removeLocal(task.id), changed())));
      es.addEventListener('categories.updated', live(({ categories }) => ((state.categories = categories), changed())));
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          this.setStatus('offline');
          this.retryLater();
        } else this.setStatus('connecting');
      };
      this.es = es;
    },
    stop() {
      if (this.es) this.es.close();
      this.es = null;
      clearTimeout(this.retryTimer);
      this.setStatus('local');
    },
  };

  // ---------- reminders ----------
  const Reminders = {
    timer: null,
    fireTime(t) {
      if (t.done || t.reminder === null || t.reminder === undefined || !t.due) return null;
      const [h, m] = (t.time || '09:00').split(':').map(Number);
      const d = toDate(t.due);
      d.setHours(h, m, 0, 0);
      return d.getTime() - t.reminder * 60000;
    },
    check() {
      const now = Date.now();
      let fired = false;
      for (const t of state.tasks) {
        const at = this.fireTime(t);
        if (at === null || at > now || now - at > 6 * 3600 * 1000) continue;
        const k = `${t.id}|${at}`;
        if (state.notified[k]) continue;
        state.notified[k] = now;
        fired = true;
        this.notify(t);
      }
      for (const k of Object.keys(state.notified)) if (now - state.notified[k] > 3 * 86400 * 1000) delete state.notified[k];
      if (fired) save();
    },
    notify(t) {
      const when = t.time ? `${dueLabel(t.due)} ${t.time}` : dueLabel(t.due);
      toast(`${icon('bell')} ถึงเวลา: ${esc(t.title)}`, { html: true, action: 'ดูงาน', onAction: () => openEditor(t.id) });
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const opts = { body: when, tag: t.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { id: t.id } };
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then((reg) => reg.showNotification(t.title, opts));
        } else new Notification(t.title, opts);
      } catch (e) {
        /* notifications not allowed here */
      }
    },
    start() {
      this.check();
      this.timer = setInterval(() => this.check(), 30000);
    },
  };

  // ---------- connectors running in the browser (when not connected to the server) ----------
  async function fetchFeed(conf) {
    if (conf.url.startsWith('demo://')) {
      const feed = S.demoFeed(conf.url.slice(7).replace(/\/$/, ''), today());
      if (!feed) throw new Error('ไม่พบข้อมูลตัวอย่างนี้');
      return feed;
    }
    let res;
    try {
      res = await fetch(conf.url, {
        method: conf.method === 'POST' ? 'POST' : 'GET',
        headers: Object.assign({ Accept: 'application/json' }, conf.headers || {}),
        body: conf.method === 'POST' && conf.body ? conf.body : undefined,
      });
    } catch (e) {
      throw new Error('เรียก API ไม่ได้ ระบบปลายทางอาจไม่อนุญาตให้เรียกจากเบราว์เซอร์ (CORS) ให้เชื่อมต่อผ่านเซิร์ฟเวอร์ X10 แทน');
    }
    if (!res.ok) throw new Error(`ระบบปลายทางตอบกลับ HTTP ${res.status}`);
    try {
      return await res.json();
    } catch (e) {
      throw new Error('ข้อมูลที่ได้ไม่ใช่ JSON');
    }
  }
  async function previewConnector(conf) {
    if (Sync.on) return Sync.api('POST', '/connectors/preview', conf);
    const json = await fetchFeed(conf);
    const r = S.mapResponse(json, conf, ctx());
    return { total: r.total, errors: r.errors.slice(0, 20), items: r.items.slice(0, 20), sample: S.extractItems(json, conf.itemsPath)[0] ?? null };
  }
  async function syncLocalConnector(conn) {
    const source = { source: `connector:${conn.id}`, sourceName: conn.name };
    try {
      const json = await fetchFeed(conn);
      const mapped = S.mapResponse(json, conn, ctx());
      let created = 0;
      let updated = 0;
      for (const f of mapped.items) {
        if (f.category === undefined && conn.category) f.category = conn.category;
        if (f.done === false) delete f.done;
        const r = upsertFromSource(f, source);
        if (r === 'created') created++;
        if (r === 'updated') updated++;
      }
      Object.assign(conn, { lastSyncAt: nowISO(), lastStatus: 'ok', lastError: mapped.errors.length ? `${mapped.errors.length} รายการอ่านไม่ได้` : null, lastCount: mapped.items.length });
      changed();
      return { created, updated, total: mapped.total };
    } catch (e) {
      Object.assign(conn, { lastSyncAt: nowISO(), lastStatus: 'error', lastError: e.message });
      changed();
      throw e;
    }
  }
  setInterval(() => {
    if (Sync.on) return;
    for (const c of state.connectors) {
      if (c.active !== false && c.interval && Date.now() - Date.parse(c.lastSyncAt || 0) >= c.interval * 60000) syncLocalConnector(c).catch(() => {});
    }
  }, 60000);

  // ---------- toast & dialogs ----------
  let toastTimer = null;
  function toast(msg, opts = {}) {
    const root = $('#toast-root');
    root.innerHTML = `<div class="toast" role="status"><span class="toast-msg">${opts.html ? msg : esc(msg)}</span>${opts.action ? `<button class="toast-btn" type="button">${esc(opts.action)}</button>` : ''}</div>`;
    const btn = $('.toast-btn', root);
    if (btn) {
      btn.addEventListener('click', () => {
        root.innerHTML = '';
        opts.onAction();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (root.innerHTML = ''), opts.action ? 5000 : 2600);
  }

  function confirmDialog({ title, message, confirm = 'ยืนยัน', danger = false }) {
    return new Promise((resolve) => {
      const root = $('#dialog-root');
      root.innerHTML = `<div class="dialog-backdrop"></div>
        <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
          <h2 id="dlg-title">${esc(title)}</h2>
          ${message ? `<p>${esc(message)}</p>` : ''}
          <div class="dialog-actions">
            <button type="button" class="btn ghost" data-r="0">ยกเลิก</button>
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(confirm)}</button>
          </div>
        </div>`;
      root.hidden = false;
      const done = (r) => {
        root.hidden = true;
        root.innerHTML = '';
        resolve(r);
      };
      $$('[data-r]', root).forEach((b) => b.addEventListener('click', () => done(b.dataset.r === '1')));
      $('.dialog-backdrop', root).addEventListener('click', () => done(false));
      $('[data-r="1"]', root).focus();
    });
  }

  let sheetReturnFocus = null;
  function openSheet(html, { label = '', onMount, wide = false } = {}) {
    const root = $('#sheet-root');
    sheetReturnFocus = document.activeElement;
    root.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
      <section class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <div class="sheet-grip" aria-hidden="true"></div>${html}</section>`;
    root.hidden = false;
    document.body.classList.add('locked');
    requestAnimationFrame(() => root.classList.add('open'));
    const sheet = $('.sheet', root);
    if (onMount) onMount(sheet);
    const first = $('[autofocus]', sheet);
    if (first) setTimeout(() => first.focus(), 60);
    return sheet;
  }
  function closeSheet() {
    const root = $('#sheet-root');
    if (root.hidden) return;
    root.classList.remove('open');
    document.body.classList.remove('locked');
    setTimeout(() => {
      if (!root.classList.contains('open')) {
        root.hidden = true;
        root.innerHTML = '';
      }
    }, 220);
    if (sheetReturnFocus && sheetReturnFocus.focus) sheetReturnFocus.focus();
  }
  const sheetHead = (title, sub) => `<header class="sheet-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    <button type="button" class="icon-btn" data-action="close-sheet" aria-label="ปิด">${icon('x')}</button></header>`;

  async function copyText(text, el) {
    try {
      await navigator.clipboard.writeText(text);
      toast('คัดลอกแล้ว');
    } catch (e) {
      const target = el && el.closest('.copy-box') ? $('code, pre', el.closest('.copy-box')) : null;
      if (target) {
        const r = document.createRange();
        r.selectNodeContents(target);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      toast('เลือกข้อความแล้ว กดค้างเพื่อคัดลอก');
    }
  }
  const copyBox = (text, { pre = false, label = 'คัดลอก' } = {}) => `<div class="copy-box">${pre ? `<pre>${esc(text)}</pre>` : `<code>${esc(text)}</code>`}
    <button type="button" class="icon-btn small" data-action="copy" data-text="${esc(text)}" aria-label="${esc(label)}">${icon('copy')}</button></div>`;

  // ---------- theme ----------
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else if (!DEMO) document.documentElement.removeAttribute('data-theme');
    else if (document.documentElement.dataset.x10theme) document.documentElement.removeAttribute('data-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.x10theme = t;
    else delete document.documentElement.dataset.x10theme;
  }

  // ---------- task list ----------
  function sortTasks(list) {
    return list.sort((a, b) =>
      (a.due || '9999') .localeCompare(b.due || '9999') ||
      (a.time || '99:99').localeCompare(b.time || '99:99') ||
      (b.priority || 0) - (a.priority || 0) ||
      a.createdAt.localeCompare(b.createdAt));
  }
  function visibleTasks() {
    let list = state.tasks;
    if (ui.category !== 'all') list = list.filter((t) => t.category === ui.category);
    if (ui.search.trim()) {
      const q = ui.search.trim().toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q) || (t.subtasks || []).some((s) => s.title.toLowerCase().includes(q)));
    }
    return list;
  }

  function taskRow(t, { showDate = false } = {}) {
    const meta = [];
    if (showDate && t.due) meta.push(`<span class="meta-date${!t.done && t.due < today() ? ' late' : ''}">${esc(dueLabel(t.due))}</span>`);
    if (t.time) meta.push(`<span class="meta-time">${icon('clock')}${esc(t.time)}</span>`);
    if (t.reminder !== null && t.reminder !== undefined) meta.push(`<span title="มีแจ้งเตือน">${icon('bell')}</span>`);
    if (t.repeat) meta.push(`<span title="ทำซ้ำ">${icon('repeat')}</span>`);
    if (t.subtasks && t.subtasks.length) meta.push(`<span>${icon('checklist')}${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}</span>`);
    if (t.notes) meta.push(`<span title="มีบันทึก">${icon('note')}</span>`);
    if (t.sourceName) meta.push(`<span class="src">${icon('inbox')}${esc(t.sourceName)}</span>`);
    if (t.sample) meta.push('<span class="src sample">ตัวอย่าง</span>');
    const cat = catOf(t.category);
    return `<li class="task${t.done ? ' done' : ''}${t.priority ? ' p' + t.priority : ''}" data-id="${esc(t.id)}" style="--cat:${catColor(t.category)}">
      <button type="button" class="check" data-action="toggle" data-id="${esc(t.id)}" role="checkbox" aria-checked="${t.done}" aria-label="${t.done ? 'ยกเลิกเสร็จ' : 'ทำเสร็จ'}: ${esc(t.title)}">${icon('check')}</button>
      <button type="button" class="task-body" data-action="open" data-id="${esc(t.id)}">
        <span class="task-title">${esc(t.title)}</span>
        ${meta.length || cat ? `<span class="task-meta">${cat && ui.category === 'all' ? `<span class="cat-tag">${esc(cat.name)}</span>` : ''}${meta.join('')}</span>` : ''}
      </button>
      ${t.priority ? `<span class="prio" title="${t.priority === 2 ? 'ด่วน' : 'สำคัญ'}">${icon('flag')}</span>` : ''}
    </li>`;
  }

  function group(title, list, opts = {}) {
    if (!list.length) return '';
    return `<section class="tgroup${opts.cls ? ' ' + opts.cls : ''}">
      <h3 class="tgroup-head">${opts.toggle ? `<button type="button" class="link-btn" data-action="toggle-done" aria-expanded="${state.settings.showDone}">${esc(title)} <span class="count">${list.length}</span>${icon('down', state.settings.showDone ? 'flip' : '')}</button>` : `${esc(title)} <span class="count">${list.length}</span>`}</h3>
      ${opts.collapsed ? '' : `<ul class="tlist">${list.map((t) => taskRow(t, opts)).join('')}</ul>`}
    </section>`;
  }

  function renderTaskList() {
    const el = $('#task-list');
    if (!el) return;
    const td = today();
    const list = visibleTasks();
    const open = sortTasks(list.filter((t) => !t.done));
    const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 50);
    const overdue = open.filter((t) => t.due && t.due < td);
    const todays = open.filter((t) => t.due === td);
    const upcoming = open.filter((t) => t.due && t.due > td);
    const nodate = open.filter((t) => !t.due);
    let html = '';
    if (ui.serverHint && !Sync.on) {
      html += `<div class="banner">${icon('cloud')}<div><strong>พบเซิร์ฟเวอร์ X10</strong><span>เชื่อมต่อเพื่อซิงก์ข้อมูลและให้แอปอื่นส่งงานเข้ามาได้</span></div><button type="button" class="btn small primary" data-action="connect-server">เชื่อมต่อ</button></div>`;
    }
    if (state.tasks.some((t) => t.sample)) {
      html += `<div class="banner soft">${icon('tasks')}<div><strong>รายการนี้เป็นงานตัวอย่าง</strong><span>ลองแตะวงกลมเพื่อทำเสร็จ หรือแตะงานเพื่อแก้ไข</span></div><button type="button" class="btn small ghost" data-action="clear-samples">ลบตัวอย่าง</button></div>`;
    }
    if (!open.length && !done.length) {
      html += ui.search
        ? `<div class="empty"><p class="empty-title">ไม่พบงานที่ตรงกับ “${esc(ui.search)}”</p></div>`
        : `<div class="empty">${icon('sun', 'big')}<p class="empty-title">ยังไม่มีงานในหมวดนี้</p><p>แตะปุ่ม + ด้านล่างเพื่อเพิ่มงานแรก</p></div>`;
    } else if (!open.length) {
      html += `<div class="empty small">${icon('check', 'big')}<p class="empty-title">เคลียร์งานหมดแล้ว</p></div>`;
    }
    html += group('เลยกำหนด', overdue, { cls: 'late', showDate: true });
    html += group('วันนี้', todays);
    html += group('เร็ว ๆ นี้', upcoming, { showDate: true });
    html += group('ไม่มีกำหนด', nodate);
    html += group('เสร็จแล้ว', done, { cls: 'finished', toggle: true, collapsed: !state.settings.showDone, showDate: true });
    el.innerHTML = html;
  }

  function dayTimeline(list) {
    const td = today();
    const timed = list.filter((t) => t.due === td && t.time);
    const mins = (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    const startH = Math.min(6, ...timed.map((t) => Math.floor(mins(t.time) / 60)));
    const endH = Math.max(22, ...timed.map((t) => Math.ceil((mins(t.time) + 1) / 60)));
    const span = (endH - startH) * 60;
    const pct = (m) => Math.max(0, Math.min(100, ((m - startH * 60) / span) * 100));
    const ticks = [];
    for (let h = Math.ceil(startH / 3) * 3; h <= endH; h += 3) ticks.push(`<span class="tl-tick" style="left:${pct(h * 60)}%">${String(h).padStart(2, '0')}</span>`);
    let lastPct = -10;
    let lane = 0;
    const dots = timed.sort((a, b) => a.time.localeCompare(b.time)).map((t) => {
      const p = pct(mins(t.time));
      lane = p - lastPct < 4 ? (lane + 1) % 3 : 0;
      lastPct = p;
      return `<button type="button" class="tl-dot${t.done ? ' done' : ''}" style="left:${p}%;--lane:${lane};--cat:${catColor(t.category)}" data-action="open" data-id="${esc(t.id)}" aria-label="${esc(t.time + ' ' + t.title)}"></button>`;
    }).join('');
    const nowMark = nowM >= startH * 60 && nowM <= endH * 60 ? `<span class="tl-now" style="left:${pct(nowM)}%"><span>ตอนนี้</span></span>` : '';
    return `<div class="timeline" aria-label="เส้นเวลางานวันนี้"><div class="tl-track">${nowMark}${dots}</div><div class="tl-ticks">${ticks.join('')}</div></div>`;
  }

  function progressRing(done, total) {
    const r = 21;
    const c = 2 * Math.PI * r;
    const f = total ? done / total : 0;
    return `<div class="ring" role="img" aria-label="วันนี้เสร็จ ${done} จาก ${total} งาน">
      <svg viewBox="0 0 52 52"><circle class="ring-bg" cx="26" cy="26" r="${r}"/><circle class="ring-fg" cx="26" cy="26" r="${r}" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}"/></svg>
      <span class="ring-num">${done}<small>/${total}</small></span></div>`;
  }

  function syncPill() {
    const map = {
      local: ['', ''],
      connecting: ['wait', 'กำลังเชื่อมต่อ'],
      online: ['ok', 'ซิงก์แล้ว'],
      offline: ['warn', state.outbox.length ? `ออฟไลน์ · รอส่ง ${state.outbox.length}` : 'ออฟไลน์'],
      unauthorized: ['bad', 'คีย์ไม่ถูกต้อง'],
    };
    const [cls, label] = map[Sync.status] || map.local;
    return label ? `<button type="button" id="sync-pill" class="pill ${cls}" data-action="go" data-view="connect">${esc(label)}</button>` : '<span id="sync-pill" hidden></span>';
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'ราตรีสวัสดิ์';
    if (h < 12) return 'สวัสดีตอนเช้า';
    if (h < 17) return 'สวัสดีตอนบ่าย';
    return 'สวัสดีตอนเย็น';
  }

  function viewTasks() {
    const td = today();
    const d = toDate(td);
    const scoped = ui.category === 'all' ? state.tasks : state.tasks.filter((t) => t.category === ui.category);
    const todayAll = scoped.filter((t) => t.due === td || (t.done && t.doneAt && S.todayIn(undefined, new Date(t.doneAt)) === td && t.due && t.due < td));
    const doneToday = todayAll.filter((t) => t.done).length;
    const chips = [{ id: 'all', name: 'ทั้งหมด' }].concat(state.categories).map((c) => {
      const n = c.id === 'all' ? state.tasks.filter((t) => !t.done).length : state.tasks.filter((t) => !t.done && t.category === c.id).length;
      return `<button type="button" class="chip${ui.category === c.id ? ' on' : ''}" data-action="cat" data-cat="${esc(c.id)}" style="--cat:${c.id === 'all' ? 'var(--accent)' : `var(--c-${c.color})`}" aria-pressed="${ui.category === c.id}">${c.id === 'all' ? '' : '<i class="dot"></i>'}${esc(c.name)}${n ? `<span class="n">${n}</span>` : ''}</button>`;
    }).join('');
    return `
      <header class="hero">
        <div class="hero-top">
          <p class="greet">${greeting()}</p>
          <div class="hero-actions">${syncPill()}
            <button type="button" class="icon-btn" data-action="search" aria-label="ค้นหางาน" aria-expanded="${ui.searchOpen}">${icon('search')}</button></div>
        </div>
        <div class="date-row">
          <div class="date-block">
            <span class="date-num">${d.getDate()}</span>
            <span class="date-text"><span class="date-wd">${F_WEEKDAY.format(d)}</span><span class="date-my">${F_MONTH_YEAR.format(d)}</span></span>
          </div>
          <div class="ring-wrap">${progressRing(doneToday, todayAll.length)}<span class="ring-cap">เสร็จวันนี้</span></div>
        </div>
        ${dayTimeline(scoped)}
      </header>
      <div class="chips-bar">
        <div class="search-row"${ui.searchOpen ? '' : ' hidden'}>
          ${icon('search')}<input id="search-input" type="search" placeholder="ค้นหางาน บันทึก หรืองานย่อย" value="${esc(ui.search)}" autocomplete="off" aria-label="ค้นหางาน">
        </div>
        <div class="chips" role="toolbar" aria-label="หมวดหมู่">${chips}
          <button type="button" class="chip add" data-action="new-category" aria-label="เพิ่มหมวดหมู่">${icon('plus')}</button></div>
      </div>
      <div id="task-list" class="task-list"></div>`;
  }

  // ---------- calendar ----------
  function viewCalendar() {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysIn = new Date(y, m, 0).getDate();
    const lead = first.getDay();
    const td = today();
    const byDay = {};
    for (const t of state.tasks) if (t.due) (byDay[t.due] = byDay[t.due] || []).push(t);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell blank"></span>');
    for (let d = 1; d <= daysIn; d++) {
      const ymd = `${y}-${S.pad(m)}-${S.pad(d)}`;
      const list = byDay[ymd] || [];
      const open = list.filter((t) => !t.done);
      const dots = open.slice(0, 3).map((t) => `<i style="--cat:${catColor(t.category)}"></i>`).join('') + (open.length > 3 ? '<b>+</b>' : '');
      const late = open.length && ymd < td;
      cells.push(`<button type="button" class="cal-cell${ymd === td ? ' today' : ''}${ymd === ui.calDay ? ' sel' : ''}${late ? ' late' : ''}${!open.length && list.length ? ' alldone' : ''}" data-action="cal-day" data-day="${ymd}" aria-label="${esc(F_LONG.format(toDate(ymd)))} มี ${open.length} งานค้าง" aria-pressed="${ymd === ui.calDay}">
        <span class="cal-num">${d}</span><span class="cal-dots">${dots}</span></button>`);
    }
    const dayTasks = sortTasks((byDay[ui.calDay] || []).slice());
    const wd = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((w, i) => `<span class="${i === 0 || i === 6 ? 'we' : ''}">${w}</span>`).join('');
    return `
      <header class="page-head row">
        <div><p class="eyebrow">ปฏิทิน</p><h1>${esc(F_MONTH_YEAR.format(first))}</h1></div>
        <div class="head-actions">
          <button type="button" class="icon-btn" data-action="cal-move" data-step="-1" aria-label="เดือนก่อน">${icon('left')}</button>
          <button type="button" class="btn small ghost" data-action="cal-today">วันนี้</button>
          <button type="button" class="icon-btn" data-action="cal-move" data-step="1" aria-label="เดือนถัดไป">${icon('right')}</button>
        </div>
      </header>
      <div class="cal">
        <div class="cal-wd">${wd}</div>
        <div class="cal-grid">${cells.join('')}</div>
      </div>
      <section class="tgroup">
        <h3 class="tgroup-head">${esc(F_LONG.format(toDate(ui.calDay)))}</h3>
        ${dayTasks.length ? `<ul class="tlist">${dayTasks.map((t) => taskRow(t)).join('')}</ul>` : '<div class="empty small"><p>ไม่มีงานในวันนี้</p></div>'}
        <button type="button" class="btn ghost block" data-action="new-on-day" data-day="${ui.calDay}">${icon('plus')} เพิ่มงานวันนี้</button>
      </section>`;
  }

  // ---------- connect (APIs) ----------
  function connectorRows(list, remote) {
    if (!list.length) return `<div class="empty small"><p>ยังไม่มีแหล่งข้อมูล ลองเริ่มจากตัวอย่าง “ระบบห้องพัก” ได้</p></div>`;
    return `<ul class="rows">${list.map((c) => `
      <li class="row-item">
        <span class="row-icon ${c.lastStatus === 'error' ? 'bad' : c.lastStatus === 'ok' ? 'ok' : ''}">${icon('inbox')}</span>
        <div class="row-main">
          <strong>${esc(c.name)}</strong>
          <span class="mono">${esc(hostOf(c.url))}</span>
          <span class="row-sub">${c.lastStatus === 'error' ? `<em class="bad">ผิดพลาด: ${esc(c.lastError)}</em>` : c.lastSyncAt ? `ซิงก์ ${esc(ago(c.lastSyncAt))} · ${c.lastCount} งาน${c.lastError ? ` · ${esc(c.lastError)}` : ''}` : 'ยังไม่เคยซิงก์'}${c.interval ? ` · อัตโนมัติทุก ${intervalLabel(c.interval)}` : ''}</span>
        </div>
        <div class="row-actions">
          <button type="button" class="icon-btn small" data-action="sync-connector" data-id="${esc(c.id)}" data-remote="${remote ? 1 : 0}" aria-label="ซิงก์ ${esc(c.name)} ตอนนี้">${icon('refresh')}</button>
          <button type="button" class="icon-btn small" data-action="edit-connector" data-id="${esc(c.id)}" aria-label="แก้ไข ${esc(c.name)}">${icon('edit')}</button>
        </div>
      </li>`).join('')}</ul>`;
  }
  const intervalLabel = (m) => (m >= 60 ? `${m / 60} ชม.` : `${m} นาที`);

  function apiExample(base, key) {
    return `curl -X POST ${base}/tasks \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"ตรวจห้อง 1203","due":"today","time":"14:00","category":"งาน"}'`;
  }

  function viewConnect() {
    const srv = state.settings.server;
    const admin = srv && srv.role !== 'app';
    const r = ui.remote;
    const origin = DEMO ? 'https://เซิร์ฟเวอร์ของคุณ' : location.origin;
    const statusText = {
      connecting: 'กำลังเชื่อมต่อ…',
      online: 'เชื่อมต่อแล้ว ข้อมูลซิงก์อัตโนมัติ',
      offline: 'ออฟไลน์ งานที่แก้จะส่งขึ้นเมื่อกลับมาออนไลน์',
      unauthorized: 'คีย์ไม่ถูกต้องหรือถูกลบ เชื่อมต่อใหม่อีกครั้ง',
    };
    const status = srv
      ? `<section class="status-card ${Sync.status}">
          <span class="status-dot" aria-hidden="true"></span>
          <div class="status-main"><strong>${esc(hostOf(srv.url || location.origin))}</strong><span>${esc(statusText[Sync.status] || '')}</span>
          ${state.outbox.length ? `<span>รอส่ง ${state.outbox.length} รายการ</span>` : ''}</div>
          <div class="status-actions">
            <button type="button" class="btn small ghost" data-action="resync">${icon('refresh')} ซิงก์</button>
            <button type="button" class="btn small ghost" data-action="disconnect">ตัดการเชื่อมต่อ</button>
          </div>
        </section>`
      : `<section class="status-card local">
          <span class="status-icon">${icon('phone')}</span>
          <div class="status-main"><strong>ใช้งานในเครื่องนี้</strong><span>ข้อมูลเก็บในมือถือเครื่องนี้ เชื่อมต่อเซิร์ฟเวอร์ X10 เพื่อซิงก์หลายเครื่องและเปิด API ให้แอปอื่นส่งงานเข้ามา</span></div>
          <div class="status-actions"><button type="button" class="btn small primary" data-action="connect-server">${icon('cloud')} เชื่อมต่อเซิร์ฟเวอร์</button></div>
        </section>`;

    const connectors = srv ? (admin ? connectorRows(r.connectors, true) : '<p class="muted">ต้องใช้คีย์ผู้ดูแลเพื่อจัดการแหล่งข้อมูล</p>') : connectorRows(state.connectors, false);

    let inbound;
    if (srv && admin) {
      inbound = `
        <p class="field-label">ที่อยู่ API</p>${copyBox(Sync.base())}
        <ul class="rows">${r.keys.map((k) => `
          <li class="row-item">
            <span class="row-icon">${icon('key')}</span>
            <div class="row-main"><strong>${esc(k.name)} ${k.role === 'admin' ? '<span class="tag">ผู้ดูแล</span>' : ''}</strong>
              <span class="mono">${esc(k.prefix)}••••••</span>
              <span class="row-sub">ใช้ล่าสุด ${esc(ago(k.lastUsedAt))}</span></div>
            <div class="row-actions"><button type="button" class="icon-btn small" data-action="delete-key" data-id="${esc(k.id)}" data-name="${esc(k.name)}" aria-label="ลบคีย์ ${esc(k.name)}">${icon('trash')}</button></div>
          </li>`).join('')}</ul>
        <button type="button" class="btn ghost block" data-action="new-key">${icon('plus')} สร้างคีย์ให้แอปใหม่</button>
        <details class="howto"><summary>ตัวอย่างการส่งงานเข้ามา</summary>${copyBox(apiExample(Sync.base(), 'x10_คีย์ของแอป'), { pre: true })}
          <p class="muted">รับชื่อฟิลด์ได้หลายแบบ เช่น <code>title</code>/<code>text</code>/<code>name</code>, <code>due</code>/<code>dueDate</code>/<code>date</code> และวันที่แบบ <code>2026-11-05</code>, <code>05/11/2569</code>, <code>today</code></p></details>`;
    } else if (srv) {
      inbound = '<p class="muted">ต้องใช้คีย์ผู้ดูแลเพื่อสร้างคีย์ให้แอปอื่น</p>';
    } else {
      inbound = `<ol class="steps">
          <li>เปิดเซิร์ฟเวอร์ X10 บนคอมพิวเตอร์หรือคลาวด์ (<code>npm start</code>)</li>
          <li>กด “เชื่อมต่อเซิร์ฟเวอร์” แล้วใส่คีย์ผู้ดูแล</li>
          <li>สร้างคีย์ให้แต่ละแอป เช่น LINE Bot, Google Sheets, ระบบ PMS แล้วให้แอปนั้นส่ง <code>POST /api/v1/tasks</code></li>
        </ol>
        ${copyBox(apiExample(origin + '/api/v1', 'x10_คีย์ของแอป'), { pre: true })}`;
    }

    let outbound;
    if (srv && admin) {
      outbound = `${r.webhooks.length ? `<ul class="rows">${r.webhooks.map((w) => `
        <li class="row-item">
          <span class="row-icon ${w.lastError ? 'bad' : w.lastStatus ? 'ok' : ''}">${icon('send')}</span>
          <div class="row-main"><strong>${esc(w.name)}</strong><span class="mono">${esc(w.url)}</span>
            <span class="row-sub">${w.events.includes('*') ? 'ทุกเหตุการณ์' : w.events.map(eventLabel).join(', ')} · ${w.lastDeliveryAt ? (w.lastError ? `<em class="bad">${esc(w.lastError)}</em>` : `ส่งสำเร็จ ${esc(ago(w.lastDeliveryAt))}`) : 'ยังไม่เคยส่ง'}</span></div>
          <div class="row-actions">
            <button type="button" class="icon-btn small" data-action="test-webhook" data-id="${esc(w.id)}" aria-label="ทดสอบส่ง">${icon('send')}</button>
            <button type="button" class="icon-btn small" data-action="delete-webhook" data-id="${esc(w.id)}" data-name="${esc(w.name)}" aria-label="ลบ ${esc(w.name)}">${icon('trash')}</button>
          </div>
        </li>`).join('')}</ul>` : '<div class="empty small"><p>ยังไม่มีปลายทาง</p></div>'}
        <button type="button" class="btn ghost block" data-action="new-webhook">${icon('plus')} เพิ่มปลายทาง</button>`;
    } else {
      outbound = '<p class="muted">ใช้ได้เมื่อเชื่อมต่อเซิร์ฟเวอร์ ระบบจะส่งข้อมูลไปยังแอปอื่นทันทีที่มีงานใหม่ งานเสร็จ หรือมีการแก้ไข เช่น แจ้งเข้ากลุ่ม LINE หรือบันทึกลง Google Sheets</p>';
    }

    const quick = `${origin}/?add=ซื้อกาแฟ&due=today&time=15:00`;
    return `
      <header class="page-head"><p class="eyebrow">เชื่อมต่อ</p><h1>แอปอื่น ๆ และ API</h1>
        <p class="lede">ดึงงานจากระบบอื่นเข้ามาอัตโนมัติ และเปิดให้แอปอื่นส่งงานเข้ามาได้</p></header>
      ${status}
      ${r.error && srv ? `<p class="error-line">${esc(r.error)}</p>` : ''}
      <section class="panel">
        <div class="panel-head"><span class="panel-icon">${icon('inbox')}</span><div><h2>ดึงงานจาก API ของแอปอื่น</h2><p>นำเข้างานจากระบบห้องพัก ระบบแจ้งซ่อม Google Sheets หรือ API ใดก็ได้ที่ส่ง JSON</p></div></div>
        ${connectors}
        ${!srv || admin ? `<button type="button" class="btn ghost block" data-action="new-connector">${icon('plus')} เพิ่มแหล่งข้อมูล</button>` : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><span class="panel-icon">${icon('key')}</span><div><h2>ให้แอปอื่นส่งงานเข้ามา</h2><p>REST API พร้อมคีย์แยกของแต่ละแอป ยกเลิกได้ทุกเมื่อ</p></div></div>
        ${inbound}
      </section>
      <section class="panel">
        <div class="panel-head"><span class="panel-icon">${icon('send')}</span><div><h2>ส่งข่าวไปแอปอื่น (Webhook)</h2><p>แจ้งระบบอื่นทันทีเมื่องานเปลี่ยน</p></div></div>
        ${outbound}
      </section>
      <section class="panel">
        <div class="panel-head"><span class="panel-icon">${icon('link')}</span><div><h2>ลิงก์เพิ่มงานด่วน</h2><p>ใช้กับปุ่มลัด (Shortcuts) QR code หรือข้อความ LINE เปิดลิงก์แล้วฟอร์มเพิ่มงานจะขึ้นพร้อมข้อมูล</p></div></div>
        ${copyBox(quick)}
        <p class="muted">เมื่อติดตั้งแอปบน Android แล้ว จะเห็น X10 Tasks ในเมนู “แชร์” ของแอปอื่นด้วย</p>
      </section>`;
  }
  const EVENT_LABELS = { 'task.created': 'งานใหม่', 'task.updated': 'แก้ไขงาน', 'task.completed': 'งานเสร็จ', 'task.deleted': 'ลบงาน' };
  const eventLabel = (e) => EVENT_LABELS[e] || e;

  async function loadRemote() {
    if (!Sync.on || state.settings.server.role === 'app') return;
    try {
      const [k, w, c] = await Promise.all([Sync.api('GET', '/keys'), Sync.api('GET', '/webhooks'), Sync.api('GET', '/connectors')]);
      ui.remote = { keys: k.keys, webhooks: w.webhooks, connectors: c.connectors, loaded: true, error: null };
    } catch (e) {
      ui.remote.error = e.message;
    }
    if (ui.view === 'connect') render();
  }

  // ---------- options ----------
  function viewOptions() {
    const td = today();
    const open = state.tasks.filter((t) => !t.done);
    const overdue = open.filter((t) => t.due && t.due < td).length;
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(S.addDays(td, -i));
    const counts = Object.fromEntries(days.map((d) => [d, 0]));
    for (const t of state.tasks) {
      if (!t.done || !t.doneAt) continue;
      const d = S.todayIn(undefined, new Date(t.doneAt));
      if (d in counts) counts[d]++;
    }
    const week = days.reduce((a, d) => a + counts[d], 0);
    const max = Math.max(1, ...Object.values(counts));
    const strip = days.map((d) => `<li class="${d === td ? 'is-today' : ''}"><span class="w-count">${counts[d]}</span><span class="w-cell" style="--f:${counts[d] / max}"></span><span class="w-day">${esc(fmt({ weekday: 'narrow' }).format(toDate(d)))}</span></li>`).join('');
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const themes = [['system', 'ตามระบบ'], ['light', 'สว่าง'], ['dark', 'มืด']];
    return `
      <header class="page-head"><p class="eyebrow">ตั้งค่า</p><h1>ภาพรวมและการตั้งค่า</h1></header>
      <section class="panel">
        <div class="stats">
          <div><span class="stat-num">${open.length}</span><span class="stat-label">งานค้าง</span></div>
          <div><span class="stat-num${overdue ? ' late' : ''}">${overdue}</span><span class="stat-label">เลยกำหนด</span></div>
          <div><span class="stat-num">${week}</span><span class="stat-label">เสร็จใน 7 วัน</span></div>
        </div>
        <p class="field-label">งานที่เสร็จในแต่ละวัน</p>
        <ol class="week">${strip}</ol>
      </section>
      <section class="panel">
        <h2>หน้าตา</h2>
        <div class="segmented" role="radiogroup" aria-label="ธีม">${themes.map(([v, l]) => `<button type="button" role="radio" aria-checked="${state.settings.theme === v}" class="${state.settings.theme === v ? 'on' : ''}" data-action="theme" data-theme="${v}">${l}</button>`).join('')}</div>
      </section>
      <section class="panel">
        <h2>การแจ้งเตือน</h2>
        <p class="muted">${perm === 'granted' ? 'เปิดแล้ว แอปจะเตือนตามเวลาที่ตั้งไว้ในแต่ละงาน' : perm === 'denied' ? 'ถูกปิดไว้ในการตั้งค่าเบราว์เซอร์ เปิดได้ที่การตั้งค่าเว็บไซต์ของเบราว์เซอร์' : perm === 'unsupported' ? 'อุปกรณ์นี้ไม่รองรับการแจ้งเตือน แอปจะแสดงข้อความเตือนในหน้าจอแทน' : 'อนุญาตให้แอปแจ้งเตือนเมื่อถึงเวลาทำงาน'}</p>
        ${perm === 'default' ? `<button type="button" class="btn primary" data-action="enable-notify">${icon('bell')} เปิดการแจ้งเตือน</button>` : ''}
      </section>
      ${ui.installPrompt ? `<section class="panel"><h2>ติดตั้งลงมือถือ</h2><p class="muted">เปิดได้จากหน้าจอโฮมเหมือนแอปทั่วไป ใช้งานได้แม้ออฟไลน์</p><button type="button" class="btn primary" data-action="install">${icon('download')} ติดตั้งแอป</button></section>` : ''}
      <section class="panel">
        <h2>หมวดหมู่</h2>
        <ul class="rows">${state.categories.map((c) => `
          <li class="row-item">
            <span class="cat-dot" style="--cat:var(--c-${c.color})"></span>
            <div class="row-main"><strong>${esc(c.name)}</strong><span class="row-sub">${state.tasks.filter((t) => t.category === c.id && !t.done).length} งานค้าง</span></div>
            <div class="row-actions"><button type="button" class="icon-btn small" data-action="edit-category" data-id="${esc(c.id)}" aria-label="แก้ไข ${esc(c.name)}">${icon('edit')}</button></div>
          </li>`).join('')}</ul>
        <button type="button" class="btn ghost block" data-action="new-category">${icon('plus')} เพิ่มหมวดหมู่</button>
      </section>
      <section class="panel">
        <h2>ข้อมูล</h2>
        <div class="btn-stack">
          <button type="button" class="btn ghost" data-action="export">${icon('download')} ส่งออกข้อมูล (JSON)</button>
          <label class="btn ghost file-btn">${icon('upload')} นำเข้าจากไฟล์ JSON<input type="file" id="import-file" accept="application/json,.json"></label>
          ${state.tasks.some((t) => t.sample) ? `<button type="button" class="btn ghost" data-action="clear-samples">${icon('trash')} ลบงานตัวอย่าง</button>` : ''}
          ${Sync.on ? '' : `<button type="button" class="btn ghost danger-text" data-action="clear-all">${icon('trash')} ลบข้อมูลทั้งหมดในเครื่องนี้</button>`}
        </div>
      </section>
      <p class="about">X10 Tasks เวอร์ชัน ${S.VERSION}${DEMO ? ' · โหมดตัวอย่าง' : ''}<br>เวลาของเครื่อง: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone || '')}</p>`;
  }

  // ---------- editor ----------
  const REMINDERS = [['', 'ไม่แจ้งเตือน'], ['0', 'ตรงเวลา'], ['5', 'ก่อน 5 นาที'], ['15', 'ก่อน 15 นาที'], ['30', 'ก่อน 30 นาที'], ['60', 'ก่อน 1 ชั่วโมง'], ['1440', 'ก่อน 1 วัน']];
  const REPEAT_OPTS = [['', 'ไม่ทำซ้ำ'], ['daily', 'ทุกวัน'], ['weekdays', 'ทุกวันทำงาน (จ.–ศ.)'], ['weekly', 'ทุกสัปดาห์'], ['monthly', 'ทุกเดือน'], ['yearly', 'ทุกปี']];
  const PRIOS = [[0, 'ปกติ'], [1, 'สำคัญ'], [2, 'ด่วน']];

  function quickDue(kind) {
    const td = today();
    if (kind === 'today') return td;
    if (kind === 'tomorrow') return S.addDays(td, 1);
    if (kind === 'nextweek') {
      let d = S.addDays(td, 1);
      while (S.weekday(d) !== 1) d = S.addDays(d, 1);
      return d;
    }
    return '';
  }

  function openEditor(id, preset) {
    const existing = id ? findTask(id) : null;
    if (id && !existing) return;
    const t = existing || Object.assign({
      title: '', notes: '', due: today(), time: null, reminder: null, repeat: null, priority: 0, subtasks: [],
      category: ui.category !== 'all' ? ui.category : null,
    }, preset || {});
    const reminderVal = t.reminder === null || t.reminder === undefined ? '' : String(t.reminder);
    const remOpts = REMINDERS.some(([v]) => v === reminderVal) ? REMINDERS : REMINDERS.concat([[reminderVal, `ก่อน ${reminderVal} นาที`]]);
    const html = `
      ${sheetHead(existing ? 'แก้ไขงาน' : 'งานใหม่', existing && existing.sourceName ? `มาจาก ${existing.sourceName}${existing.externalId ? ' · อ้างอิง ' + existing.externalId : ''}` : '')}
      <form class="editor" id="editor" novalidate>
        <label class="sr-only" for="f-title">ชื่องาน</label>
        <textarea id="f-title" class="title-input" rows="2" maxlength="500" placeholder="ต้องทำอะไร?" ${existing ? '' : 'autofocus'}>${esc(t.title)}</textarea>
        <p class="field-error" id="f-title-err" hidden>ใส่ชื่องานก่อนบันทึก</p>

        <div class="field">
          <span class="field-label">${icon('calendar')} วันที่</span>
          <div class="quick">
            ${[['today', 'วันนี้'], ['tomorrow', 'พรุ่งนี้'], ['nextweek', 'จันทร์หน้า'], ['none', 'ไม่กำหนด']].map(([k, l]) => `<button type="button" class="qchip" data-due="${k}">${l}</button>`).join('')}
            <input type="date" id="f-due" value="${esc(t.due || '')}" aria-label="เลือกวันที่">
          </div>
        </div>

        <div class="field-grid">
          <label class="field"><span class="field-label">${icon('clock')} เวลา</span><input type="time" id="f-time" value="${esc(t.time || '')}"></label>
          <label class="field"><span class="field-label">${icon('bell')} แจ้งเตือน</span>
            <select id="f-reminder">${remOpts.map(([v, l]) => `<option value="${v}"${v === reminderVal ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">${icon('repeat')} ทำซ้ำ</span>
            <select id="f-repeat">${REPEAT_OPTS.map(([v, l]) => `<option value="${v}"${v === (t.repeat || '') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <div class="field"><span class="field-label">${icon('flag')} ความสำคัญ</span>
            <div class="segmented small" role="radiogroup" aria-label="ความสำคัญ">${PRIOS.map(([v, l]) => `<label class="seg p${v}"><input type="radio" name="prio" value="${v}"${(t.priority || 0) === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        </div>
        <p class="hint" id="f-hint" hidden>ไม่ได้ระบุเวลา จะเตือนตอน 09:00 ของวันนั้น</p>

        <div class="field">
          <span class="field-label">หมวดหมู่</span>
          <div class="cat-pick" role="radiogroup" aria-label="หมวดหมู่">
            <label class="cat-opt" style="--cat:var(--ink-3)"><input type="radio" name="cat" value=""${!t.category ? ' checked' : ''}><span>ไม่มี</span></label>
            ${state.categories.map((c) => `<label class="cat-opt" style="--cat:var(--c-${c.color})"><input type="radio" name="cat" value="${esc(c.id)}"${t.category === c.id ? ' checked' : ''}><span><i class="dot"></i>${esc(c.name)}</span></label>`).join('')}
          </div>
        </div>

        <div class="field">
          <span class="field-label">${icon('checklist')} งานย่อย</span>
          <ul class="subs" id="f-subs">${(t.subtasks || []).map(subRow).join('')}</ul>
          <div class="sub-add"><input type="text" id="f-sub-new" placeholder="เพิ่มงานย่อย แล้วกด Enter" maxlength="300" aria-label="งานย่อยใหม่"><button type="button" class="icon-btn small" data-sub-add aria-label="เพิ่มงานย่อย">${icon('plus')}</button></div>
        </div>

        <label class="field"><span class="field-label">${icon('note')} บันทึก</span>
          <textarea id="f-notes" rows="3" maxlength="5000" placeholder="รายละเอียด ลิงก์ หรือสิ่งที่ต้องเตรียม">${esc(t.notes || '')}</textarea></label>

        <footer class="sheet-foot">
          ${existing ? `<button type="button" class="btn ghost danger-text" data-action="delete-task" data-id="${esc(existing.id)}">${icon('trash')} ลบ</button>` : '<span></span>'}
          <button type="submit" class="btn primary">${existing ? 'บันทึก' : 'เพิ่มงาน'}</button>
        </footer>
      </form>`;
    openSheet(html, {
      label: existing ? 'แก้ไขงาน' : 'งานใหม่',
      onMount: (sheet) => bindEditor(sheet, existing),
    });
  }
  function subRow(s) {
    return `<li data-sid="${esc(s.id || S.uid('s_'))}"><input type="checkbox" ${s.done ? 'checked' : ''} aria-label="งานย่อยเสร็จ"><input type="text" value="${esc(s.title)}" maxlength="300" aria-label="ชื่องานย่อย"><button type="button" class="icon-btn small" data-sub-del aria-label="ลบงานย่อย">${icon('x')}</button></li>`;
  }
  function bindEditor(sheet, existing) {
    const form = $('#editor', sheet);
    const due = $('#f-due', sheet);
    const time = $('#f-time', sheet);
    const rem = $('#f-reminder', sheet);
    const syncChips = () => {
      $$('.qchip', sheet).forEach((b) => b.classList.toggle('on', (b.dataset.due === 'none' ? '' : quickDue(b.dataset.due)) === due.value));
      time.disabled = !due.value;
      $('#f-hint', sheet).hidden = !(due.value && !time.value && rem.value !== '');
    };
    syncChips();
    $$('.qchip', sheet).forEach((b) => b.addEventListener('click', () => {
      due.value = b.dataset.due === 'none' ? '' : quickDue(b.dataset.due);
      if (!due.value) time.value = '';
      syncChips();
    }));
    [due, time, rem].forEach((el) => el.addEventListener('change', syncChips));
    const subs = $('#f-subs', sheet);
    const newSub = $('#f-sub-new', sheet);
    const addSub = () => {
      const v = newSub.value.trim();
      if (!v) return;
      subs.insertAdjacentHTML('beforeend', subRow({ title: v, done: false }));
      newSub.value = '';
      newSub.focus();
    };
    newSub.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSub();
      }
    });
    $('[data-sub-add]', sheet).addEventListener('click', addSub);
    subs.addEventListener('click', (e) => {
      const del = e.target.closest('[data-sub-del]');
      if (del) del.closest('li').remove();
    });
    const title = $('#f-title', sheet);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = title.value.replace(/\s+/g, ' ').trim();
      if (!name) {
        $('#f-title-err', sheet).hidden = false;
        title.focus();
        return;
      }
      if (newSub.value.trim()) addSub();
      const fields = {
        title: name,
        notes: $('#f-notes', sheet).value.trim(),
        due: due.value || null,
        time: due.value && time.value ? time.value : null,
        reminder: rem.value === '' ? null : Number(rem.value),
        repeat: $('#f-repeat', sheet).value || null,
        priority: Number(($('input[name="prio"]:checked', sheet) || { value: 0 }).value),
        category: ($('input[name="cat"]:checked', sheet) || { value: '' }).value || null,
        subtasks: $$('li', subs).map((li) => ({ id: li.dataset.sid, title: $('input[type="text"]', li).value.trim(), done: $('input[type="checkbox"]', li).checked })).filter((s) => s.title),
      };
      if (fields.repeat && !fields.due) fields.due = today();
      closeSheet();
      if (existing) {
        updateTask(existing.id, fields);
        toast('บันทึกแล้ว');
      } else {
        addTask(fields);
        toast(fields.due && fields.due !== today() ? `เพิ่มงานแล้ว · ${dueLabel(fields.due)}` : 'เพิ่มงานแล้ว');
      }
    });
  }

  // ---------- category editor ----------
  function openCategory(id) {
    const c = id ? catOf(id) : null;
    const color = c ? c.color : S.COLORS[state.categories.length % S.COLORS.length];
    const html = `${sheetHead(c ? 'แก้ไขหมวดหมู่' : 'หมวดหมู่ใหม่')}
      <form class="editor" id="cat-form" novalidate>
        <label class="field"><span class="field-label">ชื่อหมวดหมู่</span><input type="text" id="c-name" maxlength="40" value="${esc(c ? c.name : '')}" placeholder="เช่น ฝ่ายแม่บ้าน, ช้อปปิ้ง" autofocus></label>
        <div class="field"><span class="field-label">สี</span><div class="swatches" role="radiogroup" aria-label="สี">
          ${S.COLORS.map((k) => `<label class="swatch" style="--cat:var(--c-${k})"><input type="radio" name="color" value="${k}"${k === color ? ' checked' : ''} aria-label="${k}"><span></span></label>`).join('')}</div></div>
        <footer class="sheet-foot">
          ${c ? `<button type="button" class="btn ghost danger-text" data-action="delete-category" data-id="${esc(c.id)}">${icon('trash')} ลบ</button>` : '<span></span>'}
          <button type="submit" class="btn primary">บันทึก</button>
        </footer>
      </form>`;
    openSheet(html, {
      label: 'หมวดหมู่',
      onMount: (sheet) => $('#cat-form', sheet).addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('#c-name', sheet).value.trim();
        const col = $('input[name="color"]:checked', sheet).value;
        if (!name) return $('#c-name', sheet).focus();
        try {
          if (Sync.on) {
            if (c) await Sync.api('PATCH', `/categories/${enc(c.id)}`, { name, color: col });
            else {
              const r = await Sync.api('POST', '/categories', { name, color: col });
              state.categories.push(r.category);
            }
            if (c) Object.assign(c, { name, color: col });
          } else if (c) Object.assign(c, { name, color: col });
          else state.categories.push({ id: S.uid('c_'), name, color: col });
          closeSheet();
          changed();
        } catch (err) {
          toast(err.message);
        }
      }),
    });
  }

  // ---------- connector editor ----------
  function openConnector(id) {
    const list = Sync.on ? ui.remote.connectors : state.connectors;
    const c = id ? list.find((x) => x.id === id) : null;
    const v = c || { name: '', url: '', method: 'GET', headers: {}, itemsPath: '', mapping: {}, category: 'work', interval: 0 };
    const headerLines = Object.entries(v.headers || {}).map(([k, val]) => `${k}: ${val}`).join('\n');
    const m = v.mapping || {};
    const mapField = (k, label, ph) => `<label class="map-row"><span>${label}</span><input type="text" id="m-${k}" value="${esc(m[k] || '')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></label>`;
    const html = `${sheetHead(c ? 'แก้ไขแหล่งข้อมูล' : 'ดึงงานจาก API', 'ใส่ที่อยู่ API ที่ตอบกลับเป็น JSON แล้วจับคู่ฟิลด์กับงาน')}
      <form class="editor" id="conn-form" novalidate>
        ${c ? '' : `<label class="field"><span class="field-label">เริ่มจากแม่แบบ</span><select id="k-preset"><option value="">— กรอกเอง —</option>${S.PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>`}
        <label class="field"><span class="field-label">ชื่อ</span><input type="text" id="k-name" maxlength="60" value="${esc(v.name)}" placeholder="เช่น ระบบแจ้งซ่อม"></label>
        <div class="field-grid url-grid">
          <label class="field"><span class="field-label">วิธี</span><select id="k-method"><option${v.method !== 'POST' ? ' selected' : ''}>GET</option><option${v.method === 'POST' ? ' selected' : ''}>POST</option></select></label>
          <label class="field"><span class="field-label">URL ของ API</span><input type="url" id="k-url" value="${esc(v.url)}" placeholder="https://api.example.com/tasks" inputmode="url" autocomplete="off" spellcheck="false"></label>
        </div>
        <label class="field"><span class="field-label">Header (บรรทัดละ 1 ค่า)</span><textarea id="k-headers" rows="2" class="mono" placeholder="Authorization: Bearer xxxxx" spellcheck="false">${esc(headerLines)}</textarea></label>
        <label class="field" id="k-body-wrap"${v.method === 'POST' ? '' : ' hidden'}><span class="field-label">Body (JSON)</span><textarea id="k-body" rows="2" class="mono" spellcheck="false">${esc(v.body || '')}</textarea></label>
        <label class="field"><span class="field-label">ตำแหน่งรายการใน JSON</span><input type="text" id="k-items" class="mono" value="${esc(v.itemsPath || '')}" placeholder="เว้นว่าง = หาอัตโนมัติ เช่น data.items" spellcheck="false"></label>
        <fieldset class="mapping">
          <legend>จับคู่ฟิลด์ <span class="muted">(เว้นว่าง = หาให้อัตโนมัติ ใช้ {{ชื่อฟิลด์}} เพื่อรวมข้อความได้)</span></legend>
          ${mapField('title', 'ชื่องาน', 'title หรือ {{type}} ห้อง {{room}}')}
          ${mapField('notes', 'รายละเอียด', 'description')}
          ${mapField('due', 'วันที่/เวลา', 'due_date')}
          ${mapField('time', 'เวลา', 'time')}
          ${mapField('priority', 'ความสำคัญ', 'priority')}
          ${mapField('done', 'สถานะเสร็จ', 'completed')}
          ${mapField('externalId', 'รหัสอ้างอิง', 'id (กันงานซ้ำ)')}
        </fieldset>
        <div class="field-grid">
          <label class="field"><span class="field-label">ใส่ในหมวดหมู่</span><select id="k-cat"><option value="">ไม่มี</option>${state.categories.map((x) => `<option value="${esc(x.id)}"${x.id === v.category ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">ซิงก์อัตโนมัติ</span><select id="k-interval">${[[0, 'ปิด (กดเอง)'], [15, 'ทุก 15 นาที'], [60, 'ทุก 1 ชั่วโมง'], [360, 'ทุก 6 ชั่วโมง'], [1440, 'วันละครั้ง']].map(([n, l]) => `<option value="${n}"${Number(v.interval || 0) === n ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        ${Sync.on ? '' : '<p class="hint">ตอนนี้ดึงข้อมูลจากมือถือโดยตรง บาง API ไม่อนุญาต (CORS) และซิงก์อัตโนมัติทำงานเฉพาะตอนเปิดแอป เชื่อมต่อเซิร์ฟเวอร์ X10 เพื่อให้ดึงได้ทุก API ตลอดเวลา</p>'}
        <div class="preview" id="k-preview" aria-live="polite"></div>
        <footer class="sheet-foot">
          ${c ? `<button type="button" class="btn ghost danger-text" data-action="delete-connector" data-id="${esc(c.id)}">${icon('trash')} ลบ</button>` : '<span></span>'}
          <div class="foot-right">
            <button type="button" class="btn ghost" id="k-test">ทดสอบ</button>
            <button type="submit" class="btn primary">${c ? 'บันทึก' : 'บันทึกและซิงก์'}</button>
          </div>
        </footer>
      </form>`;
    openSheet(html, { label: 'แหล่งข้อมูล', wide: true, onMount: (sheet) => bindConnector(sheet, c) });
  }
  function readConnector(sheet) {
    const headers = {};
    for (const line of $('#k-headers', sheet).value.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const mapping = {};
    for (const k of ['title', 'notes', 'due', 'time', 'priority', 'done', 'externalId']) {
      const val = $(`#m-${k}`, sheet).value.trim();
      if (val) mapping[k] = val;
    }
    return {
      name: $('#k-name', sheet).value.trim() || hostOf($('#k-url', sheet).value.trim()) || 'API',
      url: $('#k-url', sheet).value.trim(),
      method: $('#k-method', sheet).value,
      headers,
      body: $('#k-body', sheet).value.trim(),
      itemsPath: $('#k-items', sheet).value.trim(),
      mapping,
      category: $('#k-cat', sheet).value || null,
      interval: Number($('#k-interval', sheet).value),
    };
  }
  function validUrl(u) {
    return /^(https?:\/\/[^\s]+|demo:\/\/[\w-]+)$/i.test(u);
  }
  function bindConnector(sheet, existing) {
    const preview = $('#k-preview', sheet);
    const preset = $('#k-preset', sheet);
    if (preset) {
      preset.addEventListener('change', () => {
        const p = S.PRESETS.find((x) => x.id === preset.value);
        if (!p) return;
        const conf = p.config;
        $('#k-name', sheet).value = conf.name;
        $('#k-url', sheet).value = conf.url;
        $('#k-items', sheet).value = conf.itemsPath || '';
        for (const k of ['title', 'notes', 'due', 'time', 'priority', 'done', 'externalId']) $(`#m-${k}`, sheet).value = conf.mapping[k] || '';
        if (state.categories.some((c) => c.id === conf.category)) $('#k-cat', sheet).value = conf.category;
        preview.innerHTML = '';
      });
    }
    $('#k-method', sheet).addEventListener('change', (e) => ($('#k-body-wrap', sheet).hidden = e.target.value !== 'POST'));
    const test = async () => {
      const conf = readConnector(sheet);
      if (!validUrl(conf.url)) {
        preview.innerHTML = '<p class="error-line">ใส่ URL ที่ขึ้นต้นด้วย https:// หรือ http://</p>';
        return null;
      }
      preview.innerHTML = '<p class="muted">กำลังดึงข้อมูล…</p>';
      try {
        const r = await previewConnector(conf);
        preview.innerHTML = `
          <p class="preview-head">${icon('check')} พบ ${r.total} รายการ แปลงเป็นงานได้ ${r.items.length}${r.total > r.items.length + r.errors.length ? '+' : ''} รายการ</p>
          <ul class="preview-list">${r.items.slice(0, 6).map((f) => `<li><strong>${esc(f.title)}</strong><span>${f.due ? esc(dueLabel(f.due)) : 'ไม่มีกำหนด'}${f.time ? ' · ' + esc(f.time) : ''}${f.externalId ? ' · #' + esc(f.externalId) : ''}</span></li>`).join('')}</ul>
          ${r.errors.length ? `<p class="error-line">อ่านไม่ได้ ${r.errors.length} รายการ: ${esc(r.errors[0].message)}</p>` : ''}
          ${r.sample ? `<details class="howto"><summary>ข้อมูลดิบรายการแรก (ใช้ดูชื่อฟิลด์)</summary><pre>${esc(JSON.stringify(r.sample, null, 2).slice(0, 2000))}</pre></details>` : ''}`;
        return r;
      } catch (e) {
        preview.innerHTML = `<p class="error-line">${esc(e.message)}</p>`;
        return null;
      }
    };
    $('#k-test', sheet).addEventListener('click', test);
    $('#conn-form', sheet).addEventListener('submit', async (e) => {
      e.preventDefault();
      const conf = readConnector(sheet);
      if (!validUrl(conf.url)) {
        preview.innerHTML = '<p class="error-line">ใส่ URL ที่ขึ้นต้นด้วย https:// หรือ http://</p>';
        return;
      }
      try {
        if (Sync.on) {
          let saved;
          if (existing) saved = (await Sync.api('PATCH', `/connectors/${enc(existing.id)}`, conf)).connector;
          else saved = (await Sync.api('POST', '/connectors', conf)).connector;
          closeSheet();
          const r = await Sync.api('POST', `/connectors/${enc(saved.id)}/sync`);
          toast(`ซิงก์แล้ว: ใหม่ ${r.created} · อัปเดต ${r.updated}`);
          loadRemote();
        } else {
          let conn = existing;
          if (conn) Object.assign(conn, conf);
          else {
            conn = Object.assign({ id: S.uid('n_'), active: true, lastSyncAt: null, lastStatus: null, lastError: null, lastCount: 0 }, conf);
            state.connectors.push(conn);
          }
          closeSheet();
          save();
          const r = await syncLocalConnector(conn);
          toast(`ซิงก์แล้ว: ใหม่ ${r.created} · อัปเดต ${r.updated}`);
        }
      } catch (err) {
        toast(`ซิงก์ไม่สำเร็จ: ${err.message}`);
        if (Sync.on) loadRemote();
      }
    });
  }

  // ---------- server connection ----------
  function openConnectServer() {
    const localCount = state.tasks.filter((t) => !t.sample).length;
    const html = `${sheetHead('เชื่อมต่อเซิร์ฟเวอร์ X10', 'ซิงก์หลายเครื่อง และเปิด API ให้แอปอื่น')}
      <form class="editor" id="srv-form" novalidate>
        <label class="field"><span class="field-label">ที่อยู่เซิร์ฟเวอร์</span><input type="url" id="s-url" inputmode="url" value="${esc(DEMO ? '' : location.origin)}" placeholder="https://tasks.example.com" autocomplete="url" spellcheck="false"></label>
        <label class="field"><span class="field-label">คีย์ผู้ดูแล</span><input type="password" id="s-key" placeholder="x10_…" autocomplete="off" spellcheck="false" autofocus></label>
        <p class="hint">คีย์จะแสดงในหน้าต่างเซิร์ฟเวอร์ตอนเปิดครั้งแรก ถ้าลืม ให้รัน <code>node server/index.js --new-admin-key</code></p>
        ${DEMO ? '<p class="hint">หน้านี้เป็นตัวอย่างบนเว็บ จึงเชื่อมต่อเซิร์ฟเวอร์ภายนอกไม่ได้ ให้ใช้แอปที่เปิดจากเซิร์ฟเวอร์ X10 ของคุณ</p>' : ''}
        ${localCount ? `<label class="check-line"><input type="checkbox" id="s-migrate" checked> ย้ายงานในเครื่องนี้ ${localCount} งานขึ้นเซิร์ฟเวอร์</label>` : ''}
        <p class="error-line" id="s-err" hidden></p>
        <footer class="sheet-foot"><span></span><button type="submit" class="btn primary">เชื่อมต่อ</button></footer>
      </form>`;
    openSheet(html, {
      label: 'เชื่อมต่อเซิร์ฟเวอร์',
      onMount: (sheet) => $('#srv-form', sheet).addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#s-err', sheet);
        const btn = $('button[type="submit"]', sheet);
        const server = { url: $('#s-url', sheet).value.trim().replace(/\/+$/, ''), key: $('#s-key', sheet).value.trim(), role: 'admin' };
        err.hidden = true;
        if (!/^https?:\/\//.test(server.url) || !server.key) {
          err.textContent = 'ใส่ที่อยู่เซิร์ฟเวอร์ (ขึ้นต้นด้วย http:// หรือ https://) และคีย์';
          err.hidden = false;
          return;
        }
        btn.disabled = true;
        btn.textContent = 'กำลังเชื่อมต่อ…';
        try {
          await Sync.api('GET', '/tasks?status=open&from=9999-01-01', undefined, server);
          try {
            await Sync.api('GET', '/keys', undefined, server);
          } catch (x) {
            if (x.status === 403) server.role = 'app';
            else throw x;
          }
          const migrate = $('#s-migrate', sheet);
          if (migrate && migrate.checked) {
            const mine = state.tasks.filter((t) => !t.sample).map(payload);
            for (let i = 0; i < mine.length; i += 400) await Sync.api('POST', '/tasks', mine.slice(i, i + 400), server);
          }
          state.settings.server = server;
          state.outbox = [];
          ui.serverHint = false;
          ui.remote = { keys: [], webhooks: [], connectors: [], loaded: false, error: null };
          save();
          closeSheet();
          await Sync.start();
          loadRemote();
          toast('เชื่อมต่อเซิร์ฟเวอร์แล้ว');
        } catch (x) {
          err.textContent = x.status === 401 ? 'คีย์ไม่ถูกต้อง' : x.message;
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = 'เชื่อมต่อ';
        }
      }),
    });
  }

  function openSecret({ title, intro, secret, extra = '' }) {
    openSheet(`${sheetHead(title)}
      <div class="editor">
        <p>${esc(intro)}</p>
        ${copyBox(secret)}
        <p class="hint">${icon('key')} คีย์นี้แสดงครั้งเดียว เก็บไว้ในที่ปลอดภัย ถ้าหายให้ลบแล้วสร้างใหม่</p>
        ${extra}
        <footer class="sheet-foot"><span></span><button type="button" class="btn primary" data-action="close-sheet">เก็บคีย์แล้ว</button></footer>
      </div>`, { label: title });
  }

  // ---------- views & navigation ----------
  const VIEWS = { tasks: viewTasks, calendar: viewCalendar, connect: viewConnect, options: viewOptions };
  const TABS = [['tasks', 'tasks', 'งาน'], ['calendar', 'calendar', 'ปฏิทิน'], ['connect', 'plug', 'เชื่อมต่อ'], ['options', 'sliders', 'ตั้งค่า']];

  function render() {
    applyTheme();
    const view = $('#view');
    view.innerHTML = VIEWS[ui.view]();
    view.dataset.view = ui.view;
    if (ui.view === 'tasks') renderTaskList();
    $('#tabbar').innerHTML = TABS.map(([v, ic, label]) => `<button type="button" class="tab${ui.view === v ? ' on' : ''}" data-action="go" data-view="${v}" ${ui.view === v ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></button>`).join('');
    $('#fab').hidden = !(ui.view === 'tasks' || ui.view === 'calendar');
    const search = $('#search-input');
    if (search) {
      search.addEventListener('input', () => {
        ui.search = search.value;
        renderTaskList();
      });
    }
  }

  function go(view, { push = true } = {}) {
    if (!VIEWS[view]) view = 'tasks';
    const changedView = ui.view !== view;
    ui.view = view;
    if (push && location.hash !== '#' + view) {
      try {
        history.pushState(null, '', '#' + view);
      } catch (e) {
        /* sandboxed */
      }
    }
    render();
    if (changedView) window.scrollTo(0, 0);
    if (view === 'connect') loadRemote();
  }

  // ---------- actions ----------
  const ACTIONS = {
    go: (el) => go(el.dataset.view),
    'close-sheet': () => closeSheet(),
    copy: (el) => copyText(el.dataset.text, el),
    open: (el) => openEditor(el.dataset.id),
    toggle: (el) => {
      const id = el.dataset.id;
      const t = findTask(id);
      if (!t) return;
      const row = el.closest('.task');
      if (row) row.classList.add(t.done ? 'unchecking' : 'checking');
      setTimeout(() => {
        const r = setTaskDone(id, !t.done);
        if (r && r.task.done) {
          toast(r.spawn ? `เสร็จแล้ว · ครั้งถัดไป ${dueLabel(r.spawn.due)}` : 'เสร็จแล้ว', { action: 'เลิกทำ', onAction: () => setTaskDone(id, false) });
        }
      }, 260);
    },
    'toggle-done': () => {
      state.settings.showDone = !state.settings.showDone;
      save();
      renderTaskList();
    },
    cat: (el) => {
      ui.category = el.dataset.cat;
      render();
    },
    search: () => {
      ui.searchOpen = !ui.searchOpen;
      if (!ui.searchOpen) ui.search = '';
      render();
      if (ui.searchOpen) $('#search-input').focus();
    },
    'new-task': () => openEditor(null, ui.view === 'calendar' ? { due: ui.calDay } : null),
    'new-on-day': (el) => openEditor(null, { due: el.dataset.day }),
    'delete-task': async (el) => {
      const t = findTask(el.dataset.id);
      if (!t) return;
      closeSheet();
      deleteTask(t.id);
      toast('ลบงานแล้ว', { action: 'เลิกทำ', onAction: () => restoreTask(t) });
    },
    'clear-samples': async () => {
      if (!(await confirmDialog({ title: 'ลบงานตัวอย่างทั้งหมด?', message: 'งานที่คุณเพิ่มเองจะยังอยู่', confirm: 'ลบตัวอย่าง', danger: true }))) return;
      for (const t of state.tasks.filter((x) => x.sample)) deleteTask(t.id);
      toast('ลบงานตัวอย่างแล้ว');
    },
    'clear-all': async () => {
      if (!(await confirmDialog({ title: 'ลบข้อมูลทั้งหมด?', message: 'งาน หมวดหมู่ และแหล่งข้อมูลในเครื่องนี้จะหายไปและกู้คืนไม่ได้', confirm: 'ลบทั้งหมด', danger: true }))) return;
      const theme = state.settings.theme;
      state = defaultState();
      state.settings.seeded = true;
      state.settings.theme = theme;
      changed();
      toast('ลบข้อมูลแล้ว');
    },
    'cal-day': (el) => {
      ui.calDay = el.dataset.day;
      render();
    },
    'cal-move': (el) => {
      const [y, m] = ui.calMonth.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(el.dataset.step), 1);
      ui.calMonth = `${d.getFullYear()}-${S.pad(d.getMonth() + 1)}`;
      render();
    },
    'cal-today': () => {
      ui.calMonth = today().slice(0, 7);
      ui.calDay = today();
      render();
    },
    'new-category': () => openCategory(null),
    'edit-category': (el) => openCategory(el.dataset.id),
    'delete-category': async (el) => {
      const c = catOf(el.dataset.id);
      if (!c) return;
      if (!(await confirmDialog({ title: `ลบหมวดหมู่ “${c.name}”?`, message: 'งานในหมวดนี้จะยังอยู่ แต่จะไม่มีหมวดหมู่', confirm: 'ลบ', danger: true }))) return;
      try {
        if (Sync.on) await Sync.api('DELETE', `/categories/${enc(c.id)}`);
        state.categories = state.categories.filter((x) => x.id !== c.id);
        if (!Sync.on) state.tasks.forEach((t) => t.category === c.id && (t.category = null));
        if (ui.category === c.id) ui.category = 'all';
        closeSheet();
        changed();
      } catch (e) {
        toast(e.message);
      }
    },
    theme: (el) => {
      state.settings.theme = el.dataset.theme;
      save();
      render();
    },
    'enable-notify': async () => {
      try {
        await Notification.requestPermission();
      } catch (e) {
        /* blocked */
      }
      render();
    },
    install: async () => {
      if (!ui.installPrompt) return;
      ui.installPrompt.prompt();
      await ui.installPrompt.userChoice.catch(() => null);
      ui.installPrompt = null;
      render();
    },
    export: () => {
      const data = JSON.stringify({ app: 'X10 Tasks', version: S.VERSION, exportedAt: nowISO(), tasks: state.tasks, categories: state.categories, connectors: state.connectors.map(({ headers, ...c }) => c) }, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      openSheet(`${sheetHead('ส่งออกข้อมูล', `${state.tasks.length} งาน`)}
        <div class="editor">
          ${DEMO ? '<p class="hint">หน้าตัวอย่างนี้ดาวน์โหลดไฟล์ไม่ได้ คัดลอกข้อความด้านล่างไปเก็บไว้แทน</p>' : `<a class="btn primary" href="${url}" download="x10-tasks-${today()}.json">${icon('download')} ดาวน์โหลดไฟล์</a>
          <p class="hint">ถ้าดาวน์โหลดไม่ได้ คัดลอกข้อความด้านล่างไปเก็บไว้แทน</p>`}
          ${copyBox(data, { pre: true })}
        </div>`, { label: 'ส่งออกข้อมูล' });
    },
    resync: () => Sync.start().then(loadRemote),
    disconnect: async () => {
      const pending = state.outbox.length;
      if (!(await confirmDialog({ title: 'ตัดการเชื่อมต่อเซิร์ฟเวอร์?', message: pending ? `ยังมี ${pending} รายการที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ ซึ่งจะไม่ถูกส่ง งานทั้งหมดจะยังอยู่ในเครื่องนี้` : 'งานทั้งหมดจะยังอยู่ในเครื่องนี้ และใช้งานแบบออฟไลน์ต่อได้', confirm: 'ตัดการเชื่อมต่อ', danger: true }))) return;
      state.settings.server = null;
      state.outbox = [];
      Sync.stop();
      changed();
    },
    'connect-server': () => openConnectServer(),
    'new-connector': () => openConnector(null),
    'edit-connector': (el) => openConnector(el.dataset.id),
    'sync-connector': async (el) => {
      el.classList.add('spin');
      try {
        if (el.dataset.remote === '1') {
          const r = await Sync.api('POST', `/connectors/${enc(el.dataset.id)}/sync`);
          toast(`ซิงก์แล้ว: ใหม่ ${r.created} · อัปเดต ${r.updated}`);
          loadRemote();
        } else {
          const c = state.connectors.find((x) => x.id === el.dataset.id);
          const r = await syncLocalConnector(c);
          toast(`ซิงก์แล้ว: ใหม่ ${r.created} · อัปเดต ${r.updated}`);
        }
      } catch (e) {
        toast(`ซิงก์ไม่สำเร็จ: ${e.message}`);
        if (el.dataset.remote === '1') loadRemote();
      }
    },
    'delete-connector': async (el) => {
      if (!(await confirmDialog({ title: 'ลบแหล่งข้อมูลนี้?', message: 'งานที่ดึงเข้ามาแล้วจะยังอยู่', confirm: 'ลบ', danger: true }))) return;
      try {
        if (Sync.on) {
          await Sync.api('DELETE', `/connectors/${enc(el.dataset.id)}`);
          loadRemote();
        } else {
          state.connectors = state.connectors.filter((x) => x.id !== el.dataset.id);
          save();
          render();
        }
        closeSheet();
      } catch (e) {
        toast(e.message);
      }
    },
    'new-key': () => {
      openSheet(`${sheetHead('สร้างคีย์ให้แอปใหม่', 'แต่ละแอปควรมีคีย์ของตัวเอง เพื่อยกเลิกแยกกันได้')}
        <form class="editor" id="key-form" novalidate>
          <label class="field"><span class="field-label">ชื่อแอป</span><input type="text" id="key-name" maxlength="60" placeholder="เช่น LINE Bot, Google Sheets, ระบบ PMS" autofocus></label>
          <footer class="sheet-foot"><span></span><button type="submit" class="btn primary">สร้างคีย์</button></footer>
        </form>`, {
        label: 'สร้างคีย์',
        onMount: (sheet) => $('#key-form', sheet).addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = $('#key-name', sheet).value.trim() || 'แอปใหม่';
          try {
            const r = await Sync.api('POST', '/keys', { name });
            loadRemote();
            openSecret({ title: `คีย์สำหรับ ${r.key.name}`, intro: 'ให้แอปนั้นส่งคีย์นี้ใน header “Authorization: Bearer …” ทุกครั้ง', secret: r.secret, extra: copyBox(apiExample(Sync.base(), r.secret), { pre: true }) });
          } catch (x) {
            toast(x.message);
          }
        }),
      });
    },
    'delete-key': async (el) => {
      if (!(await confirmDialog({ title: `ยกเลิกคีย์ “${el.dataset.name}”?`, message: 'แอปที่ใช้คีย์นี้จะส่งงานเข้ามาไม่ได้อีก', confirm: 'ยกเลิกคีย์', danger: true }))) return;
      try {
        await Sync.api('DELETE', `/keys/${enc(el.dataset.id)}`);
        loadRemote();
      } catch (e) {
        toast(e.status === 409 ? 'ต้องมีคีย์ผู้ดูแลอย่างน้อย 1 คีย์' : e.message);
      }
    },
    'new-webhook': () => {
      openSheet(`${sheetHead('ส่งข่าวไปแอปอื่น', 'ระบบจะ POST ข้อมูลงานเป็น JSON ไปยัง URL นี้')}
        <form class="editor" id="wh-form" novalidate>
          <label class="field"><span class="field-label">ชื่อ</span><input type="text" id="wh-name" maxlength="60" placeholder="เช่น แจ้งกลุ่ม LINE ทีมช่าง"></label>
          <label class="field"><span class="field-label">URL ปลายทาง</span><input type="url" id="wh-url" inputmode="url" placeholder="https://hooks.example.com/x10" autofocus spellcheck="false"></label>
          <fieldset class="field"><legend class="field-label">ส่งเมื่อ</legend>
            ${S.EVENTS.map((e) => `<label class="check-line"><input type="checkbox" name="ev" value="${e}" checked> ${eventLabel(e)} <code>${e}</code></label>`).join('')}
          </fieldset>
          <p class="error-line" id="wh-err" hidden></p>
          <footer class="sheet-foot"><span></span><button type="submit" class="btn primary">เพิ่ม</button></footer>
        </form>`, {
        label: 'เพิ่ม webhook',
        onMount: (sheet) => $('#wh-form', sheet).addEventListener('submit', async (e) => {
          e.preventDefault();
          const events = $$('input[name="ev"]:checked', sheet).map((x) => x.value);
          const err = $('#wh-err', sheet);
          try {
            const r = await Sync.api('POST', '/webhooks', { name: $('#wh-name', sheet).value.trim(), url: $('#wh-url', sheet).value.trim(), events: events.length === S.EVENTS.length ? ['*'] : events });
            loadRemote();
            openSecret({ title: 'รหัสลับสำหรับตรวจลายเซ็น', intro: 'ทุกคำขอจะมี header X-X10-Signature = HMAC-SHA256 ของ body ด้วยรหัสนี้ ใช้ตรวจว่ามาจาก X10 จริง', secret: r.webhook.secret });
          } catch (x) {
            err.textContent = x.message;
            err.hidden = false;
          }
        }),
      });
    },
    'test-webhook': async (el) => {
      try {
        const r = await Sync.api('POST', `/webhooks/${enc(el.dataset.id)}/test`);
        toast(r.delivered ? `ส่งทดสอบสำเร็จ (HTTP ${r.status})` : `ส่งไม่สำเร็จ: ${r.error}`);
        loadRemote();
      } catch (e) {
        toast(e.message);
      }
    },
    'delete-webhook': async (el) => {
      if (!(await confirmDialog({ title: `ลบ “${el.dataset.name}”?`, confirm: 'ลบ', danger: true }))) return;
      try {
        await Sync.api('DELETE', `/webhooks/${enc(el.dataset.id)}`);
        loadRemote();
      } catch (e) {
        toast(e.message);
      }
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) {
      if (el.tagName === 'A') e.preventDefault();
      fn(el, e);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#dialog-root').hidden) return;
    closeSheet();
  });
  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'import-file' || !e.target.files[0]) return;
    try {
      const data = JSON.parse(await e.target.files[0].text());
      const tasks = Array.isArray(data) ? data : data.tasks;
      if (!Array.isArray(tasks)) throw new Error('ไม่พบรายการงานในไฟล์');
      if (!Sync.on && Array.isArray(data.categories)) {
        for (const c of data.categories) if (c && c.id && c.name && !catOf(c.id)) state.categories.push({ id: String(c.id), name: String(c.name), color: S.COLORS.includes(c.color) ? c.color : 'slate' });
      }
      let n = 0;
      for (const raw of tasks) {
        try {
          const fields = S.normalizeFields(raw, ctx());
          if (raw.id && findTask(raw.id)) continue;
          addTask(fields, raw.id ? { id: String(raw.id) } : undefined);
          n++;
        } catch (x) {
          /* skip invalid rows */
        }
      }
      toast(`นำเข้าแล้ว ${n} งาน`);
    } catch (x) {
      toast(`นำเข้าไม่สำเร็จ: ${x.message}`);
    }
    e.target.value = '';
  });
  window.addEventListener('popstate', () => go((location.hash || '#tasks').slice(1), { push: false }));
  window.addEventListener('hashchange', () => go((location.hash || '#tasks').slice(1), { push: false }));
  window.addEventListener('online', () => Sync.on && Sync.start());
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ui.installPrompt = e;
    if (ui.view === 'options') render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      Reminders.check();
      if (ui.view === 'tasks' && $('#sheet-root').hidden) render();
    }
  });

  // Quick add from a link (?add=…) or from Android's share menu (?title=…&text=…&url=…)
  function handleIncoming() {
    let params;
    try {
      params = new URLSearchParams(location.search);
    } catch (e) {
      return;
    }
    const title = params.get('add') || params.get('title') || params.get('text');
    if (!title && !params.has('new')) return;
    const notes = [params.get('notes'), params.get('title') && params.get('text') ? params.get('text') : null, params.get('url')].filter(Boolean).join('\n');
    const preset = { title: (title || '').slice(0, 500), notes };
    try {
      const f = S.normalizeFields({ due: params.get('due') || undefined, time: params.get('time') || undefined }, ctx());
      if (f.due !== undefined) preset.due = f.due;
      if (f.time !== undefined) preset.time = f.time;
    } catch (e) {
      /* ignore bad date in link */
    }
    const cat = params.get('category');
    if (cat) {
      const c = state.categories.find((x) => x.id === cat || x.name === cat);
      if (c) preset.category = c.id;
    }
    try {
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (e) {
      /* sandboxed */
    }
    openEditor(null, preset);
  }

  async function detectServer() {
    if (DEMO || Sync.on || !/^https?:$/.test(location.protocol)) return;
    try {
      const res = await fetch('api/v1/health', { cache: 'no-store' });
      const data = res.ok ? await res.json() : null;
      if (data && data.name === 'X10 Tasks') {
        ui.serverHint = true;
        if (ui.view === 'tasks') renderTaskList();
      }
    } catch (e) {
      /* no server — offline mode */
    }
  }

  // ---------- boot ----------
  $('#fab').addEventListener('click', () => ACTIONS['new-task']());
  seed();
  ui.view = VIEWS[(location.hash || '').slice(1)] ? location.hash.slice(1) : 'tasks';
  render();
  Reminders.start();
  Sync.start().then(() => ui.view === 'connect' && loadRemote());
  detectServer();
  handleIncoming();
  if (!DEMO && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open-task') openEditor(e.data.id);
    });
  }
  // Keep the clock, timeline and "today" fresh without disturbing someone who is typing.
  const idle = () => $('#sheet-root').hidden && !(document.activeElement && document.activeElement.id === 'search-input');
  setInterval(() => {
    if (ui.view === 'tasks' && idle()) render();
  }, 60000);
})();
