# Migration Plan — ลด Apps Script ลงเหลือ /archive + LINE Webhook เท่านั้น

> สถานะ: **PLANNED — เริ่ม session หน้า** · เขียน 2026-05-25 หลัง Step 7 retire ([migration-plan-id-allocation.md](migration-plan-id-allocation.md)) · ตอบคำถามคุณนุ๊ก "drop Apps Script เหลืออะไรบ้าง"
>
> เป้าหมาย: ตัด "Sheet sidecar mirror" + "Apps Script read fallback" + "legacy write handlers ทั้งหมด" ออกจากระบบในก้อนเดียว → Apps Script เหลือแค่ `searchArchive` (รอ [[migration-plan-archive-port|§13]]) + LINE Webhook (คนละ project, รอ [[migration-plan-line-webhook-port|§14]])
>
> ⚠️ **ไม่ใช่ full Apps Script shutdown** — full shutdown = §15 หลัง §13+§14 เสร็จ

---

## 1. ทำไมต้องทำ

หลัง Step 7 retire (2026-05-25) Apps Script หลุดจาก hot path แล้ว แต่ระบบยังพึ่งพา Apps Script ใน 3 จุดที่ **ไม่ได้จำเป็น**:

1. **Sheet mirror sidecar** (cron) — Sheet ไม่ได้ใช้เป็น human-readable mirror แล้ว (คุณนุ๊ก confirm 2026-05-25)
2. **Apps Script read fallback** ใน `tryPostgres()` — Neon ap-southeast-1 uptime 100% ใน 1.5 เดือนล่าสุด, ไม่เคยใช้ fallback จริง + ถ้าตัด Sheet sync → fallback อ่าน stale data อยู่ดี
3. **Legacy write handlers** ใน Apps Script + 17 else-branch ใน dashboard routes — Phase 2 flags ON หมด, dead code

ตัดทั้งหมดในก้อนเดียว = code ลดลง ~500-800 บรรทัด · dependency ลดลง 1 ระบบ · cost ไม่เพิ่ม (vs alternative Read Replica $1-7/mo)

---

## 2. สถานะปัจจุบัน — Apps Script ใช้ทำอะไรบ้าง

### ใน dashboard code (penprinting-dashboard/)

| ที่ | Action | สถานะหลัง §12 |
|---|---|---|
| `lib/api.ts:127` (loadAll) + :278 (loadOrder) + :344 (getAuditByTarget) | `tryPostgres()` → AS fallback | ❌ ลบ → Postgres-only |
| `lib/api.ts:508` (searchArchive) | AS-only (archives = sheet tabs) | ✅ คงไว้ — รอ §13 port |
| `lib/sync-to-sheet.ts` (~330 บรรทัด, 4 actions) | heal cron Postgres→Sheet | ❌ ลบทั้งไฟล์ |
| `lib/sync-from-sheet.ts` (~440 บรรทัด, 1 action) | import audit_log Sheet→Postgres | ❌ ลบทั้งไฟล์ |
| `app/api/cron/sync-to-sheet/route.ts` | cron entry | ❌ ลบ |
| `app/api/cron/sync-from-sheet/route.ts` | cron entry | ❌ ลบ |
| `app/api/cron/quota-check/route.ts` → `runQuotaCheck` | ตรวจ AS execution quota | ❌ ลบ (เหลือ AS เล็กลง, ไม่ต้อง monitor) |
| `app/api/cron/r2-backup/route.ts` → `runBackup` | export Sheet → R2 | ⚠️ **Decision**: keep + dual backup, หรือ replace ด้วย Neon snapshot (ดู §3) |
| 17 routes ที่มี `if (phase2WriteEnabled(action)) {...} else { post('<action>', ...) }` | legacy AS fallback | ❌ ลบ else-branch (Postgres-only) |
| `lib/feature-flags.ts` — `phase2WriteEnabled`, `phase2OwnsTable`, `ACTION_ENV_VAR` map, 14 `WRITE_*` flags + `PHASE2_OWNS_CORE_TABLES`/`READ_FROM_POSTGRES` | feature flag scaffolding | ❌ ลบทั้งหมด (Postgres-only) |

### ใน Apps Script (production-monitoring/apps-script/dashboard/)

| ที่ | Functions | สถานะหลัง §12 |
|---|---|---|
| `api.ts/api.js` case handlers | 17 legacy writes (addOrder, addJob, updateJob, updateOrder, cancelJob, cancelOrder, moveToShipped, bulkForward, promoteDraft, deleteOrder, deleteJob, setCowork, restoreJob, addTemplate, deleteTemplate, saveAll, dailyQuotaCheck) | ❌ ลบ case handlers ทั้งหมด |
| `api.ts/api.js` case handlers | Phase 2 heal handlers (setTemplateRow, setJobRow, setOrderRow, setShippedRow, setCancelledRow, deleteJobByIdRow) | ❌ ลบ (heal cron ตาย) |
| `api.ts/api.js` case handlers | loadAll, getOrder, getAuditByTarget (read fallbacks) | ❌ ลบ |
| `api.ts/api.js` case handlers | searchArchive | ✅ คงไว้ — รอ §13 |
| `api.ts/api.js` case handlers | runQuotaCheck, runBackup | ⚠️ ขึ้นกับ §3 decision |
| `write.ts/write.js` | 17 action handler implementations + helpers | ❌ ลบทั้งไฟล์ (~750 บรรทัด) |
| `helpers.ts/helpers.js` | stub `getNextId/getNextIds/getNextOrderId` (Step 7 workaround) | ❌ ลบ — ไม่มี caller แล้ว |
| `helpers.ts/helpers.js` | sheet I/O utilities (sheetToArray, objectToRow, findRowById, rewriteSheet, getConfig, setConfig, incrementConfig, findDuplicateOrderIds, setupOrderCounters) | ⚠️ คงไว้บางส่วน — archive.ts ใช้ sheetToArray + findRowById |
| `archive.ts/archive.js` | searchArchive impl | ✅ คงไว้ |
| `backup.ts/backup.js` + `r2.ts/r2.js` | backup impl | ⚠️ ขึ้นกับ §3 |
| `quota.ts/quota.js` + cron triggers | quota check | ❌ ลบ |

---

## 3. ⭐ Decision — r2-backup จะเอาอย่างไร?

`/api/cron/r2-backup` (weekly) เรียก Apps Script `runBackup` → export Google Sheet ทั้งหมดเป็น CSV → upload to Cloudflare R2

3 ทางเลือก:

| Option | ทำอะไร | Pros | Cons |
|---|---|---|---|
| **A. คงไว้** | `r2-backup` ยังเรียก AS, Sheet ยัง snapshot ปัจจุบัน (แม้ไม่ active sync แล้ว) | ไม่มี code work | Sheet จะ stale หลังตัด `sync-to-sheet` → backup เป็น snapshot เก่า, no value |
| **B. ลบทั้ง backup** | ใช้ Neon point-in-time recovery (PITR) แทน — Neon Launch plan keep history 7 วัน, Scale 30 วัน | ลบ ~150 บรรทัด · Neon PITR fresh กว่า | ถ้า disaster เกิน 7 วัน + ต้องการ external copy → ไม่มี |
| **C. Replace ด้วย pg_dump → R2** | เขียน cron ใหม่: Vercel function รัน `pg_dump` ผ่าน `postgres` lib → upload R2 | external copy, ไม่ขึ้นกับ Neon | code ~100-150 บรรทัด ใหม่ + Neon Connection Pool หรือ direct conn |

**Recommend: Option B** — ลบทั้ง backup. Neon PITR 7 วัน + downloadable snapshot ผ่าน Neon console ก็ได้. ถ้าอนาคตอยากได้ external copy → ทำใน §15.

(คุณนุ๊ก decide ตอน execute session หน้า — ผมจะถามอีกที)

---

## 4. ⭐ Decision — sync-from-sheet `audit_log` import

`/api/cron/sync-from-sheet` (post Phase 4.2) import แค่ `audit_log` จาก Sheet → Postgres (กรณี admin จด audit entry ตรงใน Sheet)

ถ้าตัด:
- admin จด audit ใน Sheet จะไม่ถูก import → หาย (Sheet stale)
- คุณนุ๊กเคยใช้ feature นี้จริงไหม?

**Recommend: ลบ** — assumption: คุณนุ๊กไม่จด audit ใน Sheet ด้วยมือ (ใช้ /board → action บน card แทน, มี audit log อัตโนมัติ)

(confirm ก่อน execute)

---

## 5. Design ปลายทาง

### Dashboard reads
```ts
// lib/api.ts (เดิม)
export async function loadAll() {
  const pg = await tryPostgres('loadAll', () => loadAllFromPostgres());
  if (pg) return pg;
  return await post<LoadAllResponse>('loadAll', {});  // AS fallback
}

// หลัง §12
export async function loadAll() {
  return await loadAllFromPostgres();  // throws → user sees error UI
}
```

### Dashboard writes
```ts
// 17 routes (เดิม)
if (phase2WriteEnabled('updateJob')) {
  return phase2UpdateJob(...);
}
const result = await post<...>('updateJob', { data: payload });  // AS fallback

// หลัง §12
return phase2UpdateJob(...);  // function rename อาจเปลี่ยนเป็น updateJob() แทน phase2UpdateJob()
```

### User-facing error
ถ้า Postgres error → return `503` + error UI banner:
```
⚠️ ระบบขัดข้องชั่วคราว
กำลังตรวจสอบ — กรุณารอ 30 วินาทีแล้วลองใหม่
[ลองใหม่]
```
+ Sentry breadcrumb auto-fires

### Sentry alert
ตั้ง alert rule: ถ้า issue rate (Postgres error tag) > 10 events / 5 นาที → notify คุณนุ๊กผ่าน Sentry email/Slack/LINE

---

## 6. 🪤 กับดักสำคัญ

### Trap 1 — ลำดับ deploy
ถ้าลบ Apps Script case handlers ก่อน dashboard build/deploy → dashboard ที่ยังมี fallback path เรียก AS → ได้ "Unknown action" error → user เห็น 502

**Fix**: deploy dashboard ก่อน (no more AS calls except searchArchive + maybe runBackup) → wait Vercel green → ค่อย push Apps Script ที่ลบ handlers

### Trap 2 — heal cron ที่ค้างใน flight
`sync-to-sheet` cron มี Postgres rows ที่ `phase2_dirty_at` ค้าง = waiting for heal. ถ้าลบ cron + AS handlers พร้อมกัน → rows ค้างใน Postgres ตลอดไป (cosmetic only — ไม่กระทบ read)

**Fix**: ก่อนลบ cron — รัน final heal pass + verify `SELECT COUNT(*) FROM jobs WHERE phase2_dirty_at IS NOT NULL` = 0 (+ orders/shipped/cancelled)

หลัง §12: ลบ column `phase2_dirty_at` ออกจากทุกตาราง (cleanup migration)

### Trap 3 — Quota measurement loss
ลบ `runQuotaCheck` cron = ไม่รู้ว่า AS quota ใกล้เต็มไหม. แต่ AS ตอนนี้เหลือแค่ searchArchive + LINE webhook (คนละ project) → quota ใช้น้อยมาก, ไม่ critical จนกว่า /archive volume สูง

**Fix**: เพิ่ม manual `/check-quota` slash command (มีอยู่ใน todo list) สำหรับ on-demand check

### Trap 4 — `READ_FROM_POSTGRES` flag
ถ้าเคยมี code path ที่ gate `tryPostgres()` ด้วย flag นี้ → ลบ flag ต้อง confirm ไม่มี caller ใหม่นอก lib/api.ts

---

## 7. ขั้นตอน (มี checklist)

### Step 0 — Pre-flight ✋
- [ ] **คุณนุ๊ก confirm**: ตัด r2-backup (Option B) หรือ replace ด้วย pg_dump (Option C)?
- [ ] **คุณนุ๊ก confirm**: ตัด audit_log Sheet→Postgres import (assumption: ไม่ใช้)?
- [ ] เปิด Neon → Snapshots → จดวันที่ snapshot ล่าสุด (rollback reference)
- [ ] รัน Apps Script `findDuplicateOrderIds` ครั้งสุดท้าย — confirm Sheet สะอาดก่อนทิ้ง

### Step 1 — Final heal pass ⚡
- [ ] เรียก `/api/cron/sync-to-sheet` ผ่าน Chrome MCP → confirm 200 ok + processed > 0 (clean dirty rows)
- [ ] รัน SQL ใน Neon console: `SELECT COUNT(*) FROM jobs WHERE phase2_dirty_at IS NOT NULL UNION ALL ... (orders, shipped, cancelled)` — ต้องได้ 0,0,0,0
- [ ] ถ้าไม่ 0 → wait 5 นาที + retry สอง รอบ → ถ้ายัง > 0 → investigate ก่อนเริ่ม Step 2

### Step 2 — Dashboard code changes (one PR) 📦
- [ ] **lib/api.ts** — ลบ `tryPostgres()` + AS fallback ใน loadAll/loadAllWithAudit/loadOrder/getAuditByTarget. คง searchArchive + loadAllFromAppsScriptForSync (ลบทีหลัง)
- [ ] **17 routes** (orders/cancel · orders/update · orders/delete · orders/promote-draft · orders/add · orders/templates/add · orders/templates/delete · jobs/cancel · jobs/bulk-forward · jobs/reassign · jobs/update · jobs/delete · jobs/move-to-shipped · jobs/add · jobs/forward · jobs/forward-undo · jobs/restore · jobs/cowork) — ลบ else-branch + simplify route
- [ ] **lib/feature-flags.ts** — ลบ `phase2WriteEnabled`, `phase2OwnsTable`, `ACTION_ENV_VAR` map ทั้ง 14 flags
- [ ] **lib/sync-to-sheet.ts** — ลบทั้งไฟล์
- [ ] **lib/sync-from-sheet.ts** — ลบทั้งไฟล์ (พร้อม `loadAllFromAppsScriptForSync` ใน lib/api.ts)
- [ ] **app/api/cron/sync-to-sheet/route.ts** — ลบ + vercel.json schedule
- [ ] **app/api/cron/sync-from-sheet/route.ts** — ลบ + vercel.json schedule
- [ ] **app/api/cron/quota-check/route.ts** — ลบ + vercel.json schedule
- [ ] **app/api/cron/r2-backup/route.ts** — ขึ้นกับ §3 (ลบ ถ้า Option B)
- [ ] **Postgres migration**: `ALTER TABLE jobs DROP COLUMN phase2_dirty_at; ALTER TABLE orders DROP ...; (×4 tables)` — ใน db-migrate
- [ ] **Postgres migration**: `ALTER TABLE jobs DROP COLUMN phase2_deleted_at; ...` (tombstone columns, dead หลังลบ heal)
- [ ] **User-facing error UI** — สร้าง error boundary + retry button ใน app/error.tsx + per-route error handlers ที่ส่ง 503
- [ ] **Diagnostic routes** — ลบ `/api/admin/diagnose-cowork` (ใช้ phase2WriteEnabled, dead หลังลบ flag) + `/api/admin/diagnose-audit` + `/api/admin/diagnose-order` (เช็คก่อน — อาจมี caller debug ที่ยังใช้)

### Step 3 — Type-check + tests + build 🧪
- [ ] `npm run type-check` Node 22
- [ ] `npm run lint`
- [ ] `npm test` — expect: tests ที่ test fallback path / phase2WriteEnabled mock จะแตก → ลบ/ปรับ (~10-20 tests)
- [ ] `npm run build`

### Step 4 — Sentry alert rules ⚠️
- [ ] เปิด Sentry → Alerts → New Alert Rule
  - When: issue tagged `postgres-error` ใน 5 นาที > 10 events
  - Then: send email/LINE notification ถึง คุณนุ๊ก
- [ ] Tag Postgres errors ใน `lib/postgres.ts` query wrapper — add `Sentry.setTag('postgres-error', 'true')` ใน catch

### Step 5 — Deploy dashboard 🚀
- [ ] Commit + push → Vercel auto-deploy
- [ ] **Smoke verify (Chrome MCP)** — /board · /orders · /calendar · /analytics · /track + ส่งใบสั่งทดสอบ 1 ใบ (Postgres-only path)
- [ ] Sentry ดู 30 นาที — error rate ปกติ + ไม่มี Postgres error spike
- [ ] **Vercel env vars cleanup** — ลบ 14 `WRITE_*_TO_POSTGRES` flags + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES` (no-op หลัง deploy แต่ clean)

### Step 6 — Apps Script cleanup 🪦
- [ ] **api.ts/api.js** — ลบ case handlers: 17 legacy writes + 6 heal Phase 2 (setJobRow/setOrderRow/setShippedRow/setCancelledRow/deleteJobByIdRow/setTemplateRow) + 3 reads (loadAll/getOrder/getAuditByTarget) + saveAll/dailyQuotaCheck — คงไว้ searchArchive (+ runBackup ถ้า Option A/C)
- [ ] **write.ts/write.js** — ลบทั้งไฟล์
- [ ] **helpers.ts/helpers.js** — ลบ getNextId/getNextIds/getNextOrderId stubs · ลบ findDuplicateOrderIds/setupOrderCounters/incrementConfig (no longer used)
- [ ] **quota.ts/quota.js** — ลบทั้งไฟล์
- [ ] **r2.ts/r2.js + backup.ts/backup.js** — ลบ ถ้า Option B (เก็บ ถ้า A/C)
- [ ] **auth.ts/auth.js** — ลบ ROLE_REQUIREMENTS entries ของ actions ที่ลบไปแล้ว + comment cleanup
- [ ] **Code.js** — section header comments cleanup
- [ ] **tsconfig.build.json** — verify ไม่ break ใน paths
- [ ] รัน `./push.sh` → clasp push
- [ ] Apps Script editor → Manage deployments → ✏️ Edit existing → New version

### Step 7 — Final cleanup 🧹
- [ ] **เก็บ Sheet ใน "read-only emergency reference" mode** — share permission ของ Sheet → Viewer only (กัน accidental edit ที่จะไม่ sync ไหนแล้ว). Note: Sheet จะค้างที่ snapshot ปัจจุบัน + tracker ใหม่ไม่อัปเดต
- [ ] **Document**: dashboard-v2.md version history entry + AUDIT-BACKLOG closing notes + NEXT-SESSION queue §13 (archive port)
- [ ] **Memory**: บันทึก lesson ถ้าเจอ surprise (เช่น hidden caller, fallback path ที่นึกไม่ออก)

### Step 8 — Soak ~1 สัปดาห์ 📊
- [ ] ดู Sentry daily — error rate stable
- [ ] ดู Neon console — query latency stable
- [ ] หลัง 7 วัน clean → ปิด plan + move to §13 (archive port)

---

## 8. ตารางความเสี่ยง

| # | ความเสี่ยง | ระดับ | โอกาส | การป้องกัน |
|---|---|---|---|---|
| R1 | Postgres ล่ม → dashboard ล่มทั้งหมด (no fallback) | 🟠 High | ต่ำ (Neon uptime 100% 1.5 เดือนล่าสุด) | Sentry alert + error UI + Neon support contact ready |
| R2 | Sheet stale หลังตัด cron → admin Sheet-view เห็นข้อมูลเก่า | 🟡 Med | สูง (by design) | คุณนุ๊กยืนยันไม่ใช้แล้ว + share permission → Viewer |
| R3 | ลบ Apps Script handler ที่ยังมี caller จาก downstream (LINE/morning-report) | 🟠 High | ต่ำ (audit แล้ว — ไม่มี cross-project caller) | grep ทั้ง workspace + LINE webhook + cloudflare worker ก่อน Step 6 |
| R4 | Dirty rows ค้าง = inconsistent state | 🟡 Med | ต่ำ ถ้า Step 1 (final heal) ผ่าน | block Step 2 จนกว่า `phase2_dirty_at IS NULL` ทุกแถว |
| R5 | r2-backup data loss กรณีเลือก Option B | 🟡 Med | ต่ำ-กลาง (Neon PITR ~7 วัน) | confirm กับคุณนุ๊กก่อน + เก็บ R2 snapshot สุดท้ายไว้ก่อนตัด |
| R6 | Postgres migration `DROP COLUMN` lock-time | 🟢 Low | ต่ำ (Postgres `ALTER TABLE DROP COLUMN` แทบ instant) | รันใน maintenance window (lunch break) |
| R7 | Test suite ผ่านแต่ smoke-test fail (mock vs real) | 🟡 Med | กลาง | smoke เป็น step ที่ block deploy — ทุก route + ใบทดสอบจริง |
| R8 | Sentry alert misconfigured = silent Postgres outage | 🟢 Low | ต่ำ | test alert ครั้งเดียวด้วยการ trigger fake error |

---

## 9. Rollback Plan

**ก่อน Step 5 deploy** — git revert ได้ทันที (1 commit ครอบทั้ง §12)

**หลัง Step 5 deploy + Step 6 Apps Script** — ซับซ้อนขึ้น:

1. Git revert commit ของ §12 → push → Vercel rollback
2. Apps Script: New deployment ที่ deploy version เก่า (จากประวัติ Manage deployments)
3. ⚠️ **`phase2_dirty_at`/`phase2_deleted_at` columns ลบไปแล้ว** — heal cron จะ fail ที่ INSERT phase2_dirty_at. ต้องรัน migration เพิ่ม column กลับก่อน
4. Neon restore from PITR snapshot (Step 0 จดไว้) ถ้า data corruption เกิดขึ้น

**→ ทำ Step 1 final heal + Sentry alert ครบก่อน Step 5 เพื่อให้ rollback ไม่จำเป็น**

---

## 10. Decisions — ✅ DECIDED 2026-05-25 (คุณนุ๊ก confirm)

1. ✅ **r2-backup = Option B** — ลบทั้งหมด, ใช้ Neon PITR (7 วัน on Launch plan + downloadable snapshot ผ่าน Neon console). ลบ `app/api/cron/r2-backup/route.ts` + `apps-script/dashboard/backup.ts`+`r2.ts`+ `runBackup` case handler
2. ✅ **audit_log Sheet → Postgres import = ลบ** — consistent กับ #4 (Viewer-only Sheet → ไม่มีคนจดด้วยมือได้ → import ไม่จำเป็น). audit จาก dashboard ทั้งหมดเป็น `source='postgres'` อยู่แล้ว (Phase 2). audit_log Sheet กลายเป็น frozen historical record ก่อนวันตัด
3. ✅ **R2 snapshot ก่อนตัด = เก็บ** — manual download ครั้งสุดท้ายจาก Cloudflare R2 console ก่อน Step 2 (1 GB, ฟรี). pre-flight Step 0 task
4. ✅ **Sheet permission หลัง §12 = Viewer only** — share เฉพาะคุณนุ๊ก + admin. Step 7 task

---

## 11. ผลลัพธ์ที่คาดหวัง

| | ก่อน §12 | หลัง §12 |
|---|---|---|
| Code lines (dashboard) | ~13,500 | ~12,800 (-~700) |
| Apps Script .ts/.js lines | ~3,400 | ~1,800 (-~1,600) |
| Vercel cron routes | 4 | 1 (เหลือแค่ morning-report) |
| Vercel env vars (flag) | 14 WRITE_* + 2 (PHASE2_OWNS + READ_FROM) | 0 |
| Dependency: Apps Script (dashboard project) | hot path ✅ตัด + sidecar + fallback | sidecar เท่านั้น (searchArchive + บางที r2-backup) |
| User experience | เหมือนเดิม | เหมือนเดิม + error UI ที่ดีขึ้นถ้า Postgres ล่ม |
| Postgres ล่ม → user เห็น | (ไม่เคยเกิด, fallback อ่าน Sheet stale) | 503 + retry banner |

---

## 12. หลัง §12 — งานเหลือ

- **§13 — Port `/archive`** (2-3 sessions) — design Postgres archive table (หรือ R2 + JSONindex) + migrate existing Sheet archives → ตัด `searchArchive` AS dependency
- **§14 — Port LINE Webhook** (1-2 sessions) — รับ `/track` command ผ่าน Vercel route แทน Cloudflare Worker → Apps Script Webhook → ตัด Apps Script project แยกอีกตัว
- **§15 — Full Apps Script shutdown** (1 session) — delete Apps Script project · ลบ APPS_SCRIPT_URL/APPS_SCRIPT_TOKEN env vars · revoke service account · close monitoring · ทำพิธีอำลา 🪦

---

## 13. Estimated effort §12

- Step 0-1 (pre-flight + heal): ~30 นาที
- Step 2 (code changes): ~2-3 ชั่วโมง — 17 routes + 2 lib files + cron routes + UI + migration
- Step 3-4 (verify + Sentry): ~30 นาที
- Step 5 (deploy + smoke): ~30 นาที
- Step 6 (Apps Script): ~1 ชั่วโมง
- Step 7-8 (cleanup + soak): docs ~30 นาที + 1 week watch

**Total active work**: ~5-6 ชั่วโมง = **1-2 sessions** (recommend แยก 2 session: code+deploy ใน 1, Apps Script cleanup + soak ใน 2 — ลด blast radius)
