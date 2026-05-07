# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [dashboard-v2.md](dashboard-v2.md) + [PATTERNS.md](PATTERNS.md) + [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) ก่อนเริ่ม**
>
> **Session ก่อนหน้า — 2026-05-07 (full day)** ✅ Phase 2.1 Apps Script TS migration ปิด 100% (Code.js 677→93 lines) + **forward perf overhaul** (A+B+C, 0ms perceived latency, matches WP) + **order create perf** (5 round-trips → 1, < 2s) + bug fixes session (print popup blocker, PWA bounce, fresh-order 404, edit-form prefill, A4 logo) + **PM perf batch** (`8528839`) — hot-path round-trip cuts across order/print/cowork/cancel (loadOrder single-row reads, parallel cascade cancels, optimistic order edit, instant cowork+order-form feedback).

## ✅ เสร็จแล้วในรอบล่าสุด (2026-05-07)

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

1. **Verify `createOrder` fast path on next photobook order** — fast path re-enabled (`c38c5c1`) หลังแก้ edit-form prefill. ถ้า order รอบหน้ายัง land ด้วย details ครบ → mark createOrder fully validated, ปิดเรื่องนี้. ถ้าเจอ empty rows อีก → revert (`0b762cc` pattern) + investigate (อย่าด่วนสรุปว่าเป็น createOrder อีก, อาจมี edit-form bug อื่นซ่อน)

2. **Vercel env vars สำหรับ Sentry** (optional, ค้างจาก 2026-05-06):
   - `NEXT_PUBLIC_SENTRY_DSN` — error capture activate
   - `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_AUTH_TOKEN` — source map upload
   - ถ้ายังไม่ตั้ง = Sentry SDK auto-disable (no errors, no source map upload)

✅ **Already done by user 2026-05-07**: Apps Script redeploy (Phase 2.1 + createOrder + bulkForward auto-alloc + per-user audit signing all live)

---

## ⏳ ที่ยังเหลือ (priority order)

### 0. Atomic Apps Script `cancelOrder` / `deleteOrder` (deferred perf item)
- ปัจจุบัน `/api/orders/{cancel,delete}` ใช้ `Promise.allSettled([...cancelJob calls])` → ลดจาก N×serial → max(~600ms parallel)
- Future improvement: รวมเป็น Apps Script action เดียว (`cancelOrder`/`deleteOrder` ที่ทำ cancel order row + cascade jobs ใน batch lock เดียว) → ลดเหลือ 1 round-trip จริงๆ
- Deferred เพราะ `Promise.allSettled` แก้ pain point ส่วนใหญ่แล้ว และ Apps Script side ต้อง redeploy. Pick up เมื่อ user feedback ว่ายังช้า

### 1. Phase 3.6 — Decommission decision (ระยะยาว)
v2 = full WP feature parity แล้ว + permissions match WP role matrix. ตัดสินใจ:
- **Path A**: Switch DNS `app.penprinting.co` → Vercel + retire WP, deprecate `production-monitoring/` repo
- **Path B**: Coexist ต่อ — WP เป็น write fallback / staff app, v2 เป็น primary

ต้องเช็คก่อนตัดสินใจ:
- WP-only features ที่ v2 ยังไม่มี: TV Display kiosk (deferred earlier — ดู #2 ด้านล่าง), Morning Report (separate Apps Script project, อยู่ที่ workspace `morning-report/`)
- Staff acceptance — อยากให้ staff ใช้ v2 อย่างเดียวไหม หรือปล่อย WP ไว้

### 2. TV display kiosk บน v2 (deferred)
User skip ใน Phase 3.5 — ยังเป็น backlog item:
- Port `production-monitoring/assets/production-tv.{js,css}` → `app/tv/page.tsx`
- Read-only Kanban + 30s auto-refresh + secret key auth
- Dark theme, big fonts, 3-column mosaic
- ต้องเลือกว่า:
  - Mount ที่ `/tv?key=XXX` (matching WP) หรือ
  - Subdomain แยก เช่น `tv.dashboard.penprinting.co`

### 3. Route group `(shell)/layout.tsx` refactor
Future fix สำหรับ:
- Per-route loading.tsx ที่จะใส่ได้โดยไม่ unmount shell (สำหรับ user ที่อยาก skeleton ใน body)
- Mobile drawer / "More" sheet ที่เหมือน WP
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

_อัปเดตล่าสุด: 2026-05-07 (full day — Phase 2.1 close-out + forward perf overhaul A+B+C + order create perf + bug fixes session + PM perf batch `8528839` ปิด lifecycle round-trip audit)_
