/**
 * TaskFlow ↔ Google Sheets (สร้างจากแอป X10 Tasks)
 *
 * วิธีใช้
 * 1. ในชีต: ส่วนขยาย (Extensions) → Apps Script → ลบโค้ดเดิม วางโค้ดนี้ แล้วกดบันทึก
 * 2. กลับมาที่ชีตแล้วรีเฟรช จะมีเมนู "TaskFlow"
 * 3. TaskFlow → ตั้งค่า API key แล้ววางคีย์ (เก็บไว้ในบัญชี Google ของคุณ ไม่อยู่ในโค้ด)
 * 4. TaskFlow → ดึงงานของฉัน
 * 5. แก้คอลัมน์ status ในชีต (TODO / IN_PROGRESS / DONE) แล้วเลือก "ส่งสถานะที่แก้ไปที่ TaskFlow"
 *    หรือเปิดซิงก์อัตโนมัติ ให้ส่งทันทีที่แก้ และดึงงานใหม่ทุก 15 นาที
 */
const TASKFLOW_URL = 'https://taskflow.thex10smile.com';
const SHEET_NAME = 'TaskFlow';
const PULL_STATUS = 'TODO,IN_PROGRESS'; // ใส่ '' เพื่อดึงงานทุกสถานะ
const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'];
const SYNC_COLUMN = '_status_in_taskflow'; // สถานะล่าสุดที่ TaskFlow รู้ ใช้เทียบว่าแถวไหนถูกแก้

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TaskFlow')
    .addItem('ตั้งค่า API key', 'setApiKey')
    .addItem('ดึงงานของฉัน', 'pullTasks')
    .addItem('ส่งสถานะที่แก้ไปที่ TaskFlow', 'pushStatuses')
    .addSeparator()
    .addItem('เปิดซิงก์อัตโนมัติ', 'enableAutoSync')
    .addItem('ปิดซิงก์อัตโนมัติ', 'disableAutoSync')
    .addToUi();
}

function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('API key ของ TaskFlow', 'วางคีย์ที่ขึ้นต้นด้วย tfk_', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const key = answer.getResponseText().trim();
  if (!key) return;
  PropertiesService.getUserProperties().setProperty('TASKFLOW_KEY', key);
  try {
    api_('get', '/api/external/my-tasks?status=TODO');
    ui.alert('บันทึกคีย์แล้ว และ TaskFlow ตอบรับคีย์นี้');
  } catch (e) {
    ui.alert('บันทึกคีย์แล้ว แต่ทดสอบไม่ผ่าน: ' + e.message);
  }
}

/** ดึงงานของฉันจาก TaskFlow มาไว้ในชีต (ส่งสถานะที่แก้ค้างไว้ก่อน) */
function pullTasks() {
  pushStatuses(true);
  const json = api_('get', '/api/external/my-tasks' + (PULL_STATUS ? '?status=' + PULL_STATUS : ''));
  const tasks = findList_(json);
  const keys = [];
  tasks.forEach(function (t) {
    Object.keys(t).forEach(function (k) {
      if (keys.indexOf(k) < 0) keys.push(k);
    });
  });
  const front = ['id', 'status'].filter(function (k) { return keys.indexOf(k) >= 0; });
  const cols = front.concat(keys.filter(function (k) { return front.indexOf(k) < 0; })).concat([SYNC_COLUMN]);
  const sheet = sheet_();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  const rows = tasks.map(function (t) {
    return cols.map(function (k) { return k === SYNC_COLUMN ? cell_(t.status) : cell_(t[k]); });
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, cols.length).setValues(rows);
    const statusCol = cols.indexOf('status') + 1;
    if (statusCol) {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
      sheet.getRange(2, statusCol, rows.length, 1).setDataValidation(rule);
    }
  }
  sheet.setFrozenRows(1);
  toast_('ดึงงานแล้ว ' + rows.length + ' งาน');
  return rows.length;
}

/** ส่งสถานะของแถวที่แก้ในชีตไปที่ TaskFlow */
function pushStatuses(quiet) {
  const sheet = sheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return 0;
  const head = values[0];
  const idCol = head.indexOf('id');
  const statusCol = head.indexOf('status');
  const syncCol = head.indexOf(SYNC_COLUMN);
  if (idCol < 0 || statusCol < 0 || syncCol < 0) return 0;
  let sent = 0;
  const failed = [];
  for (let r = 1; r < values.length; r++) {
    const id = values[r][idCol];
    const status = String(values[r][statusCol]).trim();
    if (!id || !status || status === String(values[r][syncCol])) continue;
    try {
      api_('patch', '/api/external/tasks/' + encodeURIComponent(id), { status: status });
      sheet.getRange(r + 1, syncCol + 1).setValue(status);
      sent++;
    } catch (e) {
      failed.push(id + ' (' + e.message + ')');
    }
  }
  if (!quiet || failed.length) toast_('ส่งสถานะแล้ว ' + sent + ' งาน' + (failed.length ? ' · ไม่สำเร็จ: ' + failed.join(', ') : ''));
  return sent;
}

/** ส่งทันทีเมื่อแก้คอลัมน์ status (ใช้กับทริกเกอร์ที่เปิดจากเมนู) */
function onStatusEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME || e.range.getRow() < 2) return;
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (e.range.getColumn() !== head.indexOf('status') + 1) return;
  pushStatuses(true);
}

function enableAutoSync() {
  disableAutoSync(true);
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onStatusEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('pullTasks').timeBased().everyMinutes(15).create();
  toast_('เปิดซิงก์อัตโนมัติแล้ว: ส่งสถานะทันทีที่แก้ และดึงงานทุก 15 นาที');
}

function disableAutoSync(quiet) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onStatusEdit', 'pullTasks'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  if (quiet !== true) toast_('ปิดซิงก์อัตโนมัติแล้ว');
}

function api_(method, path, payload) {
  const key = PropertiesService.getUserProperties().getProperty('TASKFLOW_KEY');
  if (!key) throw new Error('ยังไม่ได้ตั้งค่า API key (เมนู TaskFlow → ตั้งค่า API key)');
  const options = { method: method, headers: { 'x-api-key': key }, muteHttpExceptions: true };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(TASKFLOW_URL + path, options);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('TaskFlow ตอบกลับ ' + code + (text ? ': ' + text.slice(0, 150) : ''));
  return text ? JSON.parse(text) : null;
}

function findList_(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  const names = ['tasks', 'data', 'items', 'results', 'records'];
  for (let i = 0; i < names.length; i++) {
    const v = json[names[i]];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const inner = findList_(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : v;
}

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function toast_(message) {
  try {
    SpreadsheetApp.getActive().toast(message, 'TaskFlow', 5);
  } catch (e) {
    console.log(message);
  }
}
