# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [dashboard-v2.md](dashboard-v2.md) + [PATTERNS.md](PATTERNS.md) + [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) ก่อนเริ่ม**
>
> **Session ก่อนหน้า — 2026-05-07 AM+late** Phase 2.1 ปิดครบ + **forward perf overhaul** (A+B+C) — ลบ `loadAllFresh` round-trip + Apps Script alloc id ภายใน + optimistic UI. Forward path: 3 round-trips → 1, perceived latency 2.5-6s → **0ms**.

## ✅ เสร็จแล้วในรอบล่าสุด (2026-05-07)

### Forward perf overhaul (matches WP UX)
**ปัญหา**: ส่งงานต่อใน v2 บล็อค UI 2.5-6 วินาที (vs WP รู้สึก instant) — สาเหตุคือ 3 sequential Apps Script round-trips: `loadAllFresh` → `getNextId` → `bulkForward`

**A. Skip `loadAllFresh()`** — Vercel routes รับ `srcJob` snapshot จาก client (frontend มีอยู่แล้วบน screen), ไม่ต้อง round-trip ขอ source data ก่อน:
- [/api/jobs/forward](app/api/jobs/forward/route.ts) — รับ srcJob ใน body
- [/api/jobs/bulk-forward](app/api/jobs/bulk-forward/route.ts) — รับ items[].srcJob
- [/api/jobs/reassign](app/api/jobs/reassign/route.ts) — รับ srcJob (cowork ส่งมาด้วยเลยป้องกันหาย)

**C. Apps Script `bulkForward` alloc ids ภายใน** ([write.ts](../production-monitoring/apps-script/dashboard/write.ts)) — ถ้า `newJob.id` ว่าง/0/undefined → server เรียก `getNextIds(N)` ภายใต้ batch lock เดียวกัน + return `succeeded: [{oldId, newId, name}]`. Forward-compat hook — Vercel routes ปัจจุบันยัง alloc id ผ่าน `getNextId`/`getNextIds` ก่อน เพื่อ deploy-order-safe (ดู Pending actions ด้านล่าง).

**B. Optimistic UI บน /board** — [pending-mutations.tsx](components/board/pending-mutations.tsx) context เก็บ `Set<jobId>` ที่ "ซ่อน":
- คลิกส่งต่อ → `hideJob(id)` ทันที + ปิด modal + toast "กำลังส่งต่อ → X..."
- Card หายจาก source col ทันที (`column.tsx` filter `column.jobs.filter(j => !hiddenIds.has(j.id))`)
- fetch async; success → toast.success + router.refresh + unhide; failure → unhide + toast.error
- ครอบคลุม: Card forward modal, Card action sheet (forward+reassign+ship+cancel), drag-drop reassign+forward, BulkForwardModal, BulkActionsBar floating bar

**ผลลัพธ์**:
| | ก่อน | หลัง | WP |
|---|---|---|---|
| Apps Script round-trips | 3 | **2** | 2 |
| Perceived UI latency | 2.5-6s | **0ms** (B optimistic) | 0ms |
| Atomicity | ✅ | ✅ | ❌ (delete+add race) |

> หลัง user เปลี่ยน Vercel routes ให้ใช้ Apps Script auto-alloc (drop `getNextId` calls) ใน session ถัดไป → 1 round-trip. ตอนนี้ทำ deploy-order-safe ก่อน.

### Phase 2.1 Apps Script TS migration (100%)
- ย้าย 4 sections สุดท้ายเป็น TS — type-check ผ่าน strict mode (`noImplicitAny` + `strictNullChecks`)
- [auth.ts](../production-monitoring/apps-script/dashboard/auth.ts) (96 lines) — `hmacSha256Hex`, `verifyToken`, `tokenInfo`, `tokenRole` + `VALID_ROLES`, `ROLE_REQUIREMENTS`
- [load.ts](../production-monitoring/apps-script/dashboard/load.ts) (168 lines) — `loadAll`, `loadOrder`, `loadRecentAudit` + shared `parseJsonOr` helper
- [write.ts](../production-monitoring/apps-script/dashboard/write.ts) (252 → 280+ lines) — `addJob`, `updateJob`, `deleteJob`, `moveToShipped`, `addOrder`, `updateOrder`, `deleteOrder`, `setCowork`, `restoreJob`, `cancelJob`, `saveAll`, `bulkForward` (+ server-side id alloc + succeeded[])
- [api.ts](../production-monitoring/apps-script/dashboard/api.ts) (159 lines) — `doGet`, `doPost`
- `Code.js` ลด 677 → 93 บรรทัด (-86%); now only `SS_ID` + `SHEET_*` + `*_HEADERS` + section markers
- TS cross-file globals work via `*.ts` include glob (no imports needed at runtime — V8 cross-file scope)

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

1. **v2 deploy** — `git push` ฝั่ง penprinting-dashboard → Vercel auto-deploys. Vercel-side ทั้ง A+B + forward-compat backstop เป็นเอกเทศ — ใช้งานได้กับ Apps Script เก่าและใหม่ (Vercel routes alloc id ก่อนยัง)
2. **Apps Script redeploy** (optional, forward-compat สำหรับ session ถัดไป):
   ```bash
   cd "production-monitoring/apps-script/dashboard"
   ./push.sh
   ```
   แล้ว Apps Script editor → **Manage deployments → Edit existing → New version**.
   - เปิดใช้ `bulkForward` auto-alloc + `succeeded[]` array (forward-compat hook) — Vercel routes ตอนนี้ยังไม่ใช้, แต่จะ drop `getNextId` calls ใน session ถัดไป (round-trips 2 → 1)
   - **Backwards-compat**: ถ้า client ส่ง newJob.id มา = ใช้ id นั้น (พฤติกรรมเดิมที่ Vercel ส่งอยู่)
   - ⚠️ Smoke test หลัง deploy: forward 1 จอบ + bulk-forward 5 จอบ + drag-drop forward + reassign + ship + cancel + forward undo (admin)

2. **Vercel env vars สำหรับ Sentry** (optional, ค้างจาก 2026-05-06):
   - `NEXT_PUBLIC_SENTRY_DSN` — error capture activate
   - `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_AUTH_TOKEN` — source map upload
   - ถ้ายังไม่ตั้ง = Sentry SDK auto-disable (no errors, no source map upload)

---

## ⏳ ที่ยังเหลือ (priority order)

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

_อัปเดตล่าสุด: 2026-05-07 AM (Phase 2.1 close-out: Auth + Load + Write + API → TS, Code.js 677→93 lines)_
