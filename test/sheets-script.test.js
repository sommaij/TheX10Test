'use strict';
// Runs the generated Google Apps Script against small stand-ins for Apps Script's services
// and a TaskFlow-like API, to check what it writes to the sheet and sends to TaskFlow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { taskflowScript } = require('../public/js/sheets-script.js');

function appsScriptRuntime(taskflow) {
  const calls = [];
  const toasts = [];
  const triggers = [];
  const props = new Map();
  const sheets = new Map();
  const makeSheet = (name) => {
    let grid = [];
    const sheet = {
      grid: () => grid,
      getName: () => name,
      clearContents: () => (grid = []),
      setFrozenRows: () => {},
      getLastColumn: () => Math.max(0, ...grid.map((r) => r.length)),
      getDataRange: () => sheet.getRange(1, 1, Math.max(grid.length, 1), Math.max(sheet.getLastColumn(), 1)),
      getRange: (row, col, nr = 1, nc = 1) => {
        const range = {
          getSheet: () => sheet,
          getRow: () => row,
          getColumn: () => col,
          setValues: (v) => {
            v.forEach((r, i) => r.forEach((x, j) => {
              grid[row - 1 + i] = grid[row - 1 + i] || [];
              grid[row - 1 + i][col - 1 + j] = x;
            }));
            return range;
          },
          setValue: (x) => range.setValues([[x]]),
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((grid[row - 1 + i] || [])[col - 1 + j] ?? ''))),
          setFontWeight: () => range,
          setDataValidation: (rule) => {
            range.validation = rule;
            sheet.validation = { col, rule };
            return range;
          },
        };
        return range;
      },
    };
    return sheet;
  };
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => (sheets.set(n, makeSheet(n)), sheets.get(n)),
    toast: (m) => toasts.push(m),
  };
  const ui = {
    ButtonSet: { OK_CANCEL: 1 },
    Button: { OK: 'ok' },
    alerts: [],
    promptAnswer: '',
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => ui.promptAnswer }),
    alert: (m) => ui.alerts.push(m),
    createMenu: () => {
      const menu = { items: [], addItem: (l, f) => (menu.items.push([l, f]), menu), addSeparator: () => menu, addToUi: () => (ui.menu = menu) };
      return menu;
    },
  };
  const triggerBuilder = (fn) => {
    const t = { fn, kind: null };
    const b = { forSpreadsheet: () => b, onEdit: () => ((t.kind = 'edit'), b), timeBased: () => b, everyMinutes: (n) => ((t.kind = `every ${n} min`), b), create: () => (triggers.push(t), t) };
    return b;
  };
  const context = {
    console,
    JSON,
    encodeURIComponent,
    SpreadsheetApp: {
      getUi: () => ui,
      getActive: () => ss,
      newDataValidation: () => {
        const rule = { list: null, requireValueInList: (l) => ((rule.list = l), rule), build: () => rule };
        return rule;
      },
    },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    ScriptApp: {
      newTrigger: triggerBuilder,
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, ref: t })),
      deleteTrigger: (h) => triggers.splice(triggers.indexOf(h.ref), 1),
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        calls.push({ url, method: options.method, key: options.headers['x-api-key'], body: options.payload });
        const r = taskflow(url, options);
        return { getResponseCode: () => r.status, getContentText: () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
      },
    },
  };
  return { context, calls, toasts, triggers, props, sheets, ui };
}

test('Google Sheets script: set key, pull my tasks, push edited statuses, auto-sync', () => {
  const tasks = {
    1116: { id: 1116, title: 'ตรวจรับของห้องครัว', status: 'TODO', dueDate: '2026-11-03', assignee: { name: 'Boss IT' } },
    1117: { id: 1117, title: 'สรุปยอดเบิกของ', status: 'IN_PROGRESS', dueDate: null },
  };
  const taskflow = (url, options) => {
    if (options.headers['x-api-key'] !== 'tfk_good') return { status: 401, body: { error: 'invalid key' } };
    const u = new URL(url);
    if (u.pathname === '/api/external/my-tasks') {
      const want = (u.searchParams.get('status') || '').split(',').filter(Boolean);
      return { status: 200, body: { tasks: Object.values(tasks).filter((t) => !want.length || want.includes(t.status)) } };
    }
    const m = u.pathname.match(/^\/api\/external\/tasks\/(\d+)$/);
    if (options.method === 'patch' && m) {
      Object.assign(tasks[m[1]], JSON.parse(options.payload));
      return { status: 200, body: { task: tasks[m[1]] } };
    }
    return { status: 404, body: {} };
  };
  const rt = appsScriptRuntime(taskflow);
  const code = taskflowScript({ url: 'https://tf.example', doneStatus: 'DONE' });
  vm.createContext(rt.context);
  vm.runInContext(code, rt.context);
  const run = (fn, ...args) => vm.runInContext(`${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`, rt.context);

  run('onOpen');
  assert.deepEqual(rt.ui.menu.items.map((i) => i[1]), ['setApiKey', 'pullTasks', 'pushStatuses', 'enableAutoSync', 'disableAutoSync']);

  // without a key it says what to do
  assert.throws(() => run('pullTasks'), /ตั้งค่า API key/);

  // the key is kept in the user's properties, never in the code, and is checked once
  rt.ui.promptAnswer = 'tfk_wrong';
  run('setApiKey');
  assert.match(rt.ui.alerts.pop(), /ทดสอบไม่ผ่าน: TaskFlow ตอบกลับ 401/);
  rt.ui.promptAnswer = ' tfk_good ';
  run('setApiKey');
  assert.match(rt.ui.alerts.pop(), /ตอบรับคีย์นี้/);
  assert.equal(rt.props.get('TASKFLOW_KEY'), 'tfk_good');
  assert.ok(!code.includes('tfk_good'));

  // pull: id and status first, objects as JSON, a hidden column remembering TaskFlow's status
  assert.equal(run('pullTasks'), 2);
  const sheet = rt.sheets.get('TaskFlow');
  const grid = sheet.grid();
  assert.deepEqual(grid[0], ['id', 'status', 'title', 'dueDate', 'assignee', '_status_in_taskflow']);
  assert.deepEqual(grid[1], [1116, 'TODO', 'ตรวจรับของห้องครัว', '2026-11-03', '{"name":"Boss IT"}', 'TODO']);
  assert.equal(grid[2][3], '');
  assert.deepEqual([...sheet.validation.rule.list], ['TODO', 'IN_PROGRESS', 'DONE']);
  assert.equal(sheet.validation.col, 2);
  assert.match(rt.calls.at(-1).url, /my-tasks\?status=TODO,IN_PROGRESS$/);

  // edit a status in the sheet -> only that row is sent
  grid[1][1] = 'IN_PROGRESS';
  rt.calls.length = 0;
  vm.runInContext("onStatusEdit({ range: sheet_().getRange(2, 2) })", rt.context);
  assert.deepEqual(rt.calls.map((c) => [c.method, c.url, c.body]), [['patch', 'https://tf.example/api/external/tasks/1116', '{"status":"IN_PROGRESS"}']]);
  assert.equal(grid[1][5], 'IN_PROGRESS');
  assert.equal(tasks[1116].status, 'IN_PROGRESS');

  // finish one; the next pull sends it first, then it leaves the open list
  grid[2][1] = 'DONE';
  assert.equal(run('pullTasks'), 1);
  assert.equal(tasks[1117].status, 'DONE');
  assert.deepEqual(sheet.grid()[1].slice(0, 2), [1116, 'IN_PROGRESS']);

  // auto-sync triggers: on edit + every 15 minutes, and they can be removed
  run('enableAutoSync');
  assert.deepEqual(rt.triggers.map((t) => [t.fn, t.kind]), [['onStatusEdit', 'edit'], ['pullTasks', 'every 15 min']]);
  run('enableAutoSync');
  assert.equal(rt.triggers.length, 2, 'no duplicate triggers');
  run('disableAutoSync');
  assert.equal(rt.triggers.length, 0);
});

test('the script file in the repo matches what the app generates', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'google-sheets', 'TaskFlow.gs'), 'utf8');
  assert.equal(file, taskflowScript({ url: 'https://taskflow.thex10smile.com', doneStatus: 'DONE' }));
});
