# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [PATTERNS.md](PATTERNS.md) + [CLAUDE.md](CLAUDE.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) ก่อนเริ่ม**
>
> Session ก่อนหน้า (2026-05-06 PM) — **MEGA SESSION** 30+ commits ปิด Phase 3.5.10 + 3.5.11 + critical/high audit backlog ทั้งหมด. v2 dashboard ถึง **full WP feature parity**.

## ✅ เสร็จแล้วในรอบล่าสุด (2026-05-06 PM)

### Phase 3.5.10 + 3.5.11 — WP-parity + audit close-out

**Kanban / card / detail modal:**
- Inline forward + co-work dialogs บน card (ไม่เด้ง detail page)
- Drag-drop reassign (same-dept) + cross-dept forward via custom MIME
- Drag-vs-click handler split (handleDragStart bails on button targets)
- Co-work guest fan-out (violet read-only cards), format = WP `string[]`
- จัดส่งเสร็จ จำกัด `post:ship`, "ลบถาวร" ออกจาก detail (ยกเลิกพอ)
- ActionButtons cowork code path ลบ (CoworkDialog เป็น canonical UI)

**/orders /shipped /cancelled WP-parity:**
- Year/Month dropdowns + ค้นหา + Export CSV + ค้นหาในประวัติ
- /orders: date-range filter, ขั้นตอนปัจจุบัน + สถานะงาน, ตรวจสอบข้อมูล (orphan count), detail modal 5 actions (สั่งซ้ำ/แก้ไข/Tracking/พิมพ์/ลบ)
- Per-page selector 20/50/100 (default 20)
- /cancelled: strikethrough + restore button + `/api/jobs/restore`

**Order entry overhaul:**
- `/orders/new` เป็น real inline page (ไม่ใช่ modal), `max-w-7xl`
- บันทึกร่าง + พิมพ์+สั่ง buttons
- `/orders/[id]/edit` page (admins/sales)
- Drafts promote ผ่าน `/api/orders/promote-draft` (idempotent)
- Customer autocomplete (1.6k entries) + ดึงรายละเอียดจากงานล่าสุด (lazy `/api/orders/raw/[id]`)
- Templates UI (Quick-fill + บันทึก + จัดการ)
- Cascade-cancel jobs ตอนลบ order

**New routes:**
- `/orders/[id]/edit` — full inline edit + draft promote CTA
- `/orders/[id]/print` — A4 invoice auto-print
- `/orders/[id]/tracking-card` — printable label + QR + html-to-image PNG
- `/track` — public (no auth) + `/api/track/lookup` (cookie rate-limit 15/hr)

**Infrastructure / perf / DX:**
- Toast system (`components/toast-provider.tsx`) — 4 variants
- ConfirmDialog (`components/confirm-provider.tsx`) — แทน native confirm/prompt
- Auto-sync guards (skip when dialog open / typing / dragging) + cleanup
- `revalidatePath` ทุก successful write
- Defensive defaults ใน `loadAll()`
- React.memo OrdersTable rows + optimistic toasts + `startTransition`
- KPI modal rows clickable + ใช้ `allJobs` (ไม่ใช่ visibleJobs)

**Critical audit fixes:**
- C1 forward + bulk-forward race (atomic getNextId per item)
- C2 tracking-card QR URL aligned กับ v2 `/track`
- C3 cowork dept dropdown ที่ submit payload ไม่ถูก
- C4 `body.dataset.dragging` stuck flag ฆ่า auto-sync
- C5 promote-draft duplicate jobs on retry

### API routes added
- POST `/api/orders/promote-draft`, `/api/orders/delete`
- POST `/api/orders/templates/{add,delete}`
- GET `/api/orders/raw/[id]`
- POST `/api/jobs/restore`
- POST `/api/track/lookup`

---

## ⏳ ที่ยังเหลือ (priority order)

### 1. Documentation sweep
- `production-monitoring/monitoring.md` + `Tech-Roadmap-Status.md` มีข้อมูลซ้อน WP/v2 — refactor ให้แยกชัด
- หรือ split monitoring.md เป็น `monitoring.md` (WP) + `dashboard-v2.md` (Next.js) เป็น 2 source of truth

### 2. Phase 2.1 Apps Script TS migration ที่เหลือ
Code.js เหลือ ~657 บรรทัด แตกเป็น 4 sections:
- Auth (HMAC + cookie) ~80 บรรทัด — risky (break = unauth ทุก endpoint, smoke test ทั้งหมด)
- Load operations ~150 บรรทัด — read-heavy, low-risk extraction
- Write operations ~220 บรรทัด — addJob/deleteJob/updateJob/cancelJob/forwardJob/bulkForward — core CRUD
- API handlers (doGet/doPost) ~120 บรรทัด — entry-point, ไว้สุดท้าย

แนะนำลำดับ: Load → Auth (smoke test ใหญ่) → Write (CRUD) → API last

### 3. Per-user audit signing
ตอนนี้ทุก v2 mutation ลง audit log ด้วย actor = `admin:dashboard` (service token). แก้:
- Dashboard side: sign per-user token ด้วย `DASHBOARD_AUTH_SECRET` หลัง login → forward คู่กับ session cookie
- Apps Script: parse user token + override actor = `<role>:<user>` ก่อน `appendAudit`
- Cookie ขนาด ~250 bytes เพิ่ม — OK สำหรับทุก request

### 4. Sentry wiring
`NEXT_PUBLIC_SENTRY_DSN` env มีอยู่ในโปรเจกต์ แต่ยังไม่ได้ instrument:
- ติด `@sentry/nextjs` package
- `sentry.client.config.ts` + `sentry.server.config.ts`
- Source map upload ผ่าน `withSentryConfig` ใน next.config

### 5. TV display kiosk บน v2 (deferred earlier)
User requested skip ในรอบที่ผ่านมา — ยังเป็น backlog item:
- Port `production-monitoring/assets/production-tv.{js,css}` → `app/tv/page.tsx`
- Read-only Kanban + 30s auto-refresh + secret key auth
- Dark theme, big fonts, 3-column mosaic

### 6. QR บน /orders/[id]/print
A4 invoice ตอนนี้ไม่มี QR — เพิ่ม QR ที่ link ไป `/track?id=<orderId>` ที่มุมบน-ขวา

### 7. Phase 3.6 — Decommission decision (ระยะยาว)
หลัง v2 = full parity แล้ว — ตัดสินใจ:
- **Path A**: Switch DNS `app.penprinting.co` → Vercel + retire WP, deprecate `production-monitoring/` repo
- **Path B**: Coexist ต่อ — WP เป็น write fallback / staff app, v2 เป็น admin/sales
- ควรทำหลังจบ #3 (per-user audit signing) เพื่อ feature parity ครบจริงๆ

---

## 📚 Where to dig

| ต้องเข้าใจอะไร | ดูที่ไหน |
|---|---|
| Apps Script API patterns | [PATTERNS.md](PATTERNS.md) §1 |
| Permission gating | [PATTERNS.md](PATTERNS.md) §2 |
| URL state / Context patterns | [PATTERNS.md](PATTERNS.md) §3 |
| Iconography (lib/icons.tsx) | [PATTERNS.md](PATTERNS.md) §4 |
| Form patterns (`<dialog>`, repeater, edit-mode) | [PATTERNS.md](PATTERNS.md) §5 |
| Toast / Confirm system | `components/{toast,confirm}-provider.tsx` |
| Auto-sync + write cache-bust | `lib/auto-sync.tsx` |
| WP source (reference) | `production-monitoring/assets/production-monitoring.js` |
| WP Apps Script | `production-monitoring/apps-script/dashboard/Code.js` (657 บรรทัดเหลือ) |
| Project routes/auth/env | [CLAUDE.md](CLAUDE.md) |

## 🧠 Decisions to remember

1. **Edit/delete/cancel = admin only** บน v2 (stricter than Apps Script `ROLE_REQUIREMENTS`). Forward / reassign / cowork / move-to-shipped = all roles. See [feedback_dashboard_v2_edit_admin_only.md](~/.claude/projects/-Users-witsarut-p-Desktop-Project-Report-Penprinting/memory/).
2. **All cowork UI = violet** (no amber).
3. **All icons = SVG outline** ([lib/icons.tsx](lib/icons.tsx)) — no emoji.
4. **Date display = `displayDate()` from lib/jobs.ts** — handles ISO, DD/MM/YYYY, JS Date.toString() (GMT) all in one. Use `displayDateTime()` for timestamp columns.
5. **Filter state in URL** (searchParams), not localStorage.
6. **Bulk select = inline checkbox mode** — toggled from filter-chips row.
7. **Card body click ≠ open detail** — only "รายละเอียด" button. Bulk-mode click = toggle selection.
8. **Toast/Confirm > native** — ใช้ `useToast()` + `useConfirm()` แทน `alert()`/`confirm()` ทุกที่ (consistent UI + non-blocking).
9. **`revalidatePath` after write** — ทุก successful mutation ต้อง bust cache เพื่อ next read สด (ไม่งั้นข้อมูลเก่า ISR ค้าง 60s).
10. **Drag MIME types** — same-dept reassign = `application/x-pp-reassign`, cross-dept forward = `application/x-pp-forward` (กัน drop-target รับผิด).

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

_อัปเดตล่าสุด: 2026-05-06 PM (mega-session: Phase 3.5.10 + 3.5.11 + audit close-out)_
