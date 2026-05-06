# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [PATTERNS.md](PATTERNS.md) + [CLAUDE.md](CLAUDE.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) ก่อนเริ่ม**
>
> Session ก่อนหน้า (2026-05-06) ทำไป ~20 commits — ตอนนี้ Phase 3.5 + Phase 2.3 ปิดเกือบหมด เหลือแค่ list-page polish + drag-drop. v2 dashboard มี feature parity กับ WP เกือบครบ.

## ✅ เสร็จแล้วใน session ก่อนหน้า

- Phase 3.5.4-3.5.8 ทั้งหมด (Add/edit job, Forward+Bulk+Reassign, Co-work, Auto-sync, Order entry)
- Phase 3.5.5b — Photobook tab + Order edit + Duplicate detection
- Phase 3.5.7b — Undo forward 10s toast
- Phase 2.3 Stage A+B+C — DashboardShell, sidebar, bottom-nav, KPI bar, filter chips, dept icon-headers, inline bulk-mode, dept-card pattern
- Icon refactor — all SVG outline (lib/icons.tsx)
- KPI click → detail modal (per-dept breakdown + job table)
- Order form full WP port — 3 tabs, ~50 fields matching WP screenshot
- Card visual match WP — sizes, buttons, cowork inline display, ร่วมพิมพ์ pill, all-violet cowork color
- GMT date fix — displayDate handles JS Date.toString() format
- Card body click no longer opens detail (only "รายละเอียด" button does)

## ⏳ ที่ยังเหลือ (priority order)

### 1. Drag-drop reassign — replace ปุ่ม 🔄 ย้าย
WP behavior: drag a card within same dept → drop on another staff column → reassign.

**Files to touch:**
- [app/board/card.tsx](app/board/card.tsx) — add `draggable={true}` + `onDragStart` setting `dataTransfer.setData('text/plain', String(job.id))`. Remove the 🔄 ย้าย button from ActionButtons.
- [app/board/column.tsx](app/board/column.tsx) — add `onDragOver` (preventDefault if same-dept), `onDrop` reading the job-id and POSTing `/api/jobs/reassign`. Show drag-over state with ring-2 ring-sky-300.
- Mobile: HTML5 drag doesn't work on touch. Either keep ปุ่ม ย้าย visible only on `md:hidden`, or skip mobile (defer).

**API:** `/api/jobs/reassign` already exists, no backend change needed.

**Spec:**
- Validation: source.dept === target.dept (server already enforces, frontend should hide invalid drop zones)
- Show ghost during drag, drop-target highlight on dragover
- On drop: optimistic UI? or just router.refresh()?  — start with router.refresh() (consistent with rest of v2)

### 2. /orders match WP table layout
**Reference screenshot from user:** columns are
`#` | `เลขที่ใบสั่งงาน` (sortable, link) | `ชื่องาน` | `ลูกค้า` | `วันที่รับ` | `กำหนดส่ง` | `สถานะใบสั่ง` (● สั่งแล้ว) | `ขั้นตอนปัจจุบัน` (e.g. "กราฟิก → ปุ๊ก") | `สถานะงาน` (urgency badge) | `ลบ`

**Plus:**
- Date range filter (วันที่รับ from/to) — replace the status pill filters
- Search box (have)
- "Export CSV" button
- "ตรวจสอบข้อมูล" button (orphan check — like WP)

**Files:** [app/orders/page.tsx](app/orders/page.tsx) — refactor table.

**Hard part:** computing "ขั้นตอนปัจจุบัน" + "สถานะงาน" per order. Need to:
- Find the active job for that order (jobs.find(j => j.orderId === o.id))
- If found: ขั้นตอน = "{DEPT_LABELS[job.dept]} → {staffName}", สถานะงาน = job urgency
- If shipped: ขั้นตอน = "จัดส่งแล้ว"
- If cancelled: ขั้นตอน = "ยกเลิก"

### 3. /shipped match WP layout
- Year filter dropdown (ทั้งหมด / 2025 / 2026)
- Month filter dropdown (ทั้งหมด / มกราคม-ธันวาคม) — auto-filtered by year
- Search (have)
- Export CSV button
- "ค้นหาในประวัติ" button — points to /archive
- Table: # / ชื่องาน / ลูกค้า / วันที่จัดส่ง / เดือน / สถานะ (● จัดส่งแล้ว)

**Files:** [app/shipped/page.tsx](app/shipped/page.tsx)

### 4. /cancelled match WP layout
- Year/Month filter (same pattern as /shipped)
- Search
- Export CSV
- Table: # / ชื่องาน (red strikethrough) / แผนก / ยกเลิกโดย / วันที่ยกเลิก (with time, displayDateTime — already has) / เหตุผล / `กู้คืน` button

**New endpoint:** `/api/jobs/restore` (admin only, calls Apps Script `restoreJob`):
- Body: `{ id }` — fetches cancelled row, calls Apps Script restoreJob action
- Apps Script side already implemented (`production-monitoring/apps-script/dashboard/Code.js:567 restoreJob`)

**Files:**
- new `app/api/jobs/restore/route.ts`
- [app/cancelled/page.tsx](app/cancelled/page.tsx) — strikethrough class on name col, restore button per row that POSTs to /api/jobs/restore

### 5. Templates UI (deferred to 3.5.9 — lowest priority)
- Apps Script already has `addTemplate` / `deleteTemplate` actions (admin+sales)
- Templates loaded in `loadAll().templates`
- UI: Quick-fill dropdown + "บันทึกเป็น template" + "จัดการ" buttons in OrderForm header
- Pre-fills form from selected template's `rawData`

## 📚 Where to dig

| ต้องเข้าใจอะไร | ดูที่ไหน |
|---|---|
| Apps Script API patterns | [PATTERNS.md](PATTERNS.md) §1 |
| Permission gating | [PATTERNS.md](PATTERNS.md) §2 |
| URL state / Context patterns | [PATTERNS.md](PATTERNS.md) §3 |
| Iconography (lib/icons.tsx) | [PATTERNS.md](PATTERNS.md) §4 |
| Form patterns (`<dialog>`, repeater, edit-mode) | [PATTERNS.md](PATTERNS.md) §5 |
| WP source code | `production-monitoring/assets/production-monitoring.js` (5600 lines, search for `function name`) |
| WP Apps Script | `production-monitoring/apps-script/dashboard/Code.js` |
| Project routes/auth/env | [CLAUDE.md](CLAUDE.md) |

## 🧠 Decisions to remember

1. **Edit/delete/cancel = admin only** on v2 (stricter than Apps Script `ROLE_REQUIREMENTS`). Forward / reassign / cowork / move-to-shipped = all roles. See [feedback_dashboard_v2_edit_admin_only.md](~/.claude/projects/-Users-witsarut-p-Desktop-Project-Report-Penprinting/memory/).
2. **All cowork UI = violet** (no amber).
3. **All icons = SVG outline** ([lib/icons.tsx](lib/icons.tsx)) — no emoji.
4. **Date display = `displayDate()` from lib/jobs.ts** — handles ISO, DD/MM/YYYY, and JS Date.toString() (GMT format) all in one. Use `displayDateTime()` for timestamp columns.
5. **Filter state in URL** (searchParams), not localStorage.
6. **Bulk select = inline checkbox mode** on cards — toggled from filter-chips row.
7. **Card body click ≠ open detail** — only the "รายละเอียด" button does. Bulk-mode click = toggle selection.

## 🛠 Quick start for next session

```bash
cd /Users/witsarut.p/Desktop/Project\ Report\ Penprinting/penprinting-dashboard
git pull
npm install              # if package.json changed
npm run type-check
npm run build           # before any commit
```

Pick task from list above, follow PATTERNS.md, ship + push (Vercel auto-deploys).

## 📝 Update protocol after work

หลังจบ session:
1. อัปเดตข้อ "เสร็จแล้ว" + เลื่อน item ลง / ลบ จาก "ที่ยังเหลือ"
2. ถ้าเจอ pattern ใหม่ — เพิ่มใน [PATTERNS.md](PATTERNS.md)
3. อัปเดต [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) iteration table

_อัปเดตล่าสุด: 2026-05-06 (handoff after big session)_
