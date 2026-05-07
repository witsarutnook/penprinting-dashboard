# Penprinting Dashboard v2 — Project Memory

`dashboard.penprinting.co` — Next.js 14 strangler dashboard ที่ค่อยๆ ย้าย feature มาจาก WordPress dashboard เดิม (`app.penprinting.co/production-monitoring`)

> **Companion doc**: shared infrastructure (Apps Script API, Google Sheet schema, role/permission matrix, lessons learned ที่ apply ทั้ง 2 ฝั่ง) อยู่ที่ [`production-monitoring/monitoring.md`](../production-monitoring/monitoring.md). เอกสารนี้เน้นเฉพาะส่วนที่เป็น Next.js ของ v2 — features, version history, deploy, patterns, lessons.
>
> **Forward-looking**: ที่ยังไม่ได้ทำ → [`NEXT-SESSION.md`](NEXT-SESSION.md). Audit findings → [`AUDIT-BACKLOG.md`](AUDIT-BACKLOG.md). Reusable code patterns → [`PATTERNS.md`](PATTERNS.md). Migration overview → [`../Tech-Roadmap-Status.md`](../Tech-Roadmap-Status.md).

---

## 1. ภาพรวม

ระบบ Kanban + order entry + analytics + calendar + tracking — port จาก WP สู่ Next.js แบบ strangler pattern. ทั้ง 2 ฝั่งใช้ **Google Sheet เดียวกัน** ผ่าน Apps Script API → coexist ได้

### Stack
- **Framework**: Next.js 14 (App Router) + TypeScript + Tailwind 3
- **Backend connection**: Apps Script Web App (HMAC-signed service token)
- **Auth**: cookie-based (HMAC-SHA256, Edge-compatible via Web Crypto)
- **Hosting**: Vercel (auto-deploy ทุก `git push origin main`)
- **GitHub**: `witsarutnook/penprinting-dashboard` (private)
- **Font**: Anuphan (Thai) + Inter (numerals) ผ่าน next/font/google
- **Brand accent**: `#c8553d`
- **Error tracking**: `@sentry/nextjs` (server + edge + client + global error boundary)

### ไฟล์หลัก
| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `app/board/page.tsx` | Kanban board page (Suspense streaming) |
| `app/orders/page.tsx` | Order list (filter + table + detail modal) |
| `app/orders/new/page.tsx` | Inline order entry (templates + customer autocomplete + duplicate detection) |
| `app/orders/[id]/edit/page.tsx` | Order edit + draft promote |
| `app/orders/[id]/print/page.tsx` | A4 invoice (auto-print + QR) |
| `app/orders/[id]/tracking-card/page.tsx` | Printable label + QR + html-to-image PNG download |
| `app/track/page.tsx` | Public tracking (no auth, signed-cookie rate-limit) |
| `app/analytics/page.tsx` | KPIs + 4 charts (recharts) |
| `app/calendar/page.tsx` | Month grid + Bangkok TZ + mobile vertical list |
| `app/archive/page.tsx` | Search archived sheets |
| `app/api/{auth,jobs,orders,track}/*` | API routes (POST mutations + GET reads) |
| `lib/api.ts` | Apps Script API wrapper (`loadAll`, `post`, per-action revalidatePath, per-user audit signing) |
| `lib/auth.ts` | HMAC cookie sign/verify (Web Crypto) |
| `lib/board.ts` | STAFF map + `computeBoard` + filter logic |
| `lib/forward.ts` | FW_TARGETS + RESTRICTED_TARGETS + `validateForwardTarget` |
| `lib/auto-sync.tsx` | `useAutoSync` hook + `broadcastWrite` (cross-tab via BroadcastChannel) |
| `lib/icons.tsx` | All outline SVG icons (no emoji — see PATTERNS §4.1) |
| `lib/staff-icons.tsx` | Per-staff icon + color theming |
| `lib/photobook.ts` | Photobook order schema + `orderFormFromRaw` reverser |
| `components/dashboard-shell.tsx` | Layout wrapper (sidebar + bottom-nav + Toast/Confirm providers) |
| `components/{toast,confirm}-provider.tsx` | Themed dialogs replacing native `alert/confirm/prompt` |
| `components/nav-config.ts` | Sidebar + bottom-nav source of truth |
| `instrumentation*.ts` + `sentry.*.config.ts` | Sentry init (server / edge / client) |

### Google Sheet
ใช้ Sheet ตัวเดียวกับ WP (`1QK20K5F_ucCaUHwqdwBWNp6e8-oZPSfUNsdaFHBtbts`). Schema + ID generation อยู่ใน [`monitoring.md` §4](../production-monitoring/monitoring.md).

---

## 2. Auth & sessions

### Cookie
- Cookie name: **`pp_dashboard_v6`** (separate from WP `pp_dashboard_auth_v5`)
- Format: `<role>|<user>:<exp>:<hmac>`
- HMAC-SHA256 ผ่าน Web Crypto API → ใช้ได้ทั้ง Edge runtime (middleware) + Node runtime (route handlers)
- TTL: 30 days
- Flags: httpOnly + secure + sameSite=lax

### Role mapping
4 passwords map to roles via `DASHBOARD_AUTH_USERS` env (JSON: `{ "<password>": { "role": "...", "user": "..." } }`).

### Apps Script service token
- Single service token `APPS_SCRIPT_TOKEN` (signed payload `api:admin:dashboard:<exp>:<hmac>`, 5 year TTL)
- ทุก request จาก dashboard → Apps Script ใช้ token เดียวกันนี้
- **Per-user audit signing** (v5.10.1+) — `lib/api.ts post()` ดึง session จาก cookie → ส่ง `_actor: "<role>:<user>"` ใน body. Apps Script side override default `admin:dashboard` → log จริงว่าใครเป็นคนกดทำ

### Rate limit
- `/api/auth/login` — 5 attempts / 5 min ต่อ browser ผ่าน signed cookie `pp_login_rl` (path `/api/auth`, expires กับ window)
- `/api/track/lookup` — 15 / hour ต่อ browser ผ่าน signed cookie `pp_track_rl`
- ทั้งคู่ใช้ pattern ที่ทนต่อ Vercel multi-instance (cookie state stays per browser regardless of which instance handles)

---

## 3. Routes

### Public
| Route | Purpose |
|---|---|
| `/` | Server-side redirect — `/login` if logged out, `/board` if logged in |
| `/login` | HMAC cookie auth |
| `/track` | Public order lookup (no auth, PIN gate, masked customer name) |
| `/orders/[id]/print` | A4 invoice (auth required, has QR linking to /track) |
| `/orders/[id]/tracking-card` | Printable label (auth required) |

### Authenticated (require valid `pp_dashboard_v6` cookie)
| Route | Auth | Notes |
|---|---|---|
| `/board` | any role | Kanban + URL filters (`?dept=` `?u=` `?q=`) + bulk-mode + auto-sync |
| `/orders` | any role | Filter form + status pills + table + detail modal (5 actions: สั่งซ้ำ / แก้ไข / Tracking / พิมพ์ / ลบ) |
| `/orders/new` | admin + sales | Inline order entry (templates + duplicate detection) |
| `/orders/[id]/edit` | admin + sales | Order edit + draft promote |
| `/shipped` | any role | Shipped list (year/month filter + CSV export) |
| `/cancelled` | admin only | Cancelled list + restore button |
| `/analytics` | any role | Sub-tabs: "รายงานประจำเดือน" (default, single-month deep dive) + "Analytics 12 เดือน" (KPIs + 4 charts). Month picker on monthly view; range selector on 12-month view |
| `/calendar` | admin only | Month grid + Bangkok TZ |
| `/archive` | admin only | Search archived sheets |

Middleware (`middleware.ts`) gates `/analytics /calendar /archive /board /orders /shipped /cancelled` paths — defence-in-depth on top of per-page `verifySession()`.

### API routes
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/{login,logout}` | POST | open / cookie | Session management (login is rate-limited) |
| `/api/jobs/add` | POST | admin + sales | Add standalone job (atomic getNextId) |
| `/api/jobs/update` | POST | admin | Edit job fields |
| `/api/jobs/delete` | POST | admin | Hard delete |
| `/api/jobs/cancel` | POST | admin | Move to cancelled with reason |
| `/api/jobs/move-to-shipped` | POST | any | Mark shipped |
| `/api/jobs/forward` | POST | any | Atomic single forward (uses bulkForward(items=1)) |
| `/api/jobs/bulk-forward` | POST | any | 1-25 jobs/batch atomic (uses getNextIds) |
| `/api/jobs/forward-undo` | POST | admin | Undo last forward (10s window) |
| `/api/jobs/reassign` | POST | any | Same-dept staff swap |
| `/api/jobs/cowork` | POST | any | Set co-work list (print dept only) |
| `/api/jobs/restore` | POST | admin | Move back from cancelled to active |
| `/api/orders/add` | POST | admin + sales | Create order + initial job + PIN |
| `/api/orders/update` | POST | admin | Edit order (cascades job rename) |
| `/api/orders/delete` | POST | admin | Delete order (cascade-cancels jobs) |
| `/api/orders/promote-draft` | POST | admin + sales | Convert draft to active (idempotent) |
| `/api/orders/raw/[id]` | GET | admin + sales | Lazy fetch full rawData for one order |
| `/api/orders/templates/{add,delete}` | POST | admin + sales | Template CRUD |
| `/api/track/lookup` | POST | open | Public order lookup (cookie rate-limit) |

---

## 4. Caching strategy

### ISR (read-side)
- Default `loadAll` fetch caches for **60 seconds** (`next.revalidate: 60`)
- Write-path lookups (`loadAllFresh`) bypass cache — used by `/api/jobs/forward` etc. ที่ต้องอ่าน source state ก่อน build new job

### Per-action invalidation (write-side)
`lib/api.ts post()` หลัง successful write → busts ONLY the paths whose data shape actually changed (`PATHS_BY_ACTION` map). Examples:
- `addJob` → revalidate `/board /orders /calendar /analytics`
- `cancelJob` → revalidate `/board /orders /cancelled /calendar /analytics`
- `setCowork` → revalidate `/board` only
- `addTemplate` → revalidate `/orders/new` only

Pages NOT in the action's path list keep their warm 60s ISR cache → instant nav even right after a write. Decision context: WP coexists right now, so 60s ISR window is the freshness floor — don't extend until WP retires (auditor sidebar perf, 2026-05-06).

### Cross-tab sync
`useAutoSync` hook polls 15s + listens to `BroadcastChannel('pp_dashboard_sync')` (same channel name as WP — they cross-pollinate). Guards: skip when dialog open / typing / dragging / page hidden.

### Streaming SSR
ทุก authenticated page ใช้ `<Suspense>` boundary รอบ data section. Shell (sidebar + nav + toolbar) ส่ง HTML กลับใน ~50ms; body fill in เมื่อ `loadAll` ตอบ. Suspense `key` ผูกกับ filter set → เปลี่ยน filter = fresh skeleton ทันที (ไม่ค้างกับ result เก่า).

---

## 5. Features ที่ทำเสร็จแล้ว (v2-specific)

> Features ที่ไม่ได้อยู่ในตารางนี้ → ดู [`monitoring.md` §5](../production-monitoring/monitoring.md) (WP-original features that v2 inherited via the strangler port — TV display, LINE OA, customer tracking PIN, etc.)

### Phase 3.5 — Kanban + write actions (full WP parity)
- Kanban board (3 dept × N staff cols) + URL-driven filters
- Same-dept reassign via drag-drop (custom MIME `application/x-job-${dept}`)
- Cross-dept forward via drag-drop (custom MIME `application/x-job-any` + source-staff hint)
- Inline forward + co-work dialogs บน card (ไม่เด้ง detail page)
- Co-work guest fan-out (violet read-only cards) — print dept only
- Bulk select (inline checkbox) + bulk forward 1-25 jobs (atomic via `getNextIds` Apps Script action, v5.10.1+)
- Forward undo (admin only, 10s window) via `/api/jobs/forward-undo`

### /orders /shipped /cancelled (WP parity)
- Year/Month dropdowns + search + CSV export
- /orders: date-range filter (TZ-safe YYYY-MM-DD compare), status pills, current step + urgency, orphan count, detail modal with 5 actions
- Per-page selector 20/50/100 (default 20)
- /cancelled: strikethrough display + restore button

### Order entry overhaul (Phase 3.5.10)
- `/orders/new` is a real inline page (not modal), `max-w-7xl`
- Drafts promote via `/api/orders/promote-draft` (idempotent — cascade-cancels existing jobs on retry)
- Customer autocomplete (1.6k entries from `/customers.json`)
- "ดึงรายละเอียดจากงานล่าสุดของลูกค้านี้" — lazy fetch via `/api/orders/raw/[id]`
- Templates UI (Quick-fill + บันทึก + จัดการ)
- Cascade-cancel jobs ตอนลบ order
- Duplicate detection via 409 + force flag

### Public tracking
- `/track` route + `/api/track/lookup` — order id (3+ digits) + 4-digit PIN
- Signed cookie rate-limit `pp_track_rl` (15/hour, survives Vercel cold starts)
- QR on A4 invoice + tracking card → both link to `/track?id=<orderId>`

### Streaming + perf
- Suspense streaming on all 6 authenticated pages
- Per-action revalidatePath scope (warm cache for unrelated routes)
- Sidebar `useTransition` + pulsing dot — instant click feedback (~16ms)
- React.memo OrdersTable rows + optimistic toasts + `startTransition`
- KPI modal rows clickable → navigates to filtered Kanban

### UX systems
- Toast (`useToast`): info / success / error / warn — 4 variants + auto-dismiss
- ConfirmDialog (`useConfirm`): default / warn / danger themed dialogs replacing native `confirm/prompt`
- AutoSync polling 15s + BroadcastChannel cross-tab + guards (dialog / typing / dragging)

### Tracking-card (printable label)
- A6 layout + QR + PIN + customer name + html-to-image PNG download

### A4 invoice (`/orders/[id]/print`)
- Auto-print on load
- QR in header right panel (60×60, white background, links to `/track?id=...`)
- Photobook + normal mode templates branch on `raw.orderType`

---

## 6. Roadmap (v2 phases)

| Phase | Status | Note |
|---|---|---|
| 3.1 — Scaffold | ✅ | Next.js 14 + Vercel + cookie auth (2026-05-04) |
| 3.2 — Analytics port | ✅ | Read-only KPIs + 4 charts |
| 3.3 — Calendar port | ✅ | Month grid + mobile vertical |
| 3.4 — Archive port | ✅ | Search across archive sheets |
| 3.5.1-3.5.8 | ✅ | Kanban + write actions (forward, reassign, cowork) |
| 3.5.5b / 3.5.7b | ✅ | Photobook tab, edit mode, dup detection, undo forward |
| 3.5.10 | ✅ | WP-parity card actions + inline order entry + drafts + templates UI |
| 3.5.11 | ✅ | /orders /shipped /cancelled WP-parity + restore + tracking-card + /track public + audit close-out |
| 2.3 (UI parity) | ✅ Stage A+B+C | DashboardShell + sidebar + KPI bar + filter chips + inline bulk |
| 3.6 — Decommission WP | ⏳ | Future — switch DNS app.penprinting.co → Vercel after coexist period |

ดูรายละเอียดเต็มใน [`../Tech-Roadmap-Status.md`](../Tech-Roadmap-Status.md).

---

## 7. Patterns & Conventions

หัวข้อหลักอยู่ใน [`PATTERNS.md`](PATTERNS.md):
- §1 Apps Script API patterns (atomic mutations, server-side ID allocation, `loadAllFresh` for write-path lookups)
- §2 Permission gating (v2 stricter than Apps Script `ROLE_REQUIREMENTS` for edit/delete/cancel)
- §3 Frontend state (URL searchParams as filter source-of-truth, `useIsActive`, BroadcastChannel)
- §4 UI / iconography (outline SVG only, no emoji — `lib/icons.tsx` is canonical)
- §5 Form patterns (`<dialog>` modal, repeater, edit mode)

### Decisions to remember
1. **Edit/delete/cancel = admin only** บน v2 (stricter than Apps Script). Forward / reassign / cowork / move-to-shipped = all roles.
2. **All cowork UI = violet** (no amber). Cowork format = WP-compatible `string[]`. Print dept only.
3. **All icons = SVG outline** ([lib/icons.tsx](lib/icons.tsx)) — no emoji.
4. **Date display** = `displayDate()` from [lib/jobs.ts](lib/jobs.ts) — handles ISO, DD/MM/YYYY, JS Date.toString() (GMT) all in one. Use `displayDateTime()` for timestamp columns.
5. **Filter state in URL** (searchParams), not localStorage.
6. **Bulk select = inline checkbox mode** — toggled from filter-chips row.
7. **Card body click ≠ open detail** — only "รายละเอียด" button. Bulk-mode click = toggle selection.
8. **Toast/Confirm > native** — ใช้ `useToast()` + `useConfirm()` แทน `alert()`/`confirm()` ทุกที่.
9. **`revalidatePath` after write** — `lib/api.ts` รู้ path ที่ relevant per action; routes ไม่ต้อง bust เอง.
10. **Drag MIME types** — same-dept reassign = `application/x-pp-reassign` / `application/x-job-${dept}`, cross-dept forward = `application/x-pp-forward` / `application/x-job-any`.
11. **Atomic id allocation only** — never trust `snap.nextId` from cached `loadAll`. Use `getNextId` (single) or `getNextIds(count)` (batch) Apps Script actions.

---

## 8. Backlog

→ [`NEXT-SESSION.md`](NEXT-SESSION.md) — pick-up doc for next session
→ [`AUDIT-BACKLOG.md`](AUDIT-BACKLOG.md) — running audit tracker (rounds + closed batches)

---

## 9. ประวัติปัญหาที่เคยเจอ (v2-specific)

> Generic / shared lessons (Apps Script bandwidth quota, Order ID drift, Cookie clear, etc.) อยู่ใน [`monitoring.md` §8](../production-monitoring/monitoring.md). ตารางนี้คือสิ่งที่เกิดเฉพาะ v2 — ที่ port มาใหม่หรือ Next.js-specific.

| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| **Sidebar กดแล้วช้ากว่า WP เยอะ** (2026-05-06) | Server Components await `loadAll()` block render + `revalidatePath` busted 6 paths every write → ISR cache permanently cold | (1) per-action invalidation map, (2) Suspense streaming on all 6 pages, (3) `useTransition` pulsing dot on NavLink |
| **Page-flash เมื่อกด nav** (2026-05-06) | เพิ่ม per-route `loading.tsx` ที่ duplicate sidebar geometry, แต่ shell อยู่ใน page.tsx → unmount→skeleton→remount = 3-frame flicker | Revert per-route loading.tsx; ใช้แค่ Suspense ใน page level (shell อยู่ใน DashboardShell ที่ stays mounted ขณะ Suspense fallback แสดง). Proper fix = route group `(shell)/layout.tsx` future task. |
| **/analytics crash via fetch tags** (2026-05-06) | `revalidateTag` instability when Apps Script GET URL changed per env-token | Replaced fetch tags with `revalidatePath`. Stable. |
| **Cowork แสดงไม่ครบ** (Phase 3.5.10) | v2 first iteration เก็บ cowork เป็น object array `{id,name,...}[]` — WP expects flat `string[]` of staff ids | Migrate to `string[]` (PATTERNS §3.4), guest fan-out adds violet read-only cards on each member's column |
| **GMT in date display** (Phase 3.5.10) | Apps Script returns dates as `Date.toString()` strings ("Wed May 06 2026 GMT+0700"), not just ISO | `displayDate()` extended to handle 3 formats (ISO, DD/MM/YYYY, Date.toString) |
| **Drag fired on button click** (Phase 3.5.10) | `handleDragStart` on card root captured button presses too — Quick-win buttons silently dropped onClick | Bail out of drag if `e.target.closest('button, a, input, select, textarea, label')` |
| **`body.dataset.dragging` stuck** (Critical C4) | Browser quirk + unmount mid-drag → `dragend` never fired → flag stayed → auto-sync永远disabled | Cleanup ทั้ง onUnmount + handleDragEnd. AutoSync skips when flag set. |
| **promote-draft duplicate jobs on retry** (Critical C5) | Idempotency check missing — clicking "ส่งเข้าระบบ" twice = 2 jobs for one draft | Check `existingJob = snap.jobs.find(j => j.orderId === id)` and skip addJob if already created |
| **Date-range filter off-by-day** (Medium TZ) | `parseDateDMY` returned UTC midnight; `new Date(iso + 'T00:00:00')` was server-local; Vercel runs UTC; Sheet dates were Bangkok | Compare YYYY-MM-DD strings via Intl.DateTimeFormat 'en-CA' in Asia/Bangkok zone. Lexical compare = TZ-free. |
| **jobByOrderId last-write-wins** (Medium) | Map<orderId, job> overwrote earlier jobs when an order had >1 active job (recovery scenario) | Index as Map<orderId, job[]>; pick lowest job id as primary, append "(+N)" suffix when count > 1 |
| **Login rate-limit didn't survive cold starts** (Medium) | In-memory Map per Vercel function instance → brute-forcer hitting different instances saw fresh counter | Port `attachRateCookie` pattern from `/api/track/lookup` — signed httpOnly cookie state per browser, path `/api/auth` |
| **bulk-forward N×getNextId timing out** (Medium) | 25 items × ~300-500ms per round-trip ≈ 12s → flirting with Vercel 10s function timeout | Add `getNextIds(count)` Apps Script action — single LockService call mints N sequential ids. Backwards-compat fallback retained until Apps Script side ships. |
| **Default Next.js favicon overrode logo** (2026-05-06) | `app/favicon.ico` from `create-next-app` scaffold persisted; Next.js emits its `<link>` first with sizes="16x16" → browsers preferred it over the new `icon.png` | Delete `app/favicon.ico`. Real logo lives at `app/icon.png` + `app/apple-icon.png`. |
| **Print popup blocked** (2026-05-07) | `window.open()` called AFTER `await fetch()` is rejected by browsers as non-user-initiated popup — even on a click handler | Open synchronously on click with placeholder URL → swap `location.href` post-await. Card.tsx + orders detail modal pattern. |
| **พิมพ์+สั่ง bounced out of installed PWA** (2026-05-07) | `window.open(url, '_blank')` always opens in system browser, breaking PWA UX | Detect `display-mode: standalone` + `navigator.standalone` → use `router.push(url)` for in-app navigation instead. |
| **Print page 404 for fresh orders** (2026-05-07) | `/orders/[id]/print` used cached `loadAll()` (60s ISR window) → orders < 60s old not in snapshot → 404 | Add `export const dynamic = 'force-dynamic'` + `loadAllFresh()` fallback when id missing from cached snap. |
| **Optimistic-UI flicker between hide + SSR data** (2026-05-07) | `unhideJob()` ran before `router.refresh()` SSR data landed → 1-2s gap where card not in optimistic state nor SSR state | Wrap `router.refresh()` in `useTransition` → defer `unhideJob()` until `isPending` flips false. Phantom card stays visible until real data arrives. |
| **createOrder fast-path landed empty rows** (2026-05-07) | Suspected new single-call `createOrder` action → reverted (`0b762cc`). Root cause was actually edit-form prefill reading wrong field path = blank fields submitted on edit. | Fix edit prefill (`8c5f97d`) → re-enable fast path (`c38c5c1`). Lesson: don't blame the new code path; bisect carefully. |
| **Single-order pages re-fetched full snapshot** (2026-05-07 PM, `8528839`) | `/api/orders/raw/[id]`, `/orders/[id]/print`, `/api/track/lookup` all called `loadAll()`/`loadAllFresh()` (full Sheet snapshot, ~600ms) just to look up one row | Apps Script `getOrder` action existed but unused. Added `loadOrder(id)` wrapper in [lib/api.ts](lib/api.ts) → ~200ms single-row read. 3× faster order detail tab, ~2.7s → ~1.6s print popup fill. |
| **Cancel/delete cascade serial across cowork jobs** (2026-05-07 PM, `8528839`) | `/api/orders/{cancel,delete}` looped `await cancelJob(jobId)` sequentially → order with N cowork jobs took N×600ms blocking | `Promise.allSettled([...cancelJob calls])` parallelizes — N→1 wall-clock. Failures still surface per-job. Atomic Apps Script `cancelOrder` action deferred (Promise.allSettled removes 80% of pain). |
| **Spec-only order edit re-read full snapshot** (2026-05-07 PM, `8528839`) | `/api/orders/update` called `loadAllFresh()` even when only spec fields changed (no cascade rename needed) | Accept `srcOrder` snapshot from client; skip `loadAllFresh` when name+dateDue unchanged. Cascade rename still triggers fresh read when name/date does change. -600ms per spec-only edit. |
| **Order cancel/delete/promote-draft partial-failure surface** (2026-05-07 PM2, `c95c451`) | `Promise.allSettled` cascade ใน v2 ปิด race ของ N jobs แล้ว แต่ `cascade success → order status flip fail` ยังเหลือ 1 window. promote-draft ก็เหมือนกัน (alloc jobId + addJob success → status flip fail = orphan-incoming) | Apps Script v5.10.4 atomic actions ใน LockService scope เดียว: `cancelOrder`, `deleteOrderCascade`, `promoteDraft`. v2 routes try atomic first + fall through to legacy multi-call on `Unknown action` → no coordinated deploy needed. Orphan window now closed for full lifecycle. |
| **Data-audit page was non-actionable** (2026-05-07 PM2, `c95c451`) | v2 had a "ตรวจสอบข้อมูล" link that just filtered the list — couldn't recover orphans or remove duplicates like WP could | Port WP `openDataAuditModal` + `recoverOrphanOrder` + `removeDuplicateJob` (production-monitoring.js:5440-5660) → `app/orders/data-audit-modal.tsx`. Server-computes orphans + duplicates from same loadAll snapshot (no extra round-trip). Recovery via dept/staff dropdown → POST /api/jobs/add. |

---

## 10. Version History

> WP version history (v5.0 → v5.11) อยู่ใน [`monitoring.md` §10](../production-monitoring/monitoring.md). entries below are v2-specific milestones.

### Data audit modal + atomic order cascade — orphan prevention (2026-05-07 PM2, `c95c451`)
ปิด orphan window ของ cancel/delete/promote-draft flows ที่เคยมี partial-failure surface (cascade succeeded แต่ order status flip fail = order ค้าง 'sent' มี jobs cancelled). Atomic Apps Script v5.10.4 + data-audit modal port + fast-path-with-fallback v2 routes.

**Apps Script v5.10.4** (3 new actions in `production-monitoring/apps-script/dashboard/`):
- `cancelOrder` — cascade-cancel attached jobs + flip order status='cancelled' (admin only, single LockService scope)
- `deleteOrderCascade` — cascade-cancel + delete order row (admin only)
- `promoteDraft` — allocate jobId + append job + flip draft→sent atomic (admin+sales)
- Files: [write.ts](../production-monitoring/apps-script/dashboard/write.ts) (+200 lines), [api.ts](../production-monitoring/apps-script/dashboard/api.ts) (3 switch cases), [auth.ts](../production-monitoring/apps-script/dashboard/auth.ts) (`ROLE_REQUIREMENTS` updated)

**v2 changes**:
| Change | File |
|---|---|
| Data-audit modal (NEW) — orphan recovery + duplicate job removal | [app/orders/data-audit-modal.tsx](app/orders/data-audit-modal.tsx) |
| Fast path with fallback — try atomic action, fall through on `Unknown action` | [app/api/orders/{cancel,delete,promote-draft}/route.ts](app/api/orders/cancel/route.ts) |
| `PATHS_BY_ACTION` registers 3 new actions | [lib/api.ts](lib/api.ts) |

**Modal sections**:
- Orphan orders (status=sent without job/shipped/cancelled) → recovery dropdown (dept/staff) → POST `/api/jobs/add`
- Duplicate jobs (orderId+name groups with >1 row) → older row deletable → POST `/api/jobs/delete`
- Server-computed from same `loadAll` snapshot — no extra round-trip
- Replaces previous passive `<Link>` filter (was non-actionable)

**Orphan prevention final state**: ✅ all order lifecycle actions atomic in single lock — `createOrder`, `bulkForward`, `cancelJob`, `moveToShipped`, **`cancelOrder`**, **`deleteOrderCascade`**, **`promoteDraft`**. Remaining orphan sources: legacy data, manual Sheet edits, Apps Script outage mid-write. Data-audit modal = safety net.

**Pattern crystallized**: atomic-action-with-fallback deploy pattern — Vercel can ship before Apps Script redeploy by trying the new action and falling through on `Unknown action` error → no coordinated-deploy window required (PATTERNS §1.7 added).

### Lifecycle round-trip audit — hot-path cuts (2026-05-07 PM, `8528839`)
Audit pass บน order→ship lifecycle เจอ 7 friction points กิน 0.6-1.2s/interaction. Batch ปิดในรอบเดียว — cuts unnecessary `loadAllFresh()` reads + parallelizes cascade writes + instant pending feedback.

| Fix | File | Saving |
|---|---|---|
| `loadOrder(id)` wrapper for Apps Script `getOrder` action | [lib/api.ts](lib/api.ts) | single-row read ~200ms vs full snapshot ~600ms |
| Order detail "สเปคงาน" tab | [app/api/orders/raw/[id]/route.ts](app/api/orders/raw/[id]/route.ts) | 3× faster (loadOrder instead of loadAll) |
| "พิมพ์+สั่ง" popup fill | [app/orders/[id]/print/page.tsx](app/orders/[id]/print/page.tsx) | ~2.7s → ~1.6s (loadOrder + drop loadAll→loadAllFresh fallback) |
| Track lookup fresh-bypass | [app/api/track/lookup/route.ts](app/api/track/lookup/route.ts) | QR scan within 60s of order create no longer 404s (matches print page pattern) |
| Order spec-only edit | [app/api/orders/update/route.ts](app/api/orders/update/route.ts) | -600ms when name+dateDue unchanged — accepts `srcOrder` snapshot from client; skips `loadAllFresh` |
| Order cancel cascade | [app/api/orders/cancel/route.ts](app/api/orders/cancel/route.ts) | N×600ms sequential → ~600ms parallel via `Promise.allSettled` |
| Order delete cascade | [app/api/orders/delete/route.ts](app/api/orders/delete/route.ts) | Same as above — big win for orders with cowork-attached jobs |
| Order-form submit feedback | [app/board/order-form.tsx](app/board/order-form.tsx) | `useTransition`-wrapped `router.refresh()` lights up sidebar/bottom-nav pulsing dot |
| CoworkDialog instant feedback | [app/board/card.tsx](app/board/card.tsx) | close modal on click + toast progress + `commit()` — no more waiting with modal open |

**Pattern crystallized**: client-supplied snapshots > server re-reads (matches forward/reassign/bulk-forward — see PATTERNS §1.5). Atomic Apps Script `cancelOrder`/`deleteOrder` deferred — `Promise.allSettled` already removes the main pain point.

### Forward perf overhaul — A+B+C (2026-05-07)
- **`f9262a4`** — perf: skip `loadAllFresh()` in write routes (A) — frontend ships `srcJob` snapshot in body for `/api/jobs/forward`, `/api/jobs/bulk-forward`, `/api/jobs/reassign`. -1 Apps Script round-trip per write. Drag-drop carries snapshot via dataTransfer `application/x-job-snapshot`. Apps Script `bulkForward` auto-allocates ids when newJob.id is missing/0 + returns `succeeded: [{oldId, newId, name}]` (forward-compat hook).
- **`649005c`** + **`f715a42`** — perf: optimistic UI on /board (B) — new `components/board/pending-mutations.tsx` context with `Set<jobId>` of "hidden" cards. column.tsx filters `column.jobs.filter(j => !hiddenIds.has(j.id))`. Every mutation (forward, reassign, ship, cancel, bulk-forward, drag-drop) hides instantly + closes modal + shows toast. **Phantom-card injection** in destination column shows the card immediately at the new staff before SSR data lands. **Defer phantom cleanup** until `useTransition`-wrapped `router.refresh()` completes — eliminates the 1-2s flicker between optimistic state clearing and SSR data arriving.
- Result: forward perceived latency 2.5-6s → **0ms** matching WP UX. Apps Script round-trips 3 → 2.

### Order create perf — single-call action (2026-05-07)
- **`3ad9f01`** — perf: parallelize order create / update / promote-draft round-trips — `Promise.all` for the order + initial-job pair (~1.5s saved on cold path).
- **`a184254`** — perf: single-call `createOrder` Apps Script action — 1 round-trip vs 5 (under 2s end-to-end). New action in `write.ts` allocates orderId + initial jobId atomically + writes both rows in one batch. Vercel `/api/orders/add` now ships full payload in one POST.
- **`0b762cc`** — revert: temporarily disabled createOrder fast path after observing rows landing with empty details (later traced to edit-form prefill bug `8c5f97d`, NOT createOrder).
- **`c38c5c1`** — perf: re-enabled createOrder fast path after edit-form fix verified — order create back under 2s consistently.

### Order form / edit fixes (2026-05-07)
- **`2cb2863`** — fix: order-form orderer dropdown + drop assignStaff/forwardPrint mutual exclusion. Both fields now independently editable (matches WP behavior).
- **`8c5f97d`** — fix: order edit — date prefill bug (was reading wrong field path → blank), dual assign+forward fields preserved across edits, cancel button on edit page.
- **`c542d98`** — fix: replace PP placeholder with real Penprinting logo on A4 invoice.

### Print + PWA UX (2026-05-07)
- **`2a984ab`** — fix: open print popup synchronously on click (bypass popup blocker). `window.open()` AFTER `await fetch()` is rejected as non-user-initiated → open synchronously with placeholder URL, then swap `location.href` post-await.
- **`6667d87`** — fix: print page 404 — bypass loadAll cache for fresh orders. New orders < 60s old were 404'd by ISR cache. Added `dynamic = 'force-dynamic'` + `loadAllFresh()` fallback so print page always sees latest sheet data.
- **`5fd241f`** — fix: พิมพ์+สั่ง stays inside installed PWA — detect standalone via `display-mode: standalone` + `navigator.standalone` → use `router.push` instead of `window.open(_blank)` which bounces out to system Chrome.

### Order cancel UX (2026-05-07)
- **`79a8caf`** — feat: replace ลบใบสั่ง with ยกเลิกใบสั่ง in /orders detail modal. Cancel preserves the order row + cascades cancellation to active jobs (matches WP /orders behavior). Hard delete still available via /cancelled page admin restore + Apps Script editor only.

### Phase 2.1 Apps Script TS migration — close-out (2026-05-07)
- 4 sections moved to TS: [auth.ts](../production-monitoring/apps-script/dashboard/auth.ts), [load.ts](../production-monitoring/apps-script/dashboard/load.ts), [write.ts](../production-monitoring/apps-script/dashboard/write.ts), [api.ts](../production-monitoring/apps-script/dashboard/api.ts)
- `Code.js` 677 → 93 lines (-86%); only constants + section markers remain
- Type-check passes strict mode (`noImplicitAny` + `strictNullChecks`); pure refactor (zero behavior change)
- See [Tech-Roadmap-Status.md §Phase 2.1](../Tech-Roadmap-Status.md) for full migration table

### UI feedback close-out (2026-05-06 PM, late)
- **`20c584e`** — feat: lock /analytics + /orders permissions + monthly report dept detail
  - `/analytics` admin only / `/orders` admin+sales / `/api/orders/update` + `/orders/[id]/edit` admin only
  - Sidebar/bottom-nav `adminOrSalesOnly` + `adminOnly` flags via canSee() helper
  - Dept block click → modal "รวม | แยกตามช่าง" toggle (mirrors WP `openReportDeptList`)
  - `MonthlyReportDept` extended with `rows` + `rowsByStaff` precomputed
- **`55bd628`** — feat: /analytics — port WP รายงานประจำเดือน as default sub-tab
  - 2 sub-tabs: รายงานประจำเดือน (default, `?view=monthly`) + Analytics 12 เดือน (`?view=range`)
  - Monthly view: 3 sections (Executive Summary 7 stats with ▲/▼ vs prev / Customer Insights / Per-Dept)
  - `lib/analytics.ts computeMonthlyReport()` mirrors WP renderReport
- **`e2556ea`** — feat: /orders detail modal — full WP-style 3-tab + drop +งานเดี่ยว
  - 3 tabs: ข้อมูลหลัก / สเปคงาน / ประวัติ (matches Kanban card detail)
  - Lazy fetch via `/api/orders/raw/[id]` (relax to `requireSession()`)
  - Photobook items dedicated table
  - Drop "+ งานเดี่ยว" button from /board toolbar
- **`cf49eb2`** — refactor: drop landing splash — / redirects based on session

### Polish + observability (2026-05-06 PM)
- **`b385670`** — feat: brand favicon + QR on A4 invoice
  - `app/icon.png` + `app/apple-icon.png` from real logo
  - QR (60×60) on `/orders/[id]/print` header → `/track?id=<id>`
- **`1778a8c`** — feat: Sentry wiring (server + edge + client + global error boundary)
  - `instrumentation.ts` + 3 config files + `app/global-error.tsx`
  - Bundle cost: +78 KB shared chunk, +67 KB middleware
- **`0c662c5`** — feat: per-user audit signing
  - `lib/api.ts` ships `_actor: "<role>:<user>"` from session cookie
  - Apps Script side honors override (v5.10.1)
- **`beaeb34`** — fix: remove leftover Next.js default favicon.ico
- **`154b8f5`** — docs: split monitoring.md — add dashboard-v2.md as v2 source of truth

### Sidebar perf overhaul (2026-05-06 PM)
- **`162a3e1`** — perf: stream /board with Suspense
- **`497ef7a`** — perf: stream remaining 5 pages with Suspense
- **`5d685a7`** — perf: scope revalidatePath per-action
- **`28e10d5`** — revert: drop loading.tsx skeletons (caused page-flash)
- **`40508c0`** — perf: instant nav feedback (sidebar useTransition + pulsing dot)

### Audit close-out — 4 batches (2026-05-06 PM)
- **`b1789c5`** — chore: audit batch 4 — cosmetic cleanup (5 Low)
- **`cae8294`** — fix: audit batch 3 — Medium tier (perf + security + TZ + data)
- **`07287e4`** — fix: audit batch 2 — UX + middleware (3 Medium)
- **`5996fac`** — fix: audit batch 1 — Critical M14r + 5 High regressions

Total: 17/18 audit findings closed (1 false positive). Apps Script side requires `push.sh` redeploy for batch 3 + per-user audit (commit `0c662c5`).

### Phase 3.5.10 + 3.5.11 — WP parity + audit (2026-05-06)
30+ commits — see commit log between `f06cd58` (Phase 3.5.5b/3.5.7b) and `c424989` (audit batch 1 entry point).

Highlights:
- WP-parity card actions + inline order entry + drafts + templates UI
- /orders /shipped /cancelled with year/month + CSV + restore + tracking-card
- New routes: `/orders/[id]/{edit,print,tracking-card}`, `/track`, `/api/track/lookup`
- Toast/Confirm providers replacing native dialogs
- Drag-drop reassign + cross-dept forward via custom MIME
- Cowork string[] format + guest fan-out (violet)
- Customer autocomplete + lazy raw fetch + duplicate detection
- KPI clickable + per-page selector
- Critical/High audit fixes (C1-C5, H1, H2, H10)

### Phase 3.5.1-3.5.8 + 3.5.5b/3.5.7b (2026-05-04 → 05)
- Phase 3.5.1-3.5.5: Kanban scaffold, computeBoard, filters, columns, cards
- Phase 3.5.6: forward + bulk forward + same-dept reassign
- Phase 3.5.7: cowork edit (multi-row repeater)
- Phase 3.5.8: auto-sync polling + cross-tab BroadcastChannel
- Phase 3.5.5b: photobook tab + edit mode + duplicate detection
- Phase 3.5.7b: undo forward

### Phase 3.1-3.4 (2026-05-04)
- 3.1: scaffold (Next.js 14 + cookie auth + Vercel)
- 3.2: Analytics port (KPIs + 4 charts via recharts)
- 3.3: Calendar port (month grid + mobile vertical)
- 3.4: Archive port (search archive sheets)

---

## 11. Deploy

### Vercel auto-deploy
```bash
git push origin main          # Vercel auto-deploys (~60-90s)
```

### Pre-push checklist
```bash
npm install                   # if package.json changed
npx tsc --noEmit              # type-check
npm run build                 # verify production build (catches Sentry/SSR issues)
```

### Coordinated changes (Apps Script + Vercel)
For commits that touch both `lib/api.ts` (or any v2 mutation route) AND `production-monitoring/google-apps-script.js`:
1. **Apps Script first** (else dashboard pings the new action and gets "Unknown action: ..."):
   ```bash
   cd "../production-monitoring/apps-script/dashboard"
   ./push.sh
   ```
   Then in Apps Script editor → Manage deployments → ✏️ Edit existing → New version
2. **Vercel after** (`git push origin main`)

Backwards-compat fallbacks should be in v2 routes (e.g. bulk-forward catches "Unknown action" and falls back to N×getNextId loop) — but ordering still matters for performance.

### Env vars (Vercel project settings)
| Var | Required | Purpose |
|---|---|---|
| `APPS_SCRIPT_URL` | yes | Dashboard Apps Script web app URL |
| `APPS_SCRIPT_TOKEN` | yes | service token (5y, signed by Apps Script `API_SECRET`) |
| `DASHBOARD_AUTH_SECRET` | yes | random ≥32 chars (cookie HMAC) |
| `DASHBOARD_AUTH_USERS` | yes | JSON map password → {role, user} |
| `NEXT_PUBLIC_APP_VERSION` | optional | shown in sidebar footer + Sentry release tag |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | error tracking (disabled when missing) |
| `SENTRY_ORG` | optional | source-map upload target |
| `SENTRY_PROJECT` | optional | source-map upload target |
| `SENTRY_AUTH_TOKEN` | optional | source-map upload (encrypted) |

### Local dev
```bash
npm run dev                   # localhost:3000
```

### Preview deploys
Every PR to `main` gets a Vercel preview URL. Same env vars (or `.env.preview` overrides) apply.

---

## 12. Subagents

- **`penprinting-deployer`** — `/deploy` slash command. Vercel auto-deploys on push, but the agent also updates monitoring.md / dashboard-v2.md / NEXT-SESSION.md as part of the wrap-up.
- **`penprinting-auditor`** — `/audit` after non-trivial feature work. Returns severity-categorized findings; appends to [`AUDIT-BACKLOG.md`](AUDIT-BACKLOG.md).
- ❌ **NOT** `penprinting-data-doctor` — Sheet ตัวเดียวกับ WP, ใช้กับ `production-monitoring/` แทน.

---

## 13. Where to dig

| ต้องเข้าใจอะไร | ดูที่ไหน |
|---|---|
| Apps Script API patterns (atomic, ID alloc, fresh-vs-cached loadAll) | [PATTERNS.md §1](PATTERNS.md) |
| Permission gating (route-level vs Apps Script `ROLE_REQUIREMENTS`) | [PATTERNS.md §2](PATTERNS.md) |
| URL state / Context patterns | [PATTERNS.md §3](PATTERNS.md) |
| Iconography (lib/icons.tsx) | [PATTERNS.md §4](PATTERNS.md) |
| Form patterns (`<dialog>`, repeater, edit-mode) | [PATTERNS.md §5](PATTERNS.md) |
| Toast / Confirm system | `components/{toast,confirm}-provider.tsx` |
| Auto-sync + write cache-bust | `lib/auto-sync.tsx` + `lib/api.ts` |
| Apps Script source (TS migration in progress) | `../production-monitoring/apps-script/dashboard/*.ts` + `Code.js` |
| WP source (reference) | `../production-monitoring/assets/production-monitoring.js` |
| Sheet schema + Order ID generation | [monitoring.md §4](../production-monitoring/monitoring.md) |
| Recurring failure modes (shared with WP) | [monitoring.md §8](../production-monitoring/monitoring.md) |
| Migration progress / Phase tracking | [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) |
