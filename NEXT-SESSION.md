# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [dashboard-v2.md](dashboard-v2.md) + [PATTERNS.md](PATTERNS.md) + [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) ก่อนเริ่ม**
>
> **Session ก่อนหน้า — 2026-05-06 PM mega-session (18 commits)** ปิด audit backlog ครบ 4 batches + sidebar perf overhaul (D+C) + observability (Sentry + per-user audit signing) + UI polish (favicon + QR + รายงานประจำเดือน + permission lockdown). v2 เริ่ม "ใช้งานจริงเต็มตัว".

## ✅ เสร็จแล้วในรอบล่าสุด (2026-05-06 PM)

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

## ⚠️ Pending user actions (ค้างจาก 2026-05-06 PM)

1. **Apps Script redeploy** — ต้องรันเอง เพื่อ activate features ของ commit ล่าสุด:
   ```bash
   cd "production-monitoring/apps-script/dashboard"
   ./push.sh
   ```
   แล้ว Apps Script editor → **Manage deployments → Edit existing → New version**.
   - **Activates**: `getNextIds(count)` action (bulk-forward 25 jobs จาก ~12s → ~500ms) + per-user audit signing (audit log แสดงชื่อจริงผู้ใช้แทน `admin:dashboard`).
   - **Backwards-compat fallback** ใน `/api/jobs/bulk-forward` + per-user signing silent skip จนกว่าจะ deploy — dashboard ยังใช้งานได้ปกติ.

2. **Vercel env vars สำหรับ Sentry** (optional):
   - `NEXT_PUBLIC_SENTRY_DSN` — error capture activate
   - `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_AUTH_TOKEN` — source map upload
   - ถ้ายังไม่ตั้ง = Sentry SDK auto-disable (no errors, no source map upload)

---

## ⏳ ที่ยังเหลือ (priority order)

### 1. Phase 2.1 Apps Script TS migration ที่เหลือ
Code.js เหลือ ~657 บรรทัด แตกเป็น 4 sections:
- Auth (HMAC + cookie) ~80 บรรทัด — risky (break = unauth ทุก endpoint, smoke test ทั้งหมด)
- Load operations ~150 บรรทัด — read-heavy, low-risk extraction
- Write operations ~220 บรรทัด — addJob/deleteJob/updateJob/cancelJob/forwardJob/bulkForward — core CRUD
- API handlers (doGet/doPost) ~120 บรรทัด — entry-point, ไว้สุดท้าย

แนะนำลำดับ: Load → Auth (smoke test ใหญ่) → Write (CRUD) → API last

### 2. Phase 3.6 — Decommission decision (ระยะยาว)
v2 = full WP feature parity แล้ว + permissions match WP role matrix. ตัดสินใจ:
- **Path A**: Switch DNS `app.penprinting.co` → Vercel + retire WP, deprecate `production-monitoring/` repo
- **Path B**: Coexist ต่อ — WP เป็น write fallback / staff app, v2 เป็น primary

ต้องเช็คก่อนตัดสินใจ:
- WP-only features ที่ v2 ยังไม่มี: TV Display kiosk (deferred earlier — ดู #3 ด้านล่าง), Morning Report (separate Apps Script project, อยู่ที่ workspace `morning-report/`)
- Staff acceptance — อยากให้ staff ใช้ v2 อย่างเดียวไหม หรือปล่อย WP ไว้

### 3. TV display kiosk บน v2 (deferred)
User skip ใน Phase 3.5 — ยังเป็น backlog item:
- Port `production-monitoring/assets/production-tv.{js,css}` → `app/tv/page.tsx`
- Read-only Kanban + 30s auto-refresh + secret key auth
- Dark theme, big fonts, 3-column mosaic
- ต้องเลือกว่า:
  - Mount ที่ `/tv?key=XXX` (matching WP) หรือ
  - Subdomain แยก เช่น `tv.dashboard.penprinting.co`

### 4. Route group `(shell)/layout.tsx` refactor
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

_อัปเดตล่าสุด: 2026-05-06 PM (18-commit mega-session: audit + perf + monthly report + permissions)_
