# Migration Plan — ย้าย ID Allocation จาก Apps Script → Postgres

> สถานะ: **PLANNED — ยังไม่เริ่มทำ** · เขียน 2026-05-21 · context จาก diagnose ของ order-submit latency
>
> เป้าหมาย: ตัด Apps Script round-trip (~1.5-2.5 วิ) ออกจากทุก route ที่สร้าง order/job
> → ส่งใบสั่งงาน 2-3 วิ เหลือ ~0.3-0.6 วิ (เร็วขึ้น ~4-6 เท่า)

---

## 1. ทำไมต้องทำ

จาก diagnose (2026-05-21): การกด "ส่งใบสั่งงาน" ใช้เวลา 2-3 วิ — **~80-90% หมดไปกับการขอเลข ID จาก Apps Script** (`getNextOrderId` + `getNextId`). Apps Script web app ช้าโดยธรรมชาติ (302 redirect 2 hop + LockService + Google infra latency ~1.5-2.5 วิ/call).

Phase 2 ตัด Apps Script `createOrder` write ออกไปแล้ว (ประหยัด ~1.3 วิ) แต่ยัง **เหลือการ mint ID** ที่ค้างอยู่บน Apps Script — งานนี้คือ step สุดท้ายที่จะเอา Apps Script ออกจาก critical path ของการสร้าง order/job

---

## 2. สถานะปัจจุบัน — ID allocation ทำงานยังไง

### Apps Script side ([`production-monitoring/apps-script/dashboard/helpers.js`](../production-monitoring/apps-script/dashboard/helpers.js))

| ฟังก์ชัน | บรรทัด | ทำอะไร |
|---|---|---|
| `getNextId()` | `helpers.js:153` | job counter รวม — อ่าน `config` sheet key `nextId` (default 100), return ค่า, set `+1` |
| `getNextIds(N)` | `helpers.js:171` | batch — return `[start..start+N-1]`, bump counter `+N` (ใช้โดย bulk-forward) |
| `getNextOrderId()` | `helpers.js:189` | order counter รายเดือน — key `orderCounter_YYYYMM`, `next = max(maxSeqInSheet, counter) + 1`, return เลข 9 หลัก `YYYYMM`+seq 3 หลัก |

- **Counter เก็บใน `config` sheet** (key/value rows): `nextId` + `orderCounter_YYYYMM`
- **Atomicity:** ทุก call ผ่าน `doPost` ที่ห่อด้วย **LockService** → Apps Script serialize ทุก request ทั้งระบบ → ไม่มีทาง mint เลขซ้ำ ⚠️ **นี่คือ property ที่ต้องรักษาไว้ตอนย้าย**
- **`getNextOrderId` cross-check Sheet:** สแกน orders sheet หา max sequence จริงของเดือนนั้น แล้ว `max(counter, maxInSheet)+1` — กันไว้เพราะ counter เคย drift จนเกิด ID ซ้ำ (`202604001` เคยโผล่ 2 ครั้ง)

### Routes ที่ขอ ID (6 routes — ต้องย้ายให้ครบ)

| Route | ขอ |
|---|---|
| `app/api/orders/add/route.ts` | `getNextOrderId` + `getNextId` |
| `app/api/orders/promote-draft/route.ts` | `getNextId` |
| `app/api/jobs/add/route.ts` | `getNextId` |
| `app/api/jobs/forward/route.ts` | `getNextId` |
| `app/api/jobs/forward-undo/route.ts` | `getNextId` |
| `app/api/jobs/bulk-forward/route.ts` | `getNextIds(N)` (fallback N×`getNextId`) |

---

## 3. ⭐ ผลกระทบต่อ PIN และ QR Code / Track — (คำถามคุณนุ๊ก)

### PIN — ✅ **ไม่กระทบเลย**

PIN ถูกสร้างแบบ **สุ่ม** ใน [`app/api/orders/add/route.ts:98`](app/api/orders/add/route.ts:98):
```js
const pin = String(Math.floor(1000 + Math.random() * 9000));  // เลขสุ่ม 4 หลัก
```
PIN **ไม่ได้มาจาก counter** — เป็น `Math.random()` ล้วน เก็บใน `order.rawData.pin` → migration นี้ไม่แตะ PIN เลยแม้แต่บรรทัดเดียว

### QR Code / Track — ✅ **ไม่กระทบ ถ้าทำถูก** (มีเงื่อนไข)

QR code เข้ารหัสแค่ **order ID** ([`app/orders/[id]/tracking-card/page.tsx:50`](app/orders/[id]/tracking-card/page.tsx:50)):
```js
const trackUrl = `https://dashboard.penprinting.co/track?id=${id}`;  // ไม่มี PIN ใน QR
```
ลูกค้าสแกน QR → เปิดหน้า `/track?id=<orderId>` → พิมพ์ PIN เอง → `/api/track/lookup` ตรวจ `{id, pin}` โดย lookup order จาก **`id` ตรงตัว** (`SELECT ... WHERE id = <id> LIMIT 1`)

**สรุปผลกระทบ QR:**
- ✅ **QR เดิมที่พิมพ์ไปแล้ว/แจกลูกค้าไปแล้ว — ยังใช้ได้** เพราะ order ID ของ order เก่า**ไม่เปลี่ยน** (migration ย้ายแค่กลไก mint เลขใหม่ ไม่ renumber ของเก่า)
- ✅ **QR ใหม่ — ใช้ได้** เพราะ order ID ใหม่ยังเป็น format `YYYYMMNNN` เดิม
- 🔴 **QR จะพังก็ต่อเมื่อ migration ทำให้เกิด ID ซ้ำ** — ถ้า 2 orders มี ID เดียวกัน → `/track?id=X` + `LIMIT 1` จะหยิบใบผิด → ลูกค้าเห็นงานผิดใบ

**→ ความเสี่ยง QR = ความเสี่ยง "ID ซ้ำ" ซึ่งเป็นความเสี่ยง #1 ของ migration อยู่แล้ว** ถ้ากัน ID ซ้ำได้ = QR ปลอดภัย 100%

**เงื่อนไขบังคับเพื่อไม่ให้กระทบ QR/track:**
1. ห้ามเปลี่ยน format order ID — ต้องคง `YYYYMMNNN` (9 หลัก)
2. ห้าม renumber order เก่า
3. ห้าม mint ID ซ้ำ / ชนกับ ID ที่มีอยู่

---

## 4. Design ปลายทาง

### ตาราง `counters` (เพิ่มใหม่)

```sql
CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
```
Rows: `nextId` (job counter รวม) · `orderCounter_YYYYMM` (รายเดือน — สร้าง lazy)

### Job ID — `mintJobId()` / `mintJobIds(n)`

```sql
-- เดี่ยว: atomic ผ่าน UPDATE ... RETURNING (row lock serialize concurrent minters)
UPDATE counters SET value = value + 1 WHERE key = 'nextId' RETURNING value - 1 AS id;

-- batch N ตัว (bulk-forward):
UPDATE counters SET value = value + ${n} WHERE key = 'nextId' RETURNING value;
-- → ช่วงที่จองได้ = [returned - n, returned - 1]
```

### Order ID — `mintOrderId()`

```sql
-- ใน transaction เดียว, lock counter row ก่อน:
BEGIN;
  -- key อิงเดือนตาม "เวลาไทย" (ดูความเสี่ยง R4)
  -- SELECT ... FOR UPDATE บน counter row
  -- cross-check max seq ของเดือนนั้นจากตาราง orders (replicate getNextOrderId)
  UPDATE counters
     SET value = GREATEST(value, <maxSeqInOrdersThisMonth>) + 1
   WHERE key = 'orderCounter_' || <YYYYMM>
   RETURNING value;
COMMIT;
-- order id = YYYYMM * 1000 + value
```

### Atomicity
- `UPDATE ... RETURNING` = atomic (row-level lock) → concurrent mint serialize บน counter row เดียว → ได้เลขไม่ซ้ำ
- **ดีกว่า Apps Script LockService ด้วยซ้ำ** — AS lock ทั้งแอป, อันนี้ lock แค่ 1 row
- Order ID ต้องทำ cross-check + update ใน **transaction เดียว** (lock row ก่อน select max) ไม่งั้น 2 txn อ่าน max เดียวกัน

---

## 5. 🪤 กับดักสำคัญ — Job ID ห้าม derive จาก `MAX(id)`

- **Order ID ปลอดภัยที่จะ cross-check `MAX`** — order ไม่เคยถูกลบ (cancelled order ยังอยู่ในตาราง `orders` status='cancelled') → max ของเดือนนั้นเชื่อถือได้
- **Job ID ห้าม `MAX`** — job ถูกย้ายไป shipped/cancelled แล้ว **row ในตาราง `jobs` ถูกลบจริง** (tombstone→purge) + `/api/jobs/delete` ลบ hard. ดังนั้น `MAX(id) FROM jobs` **ต่ำกว่า** id ที่เคย mint ไปแล้วได้ → ถ้า minter ใช้ `MAX(jobs)+1` จะ **mint เลขซ้ำกับ job ที่ย้ายไป shipped/cancelled/audit แล้ว**
- **→ job counter ต้องเป็น monotonic counter แท้ๆ** — `counters.nextId` เป็น authoritative, ห้ามคำนวณใหม่จาก `MAX(jobs.id)` เด็ดขาด
- ถ้าจะ cross-check job id เพื่อความปลอดภัย ต้อง `MAX` ข้าม `jobs ∪ shipped ∪ cancelled` — แต่ job ที่ลบ hard (ไม่ได้ archive) ก็ยังหาย → สรุป **เชื่อ counter อย่างเดียว, seed ให้ถูกตั้งแต่แรก**

---

## 6. 🔴 ความเสี่ยง `ON CONFLICT DO NOTHING` กลบ ID ซ้ำ

`createOrderInPostgres` + `addJobInPostgres` ใช้ `INSERT ... ON CONFLICT (id) DO NOTHING` ([`lib/postgres-write.ts`](lib/postgres-write.ts))

- ออกแบบไว้สำหรับ idempotent retry — แต่**ถ้า mint เลขซ้ำ** → INSERT จะ DO NOTHING เงียบๆ → route return success → **order/job หายเงียบ ไม่มี error**
- → migration ต้องเพิ่ม **post-insert read-back assertion**: หลัง INSERT แล้ว `SELECT` กลับมายืนยันว่า row นั้นเป็นของเราจริง (เทียบ name/timestamp) ถ้าไม่ใช่ = collision → throw error ดังๆ

---

## 7. ขั้นตอน Migration (มี checklist)

> **โค้ดลงครบแล้ว 2026-05-21 — commit `44006d3` (flag OFF).** Step 1-3 ✅.
> เหลือ rollout: db-migrate → seed → flip → soak (Step 0/4/5/6/7).

### Step 1 — Implement minters ✅
- [x] [`lib/id-allocation.ts`](lib/id-allocation.ts) — `mintJobId` / `mintJobIds` / `mintOrderId` (atomic `UPDATE...RETURNING`)
- [x] Unit tests — `tests/id-allocation.test.ts` (+10): mint shape · monotonic batch · order-id format `^\d{9}$` · errors. (atomicity แบบ concurrency จริงเป็น Postgres-level guarantee — verify ตอน smoke Step 4)

### Step 2 — Feature flag ✅
- [x] `allocateIdsInPostgres()` ([`lib/feature-flags.ts`](lib/feature-flags.ts)) + branch ครบ 6 routes (orders/add · promote-draft · jobs/add · forward · forward-undo · bulk-forward)

### Step 3 — Deploy flag OFF ✅
- [x] commit `44006d3` push แล้ว — Vercel auto-deploy, ไม่มีการเปลี่ยนพฤติกรรม (flag default OFF)

### Step 0 — Schema + Seed (ทำหลัง deploy เสร็จ — ช่วงคนใช้น้อย)
- [x] `counters` table — เพิ่มใน [`db-migrate/route.ts`](app/api/admin/db-migrate/route.ts) แล้ว (สร้างตอนรัน db-migrate)
- [ ] **รัน `/api/admin/db-migrate`** (admin) → สร้างตาราง `counters` ว่าง
- [ ] **รัน `/api/admin/seed-id-counters`** (admin) — seed `nextId` = `MAX(jobs∪shipped∪cancelled∪audit) + 1`. endpoint return ค่ามาให้ดู
- [ ] **เทียบ `nextIdCounter` กับ `config.nextId` ใน Google Sheet** (tab `config`) — ถ้า Sheet สูงกว่า → รันซ้ำ `/api/admin/seed-id-counters?min=<config.nextId>` (seed เป็น raise-only — รันซ้ำปลอดภัย)
- ℹ️ ไม่ต้อง seed `orderCounter_*` — `mintOrderId` self-seed ผ่าน orders-table cross-check

### Step 4 — Smoke (flag ON ใน preview / หรือ production ช่วงเงียบ)
- [ ] สร้าง order/job หลายใบ → เช็คเลขเรียง, ไม่ซ้ำ, format `YYYYMMNNN` ถูก, /track + QR เปิดถูกใบ
- [ ] ยิงสร้างพร้อมกันหลายอัน → ยืนยันไม่มีเลขซ้ำ (atomicity)

### Step 5 — Flip flag ON production (ช่วงคนใช้น้อย)
- [ ] ตั้ง `ALLOCATE_IDS_IN_POSTGRES=1` ใน Vercel → redeploy
- [ ] watch Sentry + รัน dup-ID scan (orders + jobs) ในวันแรก

### Step 6 — Soak — sync Apps Script counter (decision 2)
- [ ] sync `config.nextId` ฝั่ง Apps Script 1 สัปดาห์ เพื่อ rollback ปลอดภัย — ⚠️ **ต้อง deploy Apps Script action ใหม่** (`setConfig`-type) + เรียกผ่าน `waitUntil()`. ทางเลือกที่ง่ายกว่า: เขียน Apps Script editor helper `reseedJobCounter()` ที่ admin รันเอง*เฉพาะตอนจะ rollback* (ไม่ต้องแตะ hot path) — ตัดสินตอนถึง Step 6
- 🔒 **post-insert read-back assertion** (§6 / R5) — แนะนำเพิ่มใน `createOrderInPostgres`/`addJobInPostgres` ก่อน flip เป็น safety net กัน `ON CONFLICT DO NOTHING` กลบ collision

### Step 7 — Retire
- [ ] หลัง soak ≥1 สัปดาห์ — ลบ `getNext*` calls ออกจาก 6 routes + ลบ flag

---

## 8. ตารางความเสี่ยงทั้งหมด

| # | ความเสี่ยง | ระดับ | โอกาส | การป้องกัน |
|---|---|---|---|---|
| R1 | mint ID ซ้ำ (concurrency) → ON CONFLICT กลบ → ข้อมูลหาย / /track ผิดใบ | 🔴 Critical | ต่ำ ถ้าใช้ `UPDATE...RETURNING` ถูก | atomic UPDATE...RETURNING + concurrency test + dup-scan หลัง deploy |
| R2 | Job ID reuse เพราะ derive จาก `MAX(jobs)` | 🔴 Critical | กลาง ถ้า design มักง่าย | job counter ต้อง monotonic แท้ ห้าม MAX (§5) |
| R3 | Counter drift ตอน rollback (Apps Script counter ค้างค่าเก่า) | 🟠 High | สูง ถ้า rollback หลังมี write | sync AS counter ช่วง soak (Step 6) **หรือ** re-seed ก่อน rollback (§9) |
| R4 | เดือนของ order ID ผิด — Postgres `now()` เป็น UTC, Apps Script เป็นเวลาไทย | 🟠 High | กลาง (เฉพาะช่วงเที่ยงคืน UTC = 7 โมงเช้าไทย) | ใช้ `now() AT TIME ZONE 'Asia/Bangkok'` คำนวณ `YYYYMM` |
| R5 | `ON CONFLICT DO NOTHING` กลบ collision → order หายเงียบ | 🔴 Critical | ต่ำ (ขึ้นกับ R1) | post-insert read-back assertion (§6) |
| R6 | Seed ผิด (counter เริ่มต่ำไป) → ชนกับ ID เดิม | 🔴 Critical | กลาง ถ้า seed รีบ | seed = `GREATEST(ทุกแหล่ง)` + ยืนยันก่อน flip + ทำช่วงคนใช้น้อย |
| R7 | ย้ายไม่ครบ 6 routes → minter ปนกัน 2 ระบบ → counter แตก | 🟠 High | กลาง | ย้ายทั้ง 6 routes พร้อมกัน (ใช้ counter เดียวกัน) |
| R8 | มี Apps Script path อื่น mint ID เอง (cron/heal/admin) | 🟡 Med | ต่ำ (WP retired, heal cron ไม่ mint — เขียน row ที่มี id อยู่แล้ว) | verify ไม่มี `getNext*` caller นอก 6 routes |
| R9 | order ID ใหม่หลุด format `YYYYMMNNN` → QR/track พัง | 🟠 High | ต่ำ ถ้า design ตาม §4 | unit test format + smoke /track |
| R10 | bulk-forward `getNextIds(N)` batch ไม่ atomic | 🟠 High | ต่ำ | `UPDATE ... value + N RETURNING` ครั้งเดียว |
| — | **PIN** | ✅ ไม่มีผล | — | PIN สุ่ม ไม่แตะ |
| — | **QR เดิมที่แจกลูกค้าไปแล้ว** | ✅ ไม่มีผล | — | order ID เก่าไม่เปลี่ยน (ถ้าไม่ละเมิด R1/R9) |

---

## 9. Rollback Plan

- Flip flag OFF → 6 routes กลับไปใช้ Apps Script `getNext*`
- ⚠️ **แต่ `config.nextId` / `orderCounter_*` ฝั่ง Apps Script ตอนนี้ค้างค่าเก่า** (ต่ำกว่า Postgres) → ถ้า rollback ดื้อๆ → Apps Script จะ mint เลขที่ Postgres ใช้ไปแล้ว → **ID ซ้ำ**
- **ก่อน rollback ต้อง re-seed Apps Script counter:**
  - `config.nextId` = max job id ใน Postgres `+ 1`
  - `orderCounter_YYYYMM` = max seq ใน Postgres ของเดือนนั้น
  - (`getNextOrderId` มี Sheet cross-check ช่วยอยู่แล้ว แต่ `getNextId` ไม่มี — job counter อันตรายกว่า)
- **→ Step 6 (sync AS counter ช่วง soak) ทำให้ rollback ปลอดภัยโดยไม่ต้อง re-seed** — เป็น trade-off: จ่าย Apps Script call เพิ่ม (fire-and-forget ไม่ block) แลกกับ rollback ที่ปลอดภัย

---

## 10. Decisions — ✅ DECIDED 2026-05-21 (คุณนุ๊ก: "ตามแนะนำ")

1. ✅ **flag เดียว** (`ALLOCATE_IDS_IN_POSTGRES`) ย้ายทั้ง 6 routes พร้อมกัน — กัน R7 (counter ปนกัน)
2. ✅ **sync Apps Script counter ช่วง soak** 1 สัปดาห์แรก แล้วถอด — implement ผ่าน `waitUntil()` (Vercel) ให้รันเบื้องหลัง **ไม่ block response** → soak ไม่ทำให้ช้าลง
3. ✅ **ย้าย order+job พร้อมกัน** — ทั้งคู่อยู่ใน `orders/add` route เดียว แยกไม่ได้ประโยชน์

---

## 11. ผลลัพธ์ที่คาดหวัง

| | ก่อน | หลัง |
|---|---|---|
| ส่งใบสั่งงาน | 2-3 วิ | ~0.3-0.6 วิ |
| Apps Script ใน critical path การสร้าง order/job | มี | ไม่มี |
| PIN | สุ่ม 4 หลัก | เหมือนเดิม |
| QR / order ID format | `YYYYMMNNN` | เหมือนเดิม |

---

## 12. Remaining Apps Script coupling — ภาพรวมหลัง migration นี้

> "Drop Apps Script" ไม่ใช่สวิตช์เดียว — มันหดทีละส่วน. section นี้เป็น reference
> ตอนตัดสินใจรอบใหญ่ว่าจะเก็บ / ตัด Apps Script ที่เหลือแค่ไหน

### สิ่งที่ migration นี้ตัดออก
ID allocation (`getNextOrderId`/`getNextId`/`getNextIds`) — เป็น Apps Script **ตัวสุดท้ายใน hot path ที่ผู้ใช้ต้องรอ**

### ที่ยังเหลือหลัง migration นี้ — 3 กลุ่ม

| กลุ่ม | ใช้ Apps Script ทำอะไร | อยู่ใน latency ที่ผู้ใช้รอ? |
|---|---|---|
| **1. Sheet mirror (cron เบื้องหลัง)** | `sync-to-sheet` cron (ทุก 5 นาที) ดัน Postgres→Sheet via `setRow`-type actions · `sync-from-sheet` cron (ทุก 10 นาที) — post Phase 4.2 skip core tables แล้ว เหลือ import แค่ `audit_log` (admin Sheet-side audit) | ❌ ไม่ — รันเบื้องหลัง |
| **2. Feature ที่ยังไม่มีฝั่ง Postgres** | `/archive` search (`searchArchive` — archives เป็น Sheet tabs) · `restoreJob` (ฝั่ง Sheet ของ restore จาก /cancelled) · `quota-check` cron (`runQuotaCheck`) · **read fallback** `loadAll`/`getOrder`/`getAuditByTarget` ถ้า Postgres ล่ม | ⚠️ บางส่วน (archive search, restore) — แต่ไม่ใช่ hot path การสร้างงาน |
| **3. ระบบแยก (คนละ Apps Script project)** | **LINE Webhook** + Cloudflare Worker — คำสั่ง `/track` ทาง LINE OA · **Morning report** — กำลังย้ายมา v2 cron (`/api/cron/morning-report`), Apps Script "MorningReportV2" คิวรอลบ | ❌ ไม่ |

### หมายเหตุ legacy fallback
Apps Script write actions (`addOrder`/`addJob`/`updateJob`/`cancelJob`/`moveToShipped`/`updateOrder`/`deleteOrder`/`deleteJob`/`setCowork`/`addTemplate`/`deleteTemplate` ฯลฯ) ยังถูก **อ้างอิงในโค้ด** เป็น fallback path ที่ gate ด้วย `phase2WriteEnabled(...)`. Post-Phase-4.2 flags เปิดหมด → path พวกนี้**ไม่ทำงานจริง** เป็น dead-ish code รอลบใน phase หลัง

### 💡 จุดสำคัญ
หลังทำ ID migration เสร็จ → **Apps Script หลุดจากทุก path ที่ผู้ใช้ต้องรอ** เหลือแต่งานเบื้องหลัง (cron mirror, archive, LINE webhook, fallback) = สถานะที่ดีมากแล้ว ไม่จำเป็นต้องรีบฆ่าส่วนที่เหลือ

### ถ้าจะ "ฆ่า Apps Script ทั้งหมด" ต้องตัดสินใจเพิ่ม (= โปรเจกต์แยก)
- **ชะตากรรมของ Google Sheet** — เก็บเป็น human-readable mirror/backup (admin แก้ฉุกเฉินได้) หรือทิ้ง? ถ้าทิ้ง = ตัด `sync-to-sheet`/`sync-from-sheet` cron ทั้งคู่
- **Port `/archive`** — archives เป็น Sheet tabs โดยกำเนิด ต้องย้ายโครงสร้างมา Postgres/R2
- **Port LINE Webhook** — Apps Script project แยก ต้อง reimplement บน Vercel/Postgres
- **เอา read fallback ออก** — ถ้า Postgres ล่ม dashboard จะล่มตาม (ตอนนี้ Apps Script รับช่วง) — ต้องยอมรับ trade-off นี้

**คำแนะนำ:** ทำ ID migration ตามแผนนี้ก่อน (scoped ดี ตัด dependency ที่เจ็บสุด) — เรื่อง "เก็บ Sheet ไหม / port archive + LINE webhook" เป็น strategic decision แยกต่างหาก ไม่ต้องมัดรวม
