# §13 Archive port — `/archive` ค้น Postgres ทุกปี + ตัด Apps Script client (§15 ขั้นแรก)

- **วันที่:** 2026-09-05
- **สถานะ:** approved (คุณนุ๊ก approve design 2 ส่วนใน session 2026-09-05)
- **Repo:** `penprinting-dashboard` (+ docs sweep ใน workspace / `production-monitoring`)
- **เป้าหมาย:** หน้า "ค้นข้อมูลเก่า" ค้นใบสั่งงาน**ทุกปี**จาก Postgres แทน Apps Script `searchArchive` → Apps Script หมดหน้าที่ 100% → ตัด client ออกจาก dashboard + queue user actions ปิดโปรเจกต์ (§15)

## บริบท — ข้อค้นพบที่เปลี่ยน scope (ยืนยันจากของจริง 2026-09-05, ไม่ใช่จาก doc)

- **Google Sheet ไม่มี tab `*_archive_*` เลย** — มีแค่ 8 tabs: `Sheet1, templates, audit_log, cancelled, jobs, orders, shipped, config` (เปิดดูผ่าน Chrome). `archiveOldData` ไม่เคยมีแถวอายุ ≥ 365 วันให้ย้าย (ระบบเริ่ม ~2026-04, Sheet freeze 2026-05-18)
- **`/archive` บน prod ค้น "20" ได้ 0 ผลลัพธ์** — `searchArchive` ค้นเฉพาะ sheet ชื่อมี `_archive_` (ดู [production-monitoring/apps-script/dashboard/archive.ts](../../../production-monitoring/apps-script/dashboard/archive.ts)) = หน้านี้ไม่เคยคืนอะไรตั้งแต่ port มา
- **Postgres มีประวัติครบทุกแถว** — Phase 1.5 cron mirror ทั้ง sheet (TRUNCATE+INSERT) แล้ว Phase 2 เขียนตรงตั้งแต่ 2026-05-18; ไม่มี aging ฝั่ง DB — 12-month window (`LIST_WINDOW` ใน [lib/board-delta.ts](../../lib/board-delta.ts)) เป็นแค่ฝั่ง read
- **audit_log** ใน Postgres มีแถว `source='sheet'` ย้อน 180 วันก่อน 2026-05-28 (≥ 2025-11-28) = ครอบอายุระบบทั้งหมด → ไม่มีอะไรใน Sheet ที่ Postgres ไม่มี
- ⇒ **ไม่มี "Sheet archive ให้ migrate"** — §13 ตาม [migration-plan-apps-script-shrink.md](../../migration-plan-apps-script-shrink.md) §12 ("design archive table + migrate existing Sheet archives, 2-3 sessions") ไม่ตรงความจริงแล้ว. งานจริง = เปลี่ยน data source ของหน้า + retire client (1 session)

## Decisions (pinned จากคุณนุ๊ก 2026-09-05)

| # | Decision | ค่า |
|---|---|---|
| D1 | หน้า `/archive` ค้นอะไร | **ใบสั่งงานทุกปี + สถานะ** (orders ILIKE + JOIN shipped/cancelled) — ไม่ dump ทุกตาราง, ไม่รวม audit_log (ประวัติต่อ order มีใน history tab อยู่แล้ว) |
| D2 | ขอบเขต §15 ใน pass นี้ | **ตัดโค้ด AS client ทั้งก้อน + soak 7 วัน** — ถอด env + archive deployment = คุณนุ๊ก; ลบโปรเจกต์ AS หลัง soak |
| D3 | วิธี implement search | **A) SQL `ILIKE` บนคอลัมน์จริงของ `orders` + `LEFT JOIN LATERAL` สถานะ** — ไม่ใช้ tsvector (ตัดคำไทยไม่ได้), ไม่ขยาย `/orders` เป็น "ทุกปี" (ชน M-bootstrap-orders-unbounded) |
| D4 | สิทธิ์ | **admin เท่านั้น** เหมือนเดิม (WP ROLE_REQUIREMENTS `searchArchive: ['admin']`) — role อื่น redirect `/analytics` |
| D5 | L4-year-filter | **ปิด by design** — เพิ่ม hint ใน `/shipped` + `/cancelled` ชี้ไป "ค้นข้อมูลเก่า" แทนแก้ shrink |

## 1. ชั้น query — `lib/archive-search.ts` (ไฟล์ใหม่, server-only)

### 1a. `normalizeArchiveQuery(raw: string | undefined): string | null` — pure
- `trim()` + ยุบช่องว่างซ้ำเป็นช่องเดียว
- สั้นกว่า **2 ตัวอักษร** (นับหลัง trim, code point) → `null` (หน้าแสดง hint เดิม "กรุณาใส่คำค้นอย่างน้อย 2 ตัวอักษร")
- ยาวเกิน **100 code points** → ตัดที่ 100 (กัน ILIKE O(n×m) บน input ยาวผิดปกติ — amended 2026-09-05 หลัง code review)
- คืนค่าที่ยัง**ไม่** escape — escape เกิดใน 1b (แยกความรับผิดชอบ: normalize = สิ่งที่ user เห็นใน banner, escape = สิ่งที่ส่งเข้า LIKE)

### 1b. `searchArchiveOrders(q: string, opts?: { limit?: number }): Promise<ArchiveSearchResult>`
- `limit` default **100**, clamp 1..500; ค่าไม่ใช่ตัวเลข/NaN → default (amended หลัง review)
- ไม่ configured → throw `PostgresReadError` (เหมือน reader อื่นใน [lib/api-postgres.ts](../../lib/api-postgres.ts))
- normalize `q` ในตัวเอง (เรียก `normalizeArchiveQuery`) → ถ้าได้ null คืน `{ rows: [], total: 0, truncated: false }` โดยไม่ยิง SQL — ฟังก์ชันปลอดภัยสำหรับ caller ทุกตัว ไม่พึ่ง page (amended หลัง review: เดิม `''` กลายเป็น `ILIKE '%%'` dump ทั้งตาราง)
- escape LIKE: `\` → `\\`, `%` → `\%`, `_` → `\_` แล้วห่อ `%…%`; ใช้ `ESCAPE '\'` ชัดเจนใน SQL
- **ตัวเลขล้วน** (`/^\d+$/`) → เพิ่มแขน `o.id::text LIKE '<q>%'` (prefix: พิมพ์ `2025` เจอทุก order ปี 2025, พิมพ์ `202509` เจอเดือนนี้); ตัวอักษร → ไม่มีแขนนี้ (ไม่ต้อง cast ทุกแถว)
- **1 round-trip** — total ผ่าน window function:

```sql
SELECT o.id, o.name, o.customer, o.orderer, o.date_in, o.date_due, o.price, o.status,
       s.shipped_date, c.cancelled_at, c.reason AS cancelled_reason,
       COUNT(*) OVER() AS total
FROM orders o
LEFT JOIN LATERAL (
  SELECT shipped_date FROM shipped WHERE order_id = o.id ORDER BY id DESC LIMIT 1
) s ON TRUE
LEFT JOIN LATERAL (
  SELECT cancelled_at, reason FROM cancelled WHERE order_id = o.id ORDER BY id DESC LIMIT 1
) c ON TRUE
WHERE o.name ILIKE $1 ESCAPE '\'
   OR o.customer ILIKE $1 ESCAPE '\'
   OR o.orderer ILIKE $1 ESCAPE '\'
   OR ($2::boolean AND o.id::text LIKE $3)      -- แขน id prefix เฉพาะตัวเลขล้วน
ORDER BY o.id DESC
LIMIT $4
```

- คอลัมน์ `name / customer / orderer / status / date_in / date_due / price` เป็นคอลัมน์จริงที่ write path เขียนคู่กับ `raw` อยู่แล้ว (ยืนยัน `createOrder` [lib/postgres-write.ts:506](../../lib/postgres-write.ts)) — ไม่อ่าน `raw`/`details`/`raw_data` (YAGNI: ไม่ค้นใน spec blob)
- ผลลัพธ์:

```ts
interface ArchiveOrderRow {
  id: number; name: string; customer: string; orderer: string;
  dateIn: string; dateDue: string; price: string; status: string;
  shippedDate: string | null; cancelledAt: string | null; cancelledReason: string | null;
}
interface ArchiveSearchResult { rows: ArchiveOrderRow[]; total: number; truncated: boolean }
```
- `total` = `Number(rows[0]?.total ?? 0)`; `truncated = total > rows.length`
- `shippedDate` / `cancelledAt` / `cancelledReason`: `'' → null` (`||`, ไม่ใช่ `?? null` — คอลัมน์ TEXT เก็บ `''` ได้ และ type สัญญา `string | null`, amended หลัง review)
- **ไม่ cache** (admin-only, ต่อคำค้น, traffic ต่ำ) — เหมือน `/orders` SSR path; ไม่มี `unstable_cache`/tag ให้ต้อง bust
- Perf: seq scan บน `orders` หลักพันแถว = หลัก ms (ไม่มี index ช่วย `%…%` อยู่แล้ว); growth path = `pg_trgm` GIN index บน `name/customer` ผ่าน db-migrate **โดยไม่แก้ query** — ไม่ทำใน pass นี้

### 1c. `archiveRowState(row): { kind; label; detail: string | null }` — pure
- precedence **cancelled > shipped > draft > active** (mirror [lib/track-status.ts](../../lib/track-status.ts) ที่ cancelled ชนะ shipped)
  - `cancelledAt` หรือ `status === 'cancelled'` → `{ kind: 'cancelled', label: 'ยกเลิก', detail: reason || cancelledAt }`
  - `shippedDate` หรือ `status === 'shipped'` → `{ kind: 'shipped', label: 'ส่งแล้ว', detail: shippedDate }`
  - `status === 'draft'` → `{ kind: 'draft', label: 'ร่าง', detail: null }`
  - อื่นๆ → `{ kind: 'active', label: 'กำลังทำ', detail: null }`
- `status` เทียบแบบ lowercase+trim (ค่าใน DB มาจาก Sheet ยุคแรกด้วย)

## 2. หน้า `/archive` — [app/archive/page.tsx](../../app/archive/page.tsx)

- **คงเดิม**: gate admin (D4), form GET `?q=`, states ว่าง / สั้นเกิน / ไม่พบ / error, `DashboardShell`, header "ค้นข้อมูลเก่า · admin only"
- **เปลี่ยน data source**: `searchArchive()` (AS) → `normalizeArchiveQuery()` + `searchArchiveOrders()`; error state จับ `Error.message` ตรง (ไม่มี `AppsScriptError` แล้ว — ดู §4)
- **ผลลัพธ์ = ตารางเดียว** (เลิกแยกกลุ่มตาม `_sheet` และ column dump):

| คอลัมน์ | ที่มา |
|---|---|
| id | `id` (tabular-nums) |
| ชื่องาน | `name` |
| ลูกค้า | `customer` |
| ผู้สั่ง | `orderer` |
| รับงาน / กำหนดส่ง | `dateIn` / `dateDue` (DD/MM/YYYY ตามที่เก็บ) |
| ราคา | `price` (แสดงตามที่เก็บ, `—` ถ้าว่าง) |
| สถานะ | pill จาก `archiveRowState` — สี: cancelled แดง / shipped เขียว / draft เทา / active amber + `detail` ตัวเล็กใต้ label |
| ปุ่ม | 🖨 ใบสั่งงาน → `/orders/[id]/print` · ✏️ แก้ไข → `/orders/[id]/edit` — ทั้งคู่ `loadOrder(id)` ตรง ไม่ติด window เปิด order ปีไหนก็ได้ (ยืนยัน `force-dynamic` + `loadOrderFromPostgres` by id) |

- banner: "พบ **N** รายการสำหรับ `q`" + ถ้า `truncated`: "(แสดง 100 แรก — เพิ่มคำค้นให้เจาะจงเพื่อกรองให้แคบลง)"
- footer note: "ค้นจากใบสั่งงานทั้งหมดทุกปี — ไม่จำกัด 12 เดือนเหมือน /orders · ค้น ชื่องาน / ลูกค้า / ผู้สั่ง / เลข id (ขึ้นต้น)"
- ตารางใน `overflow-x-auto` (mobile ไม่ scroll แนวนอนทั้งหน้า) — เหมือนเดิม
- `ArchiveSearchResult` type ย้ายจาก `lib/api.ts` ไป `lib/archive-search.ts`

## 3. L4 hint — `/shipped` + `/cancelled` (D5)

- **Implemented at page level** (amended 2026-09-05 ตอนเขียน plan): `/shipped` มีปุ่ม "ค้นหาในประวัติ" → `/archive` อยู่แล้วที่ [app/shipped/page.tsx](../../app/shipped/page.tsx) (แสดงทุก role ทั้งที่ `/archive` admin-only) → ใช้จุดนั้นแทน `FilterForm` ฝั่ง client: ไม่ต้อง thread `role` ลง `ShippedListClient`
  - admin: ปุ่ม "ค้นข้อมูลเก่า" (ลิงก์) + ข้อความ "หน้านี้แสดงรายการ 12 เดือนล่าสุด — เก่ากว่านั้นค้นได้ที่ ค้นข้อมูลเก่า"
  - role อื่น: ข้อความเดียวกัน + "(admin)" ไม่มีปุ่ม (กันคลิกแล้วโดน redirect งง)
- `/cancelled` เป็น admin-only อยู่แล้ว (page redirect role อื่น) → block เดียวกันแบบมีปุ่มเสมอ (เพิ่ม `Link` + `IconFolder` import)
- ปิด **L4-year-filter-shrinks-at-backfill-ageout** ใน AUDIT-BACKLOG: dropdown ปีจะเหลือ ~12 เดือนเมื่อ backfill age out (2027-05-18) **โดยมีคำอธิบาย+ทางไป** = ตรง intent ของ windowing design; ไม่แก้ shrink

## 4. ตัด Apps Script client — [lib/api.ts](../../lib/api.ts)

- **ลบ**: `getApiBase` · `currentActor` · `post` · `searchArchive` · `ArchiveSearchResult` · class `AppsScriptError` (+ `export { AppsScriptError }`) · header comment ที่บอกว่า "narrowly used post-§12 by /archive"
- **คงไว้ ไม่แตะ**: `LOAD_ALL_TAG` · `loadAll` / `loadAllWithAudit` / `loadAllSnapshot` / `withDefaults` · `loadRecentOrdersSlim` · `loadOrderFormTemplates` · `loadOrderAndJobs` · `loadOrder` · `getAuditByTarget` · types `LoadOrderResponse` / `AuditEntry` / `RecentOrderSlim`
- **Mechanical sweep `instanceof AppsScriptError`** (8 ไฟล์) — ทุกจุดมี fallback `err instanceof Error ? err.message : String(err)` อยู่แล้ว → ตัดแขน AS ทิ้ง พฤติกรรม user เท่าเดิม:
  - `app/archive/page.tsx` · `app/analytics/page.tsx` (2 จุด) · `app/orders/[id]/{print,edit,tracking-card}/page.tsx` · `app/api/track/lookup/route.ts` · `app/api/orders/raw/[id]/route.ts` · `app/api/audit/route.ts`
  - `app/api/audit/route.ts:47` ใช้ `AppsScriptError` → 502 — เปลี่ยนเป็น `PostgresReadError` → **503** (Postgres ล่ม = service unavailable ตาม intent §12), error อื่น 500 เหมือนเดิม. Consumer เดียว [components/history-tab.tsx:110](../../components/history-tab.tsx) เช็คแค่ `res.ok` + แสดง `json.error` → status code ที่เปลี่ยนไม่กระทบ UI
- `app/analytics/page.tsx:414-415` error hint "ตรวจ env APPS_SCRIPT_URL/TOKEN" → เปลี่ยนเป็น `POSTGRES_URL` (ข้อความเดิมชี้ผิดตัวอยู่แล้วหลัง §12)
- `app/api/cron/morning-report/route.ts:25` comment เอ่ยถึง APPS_SCRIPT env → ลบบรรทัด
- **Invariant หลัง sweep**: `grep -rn APPS_SCRIPT app lib components` = **0** → build + runtime ไม่ต้องพึ่ง env 2 ตัว (คุณนุ๊กถอดได้ทันทีหลัง deploy)
- ไม่ลบ `.env`/env docs ฝั่ง Vercel เอง (user action §7)

## 5. Docs sweep (lesson [[roadmap-doc-drift]]: retire แล้วต้องกวาดทุก doc ที่ list ของ live)

| ไฟล์ | แก้อะไร |
|---|---|
| `penprinting-dashboard/CLAUDE.md` | Env vars: ลบ `APPS_SCRIPT_URL`/`APPS_SCRIPT_TOKEN` · Routes: `/archive` = "Search all orders (Postgres, ทุกปี)" · Auth: ลบบรรทัด service token · Roadmap: §13 ✅ |
| `dashboard-v2.md` | "Backend connection: Apps Script Web App" → Postgres-only · route table `/archive` · version history entry ใหม่ · lessons: "roadmap §13 drift — no archive tabs existed" |
| `migration-plan-apps-script-shrink.md` | §12 งานเหลือ: §13 ✅ (ข้อค้นพบ) · §14 ✅ (decommissioned 8/20 อยู่แล้ว) · §15 = user actions + soak (ดู §7) |
| `AUDIT-BACKLOG.md` | L4 → ✅ closed (by design, commit hash) + header "Open: 0" |
| `NEXT-SESSION.md` | session entry + pending user actions §7 |
| workspace `CLAUDE.md` | section "Apps Script — สถานะจริง": Dashboard AS = **หมดหน้าที่ 2026-09-05** (รอ soak → ลบ) · deploy-routing row `google-apps-script.js` → 🪦 · `/check-quota` note |
| `production-monitoring/monitoring.md` | header สถานะ backend: dashboard AS หมดหน้าที่ + วันลบตามหลัง soak |
| `Tech-Roadmap-Status.md` | Phase 4.3 / §13-§15 status |
| `.claude/commands/check-quota.md` (workspace) | note ว่า AS ไม่มี consumer แล้ว (ถ้ายังอ้าง searchArchive) |

## 6. Verification (convention repo นี้ — TDD RED-first + vitest ผ่าน `tests/helpers/mock-postgres`)

`tests/archive-search.test.ts` (ไฟล์ใหม่):
- **normalize**: `undefined`/`''`/`' a '` → `null` · `'  ใบปลิว   ซุปเปอร์ '` → `'ใบปลิว ซุปเปอร์'` · 2 ตัวพอดีผ่าน
- **escape**: q ที่มี `%` / `_` / `\` → param ถูก escape (`\%`, `\_`, `\\`) และ SQL มี `ESCAPE`
- **แขน id prefix**: `'2025'` → param boolean `true` + `'2025%'` · `'ซุปเปอร์'` → `false` · `'20 25'` (มีช่องว่าง) → `false`
- **1 round-trip**: `sqlCalls.length === 1`; `LIMIT` ส่งเป็น param = 100 default / clamp 500
- **mapping**: rows จาก mock (มี `total: '3'` string จาก pg) → `total = 3`, `truncated` true เมื่อ total > rows.length, false เมื่อเท่ากัน · null shipped/cancelled → `null` ไม่ใช่ `undefined`
- **not configured** → rejects `PostgresReadError`
- **`archiveRowState`**: 4 เคส precedence (cancelled ชนะแม้มี shippedDate · shipped · draft (`'Draft '` ก็เจอ) · active) + detail = reason ก่อน cancelledAt
- หลัง sweep §4: `npm run type-check` + `npm run build` เขียว · `grep -rn APPS_SCRIPT app lib components` = 0 · tests เดิม 635 → 635+N ไม่มีตัวแดง (เช็ค exit code ตรง ไม่ผ่าน `| grep` ตาม [[pipeline-grep-masks-exit-code]])
- ไม่มี test ระดับ page (SSR component) — smoke prod แทน (§7)

## 7. Rollout + user actions

1. **Claude**: commit ละก้อน (search lib+tests → page → L4 hint → AS client sweep → docs) → push → post-deploy smoke เขียว **pin headSha** ([[ci-wait-pin-headsha]])
2. **Claude smoke prod** (Chrome session admin): `/archive?q=<ลูกค้าเก่าที่รู้ว่ามี>` เจอแถว + pill ถูก · `?q=2025` เจอตาม id prefix · `?q=%` ไม่ระเบิด/ไม่คืนทั้งตาราง · ปุ่ม print เปิด order เก่าได้ · role non-admin → redirect `/analytics` · `/shipped` เห็น hint
3. **คุณนุ๊ก**: Vercel → Settings → Environment Variables → ลบ `APPS_SCRIPT_URL` + `APPS_SCRIPT_TOKEN` (ทั้ง Production/Preview/Development) → **Redeploy** → Claude verify build เขียว + `/archive` ยังค้นได้ (positive control ว่า runtime ไม่แตะ env นี้แล้ว)
4. **คุณนุ๊ก**: Apps Script editor (scriptId จาก `production-monitoring/apps-script/dashboard/.clasp.json`) → Deploy → Manage deployments → **Archive** deployment ของ dashboard web app · Triggers → ลบ `archiveOldData` ถ้ามี · **ไม่ลบโปรเจกต์** (rollback path ระหว่าง soak)
5. **soak 7 วัน** (ถึง ~2026-09-12): ไม่มี Sentry error จาก `/archive` / print / edit ของ order เก่า → **คุณนุ๊กลบโปรเจกต์ Apps Script** = §15 จบ · Google Sheet คงเป็น frozen historical archive ตลอดไป (Viewer-only เหมือนเดิม) · source ใน `production-monitoring/apps-script/dashboard/` เก็บเป็น reference
6. Docs หลัง soak: workspace CLAUDE.md + monitoring.md ติ๊ก "ลบแล้ว" + วันที่

## 8. ไม่อยู่ใน scope (ตัดสินใจแล้ว)

- ค้นใน `details` / `rawData` (spec blob) — ถ้าต้องการค่อยเพิ่มแขน `raw::text ILIKE` + pg_trgm
- ค้น audit_log จากหน้านี้ (D1) — มี history tab ต่อ order
- filter ปี/เดือน/สถานะบน `/archive` — id prefix ครอบเคสปี/เดือนแล้ว
- แก้ shrink ของ year dropdown (L4) — ปิด by design (D5)
- ลบ source Apps Script ใน `production-monitoring/` — เก็บเป็น reference เหมือน LINE-webhook ที่ decommission 8/20
- Import Sheet ใดๆ เข้า Postgres — ไม่มีข้อมูลที่ Postgres ไม่มี

## Rollback

- **โค้ด**: revert commit ของ pass นี้ → `/archive` กลับไปเรียก AS (ต้องมี env 2 ตัว + deployment AS ยัง active) — เหตุผลที่ user actions §7.3-7.4 ทำ**หลัง** smoke เขียว และไม่ลบโปรเจกต์จนพ้น soak
- **Apps Script**: ระหว่าง soak = un-archive deployment (Manage deployments) + ใส่ env กลับ; หลังลบโปรเจกต์ = redeploy จาก source ~30-60 นาที (pattern เดียวกับ [RUNBOOK-decommission-line-worker.md](../../../production-monitoring/RUNBOOK-decommission-line-worker.md))
- หน้าใหม่ไม่เขียน DB — ไม่มี data rollback
