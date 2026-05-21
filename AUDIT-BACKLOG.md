# 🐞 Audit Backlog — Dashboard v2

> Last scan: **2026-05-12** (5-dimensional audit — 4 parallel subagents covering data/perf/a11y/security + manual architecture review)
>
> Data-integrity scan: **2026-05-15** (`runPhase2IntegrityScan` — 9-dimension Sheet scan post Phase 2; see "Data integrity scan" section below)
>
> Latest update: **2026-05-21** — Delta-fetch P3 landed (`BoardClient` + `useDeltaSync`, flag `NEXT_PUBLIC_DELTA_FETCH`). ปิด **PA-H2** + **PA-M2** (`6412d5b`). เหลือ **PA-L1** (loadOrder over-fetch — minor, แยก session).
>
> Previous: **2026-05-20** — Delta-fetch P1+P2 landed (schema + bump triggers + delta endpoint + 9 tests). PA-H2/M2/L1 ยัง open รอ P3 client refactor (target session ถัดไป).
>
> Previous: **2026-05-19** — performance audit (penprinting-auditor) + quick wins. ปิด: PA-H1 (auto-sync idle hard-stop) · PA-M3 (nested-cache fallback) · M1 = invalid · PA-M4 = verified clean (index มีอยู่แล้ว). เหลือ open: PA-H2 · PA-M2 · PA-L1 (รอทำพร้อม delta-fetch). ดู "Perf audit — 2026-05-19" section.
>
> Previous: **2026-05-16** — `DATA-dateIn-double-encoded` root-caused via `/diagnose` → **accepted** (ไม่ใช่ `addOrder` แต่เป็น `objectToRow` Date bug, source fixed 2026-05-08; ดู Data integrity scan section). ไม่มี code/data fix — display self-corrects อยู่แล้ว.
>
> Previous: **2026-05-12** — **10 audit items closed across 5 commits today**:
>
> Morning batch (loadOrder refactor + cleanup):
> - ✅ M3-jobform-stale-toast (closure capture clarity, `7e9fa6b`)
> - ✅ M-restore-cancelled-parent (block restore at cancelled parent, `7e9fa6b`)
> - ✅ L2-currentactor-edge-comment (doc clarity, `7e9fa6b`)
> - ✅ L4-data-audit-modal-sales-no-action (hide button for non-admin, `7e9fa6b`)
> - ✅ M4 narrow `loadOrderFromPostgres` staleness gate to `['orders']` (`f4f3474`)
> - ✅ M1 drop redundant retry in `/api/track/lookup` (loadOrder ทำ fallback ในตัวอยู่แล้ว) (`f4f3474`)
> - ✅ L1/L2/L4 stale comments in print/page.tsx + track/lookup + loadOrder docstring (`c0be3b8`)
>
> Afternoon Sprint 1 (`6e46d82`) — 6 high-impact fixes:
> - ✅ PERF-F1 4 route-segment `loading.tsx` (board/orders/calendar/analytics)
> - ✅ A05-1 Security headers in `next.config.mjs`
> - ✅ PERF-B2 `allSettledLimit(cap=3)` on `/api/orders/update` cascade
> - ✅ A11Y-R1 `<main>` landmark + skip-link + global `focus-visible:` rule
> - ✅ A11Y-O2 Touch targets 44×44 (9 close buttons + MobileUserMenu + toast)
> - ✅ PERF-C1 Card `arePropsEqual` field-compare (no more JSON.stringify hot path)
>
> Afternoon Sprint 2 (`190c5fe`) — 4 security + a11y deeper fixes:
> - ✅ A04-1 /track 3-layer brute-force (Upstash IP + per-id PIN lockout + constant-time compare)
> - ✅ A09-1 Login audit logging + Sentry breadcrumb
> - ✅ A11Y-P1 Urgency badge contrast (URGENCY_BADGE Tailwind pair, 6 callsites)
> - ✅ A11Y-U2 Form errors `role="alert"` (login + track + ForwardDialog + Reassign + BulkActions)
>
> Previous: **2026-05-09** — ปิด 1 user-reported perf bug (`createOrder` missing from PATHS_BY_ACTION → order create perceived 15-60s instead of ~1.5s)
>
> Previous: **2026-05-08** — ปิด 9 (3 High + 5 Medium + 1 doc), defer 6 (M1, M3, L1-L4) ที่ audit เองแนะนำให้ defer
>
> ✅ = ปิดแล้ว / commit hash อยู่ในวงเล็บ
> ⏳ = ยังเหลือ
>
> Convention: tick checkbox + ใส่ commit hash + ย้ายลง "Closed" section หลังแก้

---

## 🔴 Critical

_(ไม่พบใน scan 2026-05-08)_

---

## 🟠 High

_(ปิดครบ — ดู Closed section)_

---

## 🟡 Medium (open — defer per audit recommendation)

- [x] ✅ **M1-card-memo-deep-compare** (closed 2026-05-19 — **invalid**) — item บรรยาย `app/board/card.tsx:459-489` ว่ามี `JSON.stringify`/deep-compare `a.order` — **โค้ดนั้นไม่มีแล้ว**. PERF-C1 (2026-05-12) ลบ `JSON.stringify` ออกไปแล้ว. comparator ปัจจุบัน [`card.tsx:552-612`](app/board/card.tsx:552) เป็น flat primitive compare (~20-25 scalar `!==` ต่อ card → ~1000-1250 ต่อ auto-sync tick = sub-ms บน iPhone, ไม่ใช่ปัญหา CPU). verified ผ่าน perf audit 2026-05-19. ไม่มี code fix — "รอ profiler" overcautious + profile ผิดจุด. **ตัวจริงที่ควร profile** = React reconciliation ของ 50-card tree ตอน parent re-render (PA-M2) ไม่ใช่ comparator.
- [x] ✅ **M3-jobform-stale-toast** (closed 2026-05-12) — snapshot `editId` at top of `onSubmit()` ใน `app/board/job-form.tsx`. Toasts ใช้ `editId` แทน `initial?.id` ตรง — closure ยังถูกต้องอยู่แล้ว แต่ explicit snapshot ทำให้ตามอ่านง่ายขึ้น + ป้องกัน future refactor ที่อาจ break.
- [x] ✅ **M-restore-cancelled-parent** (closed 2026-05-12) — `app/api/jobs/restore/route.ts` ตอน reattach parent order ตรวจ `orderResult.order.status === 'cancelled'` → return 409 message "ใบสั่งงาน #N ถูกยกเลิกแล้ว — กรุณา restore ใบสั่งงานก่อน หรือ recover ผ่าน data-audit modal".

---

## 🟢 Low (open — defer per audit recommendation)

- [ ] ⏳ **L1-bottomnav-iphonese-truncate** — `components/bottom-nav.tsx:31, 86-96` admin 5-col @ 320px → "หลังพิมพ์ / จัดส่ง" truncate. **Defer reason**: audit เองระบุ "Acceptable (icon carries meaning)" — รอ user feedback จาก iPhone SE จริง
- [x] ✅ **L2-currentactor-edge-comment** (closed 2026-05-12) — `lib/api.ts` `currentActor()` docstring เขียนใหม่ชัดเจน: ระบุ 3 cases ที่ return undefined (no request context / edge import fail / no session) + อธิบาย service identity fallback path ของ Apps Script v5.10.1+.
- [ ] ⏳ **L3-edge-build-warnings** — `app/api/track/lookup/route.ts:13` + `app/api/auth/{login,logout}` Vercel logs edge runtime warnings (expected) แต่ noisy. **Defer reason**: cosmetic, no functional issue
- [x] ✅ **L4-data-audit-modal-sales-no-action** (closed 2026-05-12) — `app/orders/data-audit-modal.tsx` `DataAuditButton` return null ถ้า `!isAdmin` → sales/staff ไม่เห็นปุ่มอีกแล้ว. Page-level role gate ของ /orders ยัง admin+sales เหมือนเดิม.

---

## ⚡ Perf audit — 2026-05-19 (penprinting-auditor, perf-only scope)

Performance-only audit หลัง Phase 4.2 close-out. ผล: **0 critical · 2 high · 3 medium · 1 low**. Hot path โดยรวมสภาพดี — cache coalescing (2026-05-18), recharts route-split, card lazy-loading verified clean.

- [x] ✅ **PA-H1-autosync-idle-leak** (closed 2026-05-19, `c43999b`) — `lib/auto-sync.tsx` backoff (15s→30s→120s) ไม่เคยถึง 0 → tab ที่เปิดทิ้งข้ามคืน fire ~720 `router.refresh()`/คืน (server re-render + stream board HTML กลับทุกครั้ง). Fix: เพิ่ม hard-stop — idle > 30 นาที หยุด poll สนิท, resume เมื่อ user input / tab re-visibility (resume refresh ทันที 1 ครั้ง = ไม่เสีย freshness).
- [x] ✅ **PA-H2-loadall-overfetch** (closed 2026-05-21, `6412d5b`) — เดิม `/board` ดึงครบ 5 ตารางผ่าน `loadAllFromPostgres` (ลาก `shipped`+`cancelled` history เปล่า). Delta-fetch P3 ทำ /board bootstrap ด้วย `loadBoardDelta(null)` — อ่านแค่ `jobs`+`orders`. มีผลเมื่อ `NEXT_PUBLIC_DELTA_FETCH=1` (flag-OFF /board ยังใช้ `loadAll()` เดิม). หน้าอื่น (orders/analytics ฯลฯ) ใช้ตารางครบจริง — ไม่ใช่ over-fetch.
- [x] ✅ **PA-M2-parent-rerender-churn** (closed 2026-05-21, `6412d5b`) — เดิม `router.refresh()` ทุก tick rebuild `KPIBar`/`BoardToolbar` แม้ snapshot ไม่เปลี่ยน. Delta-fetch P3: `mergeDelta` คืน state reference เดิมเมื่อ delta ว่าง → `useMemo(computeBoard)` ไม่ recompute → idle tick ไม่ re-render เลย. มีผลเมื่อ flag ON.
- [x] ✅ **PA-M3-nested-cache-fallback** (closed 2026-05-19, `f82734f`) — `loadAllSnapshot` ([`lib/api.ts:132`](lib/api.ts)) Apps Script fallback เรียก `get('loadAll')` ด้วย default `fetch` cache 60s ขณะรันใน `loadAllCached` (`unstable_cache` 15s + tag) → cache ชั้นที่ 2 ที่ไม่ถูก tag → `revalidateTag(LOAD_ALL_TAG)` บัสต์ไม่ถึง = write ตอน Postgres ล่มไม่โผล่นานสุด 60s. Fix: pass `{ revalidate: 0 }` ให้ `get()` → outer `unstable_cache` เป็น cache + invalidation ชั้นเดียว.
- [x] ✅ **PA-M4-auditlog-index** (closed 2026-05-19 — **no action, verified clean**) — index มีอยู่แล้ว: [`db-migrate/route.ts:52`](app/api/admin/db-migrate/route.ts:52) สร้าง `idx_audit_target ON audit_log(target_id, timestamp DESC)`. query ใน `getAuditByTargetFromPostgres` เป็น `target_id = X OR target_id = Y` บน column เดียว (`::bigint IS NOT NULL` guard constant-fold) → planner ใช้ BitmapOr ของ 2 index scan = indexed ไม่ seq-scan. auditor flag เพราะมองไม่เห็น migration route.
- [ ] ⏳ **PA-L1-loadorder-overfetch** — [`lib/api-postgres.ts:138`](lib/api-postgres.ts) `loadOrderFromPostgres` ยิง 4 query ขนาน (orders/jobs/shipped/cancelled) แม้ caller ต้องการแค่ active order → 2 pooled query เปล่าต่อ call. minor — trim ด้วย opts flag.

Verified clean: loadAll coalescing + `revalidateTag`, auto-sync guards, recharts route-split, `html-to-image`/`qrcode` leaf-only, card lazy-loading, `React.memo` card comparator (= M1 invalid), `BulkModeProvider` `useMemo`, `computeBoard` single-pass. `computeBoard` GC churn = หายเองเมื่อ PA-H1+PA-M2 ลง.

---

## 🔬 Data integrity scan — 2026-05-15 (`runPhase2IntegrityScan`)

Proactive 9-dimension scan ของ Google Sheet หลัง Phase 2 live ~2 อาทิตย์. Scan file: `production-monitoring/_scan-phase2.gs`. Counts: orders=171 jobs=41 shipped=115 cancelled=28. Result: **0 critical / 1 high / 2 medium / 0 low**.

- [accepted] **DATA-dateIn-double-encoded** — orders `202605046` / `202605047` / `202605049` (orders sheet rows 118/119/121) มี `dateIn` เป็น JSON string `"\"2026-05-07T17:00:00.000Z\""`. **Root-cause (verified 2026-05-16, /diagnose)**: ❌ ไม่ใช่ `addOrder` อย่างที่เดาไว้ — ตัวการคือ Apps Script `objectToRow()` ([helpers.ts:45](apps-script/dashboard/helpers.ts) ใน production-monitoring) ที่เดิมไม่มี Date guard. `cancelOrder` ([write.ts:591-611](../production-monitoring/apps-script/dashboard/write.ts)) + `promoteDraft` ([write.ts:743-761](../production-monitoring/apps-script/dashboard/write.ts)) อ่าน order row ด้วย `getValues()` (date cell → JS `Date`) → flip status → เขียนกลับผ่าน `objectToRow` → `Date` ตก catch-all `typeof==='object'` → `JSON.stringify(date)` → quoted ISO. `addOrder`/`createOrder` รับ `dateIn` เป็น string จาก v2 ไม่เคยเป็น `Date` → corrupt ไม่ได้. **Source fixed 2026-05-08** — `helpers.ts:49` + compiled `helpers.js:48` มี `if (val instanceof Date) return val;` (verified deployed). 3 rows = legacy residue จาก 3 promoteDraft/cancelOrder ก่อน 8 พ.ค. — post-fix สร้าง corruption ใหม่ไม่ได้. **Decision: ไม่เขียน cleanup helper** — `displayDate()` ([lib/jobs.ts:71-73](lib/jobs.ts)) unwrap quote ให้อยู่แล้ว → display ไม่พัง; 3 orders เป็นงานเดือน พ.ค. เสร็จแล้ว impact ใกล้ศูนย์. **Migration note**: ตอน Phase 4.2/4.3 cutover ค่อยรัน SQL `UPDATE orders SET date_in='2026-05-08' ...` 3 แถวทีเดียว (ไม่ต้องใช้ Apps Script). **⚠️ Scan gap**: `_scan-phase2.js:218-237` date-anomaly check เช็คแค่ `dateIn` ไม่เช็ค `dateDue` — cancelOrder/promoteDraft เขียนทับทั้ง row → ถ้า `dateDue` ของ orders เหล่านี้ corrupt ด้วย scan จะมองไม่เห็น (ควรเพิ่ม `INVALID_DATEDUE` check ใน scan v2).
- [~] **DATA-orphan-cancelled** ×4 — cancelled rows อ้าง orderId ที่หายไป (202604024 "ใบปลิวสาขา", 202604068 "สสส", 202605039 "test", 202605055 "หหหห"). **In progress**: cleanup helper `production-monitoring/_cleanup-orphan-cancelled.gs` เขียนแล้ว, รอ user รัน (2 test rows ลบได้, 2 เก่ารอตัดสิน historical).
- [false-positive] **DATA-orphan-order** ×122 — **ไม่ใช่ data bug.** scan v1 check แค่ `jobs` sheet → orders status="sent" ที่ jobs ส่งของหมดแล้ว (อยู่ใน `shipped`) ถูก flag ผิด. ต้อง scan v2 (cross-ref `jobs`+`shipped`+`cancelled`) เพื่อ confirm. defer.

---

## ✅ Closed — Bug Hunt 2026-05-09 (user-reported, found via static analysis)

- [x] **createOrder-cache-bust-missing** — `lib/api.ts:160` PATHS_BY_ACTION map ไม่มี entry สำหรับ `createOrder` action (fast-path สำหรับ POST /api/orders/add ตั้งแต่ commit `a184254` 2026-05-07). ทุก atomic action อื่น (`cancelOrder`, `deleteOrderCascade`, `promoteDraft`, `bulkForward`) อยู่ครบ. **Effect**: หลัง user submit ใบสั่งงานใหม่ — Apps Script atomic write done ใน ~1.5s แต่ /board + /orders ยังโชว์ snapshot เก่า (60s ISR cache + ❌ no revalidatePath). New order appears เมื่อ ISR expire (worst 60s) หรือ auto-sync coincides with expiry (best 15s). Closed `e88f386` — เพิ่ม `createOrder: ['/board', '/orders', '/orders/new', '/calendar', '/analytics']` (union ของ addOrder + addJob path lists). **Lesson** [should add to memory]: audit เวลาเพิ่ม atomic Apps Script action ใหม่ที่ replace multi-call legacy → ตรวจ PATHS_BY_ACTION map ด้วย เสมอ มิฉะนั้น cache invalidation จะหาย.

---

## ✅ Verified clean (2026-05-08 scan)

- Edge runtime `/api/track/lookup` + `/api/auth/{login,logout}` — ไม่มี Node-only imports หลุด, `next/headers`/`next/cache` lazy-import ใน `post()` เท่านั้น (ไม่ถูก reach โดย edge GET)
- `audit=0` default — เฉพาะ `lib/analytics.ts` consume; `app/analytics/page.tsx` ใช้ `loadAllWithAudit` ตรง
- `bulkForward` callers — forward-undo ใช้ `id: 0` ถูก
- `MobileUserMenu` z-index — z-40 ต่ำกว่า toast (z-60) + native `<dialog>` top layer
- Bottom-nav role-stripped — `getMoreMenuGroups` ใช้ `canSee` gate ทั้ง sidebar + sheet
- 6-step timeline happy paths — graphic/print/post map ตรง, cancelled collapse 2-6, shipped mark all done
- Atomic fast-path/legacy fallback — fall back เฉพาะ `Unknown action`; network/lock/validation errors surface ทันที
- Auto-sync passive listeners cleanup — 5 listeners + BroadcastChannel + setTimeout removed ถูก
- JobForm + commit() pattern — closures ถูก, no cross-component state leakage
- Restore admin gate — `requireSession(['admin'])` ตรง Apps Script `ROLE_REQUIREMENTS.restoreJob`

---

## ✅ Closed — Batch 5 (2026-05-08 scan close-out)

Commit `57ca976` — "fix: audit close-out 2026-05-08 — H1+H2+H3 + 5 medium" — 11 files, +213/-57

- [x] ✅ **H1-recover-orphan-double** (`57ca976`) — `app/api/jobs/add/route.ts` ใส่ idempotency check ก่อน addJob: ถ้ามี orderId ใน body, fetch loadAllFresh และ reject 409 ถ้ามี active (non-cancelled) job ผูกอยู่แล้ว. Closes data-audit modal double-tap window.
- [x] ✅ **H2-promotedraft-fallthrough-double-write** (`57ca976`) — `app/api/orders/promote-draft/route.ts` reject `{ok:true}` without jobId ด้วย 502 (Apps Script regression) แทน fall-through ที่จะ double-write
- [x] ✅ **H3-restore-trust-client** (`57ca976`) — `app/api/jobs/restore/route.ts` always read row from Sheet (cached `loadAll` when src provided + fresh fallback), verify `src.name === cj.name` ก่อน restore. ใช้ 409 ถ้า mismatch
- [x] ✅ **M2-jobform-dead-busy** (`57ca976`) — `app/board/job-form.tsx` ใส่ `submittedRef` guard ที่ block re-entry, ลบ dead `busy` state + unused `disabled` props ออกจาก submit/cancel buttons
- [x] ✅ **M4-track-currentdept-null-inconsistent** (`57ca976`) — `app/api/track/lookup/route.ts` เมื่อ currentDept null collapse status เป็น 'received' (no contradictory "overdue red" badge above empty 6-step timeline)
- [x] ✅ **M5-cascade-fallback-no-concurrency-cap** (`57ca976`) — `app/api/orders/{cancel,delete}/route.ts` ใช้ `allSettledLimit(cap=3)` แทน `Promise.allSettled` แบบ unbounded. New `lib/concurrency.ts` zero-dep helper
- [x] ✅ **M6-mobileusermenu-overlap-sticky** (`57ca976`) — `app/orders/page.tsx` sticky header ใช้ `pl-4 pr-12 sm:pl-6 sm:pr-6` reserve space สำหรับ MobileUserMenu บน mobile widths
- [x] ✅ **M7-autosync-settimeout-race** (`57ca976`) — `lib/auto-sync.tsx` ใส่ `unmounted` flag ใน self-rescheduling tick chain. Cleanup เซ็ต flag + clearTimeout
- [x] ✅ **M8-pathsbyaction-stale-comment** (`57ca976`) — `lib/api.ts` แก้ comment `/board uses audit (undo)` ให้สะท้อนว่า audit ถูก drop ใน round 5 (undo flow ใช้ client snapshots)

---

## ✅ Verified clean (no action needed)

- C1 race close-out — forward/bulk-forward/forward-undo/promote-draft ใช้ atomic `getNextId` (เหลือแค่ /api/jobs/add → ดู C1r)
- C2 tracking-card QR — `TRACK_BASE_URL=https://dashboard.penprinting.co/track` ตรงกับ /track + footer
- C4 stuck dragging flag — cleanup ทั้ง onUnmount + handleDragEnd
- C5 promote-draft idempotent — เช็ค `existingJob` skip addJob
- H1 `/api/track/lookup` rate-limit — signed cookie pattern
- M2 lazy raw — `/api/orders/raw/[id]` admin+sales gate
- M5 bulk-forward 25 cap — `BULK_MAX_SELECT=25` + server enforce
- Permission gates ตรง PATTERNS §2 contract
- Cascade-cancel + cascade-rename
- Duplicate detection (409 + force flag)
- Cowork string[] + dept-print enforcement + guest fan-out (violet)
- Drag MIME types separation + onDragOver matching
- Auto-sync guards (visibility + dialog + input-focus + dragging)
- `revalidatePath` หลัง writes
- `displayDate` 3 formats (ISO/DDMM/Date.toString)
- DashboardShell mounts Toast+Confirm providers
- Mobile sticky/z-index stacking (nav z-30, bulk z-40, undo z-50, toast z-[60])
- L7 cancel→restore cowork loss (documented constraint, schema deferred)
- PageSizeBar pure non-'use client' module

---

## ✅ Closed

### Batch 4 — cosmetic cleanup (5 Low)
2026-05-06 PM (1 commit — see git for hash)

- [x] **L-emoji-1** — `app/board/order-form.tsx` "ดึงงานเก่า" button uses `IconRefreshCw` (animate-spin) for loading + `IconArrowLeft` for idle. No more `⏳` / `↩` glyphs.
- [x] **L-emoji-2** — `app/orders/[id]/tracking-card/client.tsx` PIN-warning chip uses `IconAlertTriangle`. No more `⚠`.
- [x] **L-emoji-3** — false positive at the time of audit. `app/board/card.tsx` already uses icon components in the undo toast.
- [x] **L-logout-broadcast** — `app/analytics/logout-button.tsx` calls `broadcastWrite('/api/auth/logout')` before redirect. Other tabs see the channel and clear stale username on next sync tick.
- [x] **L-dead-1** — `app/board/column.tsx` dropped the IIFE + `void list` dead-code. `sourceStaffLabel` is now a plain `const`. Also removed the now-unused `STAFF` import.
- [x] **L-dead-2** — `app/orders/orders-table.tsx` removed the unused `jobDeptStaffLabel?` field from `OrderRow` (declared, never set, never read).

### Batch 3 — perf / security / data integrity (4 Medium)
2026-05-06 PM (1 commit — see git for hash)
⚠️ M-bulk-forward-N-roundtrips ต้อง deploy Apps Script ก่อน — รัน `production-monitoring/apps-script/dashboard/push.sh` แล้ว Apps Script editor → Manage deployments → Edit existing → New version. Vercel side มี backwards-compat fallback (loop getNextId) จนกว่า Apps Script จะ deploy.

- [x] **M-bulk-forward-N-roundtrips** — เพิ่ม `getNextIds(count)` action ใน Apps Script (helpers.ts + google-apps-script.js dispatch + audit-skip). `app/api/jobs/bulk-forward/route.ts` ใช้ batch call แทน loop — 25 items × 1 round-trip แทน 25. Backwards-compat fallback ครอบ catch ที่ Apps Script ยังไม่มี action นี้.
- [x] **M-login-ratelimit-map** — ported `attachRateCookie` pattern (cookie name `pp_login_rl`, path `/api/auth`, 5min/5 attempts) จาก `/api/track/lookup`. State stable across Vercel cold starts. Successful login clears cookie. Rate cookie expires when window does so browser GC's it.
- [x] **M-orders-date-range-tz** — เปรียบเทียบ date เป็น YYYY-MM-DD strings ใน `Asia/Bangkok` zone (Intl.DateTimeFormat 'en-CA') แทน Date object compare. ไม่มี off-by-day boundary bug เพราะ lexical string compare = timezone-free.
- [x] **M-jobByOrderId-last-write-wins** — เก็บ array ของ jobs ต่อ orderId แทน Map<id, job>. แสดง lowest job id เป็นหลัก + "(+N)" suffix เมื่อ order มี job มากกว่า 1.

### Batch 2 — UX / middleware (3 Medium)
2026-05-06 PM (1 commit — see git for hash)

- [x] **M-photobook-tab** — `app/board/order-form.tsx` Photobook segment click now also `setTab('main')`. Switching from "งานหลังพิมพ์" to Photobook no longer leaves the body blank.
- [x] **M-middleware-matcher** — `middleware.ts` matcher now covers `/orders/* /shipped/* /cancelled/*` in addition to the original four. Defence-in-depth — page-level `verifySession()` is preserved.
- [x] **M-cross-dept-gate** — `app/board/card.tsx` drag payload now carries `application/x-job-source-staff`; `app/board/column.tsx` reads it and passes to `computeFromType(sourceDept, sourceStaff)`. False-negative reject (e.g. dragging print:cut → post:bind) is gone — fromType resolves to the correct FW_TARGETS bucket instead of falling through to `any`.

### Batch 1 — regression cleanup (Critical + 5 High)
2026-05-06 PM (1 commit — see git for hash)

- [x] **M14r** — `lib/photobook.ts` `orderFormFromRaw` reads from `r.photobook` fallback, not just `r.photobookItems`. Edit/duplicate of post-M14 photobook orders no longer drops items.
- [x] **H10a** — `app/board/order-form.tsx` reset/saveAsTemplate/deleteTemplate now use `useConfirm()` + `useConfirm().prompt()`. Themed dialogs replace native `confirm()`/`prompt()`.
- [x] **H10b** — `app/board/order-form.tsx` "ไม่พบงานเก่า" + "ดึงข้อมูลล่าสุดไม่สำเร็จ" now use `useToast().error()` instead of native `alert()`.
- [x] **H10c** — `app/orders/[id]/edit/client.tsx` promote-draft confirm now uses `useConfirm().confirm()`.
- [x] **C1r** — `/api/jobs/add` swapped from `loadAllFresh().nextId` (cached) to atomic `post('getNextId', {})` action. Matches forward/bulk-forward/promote-draft pattern. Two concurrent "งานเดี่ยว" submits no longer race.
- [x] **H2r** — `app/track/client.tsx` client gate `< 6` → `< 3`, aligns with H1 server fix (`/api/track/lookup` accepts `id.length >= 3`). Legacy 4-digit ids work again.

---

## 🎯 ปิดครบ — เหลือไว้ track audit รอบถัดไป

ทุก finding จาก audit รอบ 2026-05-06 ปิดหมดแล้ว. ไฟล์นี้ยังคงเป็น running log ของ audit findings ในอนาคต — เมื่อรัน `/audit` รอบใหม่:

1. เพิ่มหมวดใหม่ที่ด้านบน (Critical / High / Medium / Low) ตามรูปแบบเดิม
2. แก้ตามลำดับ batch
3. Tick `[x]` + ย้ายลง Closed section ทันทีหลังแก้
4. อัปเดต `Latest update` date-stamp ที่ header

## 📝 Update protocol

หลังแก้แต่ละข้อ:
1. Tick checkbox `[x]`
2. ใส่ commit hash ในวงเล็บ
3. ย้ายลง "Closed" section
4. อัปเดต date-stamp ด้านบน
