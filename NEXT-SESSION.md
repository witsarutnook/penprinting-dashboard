# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [dashboard-v2.md](dashboard-v2.md) + [PATTERNS.md](PATTERNS.md) + [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) + [migration-plan-apps-script-shrink.md](migration-plan-apps-script-shrink.md) ก่อนเริ่ม**
>
> **Session 2026-05-28 — §12 Step 6 Apps Script cleanup + Step B `<AutoSync />` consolidate:** ✅ deployed dashboard, ⏳ AS clasp pushed (รอ user deploy "Edit existing → New version")
>
> ## งานที่ทำ
> - **§12 Step 6 — Apps Script cleanup (production-monitoring/apps-script/dashboard/)** — ลบ dead handlers + dead modules หลัง §12 Step 1-5 ตัด AS path ทั้งหมด:
>   - **api.ts (-50% LOC, 8.6K → 4.2K)** — เหลือแค่ `searchArchive` case ใน doPost; ลบ 25 handlers (17 write + 6 heal Phase 2 + 3 read + `saveAll`/`runQuotaCheck`/`runBackup`/`getQuotaStats`). ลบ `bumpUsage_()` calls (quota.ts ถูกลบ). doGet stub-return `Action retired (§12 Postgres-only): <action>` ถ้ามี stale frontend เรียก. inline `jsonResponse` helper (เพราะ helpers.ts ถูกลบ)
>   - **auth.ts trim** — `ROLE_REQUIREMENTS` เหลือแค่ `searchArchive: ['admin']` (ลบ 9 admin + 6 sales actions ที่ retire ไปแล้ว)
>   - **7 modules ถูกลบทั้งไฟล์** — `write.ts/.js` (~30K, 17 write handlers + heal helpers) · `quota.ts/.js` (~10K, dailyQuotaCheck/sendQuotaReport_/bumpUsage_/getQuotaStats) · `backup.ts/.js` (~5K, backupSheet + Drive folder triggers) · `r2.ts/.js` (~7K, r2BackupWeekly + S3 client) · `load.ts/.js` (~12K, loadAll/loadOrder/getAuditByTarget) · `templates.ts/.js` (~4K, addTemplate/deleteTemplate/setTemplateRow) · `helpers.ts/.js` (~10K, sheetToArray/findRowById/objectToRow/getConfig/getNextId stubs/findDuplicateOrderIds/setupOrderCounters — all dead after upstream callers gone)
>   - **คงไว้:** `setup.ts/.js` (ops tool — `generateServiceToken` regen ทุก 5 ปี + `setupSheets` bootstrap) · `archive.ts/.js` (searchArchive + auto-archive trigger ยังจำเป็น) · `audit.ts/.js` (appendAudit ยัง log searchArchive) · `Code.js` (sheet IDs/headers + comment block trim)
>   - **Code.js** — ลบ comment block ที่อ้างไฟล์ที่ลบไป + เขียน "post §12 module map" สั้น ๆ (70 → was 93 lines)
>   - **clasp push -f** สำเร็จ 9 files (was 16). Gates: `npx tsc -p tsconfig.build.json` ✅ no errors. **คุณนุ๊กต้อง deploy "Edit existing → New version" ที่ Apps Script editor**
> - **Step B — `<AutoSync />` consolidate** ([3 files, -1+8 lines]) — ลบ `<AutoSync />` JSX + import จาก [`app/board/page.tsx`](app/board/page.tsx) (legacy OFF path) · [`app/orders/page.tsx`](app/orders/page.tsx) · [`app/calendar/page.tsx`](app/calendar/page.tsx). 3 หน้านี้ delta-fetch path live ตั้งแต่ 5/21-22 → `<AutoSync />` redundant ตอนที่ flag ON (production state). คง `useAutoSync` hook + `<AutoSync />` ที่ /analytics /cancelled /shipped (ไม่มี delta-fetch). `broadcastWrite` helper ยังอยู่ใน lib/auto-sync.tsx (ใช้ทั่วระบบ). docstring `BoardDataDelta` ลบ comment เก่าที่อ้าง `<AutoSync>` ใน flag-OFF path
> - **Gates Node 22 (penprinting-dashboard)** — type-check ✅ · lint ✅ · vitest **120 passed** · next build ✅
>
> ## ⏳ Pending user actions
> 1. **Apps Script deploy** — เปิด Apps Script editor (project "penprinting dashboard data") → Deploy → Manage deployments → **Edit existing → New version** → publish. URL ของ deployment คงเดิม. หลัง deploy ตรวจ: /archive search ยังใช้งานได้ (เรียก `searchArchive` ผ่าน doPost)
> 2. **Smoke verify Apps Script** หลัง deploy — /archive search ใช้งานได้ + Sentry monitor 30 นาที (no spike)
> 3. **(ค้างจากเซสชั่นก่อน) Vercel env vars cleanup** — ลบ 14 `WRITE_*_TO_POSTGRES` + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES`
> 4. **(ค้างจากเซสชั่นก่อน) Sentry alert rule** — `postgres-error=true` > 10/5min → notify
> 5. **(ค้างจากเซสชั่นก่อน) Test /track ใบ `#202605173`** — verify step 5 "สินค้าพร้อมรับ" active
> 6. **(Optional) Incognito test /board** — verify Dashlane extension theory
>
> ## 🎯 งานหลัก session หน้า
> 1. **Wholesale-strangler finish — ลบ legacy flag-OFF paths**: `NEXT_PUBLIC_DELTA_FETCH` (board) + `NEXT_PUBLIC_DELTA_FETCH_LIST` (orders/calendar) ON ใน prod ตั้งแต่ 5/21-22 = ครบ 1 wk แล้ว. ตาม [[feedback_wholesale_strangler_finish]]: delete ALL fallback paths in 1 commit (blast radius linear). Scope: ลบ `if (process.env.NEXT_PUBLIC_DELTA_FETCH... === '1') { ... }` branch จาก 3 pages + ลบ `BoardData`/`OrdersData`/`CalendarData` legacy components + ลบ env vars ออกจาก Vercel + ลบ `loadAll`/`computeBoard`/`computeCalendar`/`computeOrdersList` server-side callers (if dead). Effort ~1-1.5 ชม.
> 2. **B consolidate continue (optional)** — ตอนนี้ Step B ทำแค่ ลบ `<AutoSync />` จาก 3 pages. `useAutoSync` hook + `<AutoSync />` ยังใช้ที่ /analytics /cancelled /shipped. ถ้าอยาก consolidate ครบ: เพิ่ม `useDeltaSync` ให้ /cancelled /shipped (โหลด jobs+orders+cancelled+shipped) → ลบ `useAutoSync` ทั้งหมด. /analytics ใช้ 60s ISR — ไม่ต้อง delta. ทำพร้อม #1 ได้ (related cleanup)
> 3. **AI Quoting Phase 0** (deferred 5 sessions) — spec/scaffold
> 4. **`/check-quota` skill** — manual Apps Script + CF Worker quota check (value น้อยลงมาก หลัง §12 Step 6 — quota loss = acceptable, planned)
> 5. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL
> 6. **Hydration warnings /board** — รอ user incognito test
>
> ### Decisions / Lessons
> - **setup.ts ≠ dead code**: ตอน scope plan setup.ts ดูเหมือนเป็นไฟล์ retire-able (อยู่ในกลุ่ม "post-§12 cleanup") แต่จริงๆ มี `generateServiceToken` (run ทุก 5 ปี ตอน rotate APPS_SCRIPT_TOKEN) + `setupSheets` (first-time bootstrap). ลบ = footgun สำหรับ future ops. **Rule of thumb**: ถ้า function รัน manually จาก Apps Script editor (ไม่ใช่ดูแลโดย dashboard) → ตรวจก่อนว่าเป็น admin tool หรือ truly-dead. Common admin tools: token mint, schema migrate, one-time data fix, manual scan/repair
> - **helpers.ts plan was wrong — fully dead after upstream callers gone**: NEXT-SESSION เก่าระบุ "คง sheetToArray + findRowById" แต่ grep callers พบว่า callers อยู่ใน load.ts/templates.ts/write.ts ทั้งหมด (ลบไปแล้ว). archive.ts/audit.ts ใช้ raw `getValues()` ไม่พึ่ง helpers. **Always verify caller graph ก่อน trim** — plan ใน roadmap อาจเก่าหรือ assumption ผิด ([[feedback_audit_backlog_hypothesis]])
> - **clasp push ≠ deploy** ([[feedback_diagnostic_gs_clasp_push]]): push อัพ source ไป Apps Script editor; deployment URL ผูกกับ "Manage deployments → Edit existing → New version". URL คงเดิม = LINE webhook + frontend ยังเรียกได้. **อย่ากด "New deployment"** = URL เปลี่ยน = ระบบพังเงียบ
> - **`bumpUsage_` lived in quota.ts** — quota.ts ถูกลบ → api.ts calls `bumpUsage_()` กลายเป็น ReferenceError. ก่อนลบ module ใหญ่ ๆ grep cross-file usage ของ helpers internal เสมอ
> - **Step B minimal vs wholesale**: user เลือก minimal ("ลบเฉพาะ 3 pages") = ลบแค่ `<AutoSync />` ใน flag-OFF branch ที่ effectively dead. ไม่ลบ branch ทั้งก้อน = leaves legacy path partially-working (no auto-refresh). มี wholesale opportunity ค้างใน #1 ของ "งานหลัก session หน้า"
>
> **Commits:** TBD — Step B in penprinting-dashboard repo · Step 6 lives in production-monitoring/ (not git-tracked, deployed via clasp)
>
> ---
>
> **Session 2026-05-27 — §12 Apps Script shrink (Step 1-5) + /track shipping-queue fix + board cleanup:** ✅ deployed
>
> ## งานที่ทำ
> - **/track step 5 active fix** ([commit `0cb98c3`](https://github.com/witsarutnook/penprinting-dashboard/commit/0cb98c3)) — ใบสั่งงานที่ `staff='ship'` (อยู่คิวรอจัดส่ง) เคยค้าง active ที่ step 4 "ขั้นตอนหลังพิมพ์" เพราะ `/api/track/lookup` ส่งแค่ `currentDept='post'` ไม่แยก sub-state ของ ship-staff. เพิ่ม flag `awaitingShipment` ใน response + client shift step 4=done, step 5=current. ชื่อ "สินค้าพร้อมรับ / Ready for pick up" คงเดิม (คุณนุ๊ก confirm). statusLabel badge ก็ override เป็น "สินค้าพร้อมรับ" ให้ตรงกับ active step
> - **§12 Apps Script shrink Step 1-5** ([commit `745d36f`](https://github.com/witsarutnook/penprinting-dashboard/commit/745d36f), -4,968 LOC across 47 files) — Postgres-only, ไม่มี Apps Script fallback อีกแล้ว:
>   - **lib/api.ts**: ลบ `tryPostgres()` + AS fallback ใน loadAll/loadAllWithAudit/loadOrder/getAuditByTarget. ลบ loadAllFresh/loadAllFromAppsScriptForSync/getQuotaStats (no caller after §12). คง AppsScriptError + post() + searchArchive (ใช้ /archive จน §13). loadOrderAndJobs เป็น Postgres-direct
>   - **17 write routes**: ลบ `if (phase2WriteEnabled(...)) ... else { post(...) }` ทั้งหมด (jobs/{add,update,delete,cancel,move-to-shipped,reassign,cowork,bulk-forward,forward,forward-undo,restore} + orders/{add,update,cancel,promote-draft,templates/add,templates/delete}). jobs/add idempotency check migrated จาก `loadAllFresh()` → direct SQL
>   - **Dead code deleted**: lib/feature-flags.ts (phase2WriteEnabled + 14 WRITE_* flags + phase2OwnsTable) · lib/sync-to-sheet.ts + lib/sync-from-sheet.ts (~770 LOC heal cron) · 4 cron routes (sync-to-sheet/sync-from-sheet/quota-check/r2-backup) · 9 admin diagnose/import routes + 2 bench-audit endpoints (board/postgres + audit/postgres) · app/admin/bench-audit/ dir · app/analytics/quota-widget.tsx · app/api/orders/delete (dead, no frontend caller) · 2 test files
>   - **Added**: app/error.tsx — Postgres-outage friendly UI with retry button. Tags Sentry events `postgres-error=true` when error message matches Postgres signature
>   - **vercel.json**: 5 crons → 1 (morning-report only)
> - **chore(board)** ([latest commit](https://github.com/witsarutnook/penprinting-dashboard)) — ลบ `generatedAt: new Date().toISOString()` จาก computeBoard. unused impure side effect ใน pure compute function — ไม่ใช่ root cause ของ hydration warning แต่ลบเพื่อ eliminate 1 variable ตอน investigate ครั้งหน้า
> - **Smoke verified production** ผ่าน Chrome MCP — /board (KPI + cards), /orders (252 ใบ), /calendar (61 รายการ), /analytics (179 ใบ/89.4% success), /track (lookup form) — Postgres-only path ทำงานปกติ
> - **Diagnose hydration warnings /board** (React #422 + #425) — invoked `/diagnose` skill. **Pre-existing** since `6412d5b` (5/21 BoardClient delta-fetch), ไม่ใช่จาก §12. Math.proof ว่า getBangkokToday() TZ-stable. Hypothesis #3 (Dashlane extension injecting DOM `fiikommddbeccaoicoejoniammnalkfa`) plausible แต่ไม่ confirmed. UI works (React #422 = "recovered by client-rendering"). **Not blocking — defer to incognito test**
>
> ## ⏳ Pending user actions
> 1. **Smoke verify production จริง** (~2-3 นาที หลัง deploy auto) — สร้าง order ใหม่ 1 ใบ + cancel/delete/forward 1 job → ดูทำงานปกติ + Sentry monitor 30 นาที (error rate ไม่ spike)
> 2. **Vercel env vars cleanup** (no-op now): ลบ 14 `WRITE_*_TO_POSTGRES` + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES`. dead flags ทั้งหมด — ปลอดภัย
> 3. **Sentry alert rule**: สร้าง alert: tag `postgres-error=true` > 10 events/5min → notify (Sentry UI)
> 4. **Test /track ใบ `#202605173`** — verify ว่าตอนนี้ step 5 "สินค้าพร้อมรับ" active แทน step 4 (ที่คุณนุ๊กเห็น bug ตอนเช้า)
> 5. **(Optional) Incognito test /board** — เปิด chrome incognito → login → /board → ดูว่า hydration warnings หาย? ถ้าหาย = Dashlane extension เป็นต้นเหตุ. ถ้ายังอยู่ = need source maps debug
>
> ## 🎯 งานหลัก session หน้า
> 1. **⭐ §12 Step 6 — Apps Script cleanup** (~1 ชม.) — ลบ dead handlers ใน Apps Script project. ก่อนหน้านี้เลื่อนเพราะ blast radius. ตอนนี้ dashboard ไม่เรียก AS ยกเว้น searchArchive → safe to clean:
>    - `api.ts/api.js`: ลบ 17 legacy write case handlers + 6 heal Phase 2 handlers (setJobRow/setOrderRow/setShippedRow/setCancelledRow/deleteJobByIdRow/setTemplateRow) + 3 read handlers (loadAll/getOrder/getAuditByTarget) + saveAll/dailyQuotaCheck/getQuotaStats. **คงไว้**: searchArchive
>    - `write.ts/write.js`: ลบทั้งไฟล์ (~750 LOC) — รวม legacy `addOrder/addJob/bulkForward/createOrder` ที่ยังมี internal `getNext*` stubs
>    - `helpers.ts/helpers.js`: ลบ getNextId/getNextIds/getNextOrderId stubs (no caller after write.ts ตาย) + ลบ findDuplicateOrderIds/setupOrderCounters/incrementConfig. คง sheetToArray + findRowById (archive.ts ใช้)
>    - `quota.ts/quota.js + backup.ts/backup.js + r2.ts/r2.js`: ลบทั้งหมด (Option B locked — Neon PITR)
>    - `auth.ts/auth.js`: ลบ ROLE_REQUIREMENTS entries ของ actions ที่ลบไป
>    - clasp push → คุณนุ๊ก deploy "Edit existing → New version"
> 2. **§12 Step 2F deferred — DB migration DROP COLUMN** (optional, low priority):
>    - **phase2_dirty_at**: column ค้าง dirty_at=NOW() ตลอดไป (ไม่มี heal cron มาเคลียร์). Cosmetic. Safe ลบได้ — แต่ต้อง refactor ทุก `SET phase2_dirty_at = NOW()` ใน lib/postgres-write.ts (20+ instances) ก่อน DROP
>    - **phase2_deleted_at**: ใช้เป็น soft-delete tombstone ใน SELECTs (`WHERE phase2_deleted_at IS NULL`). ถ้าจะลบต้อง refactor moveToShipped/cancelJob/deleteJob ให้ hard-DELETE jobs row แทน. Bigger refactor — ทำเมื่อทำ tombstone cleanup phase
> 3. **§12 Step 4 — Sentry alert rules** — set ผ่าน Sentry UI (Pending #3 ด้านบน)
> 4. **Hydration warnings /board investigate** — รอ user incognito test ก่อน
> 5. **B consolidate (`useAutoSync` ↔ `useDeltaSync`)** — soak ≥2 wk ตั้งแต่ 5/22 (delta-fetch-list live) — ครบ ~6/5 ก็เริ่มได้ (ลบ useAutoSync แทน consolidate, ง่ายกว่า)
> 6. **AI Quoting Phase 0** (deferred 4 sessions) — spec/scaffold
> 7. **`/check-quota` skill** — manual Apps Script + CF Worker quota check (value ลดลงหลัง §12 Step 6)
> 8. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL
>
> ### Decisions / Lessons
> - **§12 = wholesale rewrite > incremental migration**: ลบ AS fallback paths ทั้ง 17 routes พร้อมกันใน 1 commit สะอาดกว่าทยอย — incremental จะมีหลาย commit ที่ partial state (some routes Postgres-only, some hybrid) + แต่ละ commit ต้องเขียน docstring/test/audit งง. Locked plan ก่อน execute (4 decisions §10 confirmed) ทำให้ ship ครั้งเดียวจบ
> - **Defer DB migration scope (Step 2F)** ดีกว่า bundle ใน §12: phase2_deleted_at ใช้ใน SELECT gating — DROP COLUMN ต้อง refactor 6+ helpers (moveToShipped/cancelJob/deleteJob/etc). bundle = blast radius เพิ่ม 2× โดยไม่จำเป็น. Cosmetic-only column ใช้พื้นที่ disk เล็กน้อย ปล่อยได้
> - **Smoke verify ผ่าน Chrome MCP (incognito ไม่ได้)** — Chrome MCP เป็น user's logged-in browser. ถ้าจะทดสอบ extension impact ต้อง user manually open incognito + verify เอง
> - **Hydration warning ไม่ได้ block ship** — React #422 = "recovered by client-rendering". UI render ปกติ + ไม่มี user impact. Defer ไป next session ดีกว่าหา smoking gun ตอนนี้ (ไม่มี source map → time-bounded)
>
> **Commits:** [`0cb98c3`](https://github.com/witsarutnook/penprinting-dashboard/commit/0cb98c3) (track fix) · [`745d36f`](https://github.com/witsarutnook/penprinting-dashboard/commit/745d36f) (§12 Postgres-only -4,968 LOC) · `3da9266` (generatedAt cleanup)
>
> ---
>
> **Session 2026-05-25 — ID-allocation Step 7 retire + Neon transfer-rate check guide:** ✅ deployed
>
> ## งานที่ทำ
> - **Step 7 retire** ([migration-plan-id-allocation.md §7](migration-plan-id-allocation.md)) — soak จริง 4 วัน (เร็วกว่า plan 3 วัน) เพราะคุณนุ๊กตัดสินใจ "ทำทั้งหมดตอนนี้ deploy ทันที" หลัง audit แล้วไม่มี Sentry / ID collision ใน window
>   - **Dashboard (6 routes + lib)** — ลบ `if (allocateIdsInPostgres()) … else { post('getNext*') }` → keep Postgres-only mint. ลบ `allocateIdsInPostgres()` + comment block จาก [`lib/feature-flags.ts`](lib/feature-flags.ts). clean docstring ของ [`/api/admin/seed-id-counters`](app/api/admin/seed-id-counters/route.ts) + [`/api/admin/db-migrate`](app/api/admin/db-migrate/route.ts) (ลบการอ้างอิง flag)
>   - **Apps Script** — ลบ 3 case handlers (`getNextId`/`getNextIds`/`getNextOrderId`) จาก `api.ts`/`api.js` + 3 action exemptions ใน audit-log gate + function definitions จาก `helpers.ts`/`helpers.js` + clean comment ใน `auth.ts`/`auth.js`/`Code.js`
>   - **Gates Node 22:** type-check ✅ · lint ✅ · vitest **139 passed** · next build ✅
>   - **ระวัง — known live wart:** Apps Script `write.ts`/`write.js` ยังมี internal call `getNextId`/`getNextIds`/`getNextOrderId` ใน legacy `addOrder`/`addJob`/`bulkForward`/`createOrder` action handlers. แก้ tsc compile ด้วย **stub 3 helpers ที่ throw** "Apps Script ID allocation retired 2026-05-25 — Vercel routes mint via Postgres counters table" → dead handlers จะ fail ดังๆ ถ้าถูก call (ดีกว่า `ReferenceError`). รอลบ handlers จริงกับ Apps Script write-retire phase ตามแผน §12
> - **Neon transfer rate guide** — เขียน checklist ขั้นตอนเปิด console.neon.tech → project → Monitoring → Data Transfer → กราฟรายวัน เทียบ baseline 0.7 GB/วัน (ก่อน optimize) · 0.35-0.4 (post P3 21 พ.ค.) · คาด <0.3 หลัง delta-list (22 พ.ค. ON). บันทึกผลใน NEXT-SESSION เมื่อคุณนุ๊กดูเสร็จ
>
> ## ⏳ Pending user actions
> 1. ~~**Push + deploy Apps Script**~~ ✅ source pushed 11:33 (Claude clasp), version ใหม่ deployed โดยคุณนุ๊ก (Edit existing — URL คงเดิม)
> 2. ~~**ลบ env var `ALLOCATE_IDS_IN_POSTGRES`**~~ ✅ ลบจาก Vercel แล้ว — Step 7 retire LIVE ครบทั้งระบบ
> 3. ~~**Smoke-verify**~~ ✅ ทดสอบสร้างใบสั่งงานจริง: order `#202605171` (ต่อจาก `#202605145`@5/21 monotonic) · job `#820` (ต่อจาก `#740`@5/21) · PIN random `6762` · UI render ปกติ — **Postgres-mint สมบูรณ์ 100%**
> 3. ~~**Neon transfer-rate check**~~ ✅ — คุณนุ๊กแจ้งผล: **1.16 GB / 7 วัน (18-25 พ.ค.) = ~0.166 GB/วัน**. ลด **76% จาก baseline 0.7 GB/วัน** · ทะลุเป้า P3 (<0.3) ~2×. Storage 35.64 MB เล็กมาก ไม่ใช่ bottleneck. Compute 17.05 CU-hrs / 7d = ~2.4 CU-hrs/วัน
> 4. **ค้างเดิม — DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL (impact ใกล้ศูนย์)
>
> ## 🎯 งานหลัก session หน้า
> 1. **⭐ §12 — Apps Script shrink** ([migration-plan-apps-script-shrink.md](migration-plan-apps-script-shrink.md)) — ตัด Sheet sidecar (sync-to/from-sheet cron) + read fallback (`tryPostgres` AS path) + 17 legacy write else-branches + dead Apps Script handlers ในก้อนเดียว. **Pre-execute decisions**: คุณนุ๊ก confirm 4 ข้อใน §10 ก่อนเริ่ม (r2-backup option, audit_log import, R2 snapshot ก่อนตัด, Sheet permission). Effort ~5-6 ชม. แนะนำแบ่ง 2 sessions (code+deploy / Apps Script cleanup+soak)
> 2. **soak `NEXT_PUBLIC_DELTA_FETCH_LIST` ต่อ** — รอ ≥2 wk ก่อนตัดสิน retire `useAutoSync` (อยู่ใน B consolidate plan)
> 3. **`/check-quota`** — Apps Script + Cloudflare Worker quota check skill (จะมีค่าน้อยลงหลัง §12 — quota loss = acceptable, ดู §12 Trap 3)
> 4. **AI Quoting Phase 0** (deferred 3 sessions) — spec/scaffold
> 5. **DATE_ANOMALY fix** ถ้าเริ่มงาน DB cleanup
>
> ### Decisions / Lessons
> - **Soak 4 วัน ปลอดภัย ถ้า hardening ครบ:** soak window 1 wk ใน plan เป็น guardrail สำหรับ "ปลอดภัยใจ". Hardening 2026-05-22 (post-insert read-back assertion, `74ac78d`) ปิด collision-silent risk ทำให้ retire เร็วขึ้นได้ปลอดภัย. Soak สั้นได้ก็ต่อเมื่อ root cause guard ลงและ Sentry สะอาด
> - **Dead-code internal calls = known wart, ไม่ block ship:** Apps Script `write.ts` มี internal `getNext*` ใน dead action handlers — ปล่อยไว้ดีกว่าตามไปลบทุก line (จะลบรวมกับ Apps Script write-retire phase ตามแผน §12). Document ใน commit msg + dashboard-v2.md + migration-plan §7 ว่าเป็น known dead code
> - **Apps Script "Edit existing → New version" critical:** clasp push อย่างเดียวไม่ update web app URL — ต้อง deploy version ใหม่ใน editor. "New deployment" = URL ใหม่ = ระบบพัง (frontend ผูก URL เก่า)
>
> **Commits:** `(pending — commit ในส่วนถัดไป)`
>
> ---
>
> **Session 2026-05-23 — Backlog cleanup (MorningReportV2 retire) + B consolidate risk-audit:** ✅
>
> ## งานที่ทำ
> - **Apps Script "Morning Report V2" project retired** — verify code: `MORNING_REPORT_APPS_SCRIPT_URL` ไม่ถูก reference ใน code อีกแล้ว (`grep -rn` ใน .ts/.tsx/.js เหลือแค่ `MORNING_REPORT_TOKEN` สำหรับ manual `?token=` test). คุณนุ๊กลบ env var + Apps Script project แล้ว. doc [`dashboard-v2.md:707-712`](dashboard-v2.md) update: mark retired 2026-05-23, ลบ `MORNING_REPORT_APPS_SCRIPT_URL` ออกจาก env list, ระบุ Vercel cron = single scheduler.
> - **B consolidate (`useAutoSync` ↔ `useDeltaSync`) — risk-audit + defer ต่อ** — อ่าน source ทั้ง 2 hooks เทียบ behavior + caller (`board-client` · `orders-list-client` · `calendar-client` · `pending-mutations`). พบ 5 risk: ไม่มี test ของ poll-loop effect เลย (`tests/delta-sync.test.ts` cover แค่ `mergeDelta` pure) · visibility behavior diff (`useAutoSync` กัน double-refresh, `useDeltaSync` ไม่กัน — cursor handles dedup) · signature ไม่สมมาตร (sync void vs Promise + coalesced) · 4 callers ต้องไม่พัง + flag OFF fallback ต้องเก็บ · rollback แพง (delta-fetch live ~1 wk ยัง soak). **recommend:** รอ flag soak ≥2 wk → flip permanent → **ลบ `useAutoSync` ทิ้ง** (ง่ายกว่า consolidate) + เขียน test ของ poll-loop ก่อนทำจริง
> - **Drop 2 pending จาก backlog:** (1) orphan-cancelled cleanup ×4 — คุณนุ๊กยืนยันใบเทสช่วงแรกไม่กระทบ data จริง, helper push ขึ้น editor แล้วก็ไม่ต้องรัน; (2) deleteJob smoke — คุณนุ๊กแจ้งว่าเคย smoke ผ่านแล้ว
>
> ## ⏳ Pending user actions (carry forward)
> 1. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL `UPDATE orders SET date_in/date_due` (double-encoded date, impact ใกล้ศูนย์ — `displayDate` unwrap ให้แล้ว)
> 2. **Neon transfer rate check ~25 พ.ค.** — วัดผล delta-fetch P3 จริง (อีก 2 วัน). baseline 0.7 GB/วัน → 21 พ.ค. ~0.35-0.4 (ก่อน delta-list) → คาดหลัง delta-list ON ลดอีก
> 3. **ID-migration Step 7 retire ~28 พ.ค.** — ลบ `getNext*` else-branch + flag `ALLOCATE_IDS_IN_POSTGRES` + Apps Script `getNextId`/`getNextOrderId`/`getNextIds` (เช็ค caller อื่นก่อน)
>
> ## 🎯 งานหลัก session หน้า
> 1. **soak `NEXT_PUBLIC_DELTA_FETCH_LIST` + ดู Sentry/Neon transfer** — รอ ≥2 wk ก่อนตัดสิน retire `useAutoSync`
> 2. **AI Quoting Phase 0** (deferred) — spec/scaffold
> 3. **`/check-quota`** — Apps Script + Cloudflare Worker quota เช็ค
> 4. **DATE_ANOMALY fix** ถ้าเริ่มงาน DB cleanup
>
> ### Decisions / Lessons
> - **MorningReport env vars หลัง revamp:** `MORNING_REPORT_TOKEN` (manual test) + `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID` + `CRON_SECRET` (auto). `MORNING_REPORT_APPS_SCRIPT_URL` ลบทิ้งได้แล้ว — route ใหม่ self-contained ผ่าน `loadAll()` + LINE push API ตรง
> - **B consolidate ไม่ใช่ low-risk refactor** — duplicate scaffolding ~80 บรรทัดเป็น isolation เจตนา ไม่ใช่ tech debt: poll-loop effect + visibility + channel + cleanup เป็น timing-sensitive ที่ไม่มี test → bug หลุดทุก gate. ทำ "ลบ useAutoSync ทิ้ง" หลัง flag permanent ง่ายกว่า consolidate
>
> **Commits:** [`(pending — docs only)`] (NEXT-SESSION + dashboard-v2)
>
> ---
>
> **Session 2026-05-22 — Hardening (A/B2) + delta-fetch → /orders + /calendar:** ✅ LIVE & verified
>
> ## งานที่ทำ
> - **A — post-insert collision guard** (§6/R5 ของ [migration-plan-id-allocation.md](migration-plan-id-allocation.md)) — helper `assertNoIdCollision()` ใน [`postgres-write.ts`](lib/postgres-write.ts): fresh-id INSERT 4 จุดที่ใช้ `ON CONFLICT (id) DO NOTHING` (createOrder order+job · promoteDraft · bulkForward) เปลี่ยนเป็น `RETURNING id` + read-back — minted id ชน → throw ดังๆ แทนปล่อย phantom success. (`addJobToPostgres` เป็น plain INSERT ไม่มี ON CONFLICT → loud อยู่แล้ว — แผน §6 เขียนชื่อ/สมมติฐานผิด)
> - **B2 — PA-L1 loadOrder over-fetch** — `loadOrder`/`loadOrderFromPostgres` มี opt `orderOnly` → 4 callers (print · tracking-card · `/api/orders/raw` · restore parent-status) ที่อ่านแค่ `.order` รัน **1 query แทน 4**. full path (`/track`) ไม่แตะ
> - **#3 — L3 edge-build-warnings: wontfix** — build สะอาด เหลือ warning เดียวที่ inherent กับ edge runtime ลบไม่ได้ถ้าไม่ทิ้ง edge optimization
> - **#4 — scan v2** ([`_scan-phase2.gs`](../production-monitoring/_scan-phase2.gs)) — §3 orphan-order cross-ref `jobs∪shipped∪cancelled` (เดิม false-positive 122) · §6 เพิ่ม `INVALID_DATEDUE`. push.sh + **รันแล้ว** → 0 critical/0 high · ORPHAN_ORDER false-positive หายเกลี้ยง · INVALID_DATEDUE จับ orders 202605046/047
> - **#2 — delta-fetch → /orders + /calendar** ([`88b31d7`](https://github.com/witsarutnook/penprinting-dashboard/commit/88b31d7)) — flag `NEXT_PUBLIC_DELTA_FETCH_LIST`. /calendar reuse `/api/board/delta` ตรงๆ (jobs+orders) · /orders: `loadBoardDelta(…,{lists:true})` คืน `shippedOrderIds`/`cancelledOrderIds` (full sorted array ต่อ poll — เลี่ยง hard-delete) · enrichment ย้ายเป็น pure `computeOrdersList` (shared server+client) · ไฟล์ใหม่ `orders-list.ts` · `OrdersListClient` · `OrdersBody` · `CalendarClient`
> - **flag flip + smoke-verify (live)** — คุณนุ๊กตั้ง `NEXT_PUBLIC_DELTA_FETCH_LIST=1` + redeploy → verify ผ่าน Chrome: /orders poll `?...&lists=1` ✅ (~0.34KB) · /calendar poll `/api/board/delta` 200 ✅ · 2 หน้า render ถูก ไม่มี console error
> - tests 112→139 · type-check/lint/build ผ่าน Node 22 · security review diff A+B2 — ไม่พบช่องโหว่
>
> ## ⏳ Pending user actions
> 1. **orphan-cancelled ×4 cleanup** — helper `cleanupOrphanCancelled` push ขึ้น editor แล้ว ยังไม่รัน (2 test rows `202605039`/`202605055` ลบได้ · 2 historical `202604024`/`202604068` รอตัดสิน)
> 2. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional: Postgres SQL `UPDATE orders SET date_in/date_due` (double-encoded date — impact ใกล้ศูนย์, `displayDate` unwrap ให้แล้ว)
> 3. ค้างเดิม: Neon transfer ~25 พ.ค. · ID-migration Step 7 retire ~28 พ.ค.
>
> ## 🎯 งานหลัก session หน้า
> 1. **#1 — Consolidate `useAutoSync`/`useDeltaSync`** (deferred) — รวม poll-loop เป็น `usePollLoop(onTick)`. **เลื่อนเพราะ:** poll-loop effect ไม่มี test เลย → consolidation bug หลุด type-check/build/test · roadmap วางไว้หลัง delta-list เสถียร (ตอนนั้น `useAutoSync` อาจลบทิ้งได้เลย = ง่ายกว่า). ทำหลัง flag `NEXT_PUBLIC_DELTA_FETCH_LIST` soak
> 2. **soak delta-list** — ดู Sentry หลัง flag ON
> 3. ค้างเดิม: ลบ Apps Script "MorningReportV2" + env · deleteJob smoke · AI Quoting Phase 0 · `/check-quota`
>
> ### Decisions / Lessons
> - **B1 (ลบ no-op `router.refresh()`) — ข้าม:** premise ใน NEXT-SESSION เดิมผิด — `OrderForm` ใช้ 3 routes (`/board` + `/orders/new` + `/orders/[id]/edit`); 2 อันหลังไม่มี delta → `router.refresh()` ไม่ใช่ no-op. `undo-context` no-op เฉพาะตอน flag ON. ทำได้ต่อเมื่อ retire flag-OFF path ถาวร
> - **delta-fetch ขยาย route ใหม่ pattern:** extend `loadBoardDelta` ด้วย opt · ข้อมูลที่ delta จับ "ลบ" ไม่ได้ (shipped/cancelled hard-delete) → ส่ง full sorted orderId array ต่อ poll (set เล็กพอ) + `mergeDelta` เทียบ ref-stable กัน idle re-render
> - **planning-doc claims ต้อง grep code ก่อน:** แผน §6 เขียนว่า `addJobInPostgres` ใช้ ON CONFLICT — ของจริง `addJobToPostgres` เป็น plain INSERT (loud อยู่แล้ว)
>
> **Commits:** [`74ac78d`](https://github.com/witsarutnook/penprinting-dashboard/commit/74ac78d) (A+B2) · [`88b31d7`](https://github.com/witsarutnook/penprinting-dashboard/commit/88b31d7) (#2 delta-fetch) · docs ปิด session
>
> ---
>
> **Session 2026-05-21 (PM) — ID-allocation migration → Postgres: ✅ LIVE & verified**
>
> ## งานที่ทำ
> - **ทำตามแผน [migration-plan-id-allocation.md](migration-plan-id-allocation.md)** — ย้าย order/job ID minting จาก Apps Script (`getNextOrderId`/`getNextId`/`getNextIds`) มา Postgres `counters` table. 11 ไฟล์, commit [`44006d3`](https://github.com/witsarutnook/penprinting-dashboard/commit/44006d3)
>   - ใหม่: [`lib/id-allocation.ts`](lib/id-allocation.ts) (`mintJobId`/`mintJobIds`/`mintOrderId` — atomic `UPDATE...RETURNING`) · [`/api/admin/seed-id-counters`](app/api/admin/seed-id-counters/route.ts) · `counters` table ใน db-migrate
>   - branch 6 routes ด้วย `allocateIdsInPostgres()`: orders/add · promote-draft · jobs/add · forward · forward-undo · bulk-forward
> - **Rollout เสร็จใน session นี้** (lunch-break window): db-migrate → seed (`nextId`=740, verified ตรงกับ Sheet `config.nextId`=740) → ตั้ง `ALLOCATE_IDS_IN_POSTGRES=1` + redeploy → smoke
> - **Verified live**: ใบทดสอบ → job id `740` (counter→741) · order id `202605145` (`YYYYMMNNN` ถูก, seq 144→145) · ไม่มี ID ชน · **คุณนุ๊กยืนยัน "กดใบสั่งเร็วขึ้นเยอะ"** (2-3 วิ → ~0.3-0.6 วิ)
> - tests 112→122 (+10 [`tests/id-allocation.test.ts`](tests/id-allocation.test.ts)) · type-check/lint/build ผ่าน Node 22
>
> ## ⏳ Pending
> 1. ✅ ใบ "ทดสอบ ID migration" (#202605145) — ยกเลิกแล้ว (cancel cascade verified สะอาด: job 740 tombstoned, order status=cancelled)
> 2. **Soak ~1 สัปดาห์** (ถึง ~28 พ.ค.) — ดู Sentry + สังเกตการสร้างงานปกติ
> 3. **เช็ค Neon network transfer rate ~25 พ.ค.** — วัดผล delta-fetch P3 จริง. baseline ก่อน optimize = 0.7 GB/วัน (5.6GB/8d) · 21 พ.ค. วัดได้ ~0.35-0.4 GB/วัน = ผลของ loadAll caching (P3 เพิ่ง live 21 พ.ค. ~10:00 ยังไม่สะท้อน). ดูกราฟ transfer รายวันใน Neon → "View all metrics" เทียบก่อน/หลัง 21 พ.ค.
> 4. **Rollback note** — job 740+ ออกจาก Postgres แล้ว Apps Script `config.nextId` ยังค้าง 740: **ถ้าจะ rollback ต้องแก้ cell `config.nextId` ใน Google Sheet `config` tab = ค่า Postgres `counters.nextId` ปัจจุบันก่อน** แล้วค่อยปิด flag. order id ไม่ต้องทำ (`getNextOrderId` cross-check Sheet self-heal)
>
> ## 🎯 งานหลัก session หน้า
> 1. **Step 7 — Retire** (หลัง soak ≥1 สัปดาห์): ลบ `getNext*` else-branch ออกจาก 6 routes + ลบ flag `ALLOCATE_IDS_IN_POSTGRES` + ลบ `getNextId`/`getNextOrderId`/`getNextIds` ฝั่ง Apps Script (เช็คก่อนว่าไม่มี caller อื่น)
> 2. **Optional hardening** — post-insert read-back assertion ใน `createOrderInPostgres`/`addJobInPostgres` (กัน `ON CONFLICT DO NOTHING` กลบ collision เงียบ — §6 ของแผน)
>
> ### Lessons
> - **Apps Script `config.nextId` = แค่ cell ใน Google Sheet `config` tab** — แก้ตรงๆ ได้ → rollback ของ counter migration ง่าย ไม่ต้องเขียน Apps Script sync action (decision 2 ในแผนเดิม over-engineered)
> - **seed ของ counter migration ต้องชิดกับ flag flip** — seed endpoint ออกแบบเป็น raise-only + re-runnable ให้รันซ้ำได้ก่อน flip เพื่อ catch row ที่เกิดช่วงรอยต่อ
>
> **Commits**: `44006d3` (code) · `9fbc637` (decisions) · `7405ca7` (plan) · `99b6492` + `ac44fa4` (plan docs) + docs ปิด session
>
> ---
>
> **Session 2026-05-21 — Delta-fetch P3 (client refactor) + migration/smoke verified:** ✅
>
> ## งานที่ทำ
> - **P3: Client refactor** — `/board` เป็น hybrid Server/Client เมื่อ `NEXT_PUBLIC_DELTA_FETCH=1`. Server ส่ง bootstrap (`loadBoardDelta(null)`) → [`<BoardClient>`](app/board/board-client.tsx) ถือ state + [`useDeltaSync`](lib/delta-sync.tsx) poll `/api/board/delta` + merge. flag-OFF = path เดิมไม่แตะเลย.
>   - ไฟล์ใหม่: [`lib/poll-schedule.ts`](lib/poll-schedule.ts) (shared backoff + `refreshGuard`) · [`lib/delta-sync.tsx`](lib/delta-sync.tsx) (`useDeltaSync` + pure `mergeDelta`) · [`app/board/board-client.tsx`](app/board/board-client.tsx)
>   - ไฟล์แก้: `auto-sync.tsx` (import จาก poll-schedule) · `board.ts` (`computeBoard` รับ `Pick<…,'jobs'|'orders'>`) · `pending-mutations.tsx` (`commit()` รับ prop `pollNow?`) · `page.tsx` (flag branch + `BoardDataDelta`)
>   - **กลไก:** ทุก mutation เรียก `broadcastWrite()` อยู่แล้ว → `useDeltaSync` ฟัง BroadcastChannel (รับ event ของ tab ตัวเองด้วย) → poll ทันที ครอบคลุม card/column/job-form/bulk/order-form/undo **โดยไม่แตะไฟล์พวกนั้น**. มีแค่ `commit()` ที่ delta-aware (`pollNow().then(cleanup)`) เพราะ phantom cleanup timing
> - **ปิด audit:** PA-H2 (bootstrap อ่าน 2 ตาราง ไม่ใช่ `loadAll` 5) + PA-M2 (`mergeDelta` คืน state ref เดิมเมื่อ delta ว่าง → idle tick ไม่ re-render). PA-L1 ยัง open
> - **Tests** 100→112 ([`tests/delta-sync.test.ts`](tests/delta-sync.test.ts) — `mergeDelta` 12 cases). type-check + lint + build ผ่าน Node 22
> - **ขั้น 2+3 verified แล้ว session นี้** (รันผ่าน Chrome ที่ login admin อยู่):
>   - Schema migration `/api/admin/db-migrate` → `{ok:true}` (idempotent — `updated_at` + triggers อยู่ครบตั้งแต่ 2026-05-20, รอบนี้ยืนยันซ้ำ)
>   - Smoke `/api/board/delta`: full snapshot `jobs:54 orders:207 deletedJobIds:0` + `serverTime` · `?since=`อนาคต → empty delta โครงสร้างถูก → **backend delta-fetch พร้อมใช้จริงบน production**
>
> ## ⏳ Pending user actions — เรียงลำดับ
> 1. **verify Vercel deploy** — commit `6412d5b` push แล้ว, เช็คว่า deploy ขึ้นเรียบร้อย
> 2. **ตั้ง `NEXT_PUBLIC_DELTA_FETCH=1`** — Vercel → Settings → Environment Variables → **redeploy**. ⚠️ ทำ**หลัง** P3 deploy เสร็จเท่านั้น — flag เป็น `NEXT_PUBLIC_` bake ตอน build; เปิดก่อนมี `BoardClient` = build พัง
> 3. **เช็ค /board โหมด delta** — filter/search เปลี่ยนทันทีไหม · forward/reassign/cancel/ship/bulk เด้งไหม · DevTools Network ดู `/api/board/delta` poll ~ทุก 15s · idle แล้วหยุด poll ที่ 30 นาที
> 4. ค้างเดิม: soak Phase 4.2 cutover → Stage 5 (~26-28 พ.ค.) · ดู Sentry + Neon transfer · ลบ Apps Script "MorningReportV2" + env `MORNING_REPORT_APPS_SCRIPT_URL` · deleteJob smoke test · AI Quoting Phase 0 · ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2
>
> ## 🎯 งานหลัก session หน้า
> 1. **หลัง flag ON เสถียร** — ปิด deferred cleanup: ลบ `router.refresh()` ที่เป็น no-op ในโหมด delta — `order-form.tsx` (×4) + `undo-context.tsx` (×1). `broadcastWrite`→channel→poll จัดการ update แล้ว; `router.refresh()` แค่เปลือง server round-trip 1 ครั้งต่อ order create/promote/undo
> 2. **PA-L1** — `loadOrderFromPostgres` ยิง 4 query ขนานแม้ caller ต้องการ order เดียว → opts flag trim. minor
> 3. **Consolidate** `useAutoSync`/`useDeltaSync` — ตอนนี้ duplicate poll-loop scaffolding ~80 บรรทัด (เจตนา isolate ความเสี่ยงจาก 5 routes อื่นที่ใช้ `useAutoSync`). ถ้า delta mode เสถียร → ขยาย delta-fetch ไป /orders /calendar แล้ว consolidate เป็น `usePollLoop(onTick)` ตัวเดียว
> 4. **ID allocation → Postgres** — แผนละเอียดเขียนเสร็จแล้ว: [migration-plan-id-allocation.md](migration-plan-id-allocation.md) (commit `7405ca7`). ย้าย `getNextOrderId`/`getNextId`/`getNextIds` ออกจาก Apps Script → counter ใน Postgres → ส่งใบสั่งงาน 2-3 วิ เหลือ ~0.3-0.6 วิ. มาจาก diagnose order-submit latency (2026-05-21). PIN + QR ตรวจแล้วไม่กระทบ (§3 ของแผน). ⏳ **รอคุณนุ๊กตัดสิน 3 decisions ใน §10** (flag เดียว / sync AS counter ช่วง soak / ย้าย order+job พร้อมกัน) ก่อนเริ่ม implement
>
> ### Lessons
> - **`router.refresh()` = no-op ใน component ที่ owns state ผ่าน `useState(initialProp)`** — `useState` ใช้ initial value แค่ตอน mount; prop ที่เปลี่ยนทีหลังถูก ignore. ย้าย source-of-truth มาฝั่ง client แล้วต้องมี imperative trigger (`pollNow`) แทน server re-render — ไม่งั้น mutation ไม่ขึ้นจอ
> - **`broadcastWrite()` deliver ถึง tab ตัวเอง** — BroadcastChannel ชื่อเดียวกัน deliver ถึงทุก instance ยกเว้นตัวส่ง → channel listener ใช้เป็นจุดรวม refresh ได้ ไม่ต้องไล่แก้ N call sites
> - **`[...map.values()]` ต้องใช้ `Array.from(map.values())`** — tsconfig target นี้ไม่รองรับ MapIterator spread (TS2802 — type-check จับทันที)
>
> **Commits**: [`6412d5b`](https://github.com/witsarutnook/penprinting-dashboard/commit/6412d5b) (code: P3 — BoardClient + useDeltaSync + poll-schedule + 12 tests) · docs follow-up (NEXT-SESSION + dashboard-v2 + AUDIT-BACKLOG)
>
> ---
>
> **Session 2026-05-20 — Delta-fetch P1+P2 (schema + endpoint):** ✅
>
> ## งานที่ทำ
> - **P1: Schema + bump triggers** ([`app/api/admin/db-migrate/route.ts`](app/api/admin/db-migrate/route.ts)) — `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` + index + BEFORE UPDATE triggers ใน jobs/orders/shipped/cancelled. 2 trigger functions: `bump_updated_at_jobs` (raw OR phase2_deleted_at change) + `bump_updated_at_raw` (raw only). **Conditional bump** — heal-cron `phase2_dirty_at = NULL` ไม่แตะ raw → trigger เห็นไม่ distinct → ไม่ bump → cursor ไม่ pollute. INSERT ไม่ต้องแก้ (DEFAULT NOW() คุม)
> - **P2: Delta endpoint** ([`lib/board-delta.ts`](lib/board-delta.ts) + [`app/api/board/delta/route.ts`](app/api/board/delta/route.ts)) — `GET /api/board/delta?since=<iso>`. `since=null` → full snapshot. `since=iso` → 3 query ขนาน (active changes + orders changes + tombstoned ids) + `serverTime` (snapshot ก่อน queries กัน write-loss window). Response: `{ jobs, orders, deletedJobIds, serverTime }`
> - **Tests** 91→100 ผ่าน Node 22 (9 ใหม่ใน `tests/board-delta.test.ts`). type-check + lint + build ผ่าน
> - **คุม design choices** ขออนุมัติคุณนุ๊กก่อน: DB trigger > explicit (zero forget) · P1+P2 ใน session นี้ (P3 client refactor session หน้า) · migrate ผ่าน admin route
>
> ## ⏳ Pending user actions — เรียงลำดับ
> 1. **คุณนุ๊กยังต้อง deploy ตามปกติ** — push บน main = Vercel auto-deploy. Session นี้ commit ให้ แต่ verify ผ่าน Vercel dashboard
> 2. **รัน schema migration** — หลัง deploy: `curl 'https://dashboard.penprinting.co/api/admin/db-migrate'` (browser ก็ได้ ต้อง logged-in admin) → check response `applied` array ต้องมี `ALTER TABLE * ADD updated_at + index` (×4) + `CREATE FUNCTION bump_updated_at_*` (×2) + `CREATE TRIGGER trg_bump_updated_at ON *` (×4). Idempotent — ปลอดภัยถ้ารัน 2 ครั้ง
> 3. **Smoke test delta endpoint** — `curl 'https://dashboard.penprinting.co/api/board/delta'` (admin cookie) → ดู `serverTime` + `jobs.length` ตรงกับ /board · `curl 'https://dashboard.penprinting.co/api/board/delta?since=2026-05-20T00:00:00.000Z'` → ดู delta payload เล็กกว่า full snapshot
> 4. ค้างเดิม: **soak Phase 4.2 cutover ≥1 สัปดาห์** ก่อน Stage 5 (cutover 2026-05-18 → target Stage 5 ~26-28 พ.ค.) · **ดู Sentry + Neon transfer** หลัง cutover · **ลบ Apps Script "MorningReportV2"** + env `MORNING_REPORT_APPS_SCRIPT_URL` · deleteJob smoke test · AI Quoting Phase 0 · ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2
>
> ## 🎯 งานหลัก session หน้า — Delta-fetch P3 (client refactor)
> 1. **Refactor `/board`** → hybrid Server/Client:
>    - Server component ส่ง initial snapshot (มี cookies auth) → ฝัง `<BoardClient initialJobs={...} initialOrders={...} initialServerTime={...}>`
>    - `BoardClient` = "use client" — `useState` ถือ jobs/orders, ใช้ `computeBoard` เหมือนเดิม (pure function reuse), render kanban
> 2. **`useDeltaSync(initial)` hook** — poll `/api/board/delta?since=<lastServerTime>` ทุก tick (ใช้ backoff schedule เดิมจาก `useAutoSync`):
>    - merge changed jobs/orders เข้า state (`Map.set(id, newRaw)` shape — keep ordering by re-sort)
>    - remove tombstoned ids
>    - advance cursor → `lastServerTime = response.serverTime`
>    - skip render ถ้า no changes (closes PA-M2 churn)
> 3. **Feature flag** `NEXT_PUBLIC_DELTA_FETCH` — default ON ใน prod after smoke, OFF = revert to `router.refresh()`
> 4. **ปิด audit items**: PA-H2 (loadAll 5-table over-fetch — delta query แค่ 2 ตาราง) · PA-M2 (parent re-render churn — skip render no-change) · PA-L1 (loadOrder over-fetch — minor, ค่อยทำแยก)
> 5. **Edge cases ต้องระวัง:**
>    - cross-tab BroadcastChannel: tab อื่น write → tab นี้ ควร trigger delta poll ทันที (broadcast ผ่าน existing `broadcastWrite()`)
>    - tab hidden/visible: visibilitychange → refresh cursor + poll ทันที (เหมือน `useAutoSync` ปัจจุบัน)
>    - cursor stale (client หลุดนาน): server return entire delta from old cursor; ถ้า > X rows → ส่ง full snapshot แทน (sentinel field `bootstrap: true`)?
>    - bulk-mode selection state: client-state เดิม persist ถูก เพราะ kanban shape ไม่เปลี่ยน
>
> ### Lessons
> - **Trigger รวมหลายตาราง ใช้ฟังก์ชันเดียวไม่ได้** — plpgsql parse column refs ตอน first-call per-table. ถ้า function อ้าง `NEW.phase2_deleted_at` แล้ว attach กับ orders (ไม่มี column นั้น) → fail ตอน first row. แยก function ตามตาราง หรือใช้ TG_TABLE_NAME branching with `EXECUTE` dynamic SQL
> - **`DEFAULT NOW()` rewrites table on ALTER ADD COLUMN** (NOW() เป็น volatile, ไม่ใช่ constant). PG ≥11 constant default = no rewrite, แต่ NOW() ตก fallback path = rewrite ทั้งตาราง. สำหรับตารางใหญ่ควรเพิ่ม column แบบ nullable ก่อน → backfill batches → set NOT NULL. ของเรา jobs/orders ~200-700 row = ALTER ครั้งเดียวผ่าน
>
> **Commits**: [`50b43ca`](https://github.com/witsarutnook/penprinting-dashboard/commit/50b43ca) (code: triggers + delta endpoint + tests) · [`741f594`](https://github.com/witsarutnook/penprinting-dashboard/commit/741f594) (docs)
>
> ---
>
> **Session 2026-05-19 — Performance audit + PA-H1/PA-M3 fixes:** ✅
>
> ## งานที่ทำ
> - **Performance audit** ผ่าน `penprinting-auditor` (perf-only scope, หลัง Phase 4.2 close-out) → 0 critical · 2 high · 3 medium · 1 low. ผลเต็ม + verified-clean list อยู่ใน [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) section "Perf audit — 2026-05-19". hot path สภาพดี (cache coalescing 2026-05-18, recharts route-split, card lazy-loading ทั้งหมด verified clean).
> - **PA-H1 แก้แล้ว** ([`lib/auto-sync.tsx`](lib/auto-sync.tsx)) — เพิ่ม hard-stop: tab idle > 30 นาที หยุด poll สนิท. เดิม backoff 15s→30s→120s ไม่เคยถึง 0 → tab เปิดทิ้งข้ามคืน fire ~720 `router.refresh()`/คืน (server re-render + stream board HTML กลับทุกครั้ง). resume เมื่อ user input / tab re-visibility + refresh ทันที 1 ครั้ง (ไม่เสีย freshness). type-check/build/test(91/91) ผ่าน Node 22.
> - **M1-card-memo-deep-compare ปิด = invalid** — auditor ยืนยัน comparator ปัจจุบัน [`card.tsx:552-612`](app/board/card.tsx:552) เป็น flat primitive compare ไม่มี `JSON.stringify`/deep-compare แล้ว (PERF-C1 ลบไปตั้งแต่ 2026-05-12). item เดิมบรรยาย `card.tsx:459-489` ที่ไม่มีอยู่จริง.
> - **Quick perf wins** — **PA-M3 แก้แล้ว** ([`lib/api.ts:132`](lib/api.ts)): Apps Script fallback `get()` pass `{ revalidate: 0 }` ตัด nested `fetch` cache 60s ที่ `revalidateTag` บัสต์ไม่ถึง (write ตอน Postgres ล่มไม่โผล่ ≤60s). **PA-M4 verified clean** — index `idx_audit_target` มีอยู่แล้วใน `db-migrate` route, planner ใช้ BitmapOr ไม่ seq-scan = ไม่ต้องแก้.
>
> ## ค้าง — perf audit findings ที่ยังไม่แก้ (track ใน AUDIT-BACKLOG "Perf audit — 2026-05-19")
> - **PA-H2** loadAll over-fetch (ดึงครบ 5 ตารางทุกหน้า — `/board` ลาก shipped+cancelled history เปล่า)
> - **PA-M2** parent re-render churn (KPIBar/BoardToolbar ไม่ memo) — **ปิดได้ด้วย delta-fetch** (skip render ถ้า snapshot เหมือนเดิม)
> - **PA-L1** loadOrder over-fetch (4 query ขนานแม้ caller ต้องการ order เดียว)
> - คุณนุ๊กตัดสิน 2026-05-19: PA-H2/M2/L1 รอทำพร้อม delta-fetch / แยก session
>
> Commits: `c43999b` (PA-H1) · `f82734f` (PA-M3) · `e079850` + docs
>
> ---
>
> **Session 2026-05-18 (PM) — Phase 4.2 close-out S1-S4 + cutover:** ✅
>
> **Pivot:** session เริ่มจะทำ delta-fetch (board auto-sync) → คุณนุ๊กถาม "ตัด Sheet ออกเลยได้มั้ย" → ถ้า Sheet ไม่อยู่ delta-fetch trivial (ไม่มี TRUNCATE+INSERT cron รีเซ็ต cursor / ไม่มี Sheet-direct edit ที่ delta มองไม่เห็น). คุณนุ๊กตัดสิน: **เร่ง Phase 4.2 close-out ก่อน** (แลกกับ burn-in gate ต้นมิ.ย. ที่หายไป ~3-4 สัปดาห์). **delta-fetch deferred จนกว่า close-out เสร็จ.**
>
> ## Phase 4.2 close-out — แผน 6 stage
> เป้า: Postgres = sole source of truth · ตัด Apps Script write paths · Sheet = downstream mirror อย่างเดียว
> - **S0** pre-flight verify (flag / data-parity Postgres==Sheet / heal-cron backlog ว่าง)
> - **S1** ✅ migrate deleteJob/restoreJob/forwardUndo → Postgres-first (commit `fe4e238`)
> - **S2** ✅ code (`9678ab1`) + **flipped 2026-05-18** — `PHASE2_OWNS_CORE_TABLES=1` ON ใน prod, verified ผ่าน `/api/admin/sync-all` (jobs/orders/shipped/cancelled = `skipped`). from-Sheet cron หยุดทับแล้ว → **Postgres = sole source of truth**
> - **S3** ✅ done (`8043990`) — ตัด `found:false → Apps Script` fallback ใน 7 route → ตอบ 409 (orders/cancel คืน 404 อยู่แล้ว ไม่ต้องแตะ)
> - **S4** ✅ done (`2a52a64`) — ลบ dual-write mirror (`lib/postgres-write-mirror.ts` ลบทิ้ง -425 บรรทัด + ตัด `mirrorWriteToPostgres` block ใน `lib/api.ts`)
> - **S5** ลบ WRITE_* flag scaffolding + legacy branch ทั้งหมด (least reversible — soak cutover ≥1 สัปดาห์ก่อนทำ)
> - **S6** docs
> ⚠️ หลัง cutover = ไม่มี Sheet safety-net แล้ว (revert ได้ด้วย flip flag OFF)
>
> ## Stage 1 — เสร็จ + live production
> 3 route นี้ roadmap เขียนว่า "dead UI path" — **ผิด** ทั้งคู่มี UI เรียกจริง:
> - `deleteJob` — `deleteJobInPostgres` tombstone (reuse `phase2_deleted_at` + `healJobsTombstone` — ไม่มี Apps Script action ใหม่). UI: /orders → ปุ่ม "ตรวจสอบข้อมูล" → section Duplicate jobs → "ลบ row นี้" (โผล่เฉพาะมี job ซ้ำ)
> - `restoreJob` — `restoreJobInPostgres` (upsert jobs clear tombstone/dirty + delete cancelled) + ยังเรียก `post('restoreJob')` sync Sheet เพราะ `cancelled` ไม่มี tombstone column + Apps Script ไม่มี `deleteCancelledByIdRow`. UI: /cancelled
> - `forwardUndo` — route ผ่าน `bulkForwardInPostgres` + เพิ่ม cowork pass-through (เดิม drop cowork = regression ของ undo). UI: undo toast /board
> - commit `fe4e238` — 8 ไฟล์ +424. 3 flag ใหม่ `WRITE_{DELETE_JOB,RESTORE_JOB,FORWARD_UNDO}_TO_POSTGRES` (default off). test 76→87. type-check/lint/build ผ่าน (Node 22)
> - **flags ON ใน Production แล้ว** (คุณนุ๊ก set + redeploy เอง — ข้าม Preview smoke). smoke prod: restore ✅ undo ✅. deleteJob ข้าม (ต้องมี duplicate job ถึง trigger ได้ + เสี่ยงต่ำสุด — reuse tombstone+heal infra เดิม)
>
> ## Stage 2 cutover + S3 + S4 — เสร็จ 2026-05-18
> - **S2 cutover** — `PHASE2_OWNS_CORE_TABLES=1` ON ใน prod + redeploy (Stage 0 pre-flight ผ่าน — diagnose-board layer5_sync_meta ทุกตาราง `ok:true` sync สด). verified ผ่าน `/api/admin/sync-all`: jobs/orders/shipped/cancelled/templates = `skipped — Postgres owns`, audit_log = sync 500. **from-Sheet cron ไม่ทับ jobs/orders แล้ว = Postgres เป็น source of truth จริง**
> - **S3** (`8043990`) — 7 route ตัด found:false→Apps Script fallback → 409 "refresh แล้วลองใหม่"
> - **S4** (`2a52a64`) — ลบ dual-write mirror (`postgres-write-mirror.ts` -425 บรรทัด + `mirrorWriteToPostgres` block ใน `api.ts`). restore เขียน Postgres ผ่าน `restoreJobInPostgres` ตรงแล้ว ไม่พึ่ง mirror. test 91/91 ทุก stage
>
> ### ⚠️ S4 residual — ปิดใน Stage 5
> promote-draft **existingJob recovery sub-path** ยังเขียน status flip ผ่าน `post('updateOrder')` = Sheet-only หลัง S4 (mirror หายแล้ว) → Postgres order status ไม่ตาม. **rare มาก** — ต้องมี draft order ที่มี orphan job อยู่ก่อน (residue ของ partial-failure เก่า) ซึ่งแทบเป็นไปไม่ได้ในข้อมูลปัจจุบัน. Stage 5 ลบ legacy branch ทั้งหมด = ปิดเอง
>
> ### 🎯 งานหลัก session หน้า — Stage 5 (รอ soak) → Stage 6
> - **Stage 5** — ลบ `WRITE_*` flag scaffolding (`phase2WriteEnabled` + `ACTION_ENV_VAR` ใน feature-flags.ts) + legacy Apps Script branch ทั้งหมดใน write routes (รวม promote-draft existingJob path = ปิด S4 residual). **least reversible** — รอ soak cutover ≥1 สัปดาห์ (target ~ปลายพ.ค./ต้นมิ.ย.). หลัง deploy ลบ env var `WRITE_*` 14 ตัวจาก Vercel (เก็บ `READ_FROM_POSTGRES` + `CRON_SECRET`)
> - **Stage 6** docs — ปิด Phase 4.2 ใน roadmap/dashboard-v2
> - close-out จบ → กลับไปทำ **delta-fetch** ได้ (ตอนนี้ trivial — Sheet ตัดขาดแล้ว)
>
> ### ⏳ Pending
> - **ดู Sentry + Neon transfer** หลัง cutover — from-Sheet cron ไม่ error, egress ลด
> - **soak cutover ≥1 สัปดาห์** ก่อนทำ Stage 5
> - deleteJob smoke test ยังไม่ได้ทำ (ต้องมี duplicate job — ข้ามได้ เสี่ยงต่ำ)
> - delta-fetch — deferred จนกว่า close-out เสร็จ (เหลือ S5-S6)
> - delta-fetch — deferred จนกว่า Phase 4.2 close-out เสร็จ
> - ค้างเดิม: AI Quoting Phase 0 · ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2
>
> ### Lessons
> - **roadmap "dead UI path" เชื่อไม่ได้** — Tech-Roadmap-Status เขียน deleteJob/restoreJob เป็น "dead UI" แต่ทั้งคู่ reachable จริง (data-audit modal + /cancelled). verify reachability (`grep "api/jobs/delete"` ใน app/components) ก่อนเชื่อ doc claim
> - **restore Sheet-side asymmetry** — `cancelled` ไม่มี tombstone/heal path เหมือน jobs → restore Phase 2 ต้องพึ่ง `post('restoreJob')` sync Sheet (heal cron ทำแทนไม่ได้). ถ้าจะตัด Apps Script เต็มตัว (Phase 4.3) ต้องเพิ่ม `deleteCancelledByIdRow` action + cancelled tombstone
>
> **Commits**: `fe4e238` (S1) · `68e1434` · `9678ab1` (S2) · `000b13f` · `8043990` (S3) · `db04926` · `2a52a64` (S4) + cutover (`PHASE2_OWNS_CORE_TABLES=1` ใน Vercel)
>
> ---
>
> **Session 2026-05-18 — Postgres quota incident + print-404 fix + Morning Report ported off Apps Script:** ✅
>
> ## 🔥 Postgres quota incident + print-404 fix (เรื่องหลักของ session)
>
> **อาการ:** `createOrder` ล้ม HTTP 402 — Neon **network transfer 5.63/5 GB เกินโควตา Free plan** (usage since May 10; DB จริง 40 MB แต่โอน 5.6 GB/8 วัน). คุณนุ๊ก upgrade Neon → **Launch plan** → unblock. order เคสด่วนสร้างได้ 1 ใบ ไม่ซ้ำ.
>
> **print-404** — กด "พิมพ์+สั่ง" order ใหม่ → 404 (ครั้งแรกหลัง upgrade, retry หาย). `/diagnose` → `loadOrderFromPostgres` มี `checkStaleness(['orders'])` pre-gate: quota หมด → `sync-from-sheet` 402 → `sync_meta.orders` stale → gate throw ทั้งที่ order อยู่ใน Postgres → `loadOrder` fallback Apps Script → order ใหม่ไม่อยู่ Sheet → 404.
>
> **Fix:** ตัด `checkStaleness` pre-gate ออกจาก `loadOrderFromPostgres` ([`lib/api-postgres.ts`](lib/api-postgres.ts)) — Phase 2 Postgres = source of truth, mirror staleness ไม่ควร block single-order read. + regression test `tests/api-postgres.test.ts` (suite 72→76). type-check/build/test ผ่าน Node 22.
>
> ### 🎯 งานหลัก session หน้า — Delta-fetch (คุณนุ๊กตัดสิน 2026-05-18)
> เปลี่ยน board auto-sync จาก **poll-the-world** (`router.refresh()` ดึง snapshot ทั้งก้อนทุก 15 วิ) → **delta-fetch** (ขอเฉพาะ row ที่เปลี่ยนตั้งแต่ tick ก่อน)
> - **เลือก delta ไม่เลือก push/SSE** เพราะ: ไม่เพิ่ม vendor/dependency · latency 15 วิ เพียงพอสำหรับ dashboard ภายใน · เป็น stepping stone (ถ้าวันหลังอยาก push แค่เปลี่ยน trigger จาก timer → Pusher event)
> - **Scope:** board (+ อาจ orders/calendar) เปลี่ยนเป็น client-driven — fetch endpoint ใหม่ที่ query `WHERE updated_at > <lastSync>` คืนเฉพาะ delta · client merge เข้า state เอง
> - **ต้องเช็คก่อน:** มี `updated_at` column ที่ bump ทุก write มั้ย (มี `phase2_dirty_at` แต่นั่นคือ "dirty since sheet-sync" คนละความหมาย — อาจต้องเพิ่ม column ใหม่)
> - **ระวัง:** delete/move — row หายไปจากผลลัพธ์ client ต้องรู้ว่าต้องลบการ์ดออก (ไม่ใช่แค่ append) · cache coalescing ที่ทำวันนี้อาจต้องปรับ key ให้รับ delta param
> - context เต็มของการตัดสินใจ push vs delta อยู่ใน session log ด้านล่าง + version history
>
> ### ⏳ ค้างอื่น
> 1. **เช็ค data-integrity fallout** — เปิด `https://dashboard.penprinting.co/api/admin/diagnose-board` ดู `layer5_sync_meta`: ทุก table `ok=true` + `last_sync_at` สด? มี order/job ตกค้างช่วง incident มั้ย
> 2. ✅ **Network transfer — แก้แล้ว** (cache coalescing + frequency tuning, ดู version history). verify: ดู Neon transfer graph 1-2 วันว่าลดจริง ~85%
> 3. **Phase 2 writes ไม่มี fallback** — ตอน Postgres ล่ม write พังหมด (ต่างจาก read ที่ auto-fallback). พิจารณาเพิ่ม write fallback / master kill-switch
> 4. **ลบ Apps Script "MorningReportV2" project** — verify ผ่านแล้ว (Vercel Run ส่ง flex ได้) — รอคุณนุ๊กลบ + env `MORNING_REPORT_APPS_SCRIPT_URL`
>
> ## Morning Report double-fire
>
> **Trigger:** คุณนุ๊กแจ้ง flex แจ้งงานด่วนส่งเข้ากลุ่ม LINE 2 รอบทุกเช้า → `/diagnose`.
>
> **1. Root cause (`/diagnose`)** — Apps Script time trigger `morningReport` ค้างไม่ได้ลบหลัง migrate ไป Vercel cron (pending action ค้างมาตั้งแต่ 2026-05-10). dedup window 5 นาทีแคบเกินกว่า window ที่ Vercel cron กับ time trigger fire ห่างกัน — เช้า 18 พ.ค. ห่างกัน 5:11 (พลาด 11 วินาที). + ghost trigger `sendMorningReport` (handler รุ่นเก่า) fail 100%. **คุณนุ๊กลบ trigger ทั้ง 2 อันแล้ว.**
>
> **2. Fix — drop Morning Report Apps Script ทั้งโปรเจกต์, port เข้า v2:**
> - `lib/morning-report.ts` (ใหม่) — urgency bucketing + LINE Flex builders + push. ดึงข้อมูลผ่าน `loadAll()` (Postgres-first).
> - `app/api/cron/morning-report/route.ts` — เดิม proxy POST ไป Apps Script → ตอนนี้ทำงานเอง. Manual test: `?token=MORNING_REPORT_TOKEN` (`&dry=1` ไม่ส่ง LINE).
> - type-check + build ผ่านบน Node 22. **ยังไม่ commit/push** — รอคุณนุ๊ก set env vars ก่อน (ดู Pending).
> - Pull-forward: read-only part ของ Phase 4.3 — ไม่ผูก Phase 4.2.
>
> ### ⏳ Pending user actions — เรียงลำดับ (ทำก่อน push)
> 1. **Set Vercel env vars** (project `penprinting-dashboard`): `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID` — copy ค่าจาก Apps Script "MorningReportV2" → Project Settings → Script properties. (`MORNING_REPORT_TOKEN` มีอยู่แล้วจาก migration 2026-05-10 — reuse เป็น manual-test token)
> 2. คุณนุ๊ก confirm → Claude push → Vercel deploy
> 3. **Manual test**: `curl 'https://dashboard.penprinting.co/api/cron/morning-report?token=<MORNING_REPORT_TOKEN>&dry=1'` → ดู JSON counts → แล้วเอา `&dry=1` ออก → verify flex เข้ากลุ่ม LINE รอบเดียว หน้าตาเหมือนเดิม
> 4. **ลบ Morning Report Apps Script project** ทิ้ง (หลัง verify ผ่าน) + env เก่าที่ไม่ใช้แล้ว `MORNING_REPORT_APPS_SCRIPT_URL` ลบได้
> 5. ค้างเดิม: AI Quoting Phase 0, ORPHAN_CANCELLED cleanup, `/check-quota`, scan v2
>
> ### Lessons
> - **Pending user action ที่หลุดจาก carry-over list** — "ลบ Apps Script time trigger" ถูกบันทึกใน dashboard-v2.md ตั้งแต่ 2026-05-10 แต่หลุดจาก "Pending user actions" ของ NEXT-SESSION รอบหลังๆ → ค้าง 8 วัน → bug เกิดทุกเช้า. Pending action ที่ user ต้องทำเอง ต้อง carry over จนกว่าจะ confirm closed.
> - **Apps Script time trigger fire ใน window กว้าง** — `atHour(8)` = fire ช่วง 8:00-9:00 ไม่ตรงเวลา. dedup window สั้นๆ กัน double-fire ระหว่าง Apps Script trigger กับ external scheduler ไม่ได้.
>
> **Session 2026-05-17 — Node 22 upgrade + AI Quoting design doc:** ✅
>
> **1. Node 18 → 22 LTS upgrade** ([`0adbdbb`](https://github.com/witsarutnook/penprinting-dashboard/commit/0adbdbb) + [`30d240a`](https://github.com/witsarutnook/penprinting-dashboard/commit/30d240a))
> - `nvm install 22` (v22.22.3) + `nvm alias default 22` + `.nvmrc` = `22`
> - แก้ pre-commit hook ที่พังบน Node 18 (vitest/rolldown ต้อง `node:util` styleText, Node ≥20.12) — ตอนนี้ `type-check + lint + test(72/72) + build` ผ่านครบบน Node 22
> - `package-lock.json` normalize (npm 10.9 ลบ `libc` hint 105 จุด — no version change)
> - ⚠️ คุณนุ๊กควรเช็ค terminal ตัวเอง: เปิด terminal ใหม่ `node -v` ต้องได้ v22 (ถ้ายัง v18 = profile pin ไว้)
>
> **2. AI Quoting — research + design doc** → [`design-ai-quoting.md`](design-ai-quoting.md) **status: READY TO BUILD**
> - ระบบ AI ตอบราคาเบื้องต้นงานพิมพ์ (จอ + LINE OA) — สถาปัตยกรรม 3 ชั้น: AI สกัด spec → calculator คิดราคา (pure functions reuse) → ส่งราคา/บันทึก lead
> - Research: calc.ts เป็น pure functions reuse server-side ได้ · LINE webhook flow · PEAK API pricing (จากอีเมล PEAK 16 เม.ย.)
> - **Decisions ล็อกครบ D1-D7** + §0 Brain complete: PEAK API ตัดออก (sales ทำใบเสนอราคามือ) · calc เปิด `/api/quote` · ราคาต่อชิ้นก่อน VAT ไม่ปัด · `/quote-leads` page · persona · journey edge cases
> - §13 Implementation Plan: Phase 0 (calc API 2 ไฟล์) → Phase 1a (dashboard ~8 ไฟล์ + Claude API tool-use + Postgres schema)
>
> ### 🎯 งานหลัก session หน้า — เริ่ม build AI Quoting Phase 0
> - อ่าน `design-ai-quoting.md` §13 → ลงมือ **Phase 0**: `print-calculator-next` เพิ่ม `app/api/quote/route.ts` + `lib/quote-schema.ts` (server-side pricing API)
> - verify: curl spec โบรชัวร์ → ราคาตรงกับหน้า calculator UI
> - แล้วต่อ Phase 1a (AI Quote Assistant ในจอ)
>
> ### Pending user actions
> - เช็ค `node -v` ใน terminal ตัวเอง = v22 (ดูข้อ 1)
> - ตัดสิน: เริ่ม Phase 0 ใน session ไหน + `ANTHROPIC_API_KEY` มีอยู่แล้วหรือสร้างใหม่ (ดู design doc §11)
> - ค้างเดิม: ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2 · cleanup diagnostic `.js`
>
> **Commits**: `0adbdbb` `30d240a` (Node 22) + doc commit (design-ai-quoting.md + NEXT-SESSION + dashboard-v2)
>
> ---
>
> **Session 2026-05-16 — dateIn double-encode root-cause (/diagnose) + QTY_UNITS feature:** ✅
>
> **Trigger:** `/session-start` → คุณนุ๊กเลือก Option A (root-cause `DATA-dateIn-double-encoded`) → ระหว่างทาง pivot ไปเพิ่มหน่วยจำนวนในฟอร์ม.
>
> **1. `DATA-dateIn-double-encoded` root-caused via `/diagnose` — accepted (no fix)**
> - **ตัวการ**: Apps Script `objectToRow()` (helpers.ts) เดิมไม่มี Date guard. `cancelOrder`/`promoteDraft` อ่าน order row ด้วย `getValues()` (date cell → JS `Date`) → flip status → เขียนกลับผ่าน `objectToRow` → `Date` ตก catch-all → `JSON.stringify` → quoted ISO `"\"...Z\""`.
> - **ไม่ใช่ `addOrder`** อย่างที่ AUDIT-BACKLOG เดา — `addOrder`/`createOrder` รับ `dateIn` เป็น string จาก v2 ไม่เคยเป็น Date.
> - **Source fixed แล้ว 2026-05-08** — `helpers.ts:49` + compiled `helpers.js:48` มี `if (val instanceof Date) return val;` (verified deployed). 3 rows (202605046/047/049) = legacy residue ก่อน 8 พ.ค.
> - **Decision: ไม่เขียน cleanup helper** — `displayDate()` unwrap quote ให้อยู่แล้ว display ไม่พัง + 3 orders เก่าเสร็จแล้ว. AUDIT-BACKLOG entry updated → `[accepted]`.
>
> **2. เพิ่มหน่วยจำนวน กล่อง/ถุง/ชิ้น** ([`238d40d`](https://github.com/witsarutnook/penprinting-dashboard/commit/238d40d))
> - `QTY_UNITS` ใน `app/board/order-form.tsx:105` — `['แผ่น','ชุด','เล่ม']` → `['แผ่น','ชุด','เล่ม','กล่อง','ถุง','ชิ้น']`
> - แก้ v2 อย่างเดียว — คุณนุ๊กระบุไม่แตะ WP (กำลังจะ drop). Type-check ผ่าน, push แล้ว.
>
> ### Lessons
> - **AUDIT-BACKLOG hypothesis เชื่อไม่ได้เสมอ** — entry เดิมเดา `addOrder` แต่ code comment ใน `displayDate()` (lib/jobs.ts:65-73) document root-cause จริง + วันที่ fix ไว้แล้ว. ก่อน re-investigate audit item → grep หา comment ที่พูดถึง symptom ในโค้ดก่อน.
> - **`_scan-phase2` date-anomaly เช็คแค่ `dateIn`** — ไม่เช็ค `dateDue` ทั้งที่ cancelOrder/promoteDraft เขียนทับทั้ง row → scan v2 ควรเพิ่ม `INVALID_DATEDUE`.
>
> ### ⚠️ Pre-commit hook พัง — ต้องแก้ก่อน commit รอบหน้า
> - **อาการ**: `npm test` ใน pre-commit hook (`type-check && lint && test`) — vitest **startup error** `node:util` ไม่มี export `styleText`. vitest/rolldown ที่ติดตั้งต้องการ Node ≥ 20.12 แต่เครื่องรัน **Node v18.20.4**.
> - **ผลกระทบ**: ทุก commit ของ penprinting-dashboard จะติด hook นี้จนกว่าจะแก้. commit `dashboard-v2.md` รอบนี้ใช้ `--no-verify` (คุณนุ๊กอนุมัติ — doc-only, type-check/lint ผ่าน, hook พังเพราะ environment ไม่ใช่ test regression).
> - **Fix → งานแรก session หน้า (คุณนุ๊กตัดสิน 2026-05-17): upgrade Node → 22 LTS, ทำด้วยกัน.** ขั้นตอน: `nvm install 22 && nvm use 22 && nvm alias default 22` → `cd penprinting-dashboard && npm install` (rebuild deps) → เพิ่ม/อัปเดต `.nvmrc` = `22` → verify `npm run type-check && npm run lint && npm test && npm run build`. ⚠️ ระวัง native deps อาจต้อง rebuild หลังเปลี่ยน Node major — เผื่อเวลา debug. ทำให้ครบทั้ง 4 projects ก็ดี (penprinting-web / print-calculator-next / penprintphotobook ใช้ Node 22 ได้หมด).
>
> ### Pending user actions
> - **(งานแรก session หน้า) แก้ pre-commit hook — upgrade Node → 22 LTS ทำด้วยกัน** (ดู section ⚠️ ด้านบน)
> - ค้างเดิมจาก 2026-05-15: ORPHAN_CANCELLED cleanup (`cleanupOrphanCancelled()` dry-run → ตัดสิน historical rows), `/check-quota`, scan v2, cleanup diagnostic `.js` จาก Apps Script editor, Vercel Analytics watch /track p95.
> - (`DATA-dateIn-double-encoded` ปิดแล้ว — accepted, ไม่ต้องทำอะไรต่อ นอกจาก optional SQL UPDATE ตอน migration cutover)
>
> **Commits**: `238d40d` (feature QTY_UNITS) + `9fe5379` (docs root-cause) + doc commit dashboard-v2.md (`--no-verify` เพราะ hook พัง).
>
> ---
>
> **Session 2026-05-15 — pending verifications (Option B): Phase 2 smoke + data-integrity scan + quota runbook:** ✅
>
> **Trigger:** `/session-start` → คุณนุ๊กเลือก Option B (run pending verifications ที่ค้างมา 2 sessions). **ไม่มี code changes** — verification + data-integrity session ล้วน.
>
> **1. Smoke test 6 Phase 2 actions — ✅ ผ่านครบ 6/6**
> - addJob / promoteDraft / bulkForward / moveToShipped / cancelJob / cancelOrder — user smoke-tested ใน browser, ผ่านหมด ไม่มี 404 / stale / timeout
> - Phase 2 (Postgres-first writes) ยืนยันเสถียรหลัง live ~2 อาทิตย์
>
> **2. /data-doctor proactive scan — ✅ รันแล้ว, 3 findings**
> - สร้าง `production-monitoring/_scan-phase2.gs` (scan 9 มิติ, read-only) → push เข้า Apps Script ผ่าน clasp (`_scan-phase2.js`)
> - คุณนุ๊กรัน `runPhase2IntegrityScan()` — counts: orders=171 jobs=41 shipped=115 cancelled=28
> - **Result: 0 critical / 1 high / 2 medium / 0 low**
>   - 🟠 HIGH `ORPHAN_ORDER` ×122 — **scan false positive** (scan check แค่ `jobs` sheet, ไม่ cross-ref `shipped`). orders status="sent" ที่ jobs ส่งของหมดแล้วถูก flag ผิด. ไม่ใช่ data bug — เป็น scan limitation. scan v2 (cross-ref) ยังไม่ได้รัน.
>   - 🟡 MEDIUM `ORPHAN_CANCELLED` ×4 — cancelled rows อ้าง orderId ที่หายไป (202604024 "ใบปลิวสาขา", 202604068 "สสส", 202605039 "test", 202605055 "หหหห")
>   - 🟡 MEDIUM `DATE_ANOMALY` ×3 — **real bug.** orders 202605046/047/049 (orders sheet rows 118/119/121, sequential) มี `dateIn` double-encoded เป็น JSON string `"\"2026-05-07T17:00:00.000Z\""`. → ขึ้น AUDIT-BACKLOG เป็น open item `DATA-dateIn-double-encoded`
>
> **3. ORPHAN_CANCELLED cleanup — helper เขียนแล้ว, รอ user รัน**
> - data-doctor สร้าง `production-monitoring/_cleanup-orphan-cancelled.gs` → push เข้า Apps Script (`_cleanup-orphan-cancelled.js`)
> - `cleanupOrphanCancelled()` — `DRY_RUN=true` default, LockService 15s, descending row delete, triple-verify (id+name+orderId), re-check orphan ก่อนลบ
> - **ยังไม่รัน** — รอคุณนุ๊กตัดสินใจว่าจะเก็บ 2 row เก่า (202604024, 202604068) ไว้เป็น historical มั้ย
>
> **4. /check-quota — runbook ส่งให้ user แล้ว** — ยังไม่ report quota numbers กลับมา
>
> ### Lessons
> - **Diagnostic `.gs` files push ผ่าน clasp ได้** — เดิม `_diagnose-202605036.gs` ใช้ paste มือใน editor. Session นี้ยืนยัน `clasp push` (copy → `apps-script/dashboard/*.js` → `clasp push -f`) เร็วกว่า + ไม่ผิดพลาด. `push` ≠ `deploy` — ไม่กระทบ live deployment URL. (saved to memory)
> - **Scan ที่เช็คแค่ active sheet → false-positive กับ orders ที่ jobs archived หมดแล้ว** — scan v2 ต้อง cross-ref `jobs` + `shipped` + `cancelled` ก่อนสรุปว่า order orphan
>
> ### Pending user actions (queued)
> - **ORPHAN_CANCELLED cleanup** — รัน `cleanupOrphanCancelled()` dry-run → ตัดสิน historical rows (202604024/202604068) → live run → re-scan verify
> - **DATE_ANOMALY** — ยังไม่ fix (3 rows). ต้อง root-cause `addOrder` write path ก่อน → เขียน fix helper (ดู AUDIT-BACKLOG `DATA-dateIn-double-encoded`)
> - **scan v2** — ถ้าอยากปิดคำถาม "122 orphan จริงมั้ย" → รัน cross-ref scan
> - **/check-quota** — เปิด Apps Script Executions + Cloudflare Worker metrics ดู 24h
> - **cleanup `_scan-phase2.js` + `_cleanup-orphan-cancelled.js`** จาก Apps Script editor หลังใช้เสร็จ (ลบ `.js` จาก `apps-script/dashboard/` + `clasp push -f` ซ้ำ)
> - (ค้างเดิม) Vercel Analytics watch /track p95
>
> ### Files created (`production-monitoring/` — ไม่ใช่ git repo, ไม่ commit)
> - `_scan-phase2.gs` + `apps-script/dashboard/_scan-phase2.js` (pushed to Apps Script)
> - `_cleanup-orphan-cancelled.gs` + `apps-script/dashboard/_cleanup-orphan-cancelled.js` (pushed to Apps Script)
>
> **No code changes to git subprojects.** Doc commit only (NEXT-SESSION + AUDIT-BACKLOG).
>
> ---
>
> **Session 2026-05-14 — admin cross-dept reassign + Phase 2 stale-read fix #3 + cowork "เสร็จงาน" button:** ✅
>
> **3 features shipped, 3 commits, smoke-tested by user:**
>
> 1. **Admin reassign ข้ามแผนกได้** ([`c2cd3b5`](https://github.com/witsarutnook/penprinting-dashboard/commit/c2cd3b5))
>    - Card "ย้าย" dropdown ของ admin → list staff ทั้ง 3 แผนก (graphic + print + post) พร้อม prefix `[กราฟิก]`/`[พิมพ์]`/`[หลังพิมพ์]` เวลา cross-dept
>    - Server: `/api/jobs/reassign` รับ optional `targetDept` (admin-only ถ้า ≠ srcDept). `dateIn` ไม่แตะ (admin reassign = "fix mistake" ไม่ใช่ workflow advance)
>    - Wrong-direction (post → graphic) allowed — รองรับการแก้พนักงานส่งต่อผิด
>    - Drag-drop semantic เดิม (cross-column = forward dialog) — ไม่แตะ
>    - Audit data carries `prevDept` + `prevStaff` for trail
>
> 2. **Phase 2 stale-read fix #3** ([`159333c`](https://github.com/witsarutnook/penprinting-dashboard/commit/159333c)) — user-reported "ไม่พบใบสั่งงาน" บน order #202605093
>    - Bug: `/api/orders/update` ใช้ `loadAllFresh()` (Apps Script Sheet) ตรวจ existence → Sheet เป็น cron-lagged mirror หลัง Phase 2 → 404 ตอนเปลี่ยนชื่องาน/วันส่ง
>    - Same disease as `c0be3b8` (loadOrder, 2026-05-12) + `1f62d3b` (promote-draft, 2026-05-11) — third occurrence
>    - **Decision per memory rule**: ไม่เขียน helper #2/#3 — widen scope ของ helper #1 แทน. Renamed `loadOrderAndJobsForPromote` → `loadOrderAndJobs` + reuse ใน `/api/orders/{update, cancel, delete}` ทั้ง 3 routes
>    - 5 files changed, 70 insertions, 52 deletions
>
> 3. **"เสร็จงาน Co-work" button บน guest cards** ([`af8597b`](https://github.com/witsarutnook/penprinting-dashboard/commit/af8597b))
>    - Guest cowork cards (มี badge "ร่วมพิมพ์" ใน column ของ cowork member) ตอนนี้มีปุ่ม violet "เสร็จงาน Co-work"
>    - Confirm dialog → POST /api/jobs/cowork ส่ง list ใหม่ที่ลบ self ออก → optimistic hide
>    - All roles allowed (เครื่องที่ทำเสร็จควร mark เองได้)
>    - **Why explicit `guestStaff` field**: `BoardJob.staff` บน guest copy ยังชี้ host (จาก `{...job, isGuest: true}` spread) — ต้อง derived `guestStaff` set ที่ fan-out ใน `computeBoard` (lib/board.ts) เพื่อรู้ว่าเป็น "ฉัน" คนไหน
>
> ### Verified
> - Type-check ✅ / 72 vitest tests ✅ / production build ✅ ทั้ง 3 commits
> - User smoke test ผ่านครบ 3 features (cross-dept move, edit order ที่เคย 404, cowork remove-self)
>
> ### Lessons
> - **Memory rule "helper #2 = root cause signal" จับได้แม่น** — เห็นปัญหาตั้งแต่ขั้นเช็ค `loadAllFresh` callers, ไม่ได้ตามล่า patch แต่ละ route. Renamed `loadOrderAndJobsForPromote` → `loadOrderAndJobs` ลด misleading scope. ([memory updated](../../../.claude/projects/-Users-witsarut-p/memory/feedback_loadorder_postgres_first.md): noted 3rd occurrence + flagged `loadAllFresh` as next likely landmine)
> - **Cross-dept reassign ≠ forward** — ขยาย reassign action (ไม่แตะ `dateIn`) ดีกว่าทำให้ workflow forward ทำงานข้ามแผนกได้ทุกทิศ. Drag-drop semantic ก็คงเดิม → user mental model ไม่กระเทือน
> - **Guest cards ต้อง explicit self id** — fan-out logic ที่ spread host job ทับ → field `staff` ไม่ได้ยึดกับ column ที่ render. Set `guestStaff` ตอน fan-out ป้องกัน future guest-action features เจอปัญหาเดียวกัน
>
> ### Pending user actions ที่ยังค้างจาก 2026-05-12 (ยังเหมือนเดิม — ไม่มีอะไรใหม่)
> - Smoke test 6 Phase 2 actions เดิม (moveToShipped/cancelJob/bulkForward/cancelOrder/promoteDraft/addJob)
> - `/data-doctor` scan
> - `/check-quota` (Apps Script + Cloudflare quota trend)
> - Vercel Analytics watch /track p95 24-48h
>
> ### Recommended next session
> 1. **Phase 4.2 close-out planning** (drop Apps Script writes — needs Phase 2 stable ≥1 month → wait until ~early มิถุนา 2026)
> 2. หรือ run pending verifications ที่ค้าง 2 sessions แล้ว
> 3. หรือ user-reported items ใหม่
>
> ---
>
> **Session 2026-05-13 — Tech-Roadmap-Status.md doc sync (no code):** ✅
>
> **Trigger:** คุณนุ๊กถาม "drop Apps Script อยู่เฟสไหน" — เปิด docs ดูเจอ drift: Tech-Roadmap-Status.md ยัง mark Phase 4.2 = "Deferred" แต่ session 2026-05-11 ดัน 11 actions Postgres-first writes live ครบแล้ว
>
> **Doc updated** (workspace root — Obsidian vault, **ไม่ใช่ git repo** จึงไม่ commit):
> - `last-updated` 2026-05-09 → **2026-05-12**
> - **Banner top** เพิ่ม 2 entries (2026-05-11 mega session + 2026-05-12 audit mega-day)
> - **Phase table** — Phase 4.2 "⏳ Deferred" → **"✅ Mostly done"** (11 actions live, flags ON). เพิ่ม 2 rows ใหม่: **Phase 4.2 close-out** (drop Apps Script writes ทั้งหมด — defer ~ต้นมิถุนา 2026), **Phase 4.3 cleanup** (LINE webhook + audit cron + primary backend role — depends on 4.2 close-out)
> - **Known issues** — ลบ stale "Phase 2.1 Code.js เหลือ 657 บรรทัด" (จริงๆ 93 lines), เพิ่ม APPS_SCRIPT_TOKEN rotation + Phase 4.2 close-out tracking
> - **Timeline** — เพิ่ม 5 entries (2026-05-08, 09, 10, 11, 12) + reorganize Future section
> - **Recommended next session** — rewrite สะท้อนสถานะปัจจุบัน
>
> **Lesson (saved to memory):** Workspace-root docs (Tech-Roadmap-Status.md, CLAUDE.md, MEMORY.md) เป็น Obsidian vault notes ที่อยู่นอก git tree. มี git repo แค่ใน 4 subprojects (penprinting-dashboard, penprinting-web, print-calculator-next, penprintphotobook). ก่อนเสนอ commit สำหรับ doc updates → verify ด้วย `git rev-parse --show-toplevel` ว่าไฟล์อยู่ใน repo ไหน
>
> **No code touched.** No subproject commits. No Apps Script changes. No env vars.
>
> **Pending user actions** ที่ยังค้างจาก 2026-05-12 ยังเหมือนเดิม (ดู section ด้านล่าง — Smoke test 6 Phase 2 actions, /data-doctor scan, /check-quota, Vercel Analytics watch).
>
> ---
>
> **Session 2026-05-12 — print page stale-read root-cause fix (`loadOrder` refactor):** ✅
>
> **User-reported (2026-05-12):**
> 1. แก้ไขงานเสร็จ → กดพิมพ์ใบสั่งใหม่ → ค่าที่พิมพ์ยังเป็น "ก่อนแก้"
> 2. กด "พิมพ์+ส่ง" / "พิมพ์" → บางครั้ง 404
>
> **Root cause (one bug, two symptoms):** `loadOrder()` ใน [lib/api.ts](lib/api.ts) มี carve-out `if ((opts.revalidate ?? 0) > 0)` ที่ skip Postgres เมื่อ caller ขอ fresh read. Logic นี้ถูกตอน Phase 1 (Postgres mirror lag, Sheet fresh) แต่กลับด้านหลัง Phase 2 (createOrder/updateOrder writes ลง Postgres เท่านั้น, Sheet lag ≤5 นาที). Print page เรียก `loadOrder(id)` ไม่ใส่ opts → revalidate=0 → skip Postgres → อ่าน Apps Script `getOrder` → ยังเป็นค่าเก่า / null = stale หรือ 404.
>
> **Sister bug ที่เคย patch:** `1f62d3b` (promote-draft) สร้าง `loadOrderAndJobsForPromote()` workaround helper. NEXT-SESSION 2026-05-11 บันทึก lesson ไว้แล้ว: "Phase 2 stale-read trap recurring — Pattern fix: write Postgres-first helpers." Refactor นี้ปิด root cause ที่ลึกกว่า patch (ทำที่ `loadOrder` เองแทนสร้าง helper ใหม่ทุกรอบ).
>
> **Fix** (`lib/api.ts` `loadOrder()`):
> - ลบ `if ((opts.revalidate ?? 0) > 0)` carve-out
> - Postgres-first ทุก call. `loadOrderFromPostgres` throws `PostgresStaleError` เมื่อไม่เจอ row → `tryPostgres` return null → fall through ไป Apps Script (สำหรับ Phase 1.x stragglers ที่ mirror cron ยังไม่ทัน)
> - Comment ใน [`app/orders/[id]/print/page.tsx`](app/orders/[id]/print/page.tsx) อัปเดตให้สะท้อน new path
>
> **Verified:** type-check ✅ / 72 vitest tests ✅ / production build ✅
>
> **Behavior change ของ 5 callers:**
> | Caller | เดิม | หลัง refactor |
> |---|---|---|
> | `/api/track/lookup` (revalidate=30 + retry 0) | Postgres → Apps Script (retry only) | Postgres ทั้งคู่ + Apps Script fallback |
> | `/api/orders/raw/[id]` (revalidate=30) | Postgres-first | เหมือนเดิม |
> | `/api/jobs/restore` (no opts) | Apps Script direct | **ดีขึ้น** — Postgres-first, เห็น Phase 2 writes |
> | `/orders/[id]/tracking-card` (no opts) | Apps Script direct | **bug fixed** (Phase 2 track 404) |
> | `/orders/[id]/print` (no opts) | Apps Script direct | **bug fixed (รายงานนี้)** |
>
> **Lessons:**
> - **Strangler-pattern read paths invert staleness assumption when write side migrates.** "Read fresh = read Sheet" was true under Phase 1; under Phase 2 "read fresh = read Postgres". Code ที่ hard-code staleness model = recurring bug factory จนกว่าจะ refactor ที่ root
> - **Workaround helpers (`loadOrderAndJobsForPromote`) signal latent root cause.** ถ้าเริ่มเขียน helper #2 ทำงานเดียวกัน → refactor ที่ต้นทาง ไม่ใช่เพิ่ม helper อีก
> - **Rollback recipe:** `git revert <commit>` (ไม่มี env flag เพราะ behavior strictly improves ภายใต้ `READ_FROM_POSTGRES=1` ที่ ON อยู่แล้ว). หรือถ้า Postgres ล่ม → unset `READ_FROM_POSTGRES` → กลับ Apps Script 100% (รวมถึง path นี้)
>
> ### Audit cleanup follow-up (`f4f3474`) — same session
>
> ✅ M4 narrow staleness gate → `['orders']` (lib/api-postgres.ts) — peripheral table stale ไม่ degrade ทุก loadOrder caller
> ✅ M1 drop redundant retry block ใน track/lookup (loadOrder ทำ fallback ในตัวอยู่แล้ว)
> ✅ L1/L2/L4 stale comments updated
> ⏳ M3 (deferred to backlog) — restore route ไม่ block restore job ที่ parent ถูก cancel. Pre-existing, low frequency. Tracked เป็น `M-restore-cancelled-parent` ใน AUDIT-BACKLOG.md
> ℹ️ M2 (monitor only) — edge /track p95 ต้องดู 24-48h หลัง refactor. ถ้า regress → revert retry แต่ไป Apps Script direct
>
> ### Phase 2 activation verification (2026-05-12)
>
> User reported 2 bugs at start of session → diagnosis ระบุว่า Phase 2 fully ON. Vercel UI verification: **all 11 WRITE_* flags + READ_FROM_POSTGRES = ON, All Environments** (5 added 19-21h ago, 3 added 1-2d ago). Apps Script v5.10.14 deployed (Version 42, May 11 3:19 PM). Phase 2 migration **complete**.
>
> **Smoke test pending คุณนุ๊ก** (~10 min, do at convenience):
>
> 1. **moveToShipped** — /board → ship ✓ บน job test → card หายทันที + /shipped row ใหม่ (audit "ส่งงานเรียบร้อย...")
> 2. **cancelJob** — /board → ยกเลิก + ใส่เหตุผล → card หาย + /cancelled row ใหม่
> 3. **bulkForward** — /board → drag-drop card ข้าม column → ~250ms + per-job audit "ส่งต่องาน..."
> 4. **cancelOrder** — /orders → คลิก order → ยกเลิกใบสั่ง → cascade cancel jobs + order flips
> 5. **promoteDraft** — /orders → คลิก draft → "บันทึก + ส่งเข้าระบบ" → save + promote + /board redirect
> 6. **addJob** — /orders → data-audit modal → "เพิ่มงาน" ที่ orphan order → job ใหม่ขึ้น
> 7. **รอ 5 นาที → Google Sheet** — เปิด tab jobs/shipped/cancelled/orders → confirm rows sync ครบ
>
> updateOrder + createOrder ไม่ต้อง test เพราะ user prove แล้วว่าใช้จริงตลอดวัน (bugs ที่ surfaced วันนี้ก็คือหลักฐาน)
>
> **Rollback (per action):** Vercel env → unset flag → redeploy → กลับ legacy. Heal cron + tombstone infra ยังทำงานต่อ → eventual consistency.
>
> ### Table-skip cron — deferred (decision)
>
> Considered: extending `phase2OwnsTable()` ใน [lib/feature-flags.ts](lib/feature-flags.ts) สำหรับ jobs/orders/shipped/cancelled → drop Sheet→Postgres cron pass สำหรับ tables ที่ Postgres own
>
> **Decision: defer.** Rationale:
> - Cron ตอนนี้ใช้ `deleteCleanThenInsert` ที่ preserve Phase 2 dirty rows อยู่แล้ว → cron ไม่ overwrite Phase 2 writes ถึงแม้ table-skip ไม่ active
> - Benefit = ~5s + Apps Script quota call ต่อ 10-min cron pass (incremental perf, not correctness)
> - Risk = lose Sheet→Postgres safety net สำหรับ stragglers / drift / direct admin Sheet edits (rare แต่ไม่ใช่ 0)
> - Effort = ~30 min implementation + needs 1-2 weeks production observation ก่อน flip
>
> **Future trigger to revisit:** ถ้า Apps Script daily quota เริ่มชน 80% threshold หรือ Vercel cron latency กระทบ user → table-skip cron จะคุ้มทำ. ไม่งั้น defer ต่อ
>
> ### 5-dimensional audit batch + Sprint 1/2 follow-up (same session)
>
> After the loadOrder fix above, ran a **comprehensive audit across 5 dimensions** via 4 parallel subagents (data-doctor + perf + a11y + security) + manual architecture review:
>
> **Audit findings totals**: 18 a11y / 12 perf / 12 security / 6 medium tech-debt
> **Net assessments**: 🟡 yellow across the board — production-grade with surgical gaps
>
> **Sprint 1 (`6e46d82`) — 6 high-impact fixes** (~3-4h):
> - **PERF-F1** 4 route-segment `loading.tsx` files (board/orders/calendar/analytics) — eliminate blank-screen gap
> - **A05-1** Security headers in `next.config.mjs` (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
> - **PERF-B2** `allSettledLimit(cap=3)` on `/api/orders/update` cascade — match M5 pattern (timeout-resistant)
> - **A11Y-R1** `<main id="main-content">` landmark + skip-to-content link in DashboardShell + global `focus-visible:` outline rule in globals.css
> - **A11Y-O2** Touch targets 44×44 — 9 modal close buttons + MobileUserMenu trigger + toast dismiss
> - **PERF-C1** Card `arePropsEqual` field-level compare (replaces JSON.stringify) — ~500KB string work/tick saved
>
> **Sprint 2 (`190c5fe`) — 4 security + a11y deeper fixes** (~3h):
> - **A04-1** /track 3-layer brute-force resistance — IP rate-limit via Upstash + per-id PIN-failure lockout via new `peekRateLimit` + `recordFailure` helpers in `lib/rate-limit.ts` + `timingSafeStringEqual` constant-time compare
> - **A09-1** Login audit logging (`[auth]` grep-able structured logs + Sentry breadcrumb on suspicious events) — covers success/fail/rate-limit/invalid-input
> - **A11Y-P1** Urgency badge contrast — new `URGENCY_BADGE` paired Tailwind tokens (~8:1 vs prior ~3:1), refactored 6 callsites across board/card, orders-table, calendar/grid, calendar/page Pill
> - **A11Y-U2** Form errors `role="alert" aria-live="assertive"` — login + /track + ForwardDialog + ReassignDialog (×3) + BulkActionsBar
>
> **Total session 2026-05-12**: 5 commits / 10 audit findings closed (M3 + M-restore + L2 + L4 + M4 + M1 + L1/L2/L4 + Sprint1×6 + Sprint2×4) / 0 user-visible regressions / type-check ✅ / 72 tests ✅ / build ✅
>
> **Follow-up chore (same day, after Sentry report):** `6131e8b` — Sentry `ignoreErrors` filter expanded to drop browser-extension `sendMessage` + "Extension context invalidated" noise. Triggered by Sentry-reported `TypeError: Cannot read properties of undefined (reading 'sendMessage')` on `/board?dept=print` (2026-05-12T08:47Z) — not our code, content-script context-invalidation from a user's extension. Regex stays tight (specific message text) so future real `sendMessage` errors in our own code still surface. Type-check ✅ / 72 tests ✅ / lint ✅ / pushed → Vercel auto-deploy.
>
> ### Audit items deferred to Sprint 3 (low ROI vs Sprint 1+2)
> - **A04-2** APPS_SCRIPT_TOKEN 5y → 90d rotation (defensive — no breach yet)
> - **M-A01-1** `/api/orders/raw` role-gate to admin+sales (low real risk — staff trusted)
> - **PERF-A1** OrdersData rawData payload trim (needs careful UX testing — /orders is admin-only, not hot path)
> - **ARCH-OBS** Sentry DSN setup (user-deferred earlier in session)
> - **MFA + per-user passwords** (4-user app, MFA overkill at current scale)
> - **E2E tests (Playwright)** (72 unit + manual smoke acceptable at scale)
> - **Phase 4.2 close-out** (drop Apps Script writes — needs Phase 2 stable ≥1 month first)
>
> ### User actions queued
> 1. **Smoke test 6 Phase 2 actions** (~10 min) — checklist above
> 2. **`/data-doctor` scan** (Apps Script `divergenceScan()` + Postgres SQL — runbook generated this session)
> 3. **`/check-quota`** (Apps Script + Cloudflare quota trend after Phase 2 full activation)
> 4. **Vercel Analytics watch** /track p95 24-48h (M2 monitor item — Postgres-on-edge cold-start concern)
>
> ### Workspace rule additions (end of session — `/session-end` invoked)
>
> คุณนุ๊กเพิ่ม **Session Discipline rule** ให้ apply ทุก session — context check ก่อนเริ่มงาน + doc update ก่อนปิด session. ติดตั้ง 4 ที่:
> 1. **Workspace CLAUDE.md** § "Session Discipline" — auto-load ทุก session
> 2. **Memory** [`feedback_session_discipline.md`](../../../.claude/projects/-Users-witsarut-p/memory/feedback_session_discipline.md) + MEMORY.md index
> 3. **`/session-start`** slash command — `.claude/commands/session-start.md` (Step 1-6 checklist)
> 4. **`/session-end`** slash command — `.claude/commands/session-end.md` (Step 1-7 checklist)
>
> Session ใหม่ Claude จะ:
> - อ่าน NEXT-SESSION + AUDIT-BACKLOG + git log + pending actions อัตโนมัติ ก่อน confirm direction กับคุณนุ๊ก
> - ก่อนปิด session: surface uncommitted changes + update docs + memory lesson + แจ้ง pending user actions
>
> ---
>
> **Session 2026-05-11 ★ MEGA SESSION (P1 guardrails + Phase 2 jobs + orders + tombstone + audit pipeline + UX overhaul):** ✅
>
> **19+ commits + 5 Apps Script clasp pushes + 28→72 tests. Phase 2 migration covers virtually all hot-path mutations.**
>
> ### Phase 2 actions migrated (11 total — jobs + orders hot-path)
> | # | Action | Commit | Status |
> |---|---|---|---|
> | 1 | setCowork (from 2026-05-10) | — | ✅ live (earlier) |
> | 2 | updateJob | `a52381e` | ✅ live |
> | 3 | addJob | `fda396d` | ✅ live |
> | 4 | createOrder | `b3d6515` | ✅ live |
> | 5 | reassignStaff (piggybacks updateJob flag) | `1746946` | ✅ live |
> | 6 | moveToShipped | `825857e` | ✅ live (2026-05-11 21h, verified 05-12) |
> | 7 | cancelJob | `825857e` | ✅ live (2026-05-11 21h, verified 05-12) |
> | 8 | bulkForward + single forward | `d1fb66e` | ✅ live (2026-05-11 20h, verified 05-12) |
> | 9 | updateOrder | `010cf35` | ✅ live (2026-05-11 19h, verified 05-12) |
> | 10 | promoteDraft | `010cf35` | ✅ live (2026-05-11 19h, verified 05-12) |
> | 11 | cancelOrder | `010cf35` | ✅ live (2026-05-11 19h, verified 05-12) |
>
> **Skipped (intentional — dead UI paths):** deleteJob (admin-only data-audit tool), deleteOrder + deleteOrderCascade (zero callers in v2 UI), addOrder (createOrder covers).
>
> ### Infrastructure built today
> - **P1.a husky pre-commit** (`a7082f0`) — tsc + lint + vitest blocks every commit
> - **P1.b vitest** (`521292d`) — 28 initial tests; grew to **72 tests by EOD**, TDD red-phase verified for every migration
> - **Tombstone pattern** (`825857e`) — `jobs.phase2_deleted_at` + heal cron `healJobsTombstone` + from-Sheet cron predicate. Solves "move row out of jobs sheet" for moveToShipped/cancelJob/bulkForward
> - **6 new Apps Script actions** (v5.10.12/v5.10.13/v5.10.14 — clasp-pushed) — setOrderRow, setShippedRow, setCancelledRow, deleteJobByIdRow, setJobRow patches, audit.ts createOrder targetId fix
> - **Audit log pipeline** (`48a3127`, `242db89`, `d19ba75`, `f524fbd`) — schema source column + DELETE-not-TRUNCATE + appendAuditToPostgres + bootstrap loop fix in sync-from-sheet
> - **UX spec restructured** (`e2094c0`) — WP-style sections + chip flags via `lib/spec-format.ts`
> - **UX combined button** (`e9c60a9`) — "บันทึก + ส่งเข้าระบบ" on edit-draft footer: 1-click save+promote chain via `submitAndPromote` mode in OrderForm
> - **promote-draft Postgres-first** (`1f62d3b`) — new `loadOrderAndJobsForPromote()` helper bypasses Sheet stale-read so Phase 2 createOrder orders can be promoted immediately
> - **UX busy continuity** (`030dabf`) — kept `busy=true` through entire save→promote chain + added toast
> - **Diagnostic endpoints** — `/api/admin/diagnose-audit?id=&test=1` + `/api/admin/diagnose-order?id=` for next-session debugging
>
> ### Lessons (memory)
> - **/diagnose skill loop saved multiple bugs today** — initial fixes were wrong direction on audit-log + promote-draft until Phase 4 instrumentation pinned actual root cause
> - **Phase 2 stale-read trap recurring** — any write path that LATER reads via Apps Script direct (`loadAllFresh`) will see stale data when Phase 2 wrote to Postgres only. Pattern fix: write Postgres-first helpers that read Postgres direct, fall back to Apps Script only for Phase 1.7 stragglers
> - **Combined-action UX requires busy state spanning entire chain** — `setBusy(false)` before chained fetch flickers button back to idle ("เงียบ" symptom)
> - **Pre-existing bug found by /diagnose** — Apps Script legacy `addJob` double-bumps nextId (calls incrementConfig AFTER getNextId already bumped) → id gaps. Phase 2 addJob path eliminates this
>
> **Session 2026-05-10 (afternoon batch 5 — Phase 2 setCowork sync_meta bug fix):** ✅
> - **Symptom**: หลัง activate `WRITE_COWORK_TO_POSTGRES=1` + drop inline Apps Script sync, /board cards ไม่ render cowork chip ใหม่ ทั้งที่ toast success + Postgres state ถูกต้อง
> - **Diagnosed via** `/diagnose` skill + 5-layer diagnostic endpoint (`/api/admin/diagnose-board`):
>   - Layer 1 Postgres direct: ✅ cowork = `["mo"]`
>   - Layer 2 loadAllFromPostgres: ❌ throws `PostgresStaleError: templates last synced 107 min ago`
>   - Layer 3 loadAll wrapper: silently falls back to Apps Script
>   - Layer 4 Apps Script: returns `cowork: undefined` because heal cron hadn't pushed to Sheet yet (5-min cron, just-written rows are dirty)
> - **Root cause**: Phase 2 templates migration (afternoon batch 3) skipped cron sync via `phase2OwnsTable('templates')` แต่ลืมอัปเดต `sync_meta.last_sync_at` → templates "stale" ตามเวลา → staleness check fail → silent fallback to Apps Script → /board reads stale Sheet
> - **Fix** (`de9d06a`): `lib/sync-from-sheet.ts` — when skipping a Phase 2-owned table, call new `recordSyncMetaTouch(table)` to update last_sync_at + ok=true (no row_count change). Semantically: "Postgres owns this; data current via Phase 2 writes, not cron."
> - **Manual remediation**: hit `/api/admin/sync-all` once after deploy to update sync_meta immediately (otherwise wait ≤10 min for next cron cycle)
> - **Verified all 4 layers via diagnose-board** + user confirmed /board cards now update within ~300ms
> - **Lesson captured**: any future Phase 2 table-level skip MUST call `recordSyncMetaTouch()`. Phase 2 row-level dirty marker (jobs/orders/etc.) doesn't have this issue because cron still runs + updates sync_meta normally
> - **Total**: 2 commits (`fd9ce1f` diagnostic + `de9d06a` fix). Diagnostic endpoint kept for future Phase 2 debugging
>
> **Session 2026-05-10 (afternoon batch 4 — Phase 2 reverse-sync infra + setCowork):** ✅
> - **Architectural insight**: Templates migration was clean เพราะ table-level ownership (cron skip table). setCowork (และ actions ส่วนใหญ่ที่เหลือ) แตะ `jobs/orders/shipped/cancelled` ที่ยังมี actions อื่น write ผ่าน Apps Script อยู่ → cron ต้อง keep running → table-skip ไม่ใช้. ต้อง row-level ownership marker
> - **Phase 2 reverse-sync infrastructure**:
>   - **Schema**: `phase2_dirty_at TIMESTAMPTZ` column + partial index บน 4 tables (db-migrate idempotent ALTER)
>   - **From-Sheet cron** ([sync-from-sheet.ts](lib/sync-from-sheet.ts)): TRUNCATE+INSERT → "DELETE WHERE phase2_dirty_at IS NULL + INSERT ON CONFLICT DO NOTHING". Phase 2 dirty rows survive cron passes
>   - **To-Sheet heal cron** (`/api/cron/sync-to-sheet`, schedule `*/5 * * * *`): SELECT dirty rows → call Apps Script `setJobRow` → mark clean on success. Batch limit 50/run
>   - **Helpers** ([postgres-write.ts](lib/postgres-write.ts)): `markRowDirty`, `markRowClean`, `setCoworkInPostgres`. Phase 2 paths set dirty + clear on inline-sync success; cron retries failed inline syncs
> - **Apps Script v5.10.11**: `setJobRow` action — generic upsert that accepts pre-allocated id + idempotent (append if not found, overwrite if exists). Mirrors setTemplateRow pattern. Available for heal cron + future Phase 2 actions
> - **First migrated using new infra**: `setCowork` ([app/api/jobs/cowork/route.ts](app/api/jobs/cowork/route.ts)) — flag-gated branch via `WRITE_COWORK_TO_POSTGRES=1`. Postgres UPDATE + dirty mark → inline `setCowork` Apps Script call → markClean on success / leave dirty for heal cron on failure. Fallback to legacy if row not in Postgres yet (older row before Phase 1.7 mirror)
> - **Failure mode contract**: Inline sync fail → row stays `phase2_dirty_at IS NOT NULL` → from-Sheet cron skips → heal cron retries within 5 min → success clears mark. Worst case: ~5 min Sheet drift before heal catches up
> - **Default-off** — `WRITE_COWORK_TO_POSTGRES` flag ยังไม่ flip ที่ production
> - **Total**: 7 file changes (1 new lib + 1 new cron route + 5 modified)
>
> **Session 2026-05-10 (afternoon batch 3 — Phase 2 scaffold + templates migration):** ✅
> - **Phase 2 = write migration** (drop Apps Script writes, Postgres = source of truth) — เลือกทำ scaffold + 1 action proof-of-concept ก่อน, ไม่ลุย hot-path
> - **Infra**:
>   - `lib/postgres-write.ts` — Postgres-authoritative write handlers (`addTemplateToPostgres`, `deleteTemplateFromPostgres`). Difference vs `postgres-write-mirror.ts`: this is primary write, mirror is best-effort
>   - `lib/feature-flags.ts` — per-action env flag (`WRITE_TEMPLATES_TO_POSTGRES=1`) + `phase2WriteEnabled(action)` + `phase2OwnsTable(table)` helpers
>   - `lib/sync-from-sheet.ts` — gated cron template sync (skips when Postgres owns table) เพื่อกัน TRUNCATE blowing away Phase 2-only rows
> - **First migrated action**: `addTemplate` + `deleteTemplate` (lowest risk — /orders/new only, identified by name+timestamp id, ไม่ใช่ hot path)
>   - `app/api/orders/templates/{add,delete}/route.ts` — branch on `phase2WriteEnabled('<action>')`. Flag off = legacy Apps Script-first (current behavior unchanged). Flag on = Postgres-first + best-effort Apps Script Sheet sync
> - **Apps Script side**: `production-monitoring/apps-script/dashboard/templates.ts` + `api.ts` + `auth.ts` — เพิ่ม `setTemplateRow` action (v5.10.10) ที่รับ pre-allocated id + idempotent upsert (append if not found, overwrite if exists). Phase 2 path เรียกผ่าน `post('setTemplateRow', ...)` เพื่อ sync ไป Sheet สำหรับ admin Sheet UI
> - **Failure mode contract**: Postgres write fail → propagate ไป user. Apps Script Sheet sync fail → swallow + Sentry breadcrumb (`layer: phase2-sheet-sync`). Sheet drifts; cron skips template sync ที่ flag on; drift heals on next setTemplateRow retry
> - **Default-off** — flag ยังไม่ flip ที่ production. ⏳ User ต้องทำ 2 ขั้นเพื่อ activate (ดู "Pending user actions" ด้านล่าง)
> - **Total**: 4 commits + 1 Apps Script edit (รอ user push)
>
> **Session 2026-05-10 (afternoon batch 2 — Phase 1.7 dual-write + bug fixes):** ✅
> - **Bug discovered after Phase 1 cutover**: writes "เด้งกลับหมด" — Postgres mirror lag (10-min cron) made loadAll() return OLD data after every write → optimistic UI commit revealed pre-write state → user perceived writes as failed.
> - **Phase 1.7 dual-write mirror** (`33d9978`) — `lib/postgres-write-mirror.ts` 17 handlers (upsert jobs/orders/shipped/cancelled/templates + atomic cascades for cancelOrder/deleteOrderCascade/promoteDraft + bulkForward with server-allocated newIds). After every Apps Script write success, `post()` mirrors to Postgres in same request → mirror reflects change before response returns → next read sees fresh state. Mirror failures non-fatal (mark sync_meta stale + Sentry capture).
> - **Edit form bounce-back fix** (`9969af9`) — pre-existing OrderForm useEffect dep on `initial` reference reset state on every router.refresh. Phase 1.7's faster refresh (~200ms vs 1.5s Apps Script) made the SuccessView flicker user-visible. Fix: `initializedIdRef` skip re-run when same logical id, `wasOpenRef` track close→open transitions for modal "fresh open" reset.
> - **Edit-from-/orders speed** (`870aaa4`) — `/orders/[id]/edit/page.tsx` was parallel-fetching loadOrder + loadAll, but loadOrder bypassed Postgres (revalidate=0). Phase 1.7's dual-write guarantee means `loadAll()` is fresh, so `snap.orders.find(id)` covers both target + recentOrders in ONE Postgres fetch. /orders → edit ~500ms → ~200ms.
> - **Total**: 3 commits.
>
> **Session 2026-05-10 (afternoon batch 1 — Phase 1 Postgres read mirror LIVE):** ✅
> - **PoC bench-driven decision** — built `/admin/bench-audit` 2-section harness. Bench 1 (audit_log filter): tied at p50 ~108ms (best case for Sheet). Bench 2 (loadAll-shaped, full jobs payload): **Postgres p50 23.9× faster**, p95 19.8× faster. Sheet 4400ms → Postgres 200ms. Strong-GO verdict.
> - **Phase 1 read mirror full deploy** — 4 mirror tables (orders + shipped + cancelled + templates) + sync_meta + Vercel cron `*/10 * * * *` + `lib/api-postgres.ts` Postgres-flavored loadAll/loadOrder/getAuditByTarget + `lib/api.ts` Postgres-first behind `READ_FROM_POSTGRES=1` flag with Apps Script fallback.
> - **Sheet drift dedup** — shipped table had 2 duplicate ids causing PRIMARY KEY violation; added `dedupeById()` (last wins) to all 5 mirror sync functions. Currently: 86 fetched → 84 inserted, dedup 2.
> - **/track migration** — switched from `loadAll().filter()` (200KB payload) to `loadOrder()` (1KB targeted). Public QR scan flow now ~3-5× faster. Postgres-first via Phase 1 flag.
> - **Phase 1 follow-up (`e15beeb`)** — docs sync + `/api/admin/diagnose-shipped-dupes` diagnostic + /orders bundle split (DataAuditModalImpl lazy → 9.72 → 7.34 kB).
> - **Cutover validated** — flag flipped, /board feels noticeably faster ("เร็วขึ้นเยอะ" — user confirmed).
> - **Total**: 8 commits + 1 Vercel UI config (Neon connect + READ_FROM_POSTGRES env). Migration plan estimated 1 wk → shipped in 1 session via bench-driven approach.
>
> **Session 2026-05-10 (morning — Tier B close-out + perf compound, 6 tasks):** ✅
> - **Morning Report cron migration** — Apps Script `doPost` handler + `/api/cron/morning-report` Vercel route + 3rd `vercel.json` cron entry. ⏳ Pending user actions: deploy Morning Report Apps Script as Web App + set env vars (see runbook below).
> - **Vercel KV rate limit** — `lib/rate-limit.ts` fail-open Upstash REST helper, applied to `/api/audit` (60/min/user) + `/api/orders/raw/[id]` (120/min/user). ⏳ Pending: connect Upstash KV via Vercel Storage.
> - **Apps Script TextFinder write paths** (v5.10.9) — `findRowById` + new `findRowMatchesByColumn` helper in `helpers.ts`. `cancelOrder` + `deleteOrderCascade` refactored to share `cascadeCancelJobsForOrder_`. -500ms-1.5s per cascade.
> - **/board bundle sweep + fetch storm fix** — 18.4 kB → 16.4 kB (-11%). Bigger win: eliminated 50-card `useEffect` audit fetch storm by gating `DetailContent` mount on `detailsOpen` state.
> - **Apps Script quota dashboard widget** (v5.10.9) — per-day counter via Properties Service + `getQuotaStats` action + `app/analytics/quota-widget.tsx` SVG sparkline. ISR 5 min.
> - **Morning Report icons** — already done in `1e1f692` (2026-05-09); session note was stale.
>
> **✅ Phase 3.6 cutover DONE 2026-05-09** — WP retired. DNS switch HostAtom A→CNAME Vercel complete. app.penprinting.co alias dashboard.penprinting.co (same Vercel project). WP source ยังอยู่ที่ HostAtom เก็บ rollback ≥1 สัปดาห์ (DNS ไม่ตอบที่นั่นแล้ว, files ยังอยู่). **Monitor 1 สัปดาห์**: Sentry error rate + Vercel logs `/api/track/lookup` traffic + LINE OA `/track` ปกติ. ถ้ามี issue rollback ได้: HostAtom DNS → A `203.170.190.20` กลับ.
>
> **Session 2026-05-09 (mega-day: Phase 3.6 cutover + 2 bonus fixes)** ✅:
> - **Code prep**: 9 hard-coded WP refs แก้ครบ (3 v2 + 4 marketing redirects + 2 Morning Report mirrors). Type-check + production build ผ่าน
> - **Bonus perf bug**: user-reported "order create ดูช้ามาก" → static analysis เจอ `createOrder` ไม่อยู่ใน PATHS_BY_ACTION map → fast-path order create ไม่ bust /board + /orders cache → user เห็นใหม่ใน 15-60s แทน ~1.5s. Fix `e88f386` 1 บรรทัด → verified
> - **Bonus quota tune**: morning quota alert 8:44 AM 🟡 ที่ 3080ms = cold-start false alarm. Bump warn 3000→5000 / critical 10000→15000 (cold-start friendly)
> - **Cutover**: TTL ลด 300 → wait 2 min → delete A + add CNAME `cname.vercel-dns.com.` (ต้องมี dot ท้าย — HostAtom auto-append zone ถ้าไม่ใส่). Authoritative propagate ทันที, Google + Cloudflare resolvers update ใน ~1 นาที. Vercel SSL active ทันที. Browser smoke test ผ่าน. `/production-monitoring*` → `/board` redirect cushion ทำงาน
> - **Total**: 5 commits + 2 Apps Script pushes + DNS cutover
>
> **Session 2026-05-08 (mega-day: audit + Sentry + 5 bugs)** ✅ ปิด 9 audit findings (3 High + 5 Medium + 1 doc) + Sentry end-to-end (5 layers ของ silent failure) + 5 user-reported bugs. **15 commits + 2 Apps Script deploys**. Bug 4 highlight: คุณนุ๊กชี้ insight ว่า "/board card detail เร็วทำไม?" → unlock root cause ที่เป็น architecture mismatch (orders modal lazy-fetched, board renders inline) ไม่ใช่ backend perf — ผม jump-fix backend perf ก่อน 2 commits จนได้ insight ของคุณนุ๊กแล้วถึงเข้า real fix `96603a8` (inline rawData in OrderRow).
>
> **Session 2026-05-07 (mega-day, afternoon batches)** ✅ ต่อจาก morning Phase 2.1 close + forward perf + order create perf + PM perf batch + PM2 atomic cascade — afternoon ส่ง **5 batches เพิ่ม** (10 commits รวม): bundle splits + smart auto-sync backoff + edge runtime (`1d6e57f`) → mobile bottom-nav + hamburger sheet + top-right user menu (`95c0cb8`) → /track WP look + 6-step progress port (`ce611b1`) → /track charcoal mood (`fe0b38e`) → workflow speed sweep round 5 (`3cb4501`) + Apps Script v5.10.5 (audit-param skip). **Cumulative impact**: order create 5 round-trips ~3s → 1 atomic ~1.5s, print page 600-1200ms → ~200ms, /analytics First Load -39%, Apps Script idle quota -69%, mobile UX gap closed (logout reachable on mobile + 4-slot bottom nav), /track WP-parity restored.

## ✅ เสร็จแล้วในรอบล่าสุด — 2026-05-08 mega-day (audit + Sentry + 5 bugs)

15 commits + 2 Apps Script deploys (helpers.ts + load.ts):

### 1. Audit close-out batch 5 (`57ca976` + `dc24167`)

11 files +213/-57 — 3 High + 5 Medium + 1 doc fix ครบใน 1 commit:

**High (correctness/safety):**
- **H1 orphan-recovery double-tap** (`/api/jobs/add`) — เพิ่ม idempotency: ถ้า body มี orderId, fetch loadAllFresh + reject 409 ถ้ามี active job ผูกอยู่แล้ว. Closes data-audit modal duplicate-job window
- **H2 promoteDraft fall-through double-write** (`/api/orders/promote-draft`) — reject `{ok:true}` without jobId เป็น 502 (Apps Script regression) แทน fall-through ที่จะ burn speculative jobId อีกครั้ง
- **H3 restore trust-client** (`/api/jobs/restore`) — always read row from Sheet (cached `loadAll` + fresh fallback) + verify `src.name === cj.name` ก่อน restore. ใช้ 409 ถ้า mismatch

**Medium (UX/perf/safety):**
- **M2 JobForm submit re-entry** — `submittedRef` guard, ลบ dead `busy` state
- **M4 /track currentDept null** — collapse เป็น 'received' state (no contradictory urgency badge)
- **M5 cascade fallback concurrency cap** — `allSettledLimit(3)` แทน unbounded `Promise.allSettled` + new `lib/concurrency.ts` zero-dep helper
- **M6 MobileUserMenu overlap** — `/orders` sticky header reserves `pr-12` on mobile
- **M7 auto-sync setTimeout race** — `unmounted` flag ใน self-rescheduling chain

**Doc:**
- **M8 stale comment** — `lib/api.ts` PATHS_BY_ACTION comment ปรับให้สะท้อน round 5 (board ไม่อ่าน audit แล้ว)

**Defer (per audit recommendation):**
- M1 Card memo deep compare — รอ profiler data ก่อน
- M3 JobForm stale toast — cosmetic
- L1-L4 — low impact

### 2. Sentry observability — end-to-end working

**5 layers of silent failure** ขุดเจอตามลำดับ (5 commits + 1 Vercel env config + 1 Apps Script no-op):

| Layer | ปัญหา | Fix commit |
|---|---|---|
| 1 | `instrumentation-client.ts` — Next.js 15.3+ convention; Next.js 14 silently ignores | `212bb7a` rename → `sentry.client.config.ts` |
| 2 | `sentry.client.config.ts` — @sentry/nextjs v10 dropped auto-load | `f299dc9` manual init from `app/layout.tsx` |
| 3 | Top-level code in 'use client' module ไม่รัน — Next.js 14 quirk | `076586d` switch to `useEffect` init |
| 4 | `NEXT_PUBLIC_SENTRY_DSN` Sensitive flag in Vercel — Sensitive vars ไม่ inline เข้า client bundle | (config UI) uncheck Sensitive + add Production env |
| 5 | Default debugging logs noisy — clean up | `7e6fbfa` drop debug logs |

**Final state**: SDK init from `components/sentry-init.tsx` via `useEffect` in `app/layout.tsx`. Sourcemaps upload (Node + Edge + Client × 100+ files). Tunnel route `/monitoring` ผ่าน. `ignoreErrors` filter wallet extension noise. Server + Edge Sentry pre-existing config ก็ยังทำงาน.

**Verify ผ่าน**: throw → POST /monitoring → 200, issue ขึ้น Sentry dashboard, stack trace map กลับเป็น TS file ไม่ใช่ minified hash.

**Lesson** (`feedback_use_diagnose_skill.md`): จุด 5 layers ที่ "ดูเหมือนทำงาน" (build pass, sourcemaps upload สำเร็จ) แต่ runtime พังเงียบ — ใช้ `/diagnose` skill (mattpocock) เป็น loop ตอน debug bug แบบนี้ครั้งหน้า. User feedback: "ที่หลังเจอบักใช้ /diagnose ช่วยประกอบตลอดนะ".

### 3. Photobook spec tab fix (`682fd0e`)

ก่อน — photobook order spec แสดง printing fields ที่ไม่เกี่ยว (plateSize, billColors, paperCover, coatGloss, ฯลฯ) เพราะ v2 OrderForm seed ทั้ง printing schema แล้วค่อย flip orderType=photobook.

หลัง — photobook spec ใช้ whitelist `PHOTOBOOK_VISIBLE_KEYS = ['notes', 'orderer']`:
- `app/orders/orders-table.tsx` SpecSection (modal /orders)
- `app/board/card.tsx` DetailsTable + new PhotobookItemsTable component (Kanban card detail)
- Photobook items render ใน violet-themed table แยก, รายละเอียดงาน table ตามด้วย notes + orderer

### 4. Promote-draft flicker fix (`5db20f5`)

User report: หลังกด "ส่งเข้าระบบ" จาก draft → Job ขึ้น Kanban → หายไปสักพักใหญ่ๆ → กลับมา. ใน /orders แสดง "มอบหมายแล้ว" ตลอด.

Root cause มี 2:
1. Redirect hard-code `/board?dept=post` แต่ default `assignDept='graphic'` → Job ไปอยู่ graphic column, filter post ซ่อนหมด
2. ไม่มี `router.refresh()` ก่อน redirect → Router Cache ของ tab ปัจจุบันยังถือ snapshot เก่า → auto-sync tick แรก hit warm cache → flicker

Fix: ลบ `?dept=post` filter (land บน unfiltered /board) + `router.refresh()` ก่อน setTimeout navigate.

⏳ **รอ user retest** — ทดสอบ draft → ส่ง → ดู Job คงอยู่บน Kanban ไม่หาย

### 5. Date corruption fix (Vercel `25e28c0` + Apps Script helpers.ts)

User report: orders ที่ผ่าน promoteDraft / cancelOrder แสดง dateIn/dateDue เป็น `"2026-05-07T17:00:00.000Z"` (literal quotes ครอบ ISO string) ใน /orders แทน DD/MM/YYYY format.

**Root cause** — Apps Script `objectToRow()` helper:
```ts
if (typeof val === 'object') return JSON.stringify(val);
```
`typeof new Date() === 'object'` matches → Date double-stringified → cell stored as quoted ISO string. ทุกครั้งที่ promoteDraft/cancelOrder อ่าน row + write back ทับ → corrupt date columns.

**Fix two-pronged**:
- **Apps Script** `production-monitoring/apps-script/dashboard/helpers.ts` — เพิ่ม `if (val instanceof Date) return val;` guard ก่อน catch-all object branch. Apps Script writes Date back as Date cell. ป้องกัน corruption ในอนาคต. ✅ user pushed via push.sh + redeployed
- **Vercel** `lib/jobs.ts` displayDate — strip outer double quotes ก่อน regex parse. Recover existing corrupted display โดยไม่ต้องเขียน repair script.

หลังนี้ orders ที่ผ่าน atomic action ใหม่จะ Date format ถูก. Cell ที่ corrupt อยู่จะ display ปกติผ่าน Vercel rescue, แล้วทุกครั้งที่ status flip จะ overwrite เป็น Date object สะอาดเอง.

### 6. Bug 4 — Modal slow on /orders (`7b73d4f` + Apps Script load.ts + `96603a8`)

คุณนุ๊กรายงาน: เปิด detail modal จาก /orders โหลดช้า ~3.7-4.4s ต่อ order ทั้งที่ payload แค่ 0.8 KB.

**3 layers of fixing**:
1. **Apps Script `loadOrder` rewrite** (`load.ts`, คุณนุ๊ก push) — เลิกใช้ `sheetToArray()` ทั้ง 4 sheets, เปลี่ยนเป็น `TextFinder` + single-row `getDisplayValues()`. New helpers `findOneRowByColumn` + `findAllRowsByColumn`.
2. **Vercel cache** (`7b73d4f`) — `loadOrder()` รับ `{ revalidate }` option, `/api/orders/raw/[id]` ใช้ `revalidate: 30` → repeat opens cache hit ~50ms.
3. **Architectural fix** (`96603a8`) — root cause ที่แท้จริง: /orders modal lazy-fetch แต่ /board card render inline ทั้งที่ data source เดียวกัน (loadAll snap). คุณนุ๊กชี้ insight นี้ ("/board เร็วทำไม?"). Fix: pass `rawData` inline ใน OrderRow → modal render synchronously ไม่ fetch เลย. Fallback path คงอยู่สำหรับ rawData missing case.

**Lesson** (memory: `feedback_perf_compare_similar_features.md`): ถ้า feature A perf ช้า + feature B ที่คล้ายกันเร็ว → ถามว่า A ทำพิเศษกว่า B อะไร (มัก architecture mismatch) ก่อน jump-fix backend perf shared infrastructure

### 7. Bug 5 — Pagination missing (`b798c3e`)

คุณนุ๊กรายงาน: list pages แสดง "20 จาก 120 รายการ" แต่กดดูที่เหลือไม่ได้.

Root cause: ทุก list page ใช้ `slice(0, perPage)` = first page only, ไม่มี `?page=` URL state, ไม่มี pagination control.

Fix:
- New `lib/page-size.ts` helpers — `resolvePage()`, `paginate()`, `totalPages()`, `clampPage()`
- New `components/pagination-bar.tsx` — Prev / "หน้า X / Y (n–m จาก total)" / Next, auto-hide เมื่อ list fits 1 page
- `PageSizeBar` drops `?page=` เมื่อ user เปลี่ยน per-page (กัน past-end)
- /orders + OrdersTable + /shipped + /cancelled — wire up pagination

Type-check ผ่าน + production build OK ทุก commit. Vercel auto-deploy.

## ✅ เสร็จแล้วใน Afternoon batches (2026-05-07)

### Round 5 — Workflow speed sweep (`3cb4501`) ✅ — 6 fixes hot + cold paths
- **JobForm optimistic close + commit() pattern** — modal closes instantly on submit, toast carries in-flight state (matches CoworkDialog). Was 400ms modal-open lag.
- **`/api/jobs/forward-undo` drops `getNextId` round-trip** — passes `id: 0`, bulkForward auto-allocates under same lock. Saves ~300ms per undo.
- **`/api/jobs/restore`** — accepts `srcCancelled` snapshot from /cancelled page + `loadOrder(id)` parent-order lookup. 1.2s → ~400-800ms.
- **`/api/auth/{login,logout}`** — edge runtime. ~150ms cold-start saved on first login of day.
- **Apps Script `loadAll(opts?.audit?: boolean)`** ([load.ts](../production-monitoring/apps-script/dashboard/load.ts) + [api.ts](../production-monitoring/apps-script/dashboard/api.ts) switch threads `e.parameter.audit !== '0'`). Default unchanged (backwards-compat).
- **`lib/api.ts`** — `loadAll()` passes `audit=0`; new `loadAllWithAudit()` for /analytics; /analytics page.tsx switched.
- **`app/board/card.tsx`** — `React.memo` wrapper with field-level comparator (`arePropsEqual`). On auto-sync ticks, only the moved card re-renders (49/50 unchanged refs detected). Internal context updates (BulkMode/PendingMutations) still re-render via hook subscriptions → optimistic UI keeps working.
- ✅ **Apps Script v5.10.5 live** — user pushed via push.sh + Manage deployments

### /track charcoal mood (`fe0b38e`) ✅ — minimal styling pass
- Status badge `progress` variant: blue `#dbeafe/#1d4ed8` → charcoal `#e7e5e4/#1a202c`
- Step `current` icon: blue → solid charcoal `#1a202c/#ffffff` (filled black with white icon)
- Step `current` label: `#1a202c` thai bold + `#4a5568` eng
- Contact phone link: blue → black with underline + 3px underline-offset
- Kept green (done/shipped), red (cancelled/overdue), amber (received) for semantic meaning

### /track WP port + 6-step progress (`ce611b1`) ✅ — feature parity restored
- `/api/track/lookup` now returns `currentDept: 'graphic'|'print'|'post'|null`. Status labels match WP exactly (กราฟิกกำลังดำเนินการ / อยู่ระหว่างพิมพ์ / ขั้นตอนหลังพิมพ์ / etc).
- [app/track/page.tsx](app/track/page.tsx) — cream `#f5f5f0` BG, text-only "PENPRINTING" wordmark, robots noindex.
- [app/track/client.tsx](app/track/client.tsx) (full rewrite) — white card rounded-20, status header in cream, 22px job name, pill badges with 5 variants (normal/progress/overdue/shipped/cancelled), 2-column date row, **6-step vertical progress timeline** (received → graphic → print → post → ready → shipped) with done/current/pending/cancelled states + Thai+English labels, reason box for cancellations, contact box with `tel:043220582`, "← ตรวจสอบงานอื่น" back link.

### Mobile bottom-nav refactor (`95c0cb8`) ✅ — UX gap closed
- Bottom nav always reserves rightmost slot for "เมนู" hamburger that opens a bottom sheet. Primary slots = 4 mobile-flagged items (สั่งงาน + กราฟฟิก + พิมพ์ + หลังพิมพ์ for admin/sales; 3 for staff who can't see สั่งงาน).
- New [components/mobile-user-menu.tsx](components/mobile-user-menu.tsx) — floating top-right circular IconUser button (`md:hidden`). Tap opens bottom sheet with avatar + user name + role label + quick link to /track + logout button. **Closes the mobile-no-logout gap.**
- New `getMoreMenuGroups(role)` helper in [components/nav-config.ts](components/nav-config.ts) — returns groups with bottom-row items stripped, preserving "การผลิต / รายการ" headings inside the sheet.
- Added `IconMenu` (3 lines) and `IconExternalLink` to [lib/icons.tsx](lib/icons.tsx).

### Bundle splits + smart backoff + edge (`1d6e57f`) ✅ — perf compound
- **Lazy-load recharts** on /analytics via `next/dynamic({ ssr: false })` — new [app/analytics/charts-lazy.tsx](app/analytics/charts-lazy.tsx). **/analytics First Load JS: 295KB → 181KB (-39%)**.
- **Dynamic-import OrderForm + JobForm** in [app/board/card.tsx](app/board/card.tsx) with conditional mount `{editOpen && <JobForm…/>}`. Modal chunks fetch on first ✏️ click instead of every /board hit.
- **Smart auto-sync backoff** in [lib/auto-sync.tsx](lib/auto-sync.tsx) — replaced fixed 15s setInterval with self-rescheduling setTimeout. Schedule: **15s active / 30s after 2-10min idle / 60s after >10min idle**. Activity tracked via passive pointerdown/keydown/wheel/touchstart. **~75% Apps Script quota reduction on idle tabs.**
- **Edge runtime on `/api/track/lookup`** — public route, all deps Edge-compatible, ~150-300ms TTFB win on first hit of the day.
- **Deleted `app/board/bulk-forward-modal.tsx`** (424 lines, 20K, no consumers).

### 📊 Cumulative impact (afternoon + morning combined, 2026-05-07)
| Metric | Before | After |
|---|---|---|
| Order create flow | 5 round-trips ~3s | 1 atomic ~1.5s |
| Print page | 600-1200ms | ~200ms |
| Order detail modal | ~600ms | ~200ms |
| Order edit (common) | ~3-4s | ~1.5s |
| Cancel order with cowork | 3s | 1.8s → 600ms (atomic AS) |
| Job edit modal | 400ms-open | 0ms close |
| /analytics First Load | 295KB | **181KB (-39%)** |
| /board First Load | 205KB | 196KB |
| Apps Script idle quota | baseline | **-69%** |
| Apps Script payload/page | baseline | **-50-100KB** (audit=0 + atomic) |

---

## ✅ เสร็จแล้วในรอบเช้า + บ่ายต้น (2026-05-07)

### Data audit modal + atomic order cascade (`c95c451`, PM2) ✅ — orphan window closed
**ปัญหา**: order lifecycle ยังมี multi-call write paths ที่ partial-failure ได้:
- `/api/orders/cancel` — `Promise.allSettled([...cancelJob])` + แยก call ไป update order status → ถ้า order-status flip fail หลัง cascade success = order ค้าง 'sent' มี jobs cancelled
- `/api/orders/delete` — เหมือนกัน + delete order row
- `/api/orders/promote-draft` — alloc jobId + addJob + update order draft→sent → ถ้า addJob success + status flip fail = orphan-incoming

**ปิดทั้งหมดในรอบเดียว** — atomic Apps Script v5.10.4 + data-audit modal port + fast-path-with-fallback v2 routes:

- **Apps Script v5.10.4** (`production-monitoring/apps-script/dashboard/write.ts +200`, `api.ts` +3 cases, `auth.ts` ROLE_REQUIREMENTS):
  - `cancelOrder` — cascade-cancel attached jobs + flip order status='cancelled' ใน LockService scope เดียว (admin only)
  - `deleteOrderCascade` — cascade-cancel + delete order row (admin only)
  - `promoteDraft` — allocate jobId + append job + flip draft→sent atomic (admin+sales)
- **Data-audit modal** ([app/orders/data-audit-modal.tsx](app/orders/data-audit-modal.tsx) NEW, port WP `openDataAuditModal` + `recoverOrphanOrder` + `removeDuplicateJob` from production-monitoring.js:5440-5660):
  - Section 1: orphan orders (status=sent without job/shipped/cancelled) → recovery dropdown (dept/staff) → POST /api/jobs/add
  - Section 2: duplicate jobs (orderId+name groups with >1 row) → older row deletable → POST /api/jobs/delete
  - Replaces previous passive `<Link>` filter that did nothing actionable
  - Server-computed (orphans + duplicates derived from same loadAll snapshot — no extra round-trip)
- **v2 routes — fast path with fallback** — `/api/orders/{cancel,delete,promote-draft}` try atomic action first, fall through to multi-call legacy on `Unknown action` error → Vercel deploy could ship before Apps Script redeploy without breakage
- **`lib/api.ts` `PATHS_BY_ACTION`** — registered cache-bust paths for cancelOrder/deleteOrderCascade/promoteDraft

**Orphan prevention (final state)**: ✅ all order lifecycle actions atomic in single lock — createOrder, bulkForward, cancelJob, moveToShipped, **cancelOrder**, **deleteOrderCascade**, **promoteDraft**. Remaining orphan sources = legacy data, manual Sheet edits, Apps Script outage mid-write. Data-audit modal acts as safety net.

### Phase 2.1 Apps Script TS migration (100%) ✅
- 4 sections สุดท้ายเป็น TS — type-check ผ่าน strict mode (`noImplicitAny` + `strictNullChecks`)
- [auth.ts](../production-monitoring/apps-script/dashboard/auth.ts) (96 lines) — HMAC + role gate
- [load.ts](../production-monitoring/apps-script/dashboard/load.ts) (168 lines) — `loadAll`, `loadOrder`, `loadRecentAudit`
- [write.ts](../production-monitoring/apps-script/dashboard/write.ts) (280+ lines) — 12 mutations + `bulkForward` server-side id alloc + `createOrder` action
- [api.ts](../production-monitoring/apps-script/dashboard/api.ts) (159 lines) — `doGet`, `doPost`
- `Code.js` 677 → **93 lines** (-86%); only constants + section markers
- ✅ User redeploy แล้ว via push.sh + Manage deployments

### Forward perf overhaul (A+B+C) ✅
**ปัญหา**: ส่งงานต่อ v2 บล็อค UI 2.5-6 วินาที (vs WP instant). 3 sequential Apps Script round-trips: `loadAllFresh` → `getNextId` → `bulkForward`.

- **A. Skip `loadAllFresh()`** — `/api/jobs/{forward,bulk-forward,reassign}` รับ `srcJob` snapshot จาก client. Drag-drop ส่งผ่าน dataTransfer `application/x-job-snapshot`.
- **C. Apps Script `bulkForward` auto-alloc** — newJob.id ว่าง/0 → `getNextIds(N)` ภายใน batch lock + return `succeeded: [{oldId, newId, name}]`.
- **B. Optimistic UI** — [pending-mutations.tsx](components/board/pending-mutations.tsx) context เก็บ `Set<jobId>` "ซ่อน". Card หายจาก source col ทันที + phantom card injection ใน destination col + defer cleanup จนกว่า `useTransition`-wrapped `router.refresh()` จะเสร็จ. Failure → unhide + toast.error.

| | ก่อน | หลัง | WP |
|---|---|---|---|
| Apps Script round-trips | 3 | 2 | 2 |
| Perceived UI latency | 2.5-6s | **0ms** | 0ms |
| Atomicity | ✅ | ✅ | ❌ (delete+add race) |

### Order create perf (5 round-trips → 1, < 2s) ✅
- **`a184254`** — single-call `createOrder` Apps Script action — allocates orderId + initial jobId atomically + writes both rows in one batch
- **`3ad9f01`** — parallelize order create / update / promote-draft round-trips (`Promise.all`)
- **`0b762cc`** → **`c38c5c1`** — temporarily reverted createOrder fast path after suspecting empty-row regression; root cause was edit-form prefill bug `8c5f97d` instead. Re-enabled after fix.

### Order form / edit + UX fixes ✅
- **`8c5f97d`** — order edit: date prefill bug, dual assign+forward fields, cancel button on edit page
- **`2cb2863`** — order-form: orderer dropdown + drop assignStaff/forwardPrint mutual exclusion (matches WP)
- **`c542d98`** — replace PP placeholder with real Penprinting logo on A4 invoice
- **`2a984ab`** — print popup synchronous open (bypass popup blocker)
- **`6667d87`** — print page bypass loadAll cache for fresh orders (`force-dynamic` + `loadAllFresh`)
- **`5fd241f`** — พิมพ์+สั่ง stays inside installed PWA (display-mode standalone detection)
- **`79a8caf`** — ลบใบสั่ง → ยกเลิกใบสั่ง ใน /orders detail modal

### Hot-path round-trip cuts ✅ (PM, `8528839`)
**ปัญหา**: lifecycle audit ของ order→ship เจอ 7 friction points ที่กิน 0.6-1.2s/interaction. แก้ทั้ง batch — cuts unnecessary `loadAllFresh()` reads + parallelizes cascade writes + ให้ instant pending feedback บน operations ที่บล็อก UI เงียบๆ.

| Fix | ที่อยู่ | Saving |
|---|---|---|
| `loadOrder(id)` wrapper บน Apps Script `getOrder` | [lib/api.ts](lib/api.ts) | single-row read ~200ms vs full snapshot ~600ms |
| Order detail "สเปคงาน" tab | [app/api/orders/raw/[id]/route.ts](app/api/orders/raw/[id]/route.ts) | 3× faster (loadOrder vs loadAll) |
| "พิมพ์+สั่ง" popup fill | [app/orders/[id]/print/page.tsx](app/orders/[id]/print/page.tsx) | ~2.7s → ~1.6s (loadOrder + drop loadAll fallback) |
| Track lookup fresh-bypass | [app/api/track/lookup/route.ts](app/api/track/lookup/route.ts) | QR scan within 60s no longer 404s (matches print page pattern) |
| Order spec-only edit | [app/api/orders/update/route.ts](app/api/orders/update/route.ts) | -600ms when name+dateDue unchanged (`srcOrder` snapshot from client) |
| Order cancel/delete cascade | [app/api/orders/{cancel,delete}/route.ts](app/api/orders/cancel/route.ts) | N×600ms → max(~600ms) via `Promise.allSettled` |
| Order-form submit feedback | [app/board/order-form.tsx](app/board/order-form.tsx) | sidebar pulsing dot lights up via `useTransition`-wrapped `router.refresh()` |
| CoworkDialog UX | [app/board/card.tsx](app/board/card.tsx) | close modal on click + toast progress + commit() — no waiting with modal open |

## ✅ เสร็จแล้วในรอบก่อน (2026-05-06 PM)

### Audit close-out
- 4 batches ปิดครบ: 1 Critical + 5 High + 7 Medium + 5 Low → **17/18 findings closed** (1 false positive)
- [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) เป็น running tracker — ใช้สำหรับ audit รอบถัดไป

### Sidebar perf overhaul
- `useTransition` + pulsing dot บน sidebar/bottom-nav → instant click feedback (~16ms)
- Per-action `revalidatePath` scope ใน [lib/api.ts](lib/api.ts) — warm cache survives unrelated writes
- Suspense streaming SSR บน 6 pages — shell ~50ms, body fills เมื่อ Apps Script ตอบ
- Page-flash artefact จาก per-route loading.tsx revert (shell อยู่ใน page.tsx ไม่ใช่ layout)

### Polish + observability
- Favicon = real logo (`app/icon.png` + `apple-icon.png`)
- QR บน A4 invoice → `/track?id=<id>`
- Sentry wired (server/edge/client + global error boundary, +78 KB shared bundle)
- Per-user audit signing — `_actor: "<role>:<user>"` ใน body, Apps Script side override default `admin:dashboard`
- Documentation sweep — `dashboard-v2.md` ใหม่เป็น v2 source-of-truth

### UI changes
- `/` redirect → `/login` หรือ `/board` (drop landing splash)
- `/orders` detail full WP-style 3-tab (ข้อมูลหลัก / สเปคงาน / ประวัติ) + lazy fetch raw
- `/analytics` → port WP รายงานประจำเดือน + dept detail modal (รวม | แยกตามช่าง)
- Drop "+ งานเดี่ยว" button จาก /board toolbar
- Permission lockdown: /analytics admin only / /orders admin+sales / edit admin only

---

## 🎯 Next session — Phase 2 next actions (P1 + updateJob + addJob ✅ done 2026-05-11)

### Migration order (remaining hot-path actions)

After addJob, the natural next batches by risk:

1. **`bulkForward`** (Higher risk, ~1 hr) — multi-row delete-old + insert-new with server-allocated newIds. The "atomic forward" path that v2 already optimized. Translation: write all newJobs to Postgres + dirty mark + delete oldJobs in same Postgres transaction. Apps Script side already atomic — heal cron pushes via setJobRow per row. ⚠️ Need batch dirty-mark for delete (`phase2_deleted_at` or row-tombstone pattern)
2. **`cancelJob`** (Med risk, ~45 min) — atomic move job→cancelled. Two tables touched in one transaction. Patterns from `mirrorWriteToPostgres mirrorCancelOrder` reusable
3. **`moveToShipped`** (Med risk, ~45 min) — atomic move job→shipped. Same shape as cancelJob
4. **`reassignStaff`** (Low risk, ~20 min) — single-field UPDATE like setCowork. Should be quick
5. **`deleteJob`** (Low risk, ~15 min) — DELETE FROM jobs. Need tombstone pattern so heal cron knows to delete from Sheet too — or add a "delete" action to setJobRow

After 5/5 hot-path actions migrated → consider table-skip cron for `jobs` (full table ownership) + drop `mirrorWriteToPostgres` jobs branch

### Order lifecycle actions (lower priority — admin only, lower frequency)
- `addOrder`, `updateOrder`, `deleteOrder`, `createOrder`, `cancelOrder`, `deleteOrderCascade`, `promoteDraft` — these touch orders + sometimes jobs cascade. Defer until jobs are stable in Phase 2

---

## ⚠️ Pending user actions (after 2026-05-11 session)

### 🎯 Phase 2 master activation runbook (all flags)

**Status of prerequisites (one-time setup):**

| Prereq | State | How to verify |
|---|---|---|
| `phase2_dirty_at` columns (jobs/orders/shipped/cancelled) | ✅ live | `/api/admin/db-migrate` shows no ALTER in applied |
| `phase2_deleted_at` column on jobs | ✅ live (Batch A, 2026-05-11) | Same — ALTER not in applied |
| `audit_log.source` column | ✅ live | Same |
| Apps Script v5.10.14 deployed | ✅ live (verified 2026-05-12 — Version 42, May 11) | Editor → Manage deployments → Active shows `(v5.10.14)`, archived list shows v5.10.13 setOrder, v5.10.12 createOr, v5.10.11 setJobRow etc. |

**If Apps Script v5.10.14 NOT yet deployed:** Apps Script editor → Deploy → Manage deployments → **Edit existing → New version** (⚠️ ห้าม "New deployment"). Description: `v5.10.14 setShippedRow / setCancelledRow / deleteJobByIdRow + setOrderRow + audit createOrder fix`.

**Flag activation table — set ALL in Vercel env vars (Production + Preview + Development) → Redeploy once:**

| Flag | Action covered | Activated? |
|---|---|---|
| `WRITE_COWORK_TO_POSTGRES=1` | setCowork | ✅ already on |
| `WRITE_UPDATE_JOB_TO_POSTGRES=1` | updateJob + reassignStaff (piggyback) | ✅ already on |
| `WRITE_CREATE_ORDER_TO_POSTGRES=1` | createOrder (hot path) | ✅ already on |
| `WRITE_ADD_JOB_TO_POSTGRES=1` | addJob (data-audit modal) | ⏳ pending |
| `WRITE_MOVE_TO_SHIPPED_TO_POSTGRES=1` | moveToShipped | ⏳ pending |
| `WRITE_CANCEL_JOB_TO_POSTGRES=1` | cancelJob | ✅ on (2026-05-11, 21h ago verified 05-12) |
| `WRITE_BULK_FORWARD_TO_POSTGRES=1` | bulkForward + single forward | ✅ on (2026-05-11, 20h ago verified 05-12) |
| `WRITE_UPDATE_ORDER_TO_POSTGRES=1` | updateOrder + cascade rename | ✅ on (2026-05-11, 19h ago verified 05-12) |
| `WRITE_PROMOTE_DRAFT_TO_POSTGRES=1` | promote draft → sent | ✅ on (2026-05-11, 19h ago verified 05-12) |
| `WRITE_CANCEL_ORDER_TO_POSTGRES=1` | cancelOrder (cascade) | ✅ on (2026-05-11, 19h ago verified 05-12) |
| `WRITE_TEMPLATES_TO_POSTGRES=1` | add/delete template | ✅ on (2026-05-10) |

> **Verified 2026-05-12** via Vercel project Settings → Environment Variables: all 11 WRITE_* flags + READ_FROM_POSTGRES = on, All Environments. Phase 2 master activation **complete**. Docs above table updated from earlier "pending" status. (The print-page stale-read + 404 bugs reported earlier 2026-05-12 were the first user-visible surfacing of Phase 2 fully on — read path lagged behind write path's staleness model. Fixed at `c0be3b8` + `f4f3474`.)

**Master smoke test (one pass covers most actions, ~10 min):**

1. /orders/new → สร้าง order ทดสอบ → expect ~250ms create + history shows `"สร้างใบสั่งงาน..."` ทันที (createOrder)
2. /board → คลิก ✏️ → เปลี่ยน dept/staff → save → expect card moves columns ทันที (updateJob)
3. /board → drag-drop card ข้ามคอลัมน์ → expect ~250ms + per-job audit `"ส่งต่องาน..."` (bulkForward)
4. /board → คลิก ship ✓ → expect card หายจาก Kanban ทันที + /shipped row ใหม่ (moveToShipped + tombstone)
5. /board → คลิก ยกเลิก → ใส่เหตุผล → expect cancel + /cancelled row ใหม่ (cancelJob)
6. /orders → คลิก order → แก้ไข name → save → expect cascade rename of attached jobs (updateOrder + cascadeRename)
7. /orders → คลิก draft → กด "บันทึก + ส่งเข้าระบบ" → expect save+promote+/board redirect (promoteDraft 1-click)
8. /orders → คลิก order → ยกเลิกใบสั่ง → expect cascade cancel jobs + order flips (cancelOrder)
9. **รอ 5 นาที** → `/api/cron/sync-to-sheet` logs → expect `jobs_tombstone`, `shipped`, `cancelled`, `orders` healed
10. **เปิด Google Sheet** → tabs ทั้งหมด → confirm rows sync ครบ

**Rollback (per action or all):** Vercel → unset env var(s) → redeploy → กลับ legacy path. Heal cron runs regardless of flag → dirty rows still get pushed to Sheet eventually. Tombstoned rows: `phase2_deleted_at IS NOT NULL` → cron sends `deleteJobByIdRow` until cleared. Worst-case rollback window = ~5 min until heal cron converges.

**Trade-off** (applies to all Phase 2 mutations):
- Sheet stale ≤5 min after each mutation (heal cron interval). v2 reads from Postgres so user-facing always fresh.
- Morning report 8 AM reads from Sheet — mutations between 7:55-8:00 may not appear in report that day. Low impact in practice.

---

### Legacy per-action activation details (superseded by master runbook above)

#### Phase 2 bulkForward activation — 1 ขั้น (Apps Script ครอบคลุมแล้ว + tombstone infra พร้อม)

✅ **Code deployed** 2026-05-11 — `bulkForwardInPostgres` per-item best-effort + appendAuditToPostgres per item
✅ **Apps Script v5.10.14 พร้อม** (จาก Batch A — setJobRow + deleteJobByIdRow ครอบคลุม)
✅ **Tombstone infrastructure** active

ขั้นตอน:
1. **Vercel env var** — Add `WRITE_BULK_FORWARD_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
2. **Smoke test** drag-drop /board:
   - Drag job → drop ที่ target column (เช่น graphic → print) → expect ~250ms latency
   - **เปิด /board → คลิก new job → tab ประวัติ** → expect `"ส่งต่องาน "..." id=X→Y"` ทันที
   - **Multi-select bulk forward** → drag-drop 2-5 jobs at once → ทุก card move + audit per item
   - **รอ 5 นาที → cron logs** → expect:
     - `jobs: candidates ≥N` (new dirty rows)
     - `jobs_tombstone: candidates ≥N` (old tombstones cleared)
3. **Failure path** — drag job ที่ Phase 1.7 mirror ยังไม่มี (rare) → expect `error: "Job not in Postgres mirror"` → user retries หรือ wait cron

**Rollback:** unset `WRITE_BULK_FORWARD_TO_POSTGRES` → redeploy → กลับ Apps Script bulkForward (mirror writes via lib/api.ts post() ปกติ)

---

#### Phase 2 Batch A activation — moveToShipped + cancelJob + reassignStaff (3 ขั้น)

✅ **reassignStaff** — reuses WRITE_UPDATE_JOB_TO_POSTGRES flag (already active if updateJob is). No new env var needed.
✅ **Vercel code deployed** 2026-05-11 — moveToShipped/cancelJob helpers + tombstone infrastructure + heal cron extended
✅ **Apps Script v5.10.14 pushed** via clasp — setShippedRow + setCancelledRow + deleteJobByIdRow actions

ขั้นตอน:

1. **Run db-migrate** — เปิด `https://dashboard.penprinting.co/api/admin/db-migrate` → confirm `applied` มี `"ALTER TABLE jobs ADD phase2_deleted_at + partial index"`
2. **Apps Script editor** → Deploy → Manage deployments → **Edit existing → New version**
   Description: `v5.10.14 setShippedRow / setCancelledRow / deleteJobByIdRow`
3. **Vercel env vars** — Add (Production + Preview + Development):
   - `WRITE_MOVE_TO_SHIPPED_TO_POSTGRES=1`
   - `WRITE_CANCEL_JOB_TO_POSTGRES=1`
   - (reassignStaff piggybacks on existing `WRITE_UPDATE_JOB_TO_POSTGRES=1`)
   → Redeploy

**Smoke test:**
- **moveToShipped**: เปิด /board → คลิก ship (✅) บน job → expect ~250ms latency + card หายจาก Kanban ทันที + /shipped page เห็นทันที + tab ประวัติเห็น `"จัดส่งงาน"`
- **cancelJob**: คลิก ยกเลิก บน job → ใส่เหตุผล → expect job หายจาก Kanban + /cancelled เห็นทันที + ประวัติเห็น `"ยกเลิก ..."`
- **reassignStaff**: drag-drop ภายใน column เดียวกัน (เปลี่ยน staff ในแผนกเดียวกัน) → expect card move staff ทันที + ประวัติ updateJob
- **รอ 5 นาที → ดู logs `/api/cron/sync-to-sheet`** → expect:
  ```
  tables: [
    {table: 'jobs', candidates: 0, healed: 0},
    {table: 'orders', candidates: 0, healed: 0},
    {table: 'shipped', candidates: ≥1, healed: ≥1},  // ← new dirty rows
    {table: 'cancelled', candidates: ≥1, healed: ≥1},
    {table: 'jobs_tombstone', candidates: ≥2, healed: ≥2},  // ← tombstones cleared
  ]
  ```
- **Google Sheet:** tabs `shipped` + `cancelled` มี rows ใหม่ + `jobs` row หายตามที่ ship/cancel

**Rollback (per action):** unset env var → redeploy → กลับ Apps Script-first path. Tombstoned rows in Postgres heal cron continues regardless of flag. Worst case = a few rows tombstoned-but-not-deleted-from-Sheet stay for next heal cycle, then converge.

⚠️ **Trade-off:** Sheet `jobs` row stays up to ~5 นาที after Phase 2 move (heal cron interval). External readers (morning report at 8 AM) read from Sheet — if a job is ship/cancel between 7:55-8:00 it may still appear in `jobs` sheet in the report. Postgres reads filter `phase2_deleted_at IS NULL` so v2 + /track see correct state immediately.

---

#### Phase 2 createOrder activation — 2 ขั้น (Apps Script v5.10.13 deploy + env var)

✅ **Vercel code deployed** 2026-05-11 — `createOrderInPostgres` + `findDuplicateOrdersInPostgres` + route Phase 2 branch + heal cron extended for orders
✅ **Apps Script v5.10.13 source pushed** via clasp 2026-05-11 — `setOrderRow` action added (mirror of setJobRow)
✅ **Schema** `phase2_dirty_at` already on orders (from earlier db-migrate)

ขั้นตอน:

1. **Apps Script editor** → Deploy → Manage deployments → **Edit existing → New version**
   Description: `v5.10.13 setOrderRow Phase 2 reverse-sync target`
   ⚠️ ห้าม "New deployment" — URL ต้องเหมือนเดิม
2. **Vercel env var** — Add `WRITE_CREATE_ORDER_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
3. **Smoke test:**
   - เปิด `/orders/new` → สั่งงานทดสอบ ("test1" / "test2") → save
   - **คาดหวัง**: order create ภายใน ~250ms (เร็วกว่าเดิม ~6x จาก 1.5s)
   - **เปิด /board → คลิก card งานใหม่ → tab ประวัติ** → ควรเห็น `"สร้างใบสั่งงาน "..." (ลูกค้า: ...)"` ทันที (ไม่ต้องรอ cron 10 นาที)
   - **Vercel logs `/api/orders/add`** → ไม่มี call `post('createOrder', ...)` Apps Script (เห็นแค่ `getNextOrderId` + `getNextId`)
   - **รอ 5 นาที → Vercel logs `/api/cron/sync-to-sheet`** → report `{tables: [{table: 'orders', candidates: ≥1, healed: ≥1}, {table: 'jobs', candidates: ≥1, healed: ≥1}]}`
   - **Google Sheet → tab `orders` + `jobs`** → row ใหม่ขึ้นแล้ว
4. **Dedupe test:**
   - สั่งงาน "test1" ครั้งที่ 2 ด้วย customer เดียวกัน → ได้ HTTP 409 + duplicate list
   - กด "สร้างต่อ (Force)" → ผ่าน
5. **Failure path test (optional):** temporarily rename `setOrderRow` ใน Apps Script editor → สั่งงาน → ขั้นที่ 5/6 healing fail → restore action → รอ heal cron → confirm row healed
6. **Rollback:** unset `WRITE_CREATE_ORDER_TO_POSTGRES` → redeploy → กลับ Apps Script-first path. Existing Phase 2-only orders (ที่ heal cron ยังไม่ push) stay in Postgres + heal cron continues regardless of flag

⚠️ **Trade-off:** Sheet stale ได้สูงสุด ~5 นาที (เหมือน setCowork/updateJob/addJob). Morning report 8 AM อ่านจาก Postgres-first ผ่าน v2 endpoint (ปกติ) แต่ถ้ามี external reader ที่อ่าน Sheet ตรง — อาจเห็น order ใหม่ delay ~5 นาที

---

#### Phase 2 addJob activation — เหลือ 1 ขั้น (db-migrate + Apps Script v5.10.11 พร้อมแล้ว)

✅ **Code deployed** 2026-05-11 — `addJobToPostgres` + route flag-gated branch ready, dormant ถ้า flag off
✅ **Apps Script v5.10.11** ใช้ `setJobRow` (deploy แล้วจาก setCowork rollout)
✅ **Schema** `phase2_dirty_at` already exists on jobs (confirmed by `db-migrate` ที่รัน 2026-05-11)

ถ้าจะ activate Phase 2 สำหรับ addJob:

1. **Set env var** — Vercel → Settings → Environment Variables → Add `WRITE_ADD_JOB_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
2. **Smoke test**:
   - เปิด /board → toolbar "+ งานเดี่ยว" (ถ้ามี) หรือ /orders → "สร้าง Job" จาก data-audit modal
   - กรอก name + dept + staff + (ออปชั่น orderId) → save
   - **คาดหวัง**: card ขึ้น Kanban ทันที, ไม่มี call `post('addJob', ...)` ใน Vercel logs (มีแค่ `getNextId` + Postgres INSERT)
   - **เปิด Sheet → tab `jobs`** → row ใหม่ ยังไม่มี (รอ heal cron 5 นาที)
   - **รอ ≤5 นาที** → ดู Vercel logs `/api/cron/sync-to-sheet` → confirm `tables: [{table: 'jobs', candidates: ≥1, healed: ≥1}]`
   - **เปิด Sheet `jobs` ใหม่** → row ใหม่ขึ้นแล้ว ตามที่กรอก
   - **id check**: id ต้อง sequential (ไม่กระโดดเพราะไม่มี double-bump). ถ้าเทียบกับ jobs เดิมที่ยังเป็น legacy path = id Phase 2 ติดกันเช่น 234, 235, 236; legacy = 234, 236, 238 (gap 2)
3. **Idempotency check still works** — ลองส่งซ้ำเร็วๆ 2 ครั้ง สำหรับ orderId เดียวกัน → ครั้งที่ 2 ควรได้ 409 พร้อม message "ใบสั่งงาน #X มี Job #Y ผูกอยู่แล้ว"
4. **Failure path** — temporarily rename `setJobRow` action ใน Apps Script editor → addJob via /board → confirm row อยู่ใน Postgres + Sheet ไม่ update → restore action + push → รอ heal cron → confirm row healed + Sheet updated
5. **Rollback** — unset `WRITE_ADD_JOB_TO_POSTGRES` → redeploy → กลับ Apps Script-first path (legacy double-bump resumes for new adds; existing Phase 2-added rows stay valid in both Postgres + Sheet after heal)

⚠️ **Trade-off** — Sheet stale ได้สูงสุด ~5 นาทีหลัง add (เหมือน updateJob). Morning report 8 AM อ่านจาก Sheet — ถ้าสร้างงาน 7:55-8:00 อาจตกหล่นรายงานวันนั้น

#### Phase 2 updateJob activation — เหลือ 1 ขั้น (ถ้า setCowork ยังไม่ activate ทำพร้อมกันเลย)

✅ **Code deployed** 2026-05-11 (`a52381e`) — `updateJobInPostgres` + route flag-gated branch ready, dormant ถ้า flag off
✅ **Apps Script v5.10.11** ใช้ `setJobRow` ที่ deploy แล้ว (จาก setCowork rollout) — ไม่ต้อง push เพิ่ม

ถ้าจะ activate Phase 2 สำหรับ updateJob:

1. **(ถ้า db-migrate ยังไม่รัน)** — เปิด `https://dashboard.penprinting.co/api/admin/db-migrate` (admin role) → confirm `phase2_dirty_at` ขึ้น 4 tables (jobs/orders/shipped/cancelled). Setup ครั้งเดียว — ใช้ร่วมกับ setCowork
2. **Set env var** — Vercel → Settings → Environment Variables → Add `WRITE_UPDATE_JOB_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
3. **Smoke test**:
   - เปิด /board → คลิก ✏️ บน job ใดๆ → เปลี่ยน dept (เช่น graphic→print) + เปลี่ยน staff → กด save
   - Vercel logs ดู `/api/jobs/update` → confirm Postgres UPDATE + revalidatePath
   - /board re-render: card ย้ายคอลัมน์ทันที (~300ms ไม่ใช่ ~1.5s)
   - รอ 5 นาที → Vercel logs `/api/cron/sync-to-sheet` ควรรัน + report jobs candidates ≥1 (rows ที่ dirty ยังไม่ healed) → ถัดไปอีก 1 รอบ candidates กลับเป็น 0
   - เปิด Sheet tab `jobs` → row นั้น dept/staff column update ตามที่แก้
4. **Failure path test** — temporarily rename `setJobRow` action ใน Apps Script editor → updateJob via /board → confirm row stays dirty in Postgres + Sheet ไม่ update → restore action name + push → รอ heal cron → confirm row healed + Sheet updated
5. **Rollback** — unset `WRITE_UPDATE_JOB_TO_POSTGRES` → redeploy → กลับ Apps Script-first path. Existing dirty rows: heal cron continues regardless of flag

⚠️ **Trade-off ที่ต้องรับ** — Sheet จะ stale ได้สูงสุด ~5 นาทีหลัง update (เหมือน setCowork). Morning report ที่ 8 AM อ่านจาก Sheet — ถ้า user แก้งาน 7:55-8:00 ก่อนรายงาน อาจเห็น dept/staff เก่า. /track ปกติเพราะ Postgres-first

#### Phase 2 setCowork activation (3 ขั้น — ต้องรัน db-migrate + push Apps Script + flag)

ก่อน activate ต้องเตรียม schema + Apps Script ก่อน:

1. **Run db-migrate** (1 ครั้ง) — เปิด `https://dashboard.penprinting.co/api/admin/db-migrate` ในเบราว์เซอร์ (admin role required) → ตอบ `{ok: true, applied: [...includes ALTER jobs/orders/shipped/cancelled phase2_dirty_at...]}` → confirm ใหม่ 4 ALTER + index
2. **Push Apps Script v5.10.11** — `bash production-monitoring/apps-script/dashboard/push.sh` หรือ `/push-apps-script dashboard` → Apps Script editor → **Manage deployments → Edit existing → New version**. Description: "v5.10.11 setJobRow Phase 2 reverse-sync target"
3. **Set env var** — Vercel → Settings → Environment Variables → Add `WRITE_COWORK_TO_POSTGRES=1` (Production + Preview + Development) → redeploy

**Smoke test:**
- เปิด /board → คลิก "co-work" บน job ใดๆ → เลือก print staff 1 คน → กด save
- Vercel logs ดู `/api/jobs/cowork` → confirm Postgres UPDATE + Apps Script setCowork
- เปิด Sheet tab `jobs` → row นั้น cowork column ต้องมี value ใหม่
- รอ 5 นาที → Vercel logs `/api/cron/sync-to-sheet` ควร run + report `{tables: [{table: 'jobs', candidates: 0, ...}]}` (no dirty = inline sync succeeded)
- ทดสอบ failure path: ปิด Apps Script ชั่วคราว (rename action) → setCowork → confirm row dirty in Postgres + Sheet ไม่ update → enable Apps Script → รอ heal cron → confirm row healed + Sheet updated

**Rollback:** unset `WRITE_COWORK_TO_POSTGRES` → redeploy → กลับ Apps Script-first path. Existing dirty rows ใน Postgres ที่ยัง pending heal: heal cron ยังรันได้ (ไม่ขึ้นกับ flag) → จะค่อยๆ heal จนเสร็จภายในไม่กี่ cron cycles

#### Phase 2 templates activation — เหลือ 1 ขั้น

✅ **Apps Script v5.10.10 deployed** 2026-05-10 — `setTemplateRow` action live (dormant ถ้า flag off)

ถ้าจะ activate Phase 2 สำหรับ templates:

1. ~~Push Apps Script~~ ✅ done 2026-05-10
2. **Set env var** — Vercel project `penprinting-dashboard` → Settings → Environment Variables → Add `WRITE_TEMPLATES_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
3. **Smoke test**: เปิด /orders/new → "บันทึก template" ใหม่ → Vercel logs ดู `/api/orders/templates/add` → confirm Postgres INSERT + Apps Script `setTemplateRow` POST → เปิด Sheet tab `templates` ดู row ใหม่ลง → "ลบ template" → ดู row หาย
4. **Rollback** (ถ้าจำเป็น): unset `WRITE_TEMPLATES_TO_POSTGRES` → redeploy → กลับสู่ Apps Script-first path. Phase 2-only rows ใน Postgres ที่อาจไม่อยู่ใน Sheet จะถูก sync ทันที (cron resume เพราะ flag off แล้ว) — **อาจ overwrite Postgres-only rows ที่ Sheet ยังไม่ได้รับ** ดังนั้นก่อน rollback ตรวจดู /orders/new ก่อน ถ้ามี template ที่เพิ่งสร้างให้ confirm Sheet ก็มีก่อน

แนะนำให้ **monitor Phase 1.7 ก่อน 24-48 ชม.** ก่อน flip flag — ถ้า Sentry breadcrumbs `postgres-fallback` rate ต่ำ (< 1%) แล้วค่อยลุย Phase 2 activate

### Phase 1 monitor (passive, 24-48 ชม.)

- ✅ **Postgres mirror live** — Vercel cron `*/10 * * * *` runs syncAllFromSheet, sync_meta tracks per-table freshness
- ✅ **Postgres-first reads ON** — `READ_FROM_POSTGRES=1` Vercel env var set, /board/orders/calendar/analytics/track all use Postgres
- [ ] Watch **Sentry** breadcrumbs ที่ category = `postgres-fallback` — ควร < 1% ของ requests. ถ้าสูง = Postgres mirror มีปัญหา
- [ ] Watch **Vercel cron logs** — `path:/api/cron/sync-from-sheet` ควร 200 ทุก 10 นาที
- [ ] **Rollback (กรณีฉุกเฉิน)**: Vercel → Settings → Environment Variables → delete `READ_FROM_POSTGRES` → redeploy → reads กลับไป Apps Script ทันที. Sheet เป็น source of truth ตลอด — 0% data loss risk

### Apps Script trigger cleanup (~1 วันรอ verify Phase 1)

- [ ] หลัง Postgres mirror ทำงานปกติ 1-2 วัน → Apps Script editor → **Triggers → row `morningReport` (Time-driven) → delete** (ป้องกัน double-fire กับ Vercel cron — ปัจจุบัน 5-min dedup ป้องกันอยู่แต่ลบ trigger จะ cleaner)

### Upstash KV connect — optional (5 min user)

ตอนนี้ rate limit fail-open อยู่ — endpoints ยังตอบปกติแต่ไม่มี protection. ทำเมื่อพร้อม:

1. Vercel project → Storage → Connect Database → Marketplace → Upstash → Redis → Free tier
2. Vercel auto-injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` to Production + Preview + Development
3. Redeploy (env var change takes 1 deploy to propagate)
4. Verify: หลัง deploy เสร็จ ลองเปิด /board card detail หลายๆ ใบติดกันเร็วๆ ในมือถือ → หลัง ~60 ครั้ง/นาที จะเห็น 429 response. ถ้าไม่ติด rate limit แม้ spam → KV ยังไม่ wired (ดู Vercel function logs สำหรับ warn message)

### Sheet data drift cleanup — 2 shipped duplicates

shipped table ใน Sheet มี 2 rows ที่ id ซ้ำกัน (sync ก็ work เพราะ dedup last-wins แต่ Sheet เองยังมี data drift)

- [ ] Run `/api/admin/diagnose-shipped-dupes` (added in this session) → ดู ids 2 ตัวที่ซ้ำ
- [ ] เปิด Sheet → tab `shipped` → หา rows ตามที่ diagnose บอก → ลบ row ที่เก่ากว่า (ตาม shippedDate)
- [ ] Run `/api/admin/sync-all` → confirm dedup กลับเป็น 0

---

### ✅ Done in earlier sessions (no further action needed)

✅ **Already done by user 2026-05-07**: Apps Script redeploy (Phase 2.1 + createOrder + bulkForward auto-alloc + per-user audit signing + **v5.10.4 cancelOrder/deleteOrderCascade/promoteDraft** + **v5.10.5 audit-param skip** — all live)

✅ **Validated 2026-05-08**: `createOrder` fast path — photobook order รอบใหม่ land ด้วย details ครบ. ปิดเรื่องนี้ — fast path เป็น default พ.ร้อม fallback ไม่ต้อง revert

✅ **Done 2026-05-08**: Sentry 4 env vars ตั้งครบใน Vercel (`NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_ORG=penprinting-coltd` + `SENTRY_PROJECT=penprinting-dashboard` + `SENTRY_AUTH_TOKEN`). Production + Preview + Development. NEXT_PUBLIC ตัวไม่ Sensitive (สำคัญ — Vercel ไม่ inline Sensitive vars เข้า client bundle). Verify end-to-end ผ่าน — issue "Sentry real test" ขึ้น dashboard, /monitoring tunnel POST 200, sourcemaps upload ครบ 3 runtimes.

✅ **Done 2026-05-08**: Apps Script `helpers.ts` (`objectToRow` Date guard) — user pushed via push.sh + redeployed. Date corruption ใน promoteDraft / cancelOrder paths กันแล้วถาวร. existing corrupted cells จะ auto-clean เมื่อ status flip ครั้งต่อไป.

---

## ⏳ ที่ยังเหลือ (priority order)

### 1. ✅ Phase 3.6 — Path A RETIRE WP (DONE 2026-05-09)

**Cutover complete.** ดู §10 dashboard-v2.md "Phase 3.6 cutover" สำหรับ entry รายละเอียด.

**Monitor checklist (1 สัปดาห์):**
- [ ] Sentry — daily error rate ภาพรวม + spike alerts
- [ ] Vercel logs — `/api/track/lookup` traffic (paper QR scans)
- [ ] LINE OA `/track` command ยังตอบปกติ
- [ ] Staff feedback ใน work group ถ้ามี

**Rollback recipe** (ถ้าจำเป็น):
- HostAtom DNS → delete CNAME `cname.vercel-dns.com.` → add A record `203.170.190.20` (TTL=300)
- WP files ยังอยู่ที่ HostAtom theme — กลับมา serve ได้เลย ไม่ต้องเปลี่ยน wp-config.php
- Vercel app.penprinting.co domain ปล่อย "Invalid Configuration" เฉยๆ ก็ได้ (ไม่ต้องลบ)

**Lesson** [add to memory if recurring]: HostAtom DNS UI auto-appends zone to relative names → CNAME value ต้องมี trailing dot (`cname.vercel-dns.com.`) ไม่งั้นมันชี้ไป `cname.vercel-dns.com.penprinting.co.` (NXDOMAIN). เจอครั้งนี้ user save แบบไม่มี dot → 1 รอบ debug → re-save with dot → ผ่าน

---

#### Historical: Phase 3.6 Path A pre-cutover runbook (already executed)

ขั้นตอนทั้งหมดที่ executed สำเร็จ — เก็บไว้สำหรับ reference ครั้งต่อไปถ้ามี subdomain ใหม่ที่ต้อง switch:

**A. Pre-flight (5 นาที)**
- [ ] เปิด Sentry dashboard — confirm ไม่มี fresh error 24h ผ่านมา
- [ ] Manual smoke test ที่ dashboard.penprinting.co: /login → /board → drag card → /orders → /track?id=<order> → /analytics → /calendar
- [ ] Test promote draft + cancel + delete + cowork + bulk-forward ใน v2

**B. Backup WP (precaution, 5 นาที)**
- [ ] HostAtom panel → DirectAdmin → Backup → Full backup
- [ ] หรือ phpMyAdmin → Export DB ของ WordPress (mysqldump)
- [ ] Theme files: download `wp-content/themes/<active-theme>/page-production-monitoring.php` + `page-production-tv.php` + `page-track-order.php` + `production-monitoring.{js,css}` ผ่าน FTP/HostAtom file manager

**C. Add custom domain ที่ Vercel (3 นาที)**
- [ ] Vercel project `penprinting-dashboard` → Settings → Domains → Add → `app.penprinting.co`
- [ ] Vercel จะแสดง expected CNAME target (`cname.vercel-dns.com`) + warn "DNS not configured"
- [ ] อย่าลบ `dashboard.penprinting.co` — เก็บไว้เป็น canonical

**D. DNS switch ที่ HostAtom (5 นาที + 5-15 นาทีรอ propagate)**
- [ ] HostAtom DNS panel → `app.penprinting.co`
- [ ] Reduce TTL ของ A record เป็น 300 → save → wait 1-2 นาที
- [ ] Delete A record `203.170.190.20`
- [ ] Add CNAME → `cname.vercel-dns.com` (TTL 300)
- [ ] Verify DNS: `dig app.penprinting.co +short` หรือ https://www.whatsmydns.net/#CNAME/app.penprinting.co — ดูว่าตอบ `cname.vercel-dns.com` แล้ว
- [ ] กลับ Vercel domain UI — Vercel จะ auto-issue Let's Encrypt SSL (5 นาที)

**E. Verify Vercel ครอบ app.penprinting.co (3 นาที)**
- [ ] เปิด `https://app.penprinting.co` → ควร redirect /login
- [ ] เปิด `https://app.penprinting.co/board` → Kanban v2 ขึ้น
- [ ] เปิด `https://app.penprinting.co/track?id=<order>` → /track v2 ขึ้น
- [ ] ถ้า SSL ยังไม่ active หลัง 5 นาที → กลับ Vercel domain UI กด "Refresh"

**F. Push Morning Report Apps Script (5 นาที)**
- [ ] `cd morning-report` → `bash push.sh` (ถ้ามี) หรือ copy `apps-script/v2/Code.js` ไปวางใน Apps Script editor "MorningReportV2"
- [ ] Apps Script Editor → **Edit existing → Save → Manage deployments → Edit (pencil) → New version → Description "v2.x.x DASHBOARD_URL fix" → Deploy** (อย่ากด "New deployment" — จะเปลี่ยน URL)
- [ ] Test รัน `testLineSend()` → ดู LINE group — ปุ่ม "ดูทั้งหมด" ควรชี้ `dashboard.penprinting.co/board`

**G. Communicate (15 นาที)**
- [ ] Internal LINE work group broadcast (draft อยู่ด้านล่าง section "📣 LINE message templates")
- [ ] Optional: 30-นาที walk-through กับ staff คนใหม่/lower-tech (ถ้าจำเป็น)

**H. Deprecate WP source (15 นาที, ทำเมื่อ verify ผ่าน 1-2 ชม.)**
- [ ] ✋ **อย่าลบ Apps Script** — เป็น backend ของทั้ง WP (ที่ retire แล้ว) + v2 (ที่ใช้อยู่)
- [ ] ✋ **อย่าลบ Apps Script LINE Webhook** + **Cloudflare Worker** — ยังใช้สำหรับ LINE OA `/track` command
- [ ] (Optional) `production-monitoring/` repo — เพิ่ม README banner "🚫 Archived 2026-05-09. Active dashboard at /penprinting-dashboard. Apps Script + LINE Webhook ยังใช้งาน"
- [ ] WP-side `wp-config.php`: ไม่ต้องแก้ — DNS ไม่ตอบที่ HostAtom แล้ว WP ไม่มีคนเข้าก็ไม่ทำงานอะไร

**I. Monitor 1 สัปดาห์**
- [ ] Sentry — ดู error rate ทุกวัน
- [ ] Vercel logs — ดู `/api/track/lookup` traffic (paper QR usage)
- [ ] LINE OA `/track` — confirm ยังทำงาน
- [ ] ถ้ามีปัญหา rollback ได้: HostAtom DNS → A record `203.170.190.20` กลับ + WP ก็ตอบเหมือนเดิม

#### 📣 LINE message templates

**Internal staff (LINE work group):**
```
📢 อัปเดตระบบ Dashboard

วันที่ <DD/MM> เริ่ม cutover dashboard ระบบใหม่บน
🌐 https://dashboard.penprinting.co
🌐 https://app.penprinting.co (URL เดิมยังใช้ได้)

ทั้งสอง URL ตอนนี้เป็นระบบเดียวกัน (dashboard v2)
- Login เดิม / รหัสเดิม / role เดิม
- ข้อมูลเดิมจาก Sheet เดียวกัน
- เร็วขึ้น + UX ใหม่ + รองรับมือถือดีขึ้น

✅ มี: Kanban / สั่งงาน / ส่งงาน / cowork / bulk-forward / Analytics / Calendar / Archive / Track
🚧 ยังพัฒนา: ประวัติงาน (audit log)

มีปัญหาทักคุณนุ๊กได้เลยครับ 🙏
```

**Risk register**
- **HIGH**: WP-only feature ที่ staff ใช้แต่ไม่ได้ map → ลดด้วย pre-flight smoke test
- **MED**: HostAtom DNS UI งง → ลด TTL ก่อนแก้ + ทำใน window ที่ user low traffic (เช้าวันอาทิตย์)
- **LOW**: HostAtom email (mail/pop/smtp.penprinting.co) — root domain เดิม ไม่กระทบ

**Decision points**
- DNS propagate ช้าเกิน 30 นาที → ตรวจ HostAtom NS settings + clear dnsmasq local
- Vercel SSL ไม่ active หลัง 10 นาที → manually trigger ใน Vercel domain UI หรือ redeploy

### 2. TV display kiosk (deferred — not in active use, 2026-05-08)
User confirm ยังไม่มี use case จริงสำหรับ TV kiosk ใน v2. Backlog item — ถ้ากลับมาจะ port `production-monitoring/assets/production-tv.{js,css}` → `app/tv/page.tsx` (read-only Kanban + 30s auto-refresh + secret key auth + dark 3-column mosaic). ลด priority ต่ำสุดในรายการ.

### 3. Route group `(shell)/layout.tsx` refactor (low priority หลัง mobile sheet ลง)
Future fix สำหรับ:
- Per-route loading.tsx ที่จะใส่ได้โดยไม่ unmount shell (สำหรับ user ที่อยาก skeleton ใน body)
- ~~Mobile drawer / "More" sheet ที่เหมือน WP~~ ✅ ปิดด้วย `MobileUserMenu` + `getMoreMenuGroups` (`95c0cb8`)
- Shared providers (Toast/Confirm) ที่ stays mounted across navigations
- Effort ~2-3 ชม. defer until needed

### 4a. Phase 2 — write migration (in progress, scaffold + 1/17 actions ready 2026-05-10)

**สถานะ**: scaffold ครบ. 1 action (templates) implemented + flag-gated. 16 actions เหลือ.

**Migration order (lowest → highest risk)**:

| # | Action(s) | Risk | Reason | Est. effort |
|---|---|---|---|---|
| ✅ 1 | `addTemplate` + `deleteTemplate` | Low | /orders/new only, ไม่ hot path, name+Date.now() id ไม่ collision | done |
| ✅ 2 | `setCowork` + reverse-sync infra | Low | single field UPDATE + built phase2_dirty_at + heal cron | done |
| 3 | `updateJob` (spec-only edits) | Med | all roles use, แต่ partial update ปลอดภัย — reuse setJobRow infra | 30 min |
| 4 | `addJob` + `deleteJob` (standalone) | Med | needs `job_id_seq` SEQUENCE — first id minting migration | 2 hr |
| 5 | `cancelJob` + `restoreJob` | Med | 2-table mutate (jobs + cancelled). Mirror handlers reusable | 1 hr |
| 6 | `moveToShipped` | Med | 2-table mutate (jobs + shipped). Need `setShippedRow` Apps Script | 1 hr |
| 7 | `bulkForward` | High | hot path, server-side id alloc, atomic LockService → Postgres tx | 3 hr |
| 8 | `addOrder` + `updateOrder` + `deleteOrder` | High | needs `order_id_seq` SEQUENCE, customer name match logic | 3 hr |
| 9 | `createOrder` (atomic order + initial job) | High | combines 4 + 8, dependency on both SEQUENCEs | 2 hr |
| 10 | `cancelOrder` (atomic cascade) | High | reuses 5 cascade pattern but more rows | 2 hr |
| 11 | `deleteOrderCascade` | High | similar to 10 | 1 hr |
| 12 | `promoteDraft` (atomic) | High | similar to 9 | 1 hr |
| 13 | Audit log writes | Med | append-only, no id race, but every action writes audit | 2 hr |

**Total estimated**: ~22 hours additional work (~2 weeks part-time as plan said). Per-action flag = can pause/resume between sessions.

**Schema additions needed before next batch**:
- Postgres SEQUENCEs: `nextId_seq`, `order_id_seq` (for jobs and orders id allocation)
- `audit_log` writes from Vercel API directly (currently Apps Script writes audit row after every mutation — Phase 2 needs to replicate)
- Optional: reverse-direction cron (Postgres → Sheet) for tables Postgres owns, instead of relying solely on best-effort sync per action (in-flight sync misses ที่ Apps Script down ตอน write จะหายไปจาก Sheet ถาวร)

**Validation gate before each action**:
- Smoke test in preview deployment with flag set
- Watch Sentry `layer:phase2-sheet-sync` breadcrumb count for 24-48 hr
- If error rate < 1% → ready for next action

**Trigger to skip Phase 2**: writes ยังเร็วพอ (~1.5-3s) ที่ user รับได้. ถ้า bench-driven decision (analogy ของ Phase 1's bench) ชี้ว่า Postgres writes ไม่เร็วกว่า meaningfully = defer ไม่ต้องทำหมด

### 4b. ✅ Phase 1 Postgres read mirror — DONE 2026-05-10 (live in production)
**Decision** (logged 2026-05-09): Vercel Postgres (Powered by Neon) — รวมใน Pro plan, single dashboard, schema portable to Supabase ภายหลังถ้าต้องการ realtime.

**Phase 1 result**: bench-driven decision via `/admin/bench-audit` showed Postgres p50 23.9× faster than Sheet for loadAll-shaped query (4400ms → 200ms). Shipped same session: 4 mirror tables + sync_meta + Vercel cron + `lib/api-postgres.ts` + `lib/api.ts` Postgres-first behind `READ_FROM_POSTGRES=1` flag with Apps Script fallback.

**User confirmed**: "เร็วขึ้นเยอะ" after flag flipped + redeploy.

**Phase 2 — write migration** (~2 wk effort) defer ถึงเมื่อ writes รู้สึกช้าจริง. Currently writes ~1.5-3s = acceptable. Trigger conditions: user complains writes slow, LockService timeout errors, multi-user concurrent edit need. ดู migration-plan §3-4.

### 5. ✅ Tier B leftover Pro features — DONE 2026-05-10 (code; user actions pending — see top of file)

### 6. ✅ Perf optimization batch — DONE 2026-05-10
- ✅ TextFinder pattern in `write.ts` — `findRowById` rewrite + new `findRowMatchesByColumn` + cascade refactor
- ✅ /board bundle sweep 18.4 → 16.4 kB + fetch storm fix
- ✅ Apps Script quota dashboard widget on /analytics

### 7. ✅ Spawned tasks — Morning Report `ICON_BASE` already shipped 2026-05-09 (`1e1f692`)

---

## 📚 Where to dig

| ต้องเข้าใจอะไร | ดูที่ไหน |
|---|---|
| v2 source of truth (stack, routes, features, history) | [dashboard-v2.md](dashboard-v2.md) ⭐ |
| Code patterns (Apps Script, permissions, URL state, icons, forms) | [PATTERNS.md](PATTERNS.md) |
| Audit findings tracker | [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) |
| Migration phases overview | [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) |
| WP source + shared infrastructure (Sheet schema, security, lessons) | [../production-monitoring/monitoring.md](../production-monitoring/monitoring.md) |
| Today's daily log | [../10-Daily/2026-05-06.md](../10-Daily/2026-05-06.md) |

## 🧠 Decisions to remember (latest)

1. **Permissions ตาม WP role matrix** (locked 2026-05-06):
   - `/analytics` admin only
   - `/orders` admin + sales (staff redirect)
   - `/orders/[id]/edit` + `/api/orders/update` admin only
   - Sales = create + view + duplicate, ไม่ edit + ไม่ลบ
2. **ISR 60s cache** — ห้าม extend จนกว่า WP retire (cross-system stale risk)
3. **Per-action `revalidatePath`** scope ใน lib/api.ts — bust แค่ paths ที่ relevant. Pages outside the action's list keep warm cache. ดู `PATHS_BY_ACTION` map.
4. **Suspense streaming on every authenticated page** — DashboardShell ใน page.tsx (ไม่ใช่ layout) ดังนั้น loading.tsx ที่ duplicate shell ทำให้กระตุก. Use Suspense ภายใน page เท่านั้น
5. **`app/icon.png` + `app/apple-icon.png` only** — ไม่ใช้ favicon.ico (default scaffold). PNGs จาก real logo, square-padded
6. **Sentry disabled when DSN missing** — dev / preview / fork builds ไม่พัง
7. **Per-user audit signing** — `lib/api.ts` ส่ง `_actor` ใน body, Apps Script honors. Backwards-compat: Apps Script ไม่มี code นี้ → silent skip
8. **3-tab order detail** matches Kanban card detail UI — ข้อมูลหลัก / สเปคงาน / ประวัติ. Lazy fetch via `/api/orders/raw/[id]` (any role)

## 🛠 Quick start for next session

```bash
cd /Users/witsarut.p/Desktop/Project\ Report\ Penprinting/penprinting-dashboard
git pull
npm install              # if package.json changed
npx tsc --noEmit         # type-check
npm run build            # before any commit
```

Pick task from list above, follow PATTERNS.md, ship + push (Vercel auto-deploys).

## 📝 Update protocol after work

หลังจบ session:
1. อัปเดตข้อ "เสร็จแล้ว" + เลื่อน item ลง / ลบ จาก "ที่ยังเหลือ"
2. ถ้าเจอ pattern ใหม่ — เพิ่มใน [PATTERNS.md](PATTERNS.md)
3. ถ้ามี audit findings ใหม่ — เพิ่มใน [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md)
4. อัปเดต [dashboard-v2.md §10 Version History](dashboard-v2.md)
5. อัปเดต [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) timeline + iteration table
6. สร้าง daily note ที่ `../10-Daily/YYYY-MM-DD.md`

_อัปเดตล่าสุด: 2026-05-10 (afternoon batch 4) — **Phase 2 reverse-sync infra + setCowork ready**. After templates (table-level ownership) realized actions sharing tables (setCowork, etc.) need row-level marker. Built `phase2_dirty_at` column on 4 tables + refactored from-Sheet cron to "DELETE WHERE NULL + INSERT ON CONFLICT DO NOTHING" preserving dirty rows + heal cron `*/5 * * * *` pushing dirty rows back via Apps Script `setJobRow` (v5.10.11). setCowork migrated as POC of new infra: Postgres UPDATE + dirty mark → inline setCowork Apps Script call → markClean on success / leave for heal cron on failure. Worst-case Sheet drift: 5 min until heal catches up. 16 actions ที่เหลือ now reuse this infra (cleaner per-action migration). Type-check + production build clean. Default-off (3-step activation: db-migrate + Apps Script push + env flag)._

_อัปเดตก่อน: 2026-05-10 (afternoon batch 3) — **Phase 2 scaffold + templates migration ready**. Built `lib/postgres-write.ts` (Postgres-authoritative writes) + `lib/feature-flags.ts` (per-action `WRITE_<ACTION>_TO_POSTGRES` flag) + gated cron template sync via `phase2OwnsTable`. Migrated `addTemplate` + `deleteTemplate` API routes with flag-gated branch — flag off (default) = legacy behavior unchanged, flag on = Postgres-first + best-effort Apps Script Sheet sync. Apps Script side: `setTemplateRow` action (v5.10.10) accepts pre-allocated id + idempotent upsert. Failure contract: Postgres write fail → propagate; Sheet sync fail → swallow + Sentry. Default-off until user pushes Apps Script + sets env var. Type-check + production build clean. Migration order documented for remaining 16 actions (~22 hr total) — next: `setCowork` (low risk), then id-minting actions need SEQUENCEs._

_อัปเดตก่อน: 2026-05-10 (afternoon batch 2) — **Phase 1.7 dual-write live + 2 bug fixes**. After Phase 1 cutover writes "เด้งกลับหมด" (Postgres mirror 10-min lag → reads after writes returned stale → optimistic UI bounced back). Fix: `lib/postgres-write-mirror.ts` 17 handlers mirror every Apps Script write to Postgres in same request → 0 staleness window. Plus 2 follow-on fixes: OrderForm SuccessView flicker on refresh (`initializedIdRef` guard) + /orders→edit speed (drop redundant loadOrder, loadAll covers both target + recent autocomplete). 3 commits. Phase 2 deferred — writes still through Apps Script (~1.5s) which user finds acceptable; 70-80% of Path A handlers reuse in Phase 2 when triggered._

_อัปเดตก่อน: 2026-05-10 (afternoon batch 1) — **Phase 1 Postgres read mirror LIVE in production**. PoC bench-driven decision (Bench 2 loadAll-shaped showed Postgres 23.9× faster) → shipped full Phase 1 same session: 4 mirror tables + Vercel cron `*/10 * * * *` + Postgres-first reads behind `READ_FROM_POSTGRES=1` flag + dedupeById safety net. /track migration: switched from loadAll().filter() (200KB) → loadOrder() (1KB). User confirmed "เร็วขึ้นเยอะ" after flag flipped. Total 8 commits + 1 Vercel UI config (Neon connect + READ_FROM_POSTGRES env). Migration plan estimated 1 wk → shipped in 1 session._

_อัปเดตก่อน: 2026-05-10 (morning) — Tier B close-out + perf compound (6 tasks ใน 1 session). **Morning Report cron migration**: Apps Script doPost handler + Vercel cron route + 3rd vercel.json entry + new env vars (pending user deploy). **Vercel KV rate limit**: lib/rate-limit.ts fail-open Upstash REST helper applied to /api/audit + /api/orders/raw (pending KV connect). **Apps Script TextFinder writes (v5.10.9)**: helpers.ts findRowById + findRowMatchesByColumn + cancelOrder/deleteOrderCascade share new cascadeCancelJobsForOrder_. -500ms-1.5s per cascade. **/board sweep**: 18.4 → 16.4 kB (-11%) + biggest win = killed 50-card useEffect audit fetch storm via mount-on-open DetailContent gate. **Quota widget**: bumpUsage_() per-day Properties counter + getQuotaStats action + app/analytics/quota-widget.tsx SVG sparkline._

_อัปเดตก่อน: 2026-05-09/10 mega-day (12+ hr session) — Phase 3.6 cutover ✅ + history tab v2 port + Tier A Pro features + Tier B 2/4 cron migration. **Phase 3.6**: WP retired via DNS A→CNAME Vercel, app.penprinting.co alias, cushion redirect, 9 hard-coded refs fixed. **Bonus**: createOrder PATHS_BY_ACTION miss fix `e88f386`, quota threshold 3000→5000ms. **History tab port**: Apps Script v5.10.7 `getAuditByTarget` + `/api/audit` + `<HistoryTab>` (`51e8df5`) + prefetch-on-mount (`1093a6d`). **Tier A Pro**: Speed Insights + Web Analytics + maxDuration=30 on 20 routes + Spend Cap $200 (`fc0579c`). **Tier B 2/4**: Vercel Cron migration — quota-check + r2-backup endpoints + vercel.json + Apps Script v5.10.8 (`d0ec15d`). CRON_SECRET manually created (Vercel didn't auto-gen), force-redeploy without build cache, Apps Script time triggers `dailyQuotaCheck` + `backupSheet` deleted. **Total**: 11 commits + 3 Apps Script deploys + DNS cutover + 4 Vercel UI configs (custom domain, env vars, spend cap, cron). Monitor 1 สัปดาห์._

_อัปเดตก่อน: 2026-05-08 mega-day — audit batch 5 (`57ca976` + `dc24167`) + Sentry 5-layer journey (`212bb7a` → `f299dc9` → `076586d` → `5b851a5` → `7e6fbfa`) + photobook spec (`682fd0e`) + promote-draft flicker (`5db20f5`) + date corruption (Vercel `25e28c0` + Apps Script helpers.ts pushed by คุณนุ๊ก) + Bug 4 modal slow (`7b73d4f` + Apps Script load.ts pushed by คุณนุ๊ก + architectural fix `96603a8`) + Bug 5 pagination (`b798c3e`). 15 commits + 2 Apps Script deploys. Sentry observability live._

_2026-05-07 mega-day — morning: Phase 2.1 close-out + forward perf A+B+C + order create perf + bug fixes + PM perf batch (`8528839`) + PM2 atomic cascade (`c95c451`). afternoon: bundle splits + smart auto-sync backoff + edge runtime (`1d6e57f`) + mobile bottom-nav 4 + hamburger sheet + top-right user menu (`95c0cb8`) + /track WP port + 6-step progress (`ce611b1`) + /track charcoal mood (`fe0b38e`) + workflow speed sweep round 5 (`3cb4501`) + Apps Script v5.10.5 audit-param skip. **Total**: 16+ commits, full day perf compound._
