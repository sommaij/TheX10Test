# X10 Tasks API (v1)

Base URL: `https://<your-server>/api/v1` · ข้อมูลเป็น JSON (UTF-8) · เวลาทั้งหมดอ้างอิงเขตเวลา `X10_TIMEZONE` (ค่าเริ่มต้น `Asia/Bangkok`)

## การยืนยันตัวตน

ส่งคีย์ได้ 3 แบบ (เลือกแบบใดก็ได้)

```
Authorization: Bearer x10_xxxxxxxx
X-API-Key: x10_xxxxxxxx
?key=x10_xxxxxxxx        ← สำหรับระบบที่ตั้ง header ไม่ได้ (ระวังคีย์ติดอยู่ใน log ของ URL)
```

| ประเภทคีย์ | ทำอะไรได้ |
|---|---|
| ผู้ดูแล (`admin`) | ทุกอย่าง รวมถึงจัดการคีย์ webhook และแหล่งข้อมูล |
| แอป (`app`) | อ่าน/สร้าง/แก้/ลบงาน อ่านหมวดหมู่ และฟัง live stream |

ข้อผิดพลาดตอบกลับรูปแบบเดียวกันเสมอ:

```json
{ "error": { "code": "invalid", "field": "due", "message": "Could not understand date \"someday\"" } }
```

| HTTP | code | ความหมาย |
|---|---|---|
| 401 | `unauthorized` | ไม่มีคีย์หรือคีย์ผิด |
| 403 | `forbidden` | ต้องใช้คีย์ผู้ดูแล |
| 404 | `not_found` | ไม่พบข้อมูล |
| 422 | `invalid` | ข้อมูลไม่ถูกต้อง (`field` บอกว่าช่องไหน) |
| 502 | `fetch_failed` | เรียก API ของระบบอื่นไม่สำเร็จ |

## งาน (Task)

```json
{
  "id": "t_3f9a1c0b2d4e5f60",
  "title": "ตรวจความเรียบร้อยวิลล่าก่อนแขก VIP เข้าพัก",
  "notes": "",
  "category": "work",
  "due": "2026-11-01",
  "time": "13:30",
  "reminder": 30,
  "repeat": null,
  "priority": 2,
  "subtasks": [
    { "id": "s_…", "title": "ดอกไม้และการ์ดต้อนรับ", "detail": "กุหลาบขาว + การ์ดเขียนชื่อแขก", "done": true, "doneAt": "2026-10-31T03:20:00.000Z" },
    { "id": "s_…", "title": "เช็กเครื่องปรับอากาศ", "detail": "ตั้ง 24°C", "done": false, "doneAt": null }
  ],
  "status": "doing",
  "done": false,
  "doneAt": null,
  "source": "key:k_…",
  "sourceName": "ระบบ PMS",
  "externalId": "HK-1203",
  "createdAt": "2026-10-31T02:00:00.000Z",
  "updatedAt": "2026-10-31T02:00:00.000Z"
}
```

| ฟิลด์ | ชื่ออื่นที่รับได้ | ค่า |
|---|---|---|
| `title` * | `text` `name` `content` `summary` `subject` `task` `message` | ข้อความ ≤ 500 ตัวอักษร |
| `notes` | `note` `description` `details` `body` `desc` | ข้อความ |
| `due` | `dueDate` `due_date` `date` `deadline` `dueAt` `start` `datetime` | `2026-11-05`, `2026-11-05T14:30`, ISO พร้อมโซนเวลา, `05/11/2569`, `05/11/2026`, `today`, `tomorrow`, `วันนี้`, `พรุ่งนี้`, Unix timestamp, `null` |
| `time` | `dueTime` `due_time` | `HH:MM` |
| `category` | `categoryId` `list` `project` | id หรือชื่อหมวดหมู่ (ถ้าไม่มีจะสร้างให้) |
| `reminder` | `remind` `reminderMinutes` | นาทีก่อนถึงเวลา เช่น `15`, `"1h"`, `"1d"`, `true` (= ตรงเวลา) |
| `repeat` | `recurrence` `recurring` | `daily` `weekdays` `weekly` `monthly` `yearly` หรือ `ทุกวัน` `ทุกสัปดาห์` … |
| `priority` | `importance` `flag` | `0`–`2` หรือ `normal` `high`/`สำคัญ` `urgent`/`ด่วน` |
| `subtasks` | `steps` `checklist` | ขั้นตอนเรียงตามลำดับ: `["ขั้น 1", {"title":"ขั้น 2","detail":"รายละเอียด","done":true}]` ขั้นแรกที่ยังไม่เสร็จคือขั้นปัจจุบัน และ `doneAt` ถูกบันทึกให้เมื่อขั้นนั้นเปลี่ยนเป็นเสร็จ |
| `status` | `state` | `todo` (รอทำ), `doing` (กำลังทำ), `done` (เสร็จ) รับคำอื่นได้ เช่น `open`, `in_progress`, `started`, `completed`, `กำลังทำ` |
| `done` | `completed` `complete` `isDone` | `true` / `"done"` / `"completed"` / `"เสร็จ"` (`done` กับ `status` สอดคล้องกันเสมอ: `done: true` ⇔ `status: "done"`) |
| `externalId` | `external_id` `ref` `reference` | รหัสในระบบต้นทาง ใช้กันงานซ้ำ |
| `sourceName` | `app` `from` | ชื่อที่แสดงว่า “มาจาก …” |

### `GET /tasks`

ตัวกรอง: `status=open|doing|done`, `category`, `source`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `q` (ค้นข้อความ), `updatedSince` (ISO)

```bash
curl -H "Authorization: Bearer $KEY" "https://your-server/api/v1/tasks?status=open&from=2026-11-01&to=2026-11-07"
```
→ `{ "tasks": [...], "count": 3 }`

### `POST /tasks`

สร้างงาน → `201 { "task": {...}, "created": true }`

ถ้ามี `id` ที่มีอยู่แล้ว หรือ `externalId` ที่แอปเดียวกันเคยส่งมา จะ **อัปเดต** แทน → `200 { "task": {...}, "created": false }`

```bash
curl -X POST https://your-server/api/v1/tasks \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"text":"แขกห้อง 512 ขอผ้าเช็ดตัวเพิ่ม","due":"today","time":"10:15","category":"งาน","priority":"urgent","externalId":"REQ-8812"}'
```

ส่งหลายงานพร้อมกันได้ (สูงสุด 500) โดยส่งเป็น array → `{ "results": [{ "index": 0, "created": true, "task": {...} }, { "index": 1, "error": "title is required" }] }`

รับ body แบบอื่นได้ด้วย:
- `Content-Type: text/plain` → ข้อความทั้งหมดเป็นชื่องาน
- `Content-Type: application/x-www-form-urlencoded` → `title=...&due=today`

### `GET /tasks/:id` · `PATCH /tasks/:id` · `DELETE /tasks/:id`

`PATCH` ส่งเฉพาะช่องที่ต้องการแก้ ถ้าส่ง `"done": true` กับงานทำซ้ำ จะได้ครั้งถัดไปกลับมาใน `spawned`

```bash
curl -X PATCH https://your-server/api/v1/tasks/t_3f9a1c0b2d4e5f60 \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"done":true}'
```
→ `{ "task": {...}, "spawned": null }`

เปลี่ยนสถานะเป็นกำลังทำ:

```bash
curl -X PATCH https://your-server/api/v1/tasks/t_3f9a1c0b2d4e5f60 \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"status":"in_progress"}'
```

### `POST /tasks/:id/steps/:stepId/complete`

ปิดหนึ่งขั้นตอน (บันทึกเวลาให้) งานจะเป็น `doing` และถ้าเป็นขั้นสุดท้าย งานจะเสร็จทั้งงาน → `{ "task": {...}, "spawned": null }`

```bash
curl -X POST https://your-server/api/v1/tasks/t_3f9a1c0b2d4e5f60/steps/s_9a8b7c6d5e4f3a2b/complete -H "Authorization: Bearer $KEY"
```

### `POST /tasks/:id/complete`

ทางลัดของ `PATCH {"done": true}`

### `GET /widget`

ข้อมูลย่อสำหรับวิดเจ็ตหน้าจอโฮม (แอป Android ใช้ดึงงานใหม่ตอนปิดแอปอยู่) ใช้คีย์แอปได้

```json
{
  "v": 1,
  "today": "2026-10-31",
  "openCount": 7,
  "doneDays": { "2026-10-31": 1 },
  "tasks": [
    { "id": "t_…", "title": "ซ่อมแอร์ ห้อง 418", "due": "2026-10-31", "time": "14:30", "status": "doing",
      "priority": 2, "category": "งาน", "color": "#4a7be0", "subtasks": "2/4",
      "steps": [{ "id": "s_…", "title": "รับแจ้งปัญหา", "done": true }, { "id": "s_…", "title": "ล้างคอยล์", "done": false }] }
  ]
}
```

`tasks` คืองานที่ยังไม่เสร็จภายใน 14 วันข้างหน้า งานที่กำลังทำ และงานที่ไม่มีกำหนด (สูงสุด 60 งาน) ส่วน `doneDays` คือจำนวนงานที่เสร็จของเมื่อวานและวันนี้

## หมวดหมู่

| | |
|---|---|
| `GET /categories` | `{ "categories": [{ "id": "work", "name": "งาน", "color": "blue" }] }` |
| `POST /categories` (ผู้ดูแล) | `{ "name": "ฝ่ายช่าง", "color": "violet" }` สี: `blue` `green` `amber` `rose` `violet` `slate` |
| `PATCH /categories/:id` · `DELETE /categories/:id` (ผู้ดูแล) | ลบแล้วงานในหมวดจะไม่มีหมวดหมู่ |

## คีย์สำหรับแอปอื่น (ผู้ดูแล)

| | |
|---|---|
| `GET /keys` | รายการคีย์ (ไม่แสดงคีย์เต็ม) |
| `POST /keys` | `{ "name": "LINE Bot" }` → `{ "key": {...}, "secret": "x10_…" }` ← คีย์เต็มแสดงครั้งเดียว |
| `DELETE /keys/:id` | ยกเลิกคีย์ (ต้องเหลือคีย์ผู้ดูแลอย่างน้อย 1 คีย์) |

## Webhook ขาออก (ผู้ดูแล)

| | |
|---|---|
| `GET /webhooks` | รายการพร้อมสถานะการส่งล่าสุด |
| `POST /webhooks` | `{ "url": "https://…", "events": ["task.created","task.completed"], "name": "แจ้งทีมช่าง" }` (ไม่ใส่ `events` = ทุกเหตุการณ์) → มี `secret` สำหรับตรวจลายเซ็น |
| `PATCH /webhooks/:id` | แก้ `url`, `events`, `name`, `active` |
| `DELETE /webhooks/:id` | |
| `POST /webhooks/:id/test` | ส่งเหตุการณ์ `ping` ทดสอบ |

เหตุการณ์: `task.created` `task.updated` `task.completed` `task.deleted`

คำขอที่ส่งไป:

```
POST <url>
Content-Type: application/json
X-X10-Event: task.completed
X-X10-Delivery: evt_…
X-X10-Signature: sha256=<HMAC-SHA256 ของ body ด้วย secret>

{ "id": "evt_…", "event": "task.completed", "createdAt": "…", "data": { "task": { … } } }
```

ถ้าปลายทางตอบไม่ใช่ 2xx หรือไม่ตอบใน 8 วินาที จะลองใหม่หลังจาก 2 วินาที, 10 วินาที และ 1 นาที

ตรวจลายเซ็น (Node.js):

```js
const crypto = require('crypto');
function verify(rawBody, header, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return header && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

## ดึงงานจาก API ของแอปอื่น — connectors (ผู้ดูแล)

```json
{
  "name": "ระบบแจ้งซ่อม",
  "url": "https://maintenance.example.com/api/jobs?status=open",
  "method": "GET",
  "headers": { "Authorization": "Bearer abc123" },
  "itemsPath": "data.rows",
  "mapping": {
    "title": "งาน: {{job}} ห้อง {{room}}",
    "notes": "detail",
    "due": "scheduled_at",
    "priority": "level",
    "externalId": "code"
  },
  "category": "work",
  "interval": 15
}
```

- `itemsPath` ตำแหน่งของ array ในคำตอบ (เว้นว่าง = หาจาก `items` `data` `results` `tasks` `todos` `records` `value` `rows`)
- `mapping` แต่ละช่องเป็น path (`a.b.0.c`) หรือข้อความที่มี `{{path}}` ช่องที่เว้นไว้จะหาจากชื่อฟิลด์ทั่วไปให้อัตโนมัติ
- `externalId` ใช้กันงานซ้ำ ซิงก์รอบถัดไปจะอัปเดตงานเดิม ถ้าต้นทางบอกว่าเสร็จ งานจะถูกติ๊กเสร็จให้ แต่งานที่ติ๊กเสร็จในแอปแล้วจะไม่ถูกเปลี่ยนกลับ
- `interval` นาที (`0` = กดซิงก์เอง)
- `url` แบบ `demo://hotel-pms` คือข้อมูลตัวอย่างในตัว

| | |
|---|---|
| `POST /connectors/preview` | ส่ง config เดียวกัน → ดูผลแปลงโดยไม่บันทึก `{ "total", "items", "errors", "sample" }` |
| `GET /connectors` · `POST /connectors` · `PATCH /connectors/:id` · `DELETE /connectors/:id` | จัดการ |
| `POST /connectors/:id/sync` | ซิงก์ทันที → `{ "created": 2, "updated": 1, "total": 3, "errors": [] }` |

## Live stream

`GET /stream?access_token=<key>` (Server-Sent Events) ส่ง `task.created` `task.updated` `task.deleted` `categories.updated`
ใช้ทำหน้าจอแสดงงานสด เช่น จอในห้องแม่บ้าน

```js
const es = new EventSource('https://your-server/api/v1/stream?access_token=' + KEY);
es.addEventListener('task.created', (e) => console.log(JSON.parse(e.data).task.title));
```

## อื่น ๆ

- `GET /health` (ไม่ต้องใช้คีย์) → `{ "ok": true, "name": "X10 Tasks", "version": "1.0.0", "timeZone": "Asia/Bangkok", "today": "2026-10-31" }`
- `GET /export` (ผู้ดูแล) → งานและหมวดหมู่ทั้งหมด

---

## ตัวอย่างการเชื่อมต่อ

### Google Sheets → X10 (ส่งแถวใหม่เป็นงาน)

Extensions → Apps Script แล้ววางโค้ดนี้ ตั้ง trigger “On form submit” หรือเรียกจากปุ่ม

```js
const X10 = 'https://your-server/api/v1/tasks';
const KEY = 'x10_คีย์ของแอป';

function sendRow(e) {
  const [timestamp, title, due, room] = e.values;
  UrlFetchApp.fetch(X10, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + KEY },
    payload: JSON.stringify({ title: title + ' ห้อง ' + room, due: due, sourceName: 'Google Sheets', externalId: 'sheet-' + timestamp }),
  });
}
```

### X10 ← Google Sheets (ให้ X10 ดึงจากชีต)

Deploy Apps Script เป็น Web app (Anyone with the link) แล้วใช้ URL นั้นเป็น connector

```js
function doGet() {
  const rows = SpreadsheetApp.getActiveSheet().getDataRange().getValues();
  const head = rows.shift();
  const items = rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  return ContentService.createTextOutput(JSON.stringify({ items })).setMimeType(ContentService.MimeType.JSON);
}
```

### iPhone Shortcuts

ใช้แอ็กชัน **Get Contents of URL** → Method `POST`, Headers `Authorization: Bearer x10_…`, Request Body เป็น JSON ใส่ `title`, `due`
หรือแบบง่ายที่สุด ใช้แอ็กชัน **Open URL** กับลิงก์ `https://your-server/?add=ข้อความ&due=today` (เปิดฟอร์มให้กดบันทึก)

### LINE, Slack, ระบบอื่น ๆ ผ่าน n8n / Make / Zapier

1. รับข้อความจาก LINE OA หรือ Slack ในเครื่องมือเหล่านี้
2. เพิ่มขั้น **HTTP Request** → `POST /api/v1/tasks` พร้อมคีย์
3. ขาออก: เพิ่ม webhook ใน X10 ให้ชี้ไปที่ Webhook trigger ของ n8n/Make แล้วส่งต่อเข้ากลุ่ม LINE
