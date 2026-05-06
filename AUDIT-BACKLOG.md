# 🐞 Audit Backlog — Dashboard v2

> Last scan: **2026-05-06 PM** (penprinting-auditor) — หลังจบ Phase 3.5.10 + 3.5.11 + critical/high audit close-out
>
> Latest update: **2026-05-06 PM** — Critical + 5 High + 7 Medium ปิดครบ. เหลือ 5 Low (cosmetic)
>
> ✅ = ปิดแล้ว / commit hash อยู่ในวงเล็บ
> ⏳ = ยังเหลือ
>
> Convention: tick checkbox + ใส่ commit hash + ย้ายลง "Closed" section หลังแก้

---

## 🔴 Critical

_(ปิดครบ — ดู Closed section)_

---

## 🟠 High

_(ปิดครบ — ดู Closed section)_

---

## 🟡 Medium

_(ปิดครบ — ดู Closed section)_

---

## 🟢 Low

- [ ] **L-emoji-1** — order-form.tsx:731 ใช้ `⏳` + `↩`
  - Fix: ใช้ `IconRefreshCw` / `IconArrowLeft`

- [ ] **L-emoji-2** — tracking-card/client.tsx:250 ใช้ `⚠`
  - Fix: ใช้ `IconAlertTriangle`

- [ ] **L-emoji-3** — card.tsx:175 ใช้ `↩` ใน undo toast
  - Fix: icon component

- [ ] **L-logout-broadcast** — logout ไม่ `broadcastWrite` → tab อื่นค้าง user-name
  - File: [app/analytics/logout-button.tsx:11](app/analytics/logout-button.tsx:11)
  - Fix: `broadcastWrite('/api/auth/logout')` ก่อน redirect

- [ ] **L-dead-1** — column.tsx:91 dead `void list` ใน IIFE
  - Fix: simplify เป็น `const sourceStaffLabel = DEPT_LABELS[sourceDept] || sourceDept`

- [ ] **L-dead-2** — orders-table.tsx:32-33 unused `jobDeptStaffLabel?` field
  - Fix: ลบจาก type

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

## 🎯 Recommended close order (remaining)

1. **Batch 3 (perf/security):** M-bulk-forward-N-roundtrips (Apps Script change!) → M-login-ratelimit-map → M-orders-date-range-tz → M-jobByOrderId-last-write-wins
2. **Batch 4 (cosmetic):** Lows ทั้งหมด — 1 commit

## 📝 Update protocol

หลังแก้แต่ละข้อ:
1. Tick checkbox `[x]`
2. ใส่ commit hash ในวงเล็บ
3. ย้ายลง "Closed" section
4. อัปเดต date-stamp ด้านบน
