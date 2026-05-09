# 🐞 Audit Backlog — Dashboard v2

> Last scan: **2026-05-08** (penprinting-auditor) — รอบ regression หลัง 2026-05-07 mega-day (16+ commits)
>
> Latest update: **2026-05-09** — ปิด 1 user-reported perf bug (`createOrder` missing from PATHS_BY_ACTION → order create perceived 15-60s instead of ~1.5s)
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

- [ ] ⏳ **M1-card-memo-deep-compare** — `app/board/card.tsx:459-489` field-level comparator JSON-compare `a.order` vs `b.order` (O(n)). 50 cards × auto-sync × ~5KB orders → measurable iPhone CPU. **Defer reason**: audit เองระบุ "verify with profiler — if measurable, switch". ยังไม่มี profiler data + naive switch (เช่น drop deep compare) อาจ break DetailContent freshness ตอน auto-sync tick. รอ measurement จริงก่อน.
- [ ] ⏳ **M3-jobform-stale-toast** — `app/board/job-form.tsx:132, 145` closure capture `initial?.id` ตอน submit → toast ของ Job-A pop ตอน user เปิด Job-B (cosmetic). **Defer reason**: audit เองระบุ "Probably accept the minor noise". Tracking ระดับ global จะ over-engineer สำหรับ noise น้อย.

---

## 🟢 Low (open — defer per audit recommendation)

- [ ] ⏳ **L1-bottomnav-iphonese-truncate** — `components/bottom-nav.tsx:31, 86-96` admin 5-col @ 320px → "หลังพิมพ์ / จัดส่ง" truncate. **Defer reason**: audit เองระบุ "Acceptable (icon carries meaning)" — รอ user feedback จาก iPhone SE จริง
- [ ] ⏳ **L2-currentactor-edge-comment** — `lib/api.ts:179-189` doc clarity — defer ก่อน, จะปรับตอน sweep doc รอบหน้า
- [ ] ⏳ **L3-edge-build-warnings** — `app/api/track/lookup/route.ts:13` + `app/api/auth/{login,logout}` Vercel logs edge runtime warnings (expected) แต่ noisy. **Defer reason**: cosmetic, no functional issue
- [ ] ⏳ **L4-data-audit-modal-sales-no-action** — `app/orders/data-audit-modal.tsx:175-184, 295-307` sales เห็นบัดจ์ count + open modal ได้ แต่ปุ่มทั้งหมด admin-only → UX leak. **Fix idea**: ซ่อน DataAuditButton สำหรับ non-admin หรือใส่ "ติดต่อ admin" hint. Defer ก่อนเพราะ low impact (sales เปิดแล้วเห็นปุ่มไม่ได้ก็ไม่กระทบ workflow ตัวเอง)

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
