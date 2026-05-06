# 🐞 Audit Backlog — Dashboard v2

> Last scan: **2026-05-06 PM** (penprinting-auditor) — หลังจบ Phase 3.5.10 + 3.5.11 + critical/high audit close-out
>
> Latest update: **2026-05-06 PM** — Critical + 5 High batch ปิดครบ
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

- [ ] **M-bulk-forward-N-roundtrips** — getNextId × N sequential อาจ timeout
  - File: [app/api/jobs/bulk-forward/route.ts:88-94](app/api/jobs/bulk-forward/route.ts:88)
  - 25 items × 200-500ms = ~12s แค่ id allocation + 1 round สำหรับ bulkForward → เกิน Vercel 10s บาง cold start
  - Fix: เพิ่ม `getNextIds(count)` action ใน Apps Script (atomic batch ใน LockService เดียว)

- [ ] **M-login-ratelimit-map** — `/api/auth/login` rate-limit เป็น in-memory Map
  - File: [app/api/auth/login/route.ts:7-9](app/api/auth/login/route.ts:7)
  - Vercel multi-instance → limit ไม่ carry across cold starts/regions → brute force ทะลุได้
  - Fix: port `attachRateCookie` pattern จาก [/api/track/lookup](app/api/track/lookup/route.ts) (signed cookie state)

- [ ] **M-orders-date-range-tz** — date-range filter off-by-day ที่ boundary
  - File: [app/orders/page.tsx:158-161](app/orders/page.tsx:158)
  - `parseDateDMY` fall through `new Date(iso)` = UTC, `fromDate = new Date(iso + 'T00:00:00')` = local; server runs UTC แต่ Sheet dates เป็น Bangkok
  - Fix: normalize ทั้ง 2 ฝั่งผ่าน `Asia/Bangkok` formatter หรือเปรียบเทียบ string YYYY-MM-DD

- [ ] **M-jobByOrderId-last-write-wins** — duplicate orderId แสดงไม่ครบ
  - File: [app/orders/page.tsx:68-73](app/orders/page.tsx:68)
  - ถ้า order มี job มากกว่า 1 (recovery scenario) — column "ขั้นตอนปัจจุบัน" แสดงแค่ตัวสุดท้าย
  - Fix: prefer lowest job id + เพิ่ม count badge

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
