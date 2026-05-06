# 🐞 Audit Backlog — Dashboard v2

> Last scan: **2026-05-06 PM** (penprinting-auditor) — หลังจบ Phase 3.5.10 + 3.5.11 + critical/high audit close-out
>
> ✅ = ปิดแล้ว / commit hash อยู่ในวงเล็บ
> ⏳ = ยังเหลือ
>
> Convention: tick checkbox + ใส่ commit hash + ย้ายลง "Closed" section หลังแก้

---

## 🔴 Critical

- [ ] **M14r** — Photobook round-trip data loss
  - File: [lib/photobook.ts:176](lib/photobook.ts:176) (`orderFormFromRaw`)
  - Issue: M14 fix dedupe เป็น key `photobook` แล้ว แต่ `orderFormFromRaw` ยังอ่านจาก `r.photobookItems` เท่านั้น → edit/duplicate photobook order = items หาย → save = "ต้องมีรายการ Photobook อย่างน้อย 1 เล่ม" หรือถูก strip
  - Print page อ่าน `raw.photobook` ตรง ([orders/[id]/print/page.tsx:220](app/orders/[id]/print/page.tsx:220)) — แต่ edit/dup ผ่าน orderFormFromRaw แตก
  - Fix: เพิ่ม fallback `if (Array.isArray(r.photobook)) merge.photobookItems = r.photobook` ก่อนบรรทัด 176

---

## 🟠 High (regression ของ audit fix รอบก่อน)

- [ ] **H10a** — order-form.tsx ยังใช้ native `confirm()` / `prompt()`
  - File: [app/board/order-form.tsx:301,395,430](app/board/order-form.tsx:301)
  - 301 = reset, 395 = saveAsTemplate, 430 = deleteTemplate
  - Fix: import `useConfirm()` → `confirm({...})` + `prompt({...})`

- [ ] **H10b** — order-form.tsx ยังใช้ native `alert()`
  - File: [app/board/order-form.tsx:340,349](app/board/order-form.tsx:340)
  - "ไม่พบงานเก่า" + "ดึงข้อมูลล่าสุดไม่สำเร็จ"
  - Fix: ใช้ `useToast().error(...)` (มีอยู่แล้วในไฟล์อื่น)

- [ ] **H10c** — promote-draft ใช้ native `confirm()`
  - File: [app/orders/[id]/edit/client.tsx:33](app/orders/[id]/edit/client.tsx:33)
  - ข้อความ: "ส่งใบสั่งนี้เข้าระบบ? ..."
  - Fix: `useConfirm().confirm({ variant: 'default' })`

- [ ] **C1r** — `/api/jobs/add` ยังใช้ cached `nextId` (race เปิดอยู่)
  - File: [app/api/jobs/add/route.ts:55-56](app/api/jobs/add/route.ts:55)
  - Issue: route อื่น (forward, bulk-forward, promote-draft, forward-undo) ปิด race ด้วย atomic `getNextId` action แล้ว
  - แต่ "งานเดี่ยว" path ยัง read `snap.nextId` จาก `loadAllFresh()` → 2 submits พร้อมกันชนได้
  - Fix: swap เป็น `post<{nextId}>('getNextId', {})` ตาม pattern ใน [forward/route.ts:67-77](app/api/jobs/forward/route.ts:67)

- [ ] **H2r** — `/track` client gate ยัง `< 6` (server เปิด `>= 3` แล้ว)
  - File: [app/track/client.tsx:38](app/track/client.tsx:38)
  - Server fix H2: `/api/track/lookup:118` รับ `id.length >= 3` แล้ว
  - แต่ client เด้งที่ `orderId.length < 6` ก่อน → legacy 4-digit id เข้าไม่ได้
  - Fix: เปลี่ยนเป็น `< 3`

---

## 🟡 Medium

- [ ] **M-photobook-tab** — Photobook segment กลายเป็น body ว่างเมื่ออยู่ tab `post`
  - File: [app/board/order-form.tsx:485-488](app/board/order-form.tsx:485)
  - Tab `post` ถูก hide เมื่อ photobook (line 596) แต่ `tab` state ไม่ reset → body แสดงไม่ได้
  - Fix: ใน photobook click handler เพิ่ม `setTab('main')`

- [ ] **M-middleware-matcher** — middleware ไม่คุ้ม `/orders/* /shipped /cancelled`
  - File: [middleware.ts:24](middleware.ts:24)
  - ปัจจุบัน rely บน per-page `verifySession()` → defence-in-depth พังถ้ามี page ใหม่ลืม block
  - Fix: เพิ่ม `'/orders/:path*'`, `'/shipped/:path*'`, `'/cancelled/:path*'` ใน matcher (เก็บ `/track` excluded)

- [ ] **M-cross-dept-gate** — cross-dept forward client gate ใช้ staff ว่าง → false-negative
  - File: [app/board/column.tsx:125](app/board/column.tsx:125)
  - `computeFromType(sourceDept, '')` คืน `'any'` (รับแค่ ship) → drop print:cut → post:bind ขึ้น "ไม่สามารถส่งต่อ" ทั้งที่ server รับ
  - Fix: lookup src.staff ก่อนคำนวณ fromType — หรือ skip client-side gate, รอ server toast

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

## 🎯 Recommended close order

1. **Batch 1 (regression cleanup):** M14r → H10a/b/c → C1r → H2r — 1 commit, low risk, scope ชัด, ใช้ pattern เดิม
2. **Batch 2 (UX/middleware):** M-photobook-tab → M-middleware-matcher → M-cross-dept-gate
3. **Batch 3 (perf/security):** M-bulk-forward-N-roundtrips (Apps Script change!) → M-login-ratelimit-map → M-orders-date-range-tz
4. **Batch 4 (cosmetic):** Lows ทั้งหมด — 1 commit

## 📝 Update protocol

หลังแก้แต่ละข้อ:
1. Tick checkbox `[x]`
2. ใส่ commit hash ในวงเล็บ
3. ย้ายลง "Closed" section
4. อัปเดต date-stamp ด้านบน
