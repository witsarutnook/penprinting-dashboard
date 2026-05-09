# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [dashboard-v2.md](dashboard-v2.md) + [PATTERNS.md](PATTERNS.md) + [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) ก่อนเริ่ม**
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

## ⚠️ Pending user actions

_(none open — ทุกอย่าง deploy ครบแล้วตอนปิด session 2026-05-08)_

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

_อัปเดตล่าสุด: 2026-05-09 mega-day — Phase 3.6 cutover ✅ DONE + history tab port. WP retired via DNS switch HostAtom A→CNAME Vercel. app.penprinting.co alias dashboard.penprinting.co (same Vercel project). 9 hard-coded WP refs แก้ครบ. Vercel `/production-monitoring*` → `/board` cushion. **Bonus perf bug** เจอ via static analysis — `createOrder` missing from PATHS_BY_ACTION map → fast-path order create stale 15-60s. Fix `e88f386`. **Bonus quota tune** — warn 3000→5000ms. **History tab port** — Apps Script v5.10.7 `getAuditByTarget` + Vercel `/api/audit` + `<HistoryTab>` component (`51e8df5`) + prefetch-on-modal-open pattern (`1093a6d`) ปิด last placeholder. **Total**: 7 commits + 3 Apps Script pushes + DNS cutover. Monitor 1 สัปดาห์._

_อัปเดตก่อน: 2026-05-08 mega-day — audit batch 5 (`57ca976` + `dc24167`) + Sentry 5-layer journey (`212bb7a` → `f299dc9` → `076586d` → `5b851a5` → `7e6fbfa`) + photobook spec (`682fd0e`) + promote-draft flicker (`5db20f5`) + date corruption (Vercel `25e28c0` + Apps Script helpers.ts pushed by คุณนุ๊ก) + Bug 4 modal slow (`7b73d4f` + Apps Script load.ts pushed by คุณนุ๊ก + architectural fix `96603a8`) + Bug 5 pagination (`b798c3e`). 15 commits + 2 Apps Script deploys. Sentry observability live._

_2026-05-07 mega-day — morning: Phase 2.1 close-out + forward perf A+B+C + order create perf + bug fixes + PM perf batch (`8528839`) + PM2 atomic cascade (`c95c451`). afternoon: bundle splits + smart auto-sync backoff + edge runtime (`1d6e57f`) + mobile bottom-nav 4 + hamburger sheet + top-right user menu (`95c0cb8`) + /track WP port + 6-step progress (`ce611b1`) + /track charcoal mood (`fe0b38e`) + workflow speed sweep round 5 (`3cb4501`) + Apps Script v5.10.5 audit-param skip. **Total**: 16+ commits, full day perf compound._
