/*
 * X10 Tasks — shared logic used by both the phone app (browser) and the server (Node).
 * Loaded as a plain <script> in the browser (window.X10Shared) and via require() in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.X10Shared = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.1.0';
  const STATUSES = ['todo', 'doing', 'done'];
  const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
  const COLORS = ['blue', 'green', 'amber', 'rose', 'violet', 'slate'];
  const EVENTS = ['task.created', 'task.updated', 'task.completed', 'task.deleted'];
  // Category colours as hex for places that cannot use CSS variables (Android widgets).
  const COLOR_HEX = { blue: '#4a7be0', green: '#34a06b', amber: '#d99a26', rose: '#d65a86', violet: '#8565d4', slate: '#6f8592' };
  const DEFAULT_CATEGORIES = [
    { id: 'work', name: 'งาน', color: 'blue' },
    { id: 'personal', name: 'ส่วนตัว', color: 'green' },
    { id: 'wishlist', name: 'อยากได้', color: 'amber' },
    { id: 'birthday', name: 'วันเกิด', color: 'rose' },
  ];

  // Field names other apps commonly use, mapped to ours. The canonical name is always first.
  const ALIASES = {
    title: ['title', 'text', 'name', 'content', 'summary', 'subject', 'task', 'message'],
    notes: ['notes', 'note', 'description', 'details', 'body', 'desc'],
    when: ['due', 'dueDate', 'due_date', 'date', 'deadline', 'dueAt', 'due_at', 'start', 'startAt', 'datetime'],
    time: ['time', 'dueTime', 'due_time'],
    category: ['category', 'categoryId', 'category_id', 'list', 'project'],
    reminder: ['reminder', 'remind', 'reminderMinutes', 'remind_before'],
    repeat: ['repeat', 'recurrence', 'recurring'],
    priority: ['priority', 'importance', 'flag'],
    subtasks: ['subtasks', 'checklist', 'steps'],
    done: ['done', 'completed', 'complete', 'isDone', 'is_done'],
    status: ['status', 'state'],
    externalId: ['externalId', 'external_id', 'ref', 'reference'],
    sourceName: ['sourceName', 'source_name', 'app', 'from'],
  };

  class ValidationError extends Error {
    constructor(message, field) {
      super(message);
      this.name = 'ValidationError';
      this.field = field;
    }
  }

  // ---------- ids ----------
  function randomHex(bytes) {
    const buf = new Uint8Array(bytes);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
    else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function uid(prefix) {
    return (prefix || 't_') + randomHex(8);
  }

  // ---------- dates (all due dates are local calendar dates: YYYY-MM-DD) ----------
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_RE = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;
  const LOCAL_DT_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function partsInZone(date, timeZone) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const p = {};
    for (const x of f.formatToParts(date)) p[x.type] = x.value;
    return { due: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
  }
  function todayIn(timeZone, now) {
    return partsInZone(now || new Date(), timeZone).due;
  }
  function ymdToUTC(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function isValidDate(ymd) {
    if (!DATE_RE.test(ymd)) return false;
    return ymdToUTC(ymd).toISOString().slice(0, 10) === ymd;
  }
  function addDays(ymd, n) {
    const d = ymdToUTC(ymd);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function addMonths(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(d, last));
    return first.toISOString().slice(0, 10);
  }
  function weekday(ymd) {
    return ymdToUTC(ymd).getUTCDay();
  }

  // Parses the many ways other apps send a due date. Returns {due, time?} or {due:null,time:null}.
  function parseWhen(value, ctx) {
    if (value === null || value === '' || value === false) return { due: null, time: null };
    if (typeof value === 'number' && isFinite(value)) {
      return partsInZone(new Date(value < 1e12 ? value * 1000 : value), ctx.timeZone);
    }
    const s = String(value).trim();
    const lower = s.toLowerCase();
    if (lower === 'today' || s === 'วันนี้') return { due: ctx.today };
    if (lower === 'tomorrow' || s === 'พรุ่งนี้') return { due: addDays(ctx.today, 1) };
    if (DATE_RE.test(s)) {
      if (!isValidDate(s)) throw new ValidationError(`Invalid date "${s}"`, 'due');
      return { due: s };
    }
    const local = s.match(LOCAL_DT_RE);
    if (local) {
      if (!isValidDate(local[1])) throw new ValidationError(`Invalid date "${s}"`, 'due');
      return { due: local[1], time: `${pad(local[2])}:${local[3]}` };
    }
    // dd/mm/yyyy, including Buddhist-era years (e.g. 01/11/2569)
    const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      let y = Number(dmy[3]);
      if (y > 2400) y -= 543;
      const ymd = `${y}-${pad(dmy[2])}-${pad(dmy[1])}`;
      if (!isValidDate(ymd)) throw new ValidationError(`Invalid date "${s}"`, 'due');
      return { due: ymd };
    }
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const parts = partsInZone(new Date(t), ctx.timeZone);
      return /\d{1,2}:\d{2}/.test(s) ? parts : { due: parts.due };
    }
    throw new ValidationError(`Could not understand date "${s}"`, 'due');
  }

  function parseTime(value) {
    if (value === null || value === '' || value === false) return null;
    const m = String(value).trim().match(TIME_RE);
    if (!m) throw new ValidationError(`Invalid time "${value}", use HH:MM`, 'time');
    return `${pad(m[1])}:${m[2]}`;
  }

  function parseReminder(value) {
    if (value === null || value === undefined || value === false || value === '' || value === 'none') return null;
    if (value === true) return 0;
    if (typeof value === 'number' && isFinite(value) && value >= 0) return Math.min(Math.round(value), 60 * 24 * 7);
    const m = String(value).trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|minutes|h|hr|hour|hours|d|day|days)?$/);
    if (!m) throw new ValidationError(`Invalid reminder "${value}", use minutes before due (e.g. 15)`, 'reminder');
    const n = Number(m[1]);
    const unit = (m[2] || 'm')[0];
    return Math.min(unit === 'd' ? n * 1440 : unit === 'h' ? n * 60 : n, 60 * 24 * 7);
  }

  function parseRepeat(value) {
    if (value === null || value === undefined || value === false || value === '' || value === 'none') return null;
    const s = String(value).trim().toLowerCase();
    const map = {
      day: 'daily', daily: 'daily', 'ทุกวัน': 'daily',
      weekday: 'weekdays', weekdays: 'weekdays', 'ทุกวันทำงาน': 'weekdays',
      week: 'weekly', weekly: 'weekly', 'ทุกสัปดาห์': 'weekly',
      month: 'monthly', monthly: 'monthly', 'ทุกเดือน': 'monthly',
      year: 'yearly', yearly: 'yearly', annually: 'yearly', 'ทุกปี': 'yearly',
    };
    if (map[s]) return map[s];
    throw new ValidationError(`Invalid repeat "${value}", use one of ${REPEATS.join(', ')}`, 'repeat');
  }

  function parsePriority(value) {
    if (value === null || value === undefined || value === false || value === '') return 0;
    if (value === true) return 1;
    if (typeof value === 'number' && isFinite(value)) return Math.max(0, Math.min(2, Math.round(value)));
    const s = String(value).trim().toLowerCase();
    if (/^\d+$/.test(s)) return Math.max(0, Math.min(2, Number(s)));
    if (['urgent', 'critical', 'highest', 'ด่วน', 'ด่วนมาก', '!!'].includes(s)) return 2;
    if (['high', 'important', 'medium', 'สำคัญ', '!'].includes(s)) return 1;
    return 0;
  }

  function parseDone(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value).trim().toLowerCase();
    return ['true', 'yes', '1', 'done', 'completed', 'complete', 'closed', 'resolved', 'finished', 'เสร็จ', 'เสร็จแล้ว'].includes(s);
  }

  // todo = waiting, doing = in progress, done = finished. Other apps' words are mapped onto these.
  function parseStatus(value) {
    if (value === true) return 'done';
    if (value === null || value === undefined || value === false || value === '') return 'todo';
    const s = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['doing', 'in_progress', 'inprogress', 'progress', 'started', 'working', 'active', 'ongoing', 'wip', 'กำลังทำ', 'ดำเนินการ', 'กำลังดำเนินการ'].includes(s)) return 'doing';
    if (parseDone(s.replace(/_/g, ' '))) return 'done';
    return 'todo';
  }
  function statusOf(t) {
    return t.done ? 'done' : t.status === 'doing' ? 'doing' : 'todo';
  }

  function parseSubtasks(value) {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) throw new ValidationError('subtasks must be an array', 'subtasks');
    return value.slice(0, 50).map((s) => {
      if (typeof s === 'string' || typeof s === 'number') return { id: uid('s_'), title: String(s).slice(0, 300), done: false };
      if (s && typeof s === 'object') {
        const title = String(s.title ?? s.text ?? s.name ?? '').trim().slice(0, 300);
        return { id: typeof s.id === 'string' && s.id ? s.id.slice(0, 64) : uid('s_'), title, done: s.done !== undefined ? parseDone(s.done) : s.completed !== undefined ? parseDone(s.completed) : false };
      }
      throw new ValidationError('Invalid subtask', 'subtasks');
    }).filter((s) => s.title);
  }

  function resolveCategory(value, categories) {
    if (value === null || value === undefined || value === '') return { id: null };
    const s = String(value).trim();
    const lower = s.toLowerCase();
    const found = (categories || []).find((c) => c.id === s || c.name.toLowerCase() === lower);
    if (found) return { id: found.id };
    return { id: null, create: { id: uid('c_'), name: s.slice(0, 40), color: COLORS[(categories || []).length % COLORS.length] } };
  }

  function pick(obj, names) {
    for (const k of names) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) return { found: true, value: obj[k] };
    }
    return { found: false };
  }

  /**
   * Turns a payload from any app into a partial task (only the fields that were sent).
   * ctx: { today, timeZone, categories }
   * Returns fields; may include `_newCategory` when the category name did not exist yet.
   */
  function normalizeFields(input, ctx) {
    if (typeof input === 'string') input = { title: input };
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Task must be a JSON object');
    const out = {};
    let p;

    p = pick(input, ALIASES.title);
    if (p.found) {
      if (typeof p.value !== 'string' && typeof p.value !== 'number') throw new ValidationError('title must be text', 'title');
      out.title = String(p.value).trim().slice(0, 500);
      if (!out.title) throw new ValidationError('title must not be empty', 'title');
    }
    p = pick(input, ALIASES.notes);
    if (p.found) out.notes = p.value == null ? '' : String(p.value).slice(0, 5000);

    p = pick(input, ALIASES.when);
    if (p.found) {
      const w = parseWhen(p.value, ctx);
      out.due = w.due;
      if (w.time !== undefined) out.time = w.time;
    }
    p = pick(input, ALIASES.time);
    if (p.found) out.time = parseTime(p.value);
    if (out.due === null) out.time = null;

    p = pick(input, ALIASES.category);
    if (p.found) {
      const c = resolveCategory(p.value, ctx.categories);
      if (c.create) {
        out._newCategory = c.create;
        out.category = c.create.id;
      } else out.category = c.id;
    }
    p = pick(input, ALIASES.reminder);
    if (p.found) out.reminder = parseReminder(p.value);
    p = pick(input, ALIASES.repeat);
    if (p.found) out.repeat = parseRepeat(p.value);
    p = pick(input, ALIASES.priority);
    if (p.found) out.priority = parsePriority(p.value);
    p = pick(input, ALIASES.subtasks);
    if (p.found) out.subtasks = parseSubtasks(p.value);
    p = pick(input, ALIASES.done);
    if (p.found) out.done = parseDone(p.value);
    p = pick(input, ALIASES.status);
    if (p.found) {
      out.status = parseStatus(p.value);
      if (out.status === 'done') out.done = true;
      else if (out.done === true) out.status = 'done';
      else out.done = false;
    }
    p = pick(input, ALIASES.externalId);
    if (p.found && p.value != null && p.value !== '') out.externalId = String(p.value).slice(0, 200);
    p = pick(input, ALIASES.sourceName);
    if (p.found && p.value) out.sourceName = String(p.value).slice(0, 60);
    return out;
  }

  function createTask(fields, ctx, extra) {
    if (!fields.title) throw new ValidationError('title is required', 'title');
    const now = ctx.now || new Date().toISOString();
    const task = {
      id: uid('t_'),
      title: fields.title,
      notes: '',
      category: null,
      due: null,
      time: null,
      reminder: null,
      repeat: null,
      priority: 0,
      subtasks: [],
      done: false,
      status: 'todo',
      doneAt: null,
      source: 'app',
      sourceName: null,
      externalId: null,
      seriesId: null,
      spawnedId: null,
      createdAt: now,
      updatedAt: now,
    };
    for (const k of Object.keys(fields)) if (k[0] !== '_') task[k] = fields[k];
    Object.assign(task, extra || {});
    if (task.done && !task.doneAt) task.doneAt = now;
    task.status = task.done ? 'done' : task.status === 'doing' ? 'doing' : 'todo';
    if (!task.due) task.time = null;
    return task;
  }

  /** Applies edits (not completion) to a task, returning a new object. */
  function patchTask(task, fields, ctx) {
    const now = ctx.now || new Date().toISOString();
    const next = Object.assign({}, task);
    for (const k of Object.keys(fields)) {
      if (k[0] === '_' || k === 'done' || k === 'id' || k === 'createdAt') continue;
      next[k] = fields[k];
    }
    if (!next.due) next.time = null;
    // keep status and done in step; completion itself goes through setDone()
    if (next.done) next.status = 'done';
    else if (next.status !== 'doing') next.status = 'todo';
    next.updatedAt = now;
    return next;
  }

  function nextDue(due, repeat) {
    switch (repeat) {
      case 'daily': return addDays(due, 1);
      case 'weekdays': {
        let d = addDays(due, 1);
        while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1);
        return d;
      }
      case 'weekly': return addDays(due, 7);
      case 'monthly': return addMonths(due, 1);
      case 'yearly': return addMonths(due, 12);
      default: return null;
    }
  }

  /**
   * Marks a task done / not done. Repeating tasks spawn their next occurrence with a
   * deterministic id, so the phone (offline) and the server always agree on it.
   * ctx: { now, today, find(id) }
   * Returns { task, spawn, removeId }.
   */
  function setDone(task, done, ctx) {
    const now = ctx.now || new Date().toISOString();
    let spawn = null;
    let removeId = null;
    let updated = task;
    if (done && !task.done) {
      updated = Object.assign({}, task, { done: true, status: 'done', doneAt: now, updatedAt: now });
      if (task.repeat) {
        const today = ctx.today;
        let next = nextDue(task.due || today, task.repeat);
        while (next < today) next = nextDue(next, task.repeat);
        const seriesId = task.seriesId || task.id;
        const id = `${seriesId}@${next}`;
        updated.seriesId = seriesId;
        updated.spawnedId = id;
        if (!ctx.find(id)) {
          spawn = Object.assign({}, task, {
            id, seriesId, due: next, done: false, status: 'todo', doneAt: null, spawnedId: null,
            subtasks: (task.subtasks || []).map((s) => Object.assign({}, s, { done: false })),
            createdAt: now, updatedAt: now,
          });
        }
      }
    } else if (!done && task.done) {
      updated = Object.assign({}, task, { done: false, status: task.status === 'doing' ? 'doing' : 'todo', doneAt: null, spawnedId: null, updatedAt: now });
      if (task.spawnedId) {
        const s = ctx.find(task.spawnedId);
        if (s && !s.done && s.createdAt === s.updatedAt) removeId = s.id;
      }
    }
    return { task: updated, spawn, removeId };
  }

  // ---------- importing from other apps' APIs ----------
  function getPath(obj, path) {
    if (path === undefined || path === null || path === '') return obj;
    return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
  }
  function renderTemplate(tpl, item) {
    return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => {
      const v = getPath(item, p);
      return v == null ? '' : String(v);
    }).replace(/\s+/g, ' ').trim();
  }
  function extractItems(json, itemsPath) {
    const v = itemsPath ? getPath(json, itemsPath) : json;
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      if (!itemsPath) {
        for (const k of ['items', 'data', 'results', 'tasks', 'todos', 'records', 'value', 'rows']) {
          if (Array.isArray(v[k])) return v[k];
        }
      }
      return [v];
    }
    return [];
  }
  /**
   * mapping: { title: 'name' | '{{type}} ห้อง {{room}}', notes, due, time, priority, done, externalId, category }
   * Each value is a dot path into the item, or a template with {{path}}. Empty = auto-detect.
   */
  function mapItem(item, mapping) {
    const out = item && typeof item === 'object' && !Array.isArray(item) ? Object.assign({}, item) : { title: String(item) };
    for (const field of Object.keys(mapping || {})) {
      const spec = mapping[field];
      if (spec === null || spec === undefined || spec === '') continue;
      out[field] = typeof spec === 'string' ? (spec.includes('{{') ? renderTemplate(spec, item) : getPath(item, spec)) : spec;
    }
    if (out.externalId == null && item && typeof item === 'object') {
      const id = item.id ?? item._id ?? item.uuid ?? item.key;
      if (id != null) out.externalId = String(id);
    }
    return out;
  }
  /** Maps a raw API response to normalized task fields. Bad items are reported, not thrown. */
  function mapResponse(json, config, ctx) {
    const items = extractItems(json, config.itemsPath);
    const ok = [];
    const errors = [];
    items.slice(0, 500).forEach((item, i) => {
      try {
        const fields = normalizeFields(mapItem(item, config.mapping), ctx);
        if (!fields.title) throw new ValidationError('No title found — set the title field');
        if (fields.externalId == null) fields.externalId = 'idx-' + i + '-' + fields.title;
        ok.push(fields);
      } catch (e) {
        errors.push({ index: i, message: e.message });
      }
    });
    return { items: ok, errors, total: items.length };
  }

  // ---------- at-a-glance status (app board, Android widgets, /api/v1/widget) ----------
  function compareTasks(a, b) {
    return (a.due || '9999').localeCompare(b.due || '9999') ||
      (a.time || '99:99').localeCompare(b.time || '99:99') ||
      (b.priority || 0) - (a.priority || 0) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  }
  /** Splits tasks into what needs attention. A task that is in progress is listed under `doing` only. */
  function buckets(tasks, today, timeZone) {
    const b = { doing: [], overdue: [], today: [], upcoming: [], nodate: [], doneToday: [] };
    for (const t of tasks) {
      if (t.done) {
        if (t.doneAt && todayIn(timeZone, new Date(t.doneAt)) === today) b.doneToday.push(t);
        continue;
      }
      if (statusOf(t) === 'doing') b.doing.push(t);
      else if (!t.due) b.nodate.push(t);
      else if (t.due < today) b.overdue.push(t);
      else if (t.due === today) b.today.push(t);
      else b.upcoming.push(t);
    }
    for (const k of Object.keys(b)) if (k !== 'doneToday') b[k].sort(compareTasks);
    return b;
  }
  /** The next thing to do: in-progress first, then overdue, then today's earliest. */
  function nextUp(b) {
    return b.doing[0] || b.overdue[0] || b.today.find((t) => t.time) || b.today[0] || null;
  }
  /** Compact data for home-screen widgets. Dates are recomputed on the phone, so it stays right after midnight. */
  function widgetPayload(tasks, categories, ctx) {
    const cats = new Map((categories || []).map((c) => [c.id, c]));
    const horizon = addDays(ctx.today, 14);
    const yesterday = addDays(ctx.today, -1);
    const open = tasks.filter((t) => !t.done && (statusOf(t) === 'doing' || !t.due || t.due <= horizon)).sort(compareTasks);
    const doneDays = {};
    for (const t of tasks) {
      if (!t.done || !t.doneAt) continue;
      const day = todayIn(ctx.timeZone, new Date(t.doneAt));
      if (day >= yesterday) doneDays[day] = (doneDays[day] || 0) + 1;
    }
    return {
      v: 1,
      generatedAt: ctx.now || new Date().toISOString(),
      today: ctx.today,
      openCount: tasks.filter((t) => !t.done).length,
      doneDays,
      tasks: open.slice(0, 60).map((t) => {
        const c = cats.get(t.category);
        const subs = t.subtasks || [];
        return {
          id: t.id,
          title: t.title,
          due: t.due || null,
          time: t.time || null,
          status: statusOf(t),
          priority: t.priority || 0,
          category: c ? c.name : '',
          color: COLOR_HEX[c ? c.color : 'slate'] || COLOR_HEX.slate,
          subtasks: subs.length ? `${subs.filter((x) => x.done).length}/${subs.length}` : '',
        };
      }),
    };
  }

  // Built-in sample feed so the import screen can be tried without another system.
  function demoFeed(name, today) {
    if (name !== 'hotel-pms') return null;
    const tmr = addDays(today, 1);
    return {
      property: 'X10 Resort',
      generatedAt: today,
      data: {
        tasks: [
          { ref: 'HK-1203', type: 'ทำความสะอาด', room: '1203', due: `${today}T11:00`, note: 'แขกเช็กเอาต์ 10:30 มีแขกใหม่เข้าพัก 14:00', priority: 'high' },
          { ref: 'MT-0418', type: 'ซ่อมแอร์', room: '418', due: `${today}T14:30`, note: 'แอร์มีน้ำหยด แจ้งโดยแผนกต้อนรับ', priority: 'urgent', status: 'in_progress' },
          { ref: 'FD-0077', type: 'เตรียมของต้อนรับ VIP', room: 'V02', due: `${tmr}T15:00`, note: 'ผลไม้ + การ์ดฉลองครบรอบแต่งงาน' },
          { ref: 'HK-0907', type: 'เปลี่ยนผ้าปูที่นอน', room: '907', due: `${tmr}T10:00`, note: '' },
        ],
      },
    };
  }
  const PRESETS = [
    {
      id: 'demo-pms',
      label: 'ตัวอย่าง: ระบบห้องพัก (PMS)',
      config: {
        name: 'ระบบห้องพัก (ตัวอย่าง)', url: 'demo://hotel-pms', itemsPath: 'data.tasks',
        mapping: { title: '{{type}} ห้อง {{room}}', notes: 'note', due: 'due', externalId: 'ref', priority: 'priority' },
        category: 'work', interval: 0,
      },
    },
    {
      id: 'jsonplaceholder',
      label: 'API ทดสอบสาธารณะ (JSONPlaceholder)',
      config: {
        name: 'JSONPlaceholder', url: 'https://jsonplaceholder.typicode.com/todos?_limit=5', itemsPath: '',
        mapping: { title: 'title', done: 'completed', externalId: 'id' },
        category: 'personal', interval: 0,
      },
    },
  ];

  return {
    VERSION, REPEATS, COLORS, COLOR_HEX, STATUSES, EVENTS, DEFAULT_CATEGORIES, ALIASES, PRESETS,
    ValidationError, uid, randomHex, pad, parseStatus, statusOf, compareTasks, buckets, nextUp, widgetPayload,
    partsInZone, todayIn, addDays, addMonths, weekday, isValidDate,
    parseWhen, parseTime, parseReminder, parseRepeat, parsePriority, parseDone, parseSubtasks,
    resolveCategory, normalizeFields, createTask, patchTask, nextDue, setDone,
    getPath, renderTemplate, extractItems, mapItem, mapResponse, demoFeed,
  };
});
