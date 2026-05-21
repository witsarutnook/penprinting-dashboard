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
`useAutoSync` hook polls on adaptive backoff (15s active → 30s → 120s after 5 min idle → **hard-stop after 30 min idle**, resumes on input / re-visibility) + listens to `BroadcastChannel('pp_dashboard_sync')` (same channel name as WP — they cross-pollinate). Guards: skip when dialog open / typing / dragging / page hidden.

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
| **React.memo with default shallow comparator stops working when parent re-renders fresh refs** (2026-05-07 afternoon, `3cb4501`) | Auto-sync ticks → parent gets fresh `jobs[]` from SSR → every Card prop ref changes → React.memo's default shallow check fires re-render on all 50 cards even when display fields are identical | Provide explicit `arePropsEqual` field-level comparator on Card (job.id, name, dept, staff, dateDue, dateIn, status, cowork ids, orderId — the fields that actually drive render). Internal context updates (BulkMode/PendingMutations) still re-render via hook subscriptions, so optimistic UI keeps working. |
| **JobForm modal-open feedback laggy** (2026-05-07 afternoon, `3cb4501`) | Form posted, awaited Apps Script response, then closed modal → 400ms perceptible "stuck open" feel | Optimistic close: close modal on submit click + show toast progress ("กำลังบันทึก…") + `commit()` in-flight → 0ms close. Mirrors CoworkDialog pattern from PM batch. |
| **Mobile users had no logout reachable** (2026-05-07 afternoon, `95c0cb8`) | Bottom nav showed dept items only; sidebar (with logout) was `md:hidden`. Logging out required desktop or hard cookie clear | Floating top-right `IconUser` button (`md:hidden`) → bottom sheet with avatar + name + role + /track link + logout. + bottom nav reserves rightmost slot for hamburger sheet that exposes "More" items normally hidden in `getMoreMenuGroups(role)`. |
| **Auto-sync polled 15s every minute even on idle tabs** (2026-05-07 afternoon, `1d6e57f`) | Fixed `setInterval(15000)` → user leaves tab idle for hours → still 4 reqs/min × hours = quota burn for nothing | Smart backoff: self-rescheduling `setTimeout`. Tracks last-activity via passive pointerdown/keydown/wheel/touchstart. Schedule: 15s active → 30s after 2-10min idle → 60s after >10min idle. Pre-existing visibility-aware skip retained. ~75% Apps Script quota cut on idle tabs. |
| **/analytics First Load JS too big from recharts** (2026-05-07 afternoon, `1d6e57f`) | recharts (~110KB) bundled with /analytics page even though only admin opens it and not on first paint | `next/dynamic({ ssr: false })` lazy-load via `app/analytics/charts-lazy.tsx`. /analytics First Load: 295KB → 181KB (-39%). Same pattern applied to OrderForm + JobForm in /board card.tsx (modal chunks fetch on first ✏️ click). |
| **/track v2 didn't match WP look** (2026-05-07 afternoon, `ce611b1` + `fe0b38e`) | Original v2 /track was minimal text + placeholder layout — customers used to WP's 6-step timeline saw a regression | Port WP page-track-order.php look: `currentDept` returned from `/api/track/lookup` so client positions step, white card on cream BG, 6-step vertical timeline (received → graphic → print → post → ready → shipped), pill badges with 5 variants, contact box with `tel:` link. Charcoal-only accents (no blue) for minimal mood; semantic colors retained for done/cancelled/overdue/received. |
| **Apps Script payload included audit_log on every page render** (2026-05-07 afternoon, `3cb4501`) | `loadAll()` always returned `recentAudit` for /board and friends even though only /analytics consumed it | Apps Script `loadAll(opts?: { audit?: boolean })` (load.ts) + api.ts switch threads `e.parameter.audit !== '0'`. Default unchanged for backwards compat. Vercel `lib/api.ts` `loadAll()` passes `audit=0` (saves 50-100KB per call); new `loadAllWithAudit()` for /analytics. |

---

## 10. Version History

> WP version history (v5.0 → v5.11) อยู่ใน [`monitoring.md` §10](../production-monitoring/monitoring.md). entries below are v2-specific milestones.

### ID-allocation → Postgres (2026-05-21)

**Goal:** ตัด Apps Script ออกจาก critical path การสร้าง order/job. จาก diagnose order-submit latency — กด "ส่งใบสั่งงาน" 2-3 วิ, ~80-90% หมดกับ Apps Script ID round-trip (`getNextOrderId` + `getNextId`).

**กลไก:** ตาราง `counters(key, value)` — mint ด้วย `UPDATE counters SET value = value + N ... RETURNING` (atomic row-lock; concurrent mint serialize บน row เดียว — ดีกว่า Apps Script LockService ที่ lock ทั้งแอป). Job id = monotonic counter ล้วน (**ห้าม MAX-derive** — job ถูก hard-delete ตอนย้าย shipped/cancelled → MAX ต่ำกว่า id ที่เคยใช้). Order id = `YYYYMMNNN` per-month + cross-check `MAX(orders.id)` ของเดือน (orders ไม่เคยลบ → MAX เชื่อถือได้; Bangkok-TZ prefix).

**ไฟล์:** ใหม่ [`lib/id-allocation.ts`](lib/id-allocation.ts) (`mintJobId`/`mintJobIds`/`mintOrderId`) · [`/api/admin/seed-id-counters`](app/api/admin/seed-id-counters/route.ts) (raise-only seed) · `counters` table ใน db-migrate. branch 6 routes ด้วย flag `ALLOCATE_IDS_IN_POSTGRES` — orders/add · promote-draft · jobs/add · forward · forward-undo · bulk-forward. แผนเต็ม + risk table: [migration-plan-id-allocation.md](migration-plan-id-allocation.md).

**Rollout (2026-05-21):** db-migrate → seed (`nextId`=740, verified ตรง Sheet `config.nextId`) → flag ON + redeploy → smoke ✅ — job `740`, order `202605145`, ไม่มี ID ชน, ส่งใบสั่ง 2-3 วิ → ~0.3-0.6 วิ (คุณนุ๊กยืนยัน).

**PIN/QR ไม่กระทบ:** PIN เป็นเลขสุ่ม ไม่เกี่ยว counter · QR เข้ารหัสแค่ order id (`track?id=`) — format `YYYYMMNNN` คงเดิม → QR เก่า/ใหม่ใช้ได้หมด.

**Rollback:** Apps Script `config.nextId` ค้างค่าเดิม → ก่อนปิด flag ต้องแก้ cell `config.nextId` ใน Sheet = ค่า Postgres `counters.nextId` ปัจจุบัน. order id self-heal เอง (`getNextOrderId` cross-check Sheet).

**ค้าง:** soak ~1 สัปดาห์ → Step 7 retire (`getNext*` Apps Script). **Tests:** +10 ([`tests/id-allocation.test.ts`](tests/id-allocation.test.ts)) — total 112→122.

---

### Delta-fetch P3 — client refactor (2026-05-21)

**Goal:** ปิดงาน delta-fetch — ทำ `/board` ให้ client-driven: server ส่ง bootstrap snapshot, client ถือ state เอง + delta-poll แทน `router.refresh()` รายตึ๊ก. Flag-gated (`NEXT_PUBLIC_DELTA_FETCH`) — OFF = path เดิมไม่แตะเลย.

**สถาปัตยกรรม (flag ON):**
`page.tsx` (server, auth) → `<Suspense>` → `BoardDataDelta` (server: `loadBoardDelta(null)` = jobs+orders+serverTime) → `<BoardClient>` (client: ถือ state + render kanban ทั้งหมด)

**ไฟล์ใหม่:**
- [`lib/poll-schedule.ts`](lib/poll-schedule.ts) — แยก backoff constants + `refreshGuard` ออกจาก `auto-sync.tsx` (pure, ไม่มี React/next) → `useDeltaSync` reuse cadence เดิมได้ + `mergeDelta` unit-test ไม่ลาก Next runtime
- [`lib/delta-sync.tsx`](lib/delta-sync.tsx) — `useDeltaSync(initial)` hook (poll loop + adaptive backoff + 30-min hard-stop + BroadcastChannel + visibilitychange + `pollNow()` coalesced) + `mergeDelta()` pure function
- [`app/board/board-client.tsx`](app/board/board-client.tsx) — `BoardClient`: `useSearchParams`→filters, `useMemo(computeBoard)`, render providers + KPIBar + toolbar + Columns + BulkBar

**ไฟล์แก้:** `auto-sync.tsx` (import จาก poll-schedule) · `board.ts` (`computeBoard` รับ `Pick<…,'jobs'|'orders'>`) · `pending-mutations.tsx` (`commit()` รับ prop `pollNow?`) · `page.tsx` (flag branch + `BoardDataDelta`)

**กลไกสำคัญ — BroadcastChannel same-tab delivery:** ทุก mutation เรียก `broadcastWrite()` อยู่แล้ว. channel ชื่อเดียวกัน deliver ถึงทุก instance ยกเว้นตัวส่ง → `useDeltaSync` ที่ฟัง channel **รับ event ของ tab ตัวเองด้วย** → poll ทันที. ผล: card/column/job-form/bulk/order-form/undo writes refresh delta board **โดยไม่ต้องแก้ไฟล์พวกนั้นเลย**. มีแค่ `commit()` ที่ต้อง delta-aware (`pollNow().then(cleanup)`) เพราะ phantom-card cleanup ต้อง time ให้ตรงกับ merge.

**Filtering ย้ายมา client-side:** `BoardClient` อ่าน `?dept=/?u=/?q=` จาก `useSearchParams` → `computeBoard` re-bucket ทันที ไม่มี server round-trip / skeleton flash. (flag-OFF path ยัง filter server-side + Suspense filter-key เหมือนเดิม.)

**ปิด audit:** **PA-H2** (bootstrap อ่าน 2 ตาราง ไม่ใช่ `loadAll` 5 ตาราง) · **PA-M2** (`mergeDelta` คืน state ref เดิมเมื่อ delta ว่าง → idle tick ไม่ re-render). **PA-L1** (loadOrder over-fetch) ยัง open — minor, แยก session.

**Tests:** +12 (`tests/delta-sync.test.ts` — `mergeDelta`: upsert/tombstone/no-op ref-identity/ordering/combined). type-check + lint + build + test (100→112) ผ่าน Node 22.

**Deferred cleanup:** `router.refresh()` ใน `order-form.tsx` (×4) + `undo-context.tsx` (×1) กลายเป็น no-op ในโหมด delta (state เป็น client-owned, props ignore) — ไม่มีพิษ (`broadcastWrite`→channel→poll จัดการ update แล้ว) แค่เปลือง server round-trip 1 ครั้งต่อ order create/promote/undo. ลบทีหลังเมื่อ flag ON เสถียร.

**Lessons:**
- **`router.refresh()` = no-op ใน component ที่ owns state ผ่าน `useState(initialProp)`** — `useState` ใช้ initial value แค่ตอน mount, prop เปลี่ยนทีหลังถูก ignore. ย้าย source-of-truth มาฝั่ง client แล้วต้องมี imperative trigger (`pollNow`) แทน server re-render
- **`broadcastWrite()` deliver ถึง tab ตัวเอง** — ใช้ channel listener เป็นจุดรวม refresh ได้ ไม่ต้องไล่แก้ N call sites
- **`[...map.values()]` ต้อง `Array.from(map.values())`** — tsconfig target นี้ไม่รองรับ MapIterator spread (type-check จับทันที)

**⏳ Pending user action:** ต้องตั้ง `NEXT_PUBLIC_DELTA_FETCH=1` ใน Vercel + redeploy เพื่อเปิดโหมด delta จริง (ทำ**หลัง** P3 deploy เสร็จ — flag เป็น `NEXT_PUBLIC_` bake ตอน build, เปิดก่อนมี `BoardClient` = build พัง).

---

### Delta-fetch foundation — P1+P2 (2026-05-20)

**Goal:** เริ่มงาน delta-fetch ที่ deferred ไว้จาก 2026-05-18 (ตัด Sheet ก่อน → delta-fetch trivial). Session นี้ลง P1 (schema + bump triggers) + P2 (delta endpoint + tests) — P3 client refactor (`/board` ใช้ delta แทน `router.refresh()`) ไว้ session หน้า.

**P1 — Schema + triggers** ([`app/api/admin/db-migrate/route.ts`](app/api/admin/db-migrate/route.ts)):
- เพิ่ม `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` + `idx_*_updated_at` ใน jobs/orders/shipped/cancelled
- 2 trigger functions:
  - `bump_updated_at_jobs()` — bump เมื่อ `OLD.raw IS DISTINCT FROM NEW.raw` OR `OLD.phase2_deleted_at IS DISTINCT FROM NEW.phase2_deleted_at`
  - `bump_updated_at_raw()` — bump เฉพาะ `OLD.raw IS DISTINCT FROM NEW.raw` (orders/shipped/cancelled ไม่มี phase2_deleted_at)
- 4 BEFORE UPDATE triggers (1 ต่อตาราง) — `DROP IF EXISTS` + `CREATE` รูปแบบ rerunnable
- **ทำไมไม่ reuse phase2_dirty_at:** column นั้น clear กลับเป็น NULL ตอน heal-cron sync สำเร็จ = "needs heal" signal ไม่ใช่ "what changed" cursor
- **ทำไม conditional bump:** heal-cron `UPDATE jobs SET phase2_dirty_at = NULL` ไม่แตะ `raw` → trigger เห็น `OLD.raw IS NOT DISTINCT FROM NEW.raw` → ไม่ bump (housekeeping write ไม่ pollute cursor)
- INSERT paths ไม่ต้องแก้ — `DEFAULT NOW()` คุม 8 INSERT INTO ใน `postgres-write.ts` อัตโนมัติ

**P2 — Delta endpoint** ([`lib/board-delta.ts`](lib/board-delta.ts) + [`app/api/board/delta/route.ts`](app/api/board/delta/route.ts)):
- `GET /api/board/delta?since=<iso>`
- `since` = null → full snapshot (active jobs + all orders) — สำหรับ bootstrap
- `since` = ISO → 3 query ขนาน:
  1. jobs ที่ `updated_at > since AND phase2_deleted_at IS NULL` (active changes)
  2. orders ที่ `updated_at > since`
  3. jobs ids ที่ `phase2_deleted_at > since` (tombstones — return เป็น `deletedJobIds`)
- mutually exclusive (`IS NULL` vs `IS NOT NULL > since`) → row อยู่ใน bucket เดียว
- `serverTime` snapshot **ก่อน** queries (write ที่ land ระหว่าง query รับใน delta ถัดไป — ไม่ lose)
- Tests: 9 new (full snapshot · delta · param binding · type coercion · serverTime timing). Total 91→100 ผ่าน Node 22.

**Phase 4.2 reliance:** cutover (2026-05-18) ทำให้ `updated_at` เป็น authoritative cursor — jobs/orders/shipped/cancelled cron OFF, dual-write mirror ลบไป Sheet edits ไม่ leak past cursor. ถ้ายังเปิด cron + mirror ตอนนี้ delta จะ miss Sheet-direct edits.

**ค้าง — P3 client refactor (session หน้า):**
- Refactor `/board` → hybrid: server ส่ง initial snapshot, client maintain state
- `useDeltaSync(initialSnapshot)` hook poll `/api/board/delta?since=<lastServerTime>` + merge
- Replace `router.refresh()` ใน /board (เก็บไว้สำหรับหน้าอื่น)
- Feature flag `NEXT_PUBLIC_DELTA_FETCH=1` rollout
- เสร็จ P3 = ปิด PA-H2 (over-fetch) · PA-M2 (parent re-render churn) · PA-L1 (loadOrder over-fetch) ทีเดียว

**Pending user action:** หลัง deploy ต้อง `curl https://dashboard.penprinting.co/api/admin/db-migrate` (admin session) เพื่อ apply schema. Idempotent — ปลอดภัยถ้ารัน 2 ครั้ง.

### Performance audit + PA-H1/PA-M3 fixes (2026-05-19)

**Audit:** perf-only scan ผ่าน `penprinting-auditor` หลัง Phase 4.2 close-out — 0 critical · 2 high · 3 medium · 1 low. hot path สภาพดี (cache coalescing, recharts route-split, card lazy-loading verified clean). ผลเต็มใน [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) section "Perf audit — 2026-05-19".

**PA-H1** ([`c43999b`](https://github.com/witsarutnook/penprinting-dashboard/commit/c43999b)) — `useAutoSync` backoff (15s→30s→120s) ไม่เคยถึง 0 → tab เปิดทิ้งข้ามคืน fire `router.refresh()` ~720 ครั้ง/คืน (server re-render + stream board HTML กลับทุกครั้ง). เพิ่ม **hard-stop**: idle > 30 นาที หยุด poll สนิท (`stopped` flag — `tick()` ไม่ reschedule), `resumeIfStopped()` restart timer + refresh ทันที 1 ครั้งเมื่อ user input / tab re-visibility.

**PA-M3** ([`f82734f`](https://github.com/witsarutnook/penprinting-dashboard/commit/f82734f)) — `loadAllSnapshot` Apps Script fallback เรียก `get('loadAll')` ด้วย default `fetch` cache 60s ขณะรันใน `loadAllCached` (`unstable_cache` 15s + tag) = cache ชั้นที่ 2 ที่ไม่ถูก tag → `revalidateTag(LOAD_ALL_TAG)` บัสต์ไม่ถึง → write ตอน Postgres ล่มไม่โผล่ ≤60s. แก้: pass `{ revalidate: 0 }` → outer `unstable_cache` เป็น cache + invalidation ชั้นเดียว.

**ปิดเพิ่ม (no code change):** `M1-card-memo-deep-compare` = **invalid** (บรรยายโค้ดที่ PERF-C1 ลบไปแล้ว 2026-05-12 — comparator ปัจจุบันเป็น flat primitive compare) · `PA-M4-auditlog-index` = **verified clean** (index `idx_audit_target` มีอยู่ใน `db-migrate` route แล้ว, planner ใช้ BitmapOr index scan ไม่ seq-scan).

**Deferred:** PA-H2 (loadAll over-fetch 5 ตาราง) · PA-M2 (KPIBar/BoardToolbar ไม่ memo) · PA-L1 (loadOrder over-fetch) — bundle ไปทำพร้อม delta-fetch.

### Phase 4.2 close-out Stage 1-4 + cutover (2026-05-18)

**Context:** session เริ่มจะทำ delta-fetch (board auto-sync) แต่คุณนุ๊กตัดสิน — ถ้าตัด Sheet ออกจากระบบก่อน delta-fetch จะ trivial (ไม่มี TRUNCATE+INSERT cron รีเซ็ต cursor / ไม่มี Sheet-direct edit ที่ delta มองไม่เห็น) → **เร่ง Phase 4.2 close-out** เป็นแผน 6 stage. delta-fetch deferred จนกว่า close-out เสร็จ.

**แผน 6 stage:** S0 ✅ · **S1** ✅ · **S2** ✅ + cutover · **S3** ✅ · **S4** ✅ · S5 ลบ WRITE_* flag scaffolding (soak ≥1 สัปดาห์) · S6 docs. หลัง cutover = Postgres sole source of truth, ไม่มี Sheet safety-net.

**Stage 1** ([`fe4e238`](https://github.com/witsarutnook/penprinting-dashboard/commit/fe4e238)) — migrate 3 write route สุดท้ายที่ยัง Apps Script-only ให้ Postgres-first (prerequisite ของ S2 หยุด cron + S4 ลบ mirror). roadmap เขียนว่า 3 ตัวนี้เป็น "dead UI path" — **ผิด**, reachable จริง:
- `deleteJob` — `deleteJobInPostgres` tombstone (reuse `phase2_deleted_at` + `healJobsTombstone` — ไม่มี Apps Script action ใหม่). UI: /orders → "ตรวจสอบข้อมูล" modal → Duplicate jobs → "ลบ row นี้"
- `restoreJob` — `restoreJobInPostgres` (upsert jobs clear tombstone/dirty + delete cancelled) + ยังเรียก `post('restoreJob')` sync Sheet เพราะ `cancelled` ไม่มี tombstone column/heal path. UI: /cancelled
- `forwardUndo` — route ผ่าน `bulkForwardInPostgres` + เพิ่ม cowork pass-through (เดิม `bulkForwardInPostgres` drop cowork = regression ของ undo; forward ยัง clear cowork เหมือนเดิมเพราะ caller ไม่ส่ง)
- 3 flag ใหม่ `WRITE_{DELETE_JOB,RESTORE_JOB,FORWARD_UNDO}_TO_POSTGRES` (default off — deploy พฤติกรรมเหมือนเดิมจนกว่าจะ set). test 76→87, type-check/lint/build ผ่าน (Node 22)
- **flags ON ใน Production** (คุณนุ๊ก set + redeploy เอง — ข้าม Preview). smoke prod: restore ✅ undo ✅; deleteJob ข้าม (ต้องมี duplicate job ถึง trigger + เสี่ยงต่ำสุด)

**Stage 2** ([`9678ab1`](https://github.com/witsarutnook/penprinting-dashboard/commit/9678ab1)) — the core cutover, shipped behind a flag OFF. `phase2OwnsTable()` คืน true ให้ jobs/orders/shipped/cancelled เมื่อ `PHASE2_OWNS_CORE_TABLES=1`; from-Sheet cron orchestration refactor ผ่าน helper `syncOrSkip` — flag ON → skip sync 4 ตาราง + `recordSyncMetaTouch` (Sheet ทับ Postgres-authoritative row ไม่ได้อีก; audit_log ยัง sync จาก Sheet เสมอ). flag **default OFF → deploy พฤติกรรมเหมือนเดิม** (cron วิ่งปกติ). flip ON = cutover (Postgres = sole source of truth, heal cron เป็น Postgres→Sheet path เดียว); flip OFF = revert (cron resume, `deleteCleanThenInsert` preserve dirty rows → ไม่เสีย Phase 2 write). **Cutover ทำแล้ว 2026-05-18** — `PHASE2_OWNS_CORE_TABLES=1` ON ใน prod (Stage 0 pre-flight ผ่าน — diagnose-board layer5_sync_meta เขียวหมด), verified ผ่าน `/api/admin/sync-all`: jobs/orders/shipped/cancelled/templates = `skipped`, audit_log sync ปกติ.

**Stage 3** ([`8043990`](https://github.com/witsarutnook/penprinting-dashboard/commit/8043990)) — หลัง cutover, `found:false → Apps Script` fallback กลายเป็น data-loss path (from-Sheet cron ไม่ import jobs/orders แล้ว → Sheet-only write หายเข้า Sheet ไม่กลับมา Postgres). ตัด fallback ใน 7 route (jobs: update/delete/reassign/move-to-shipped/cowork · orders: update/promote-draft) → ตอบ **409** "refresh แล้วลองใหม่" แทน (found:false post-cutover = stale-client race จริง). orders/cancel คืน 404 row-missing อยู่แล้ว — ไม่แตะ. flag-OFF legacy branch ยังอยู่ (ลบ Stage 5).

**Stage 4** ([`2a52a64`](https://github.com/witsarutnook/penprinting-dashboard/commit/2a52a64)) — ลบ Phase 1.7 dual-write mirror: ลบไฟล์ `lib/postgres-write-mirror.ts` (-425 บรรทัด) + ตัด `mirrorWriteToPostgres` block จาก `post()` ใน `lib/api.ts`. หลัง S1 (migrate 3 route) + S3 (ตัด fallback) ไม่มี route ไหนพึ่ง mirror — restore เขียน Postgres ผ่าน `restoreJobInPostgres` ตรง. **Residual (ปิดใน S5):** promote-draft existingJob recovery sub-path ยัง flip status ผ่าน `post('updateOrder')` = Sheet-only — rare มาก (ต้องมี draft order + orphan job ค้างอยู่ก่อน, residue ของ partial-failure เก่า).

### Postgres network-transfer fix — cache coalescing (2026-05-18)

**Diagnosis (`/diagnose`):** Neon network transfer 5.63 GB/8 วัน (DB จริง 40 MB). root cause: `useAutoSync` → `router.refresh()` ทุก 15-60 วิ → re-run server component → `loadAll()` → `loadAllFromPostgres` query Postgres สดทุก tick · ไม่มี cache · staff หลายคนเปิด board เดียวกัน = ดึง snapshot เหมือนกันซ้ำ N รอบ. วัด `pg_column_size(raw)`: orders = 79% ของ snapshot → ตัด table ไม่ช่วย, ตัวคูณคือ frequency. cron ตัดออก (sync-from-sheet = TRUNCATE+INSERT = ingress ไม่ใช่ egress).

**Fix — 2 lever:**
- **Cache coalescing** ([`lib/api.ts`](lib/api.ts)) — `loadAll()`/`loadAllWithAudit()` ห่อ `unstable_cache` TTL 15 วิ + tag `LOAD_ALL_TAG`. staff N คน auto-sync พร้อมกัน → 1 query/15วิ แทน N. Invalidation: `post()` (Apps Script writes) + 14 Phase-2 write routes เพิ่ม `revalidateTag('load-all')` → write เสร็จ board สดทันที (ไม่รอ TTL).
- **Frequency tuning** ([`lib/auto-sync.tsx`](lib/auto-sync.tsx)) — long-idle เข้าหลัง 5 นาที (เดิม 10) @ 120 วิ (เดิม 60). active 15 วิ คงไว้.
- คาดลด egress ~85-90% (~21 GB/เดือน → ~2-3 GB)
- ⚠️ ยังเป็น poll-the-world architecture — cache แค่บรรเทา. proper fix = push (SSE/WebSocket) หรือ delta-fetch → improvement ระยะยาว แยก project
- ไม่มี unit-test seam (`unstable_cache` = Next infra) — verify ด้วย build + Neon transfer graph + board ยัง update หลัง write

### Postgres quota incident + print-page 404 fix (2026-05-18)

**Incident:** `createOrder` ล้มด้วย HTTP 402 — Neon (Vercel Postgres) **network transfer 5.63/5 GB เกินโควตา Free plan** (usage since May 10 — DB จริงแค่ 40 MB แต่โอน 5.6 GB ใน 8 วัน). อ่านยังได้ (loadAll auto-fallback ไป Apps Script) แต่ Phase 2 writes ไม่มี fallback → เขียนไม่ได้ทั้งระบบ. แก้เฉพาะหน้า: คุณนุ๊ก upgrade Neon → Launch plan → unblock ทันที.

**ตามด้วย print-page 404** — สร้าง order ใหม่หลัง upgrade แล้วกด "พิมพ์+สั่ง" ขึ้น 404 (ครั้งแรกหลัง upgrade, retry แล้วหาย). `/diagnose` → root cause: `loadOrderFromPostgres` มี `checkStaleness(['orders'])` **pre-gate** — ตอน quota หมด `sync-from-sheet` cron 402 fail → `sync_meta.orders` stale → gate throw `PostgresStaleError` **ทั้งที่ order อยู่ใน Postgres แล้ว** → `loadOrder()` fallback ไป Apps Script → order ใหม่ยังไม่ sync ลง Sheet → `notFound()`.

**Fix** ([`lib/api-postgres.ts`](lib/api-postgres.ts)) — ตัด `checkStaleness` pre-gate ออกจาก `loadOrderFromPostgres`. เหตุผล: Phase 2 ทุก write path commit Postgres-first → Postgres row คือ source of truth ของ order นั้น ไม่ว่า cron mirror จะสดแค่ไหน. fallback signal เดียวที่ต้องสนใจคือ "order ไม่อยู่ใน Postgres เลย" (row-not-found throw ที่มีอยู่แล้ว). เป็น instance ที่ 2 ของ anti-pattern เดียวกับที่ refactor 2026-05-12 ลบไป (gate Postgres-authoritative read ด้วย mirror staleness). Regression test `tests/api-postgres.test.ts` (4 tests) — suite 72→76.

⚠️ **ค้าง:** diagnose data-integrity fallout (sync recover ครบมั้ย) + diagnose/optimize network transfer (5.6GB/8วันผิดปกติ — loadAll ดึงทั้ง snapshot ทุก page + auto-sync + sync cron).

### Morning Report ported off Apps Script — fix double-fire (2026-05-18)

**Bug:** flex แจ้งงานด่วนส่งเข้ากลุ่ม LINE 2 รอบทุกเช้า. `/diagnose` → root cause: Apps Script time trigger `morningReport` ค้างไม่ได้ลบหลัง migrate ไป Vercel cron (pending action ค้างมาตั้งแต่ 2026-05-10) — dedup window 5 นาทีแคบเกินกว่า window ที่ trigger สองตัว fire ห่างกัน (เช้า 18 พ.ค. ห่างกัน 5:11 — พลาดไป 11 วินาที). Ghost trigger `sendMorningReport` (handler รุ่นเก่า) ก็ค้างอยู่ด้วย fail 100%. User ลบ trigger ทั้ง 2 อันออก.

**Fix (proper):** drop Morning Report Apps Script ทั้งโปรเจกต์ — port logic ทั้งหมดเข้า v2:
- [`lib/morning-report.ts`](lib/morning-report.ts) — port urgency bucketing (overdue/D-Day/urgent ≤3 วัน) + LINE Flex carousel builders + LINE push. ดึงข้อมูลผ่าน `loadAll()` (Postgres-first, Apps Script fallback) — ไม่มี HTTP hop แยก. วันที่ทั้งหมด snap เป็น Bangkok-calendar 00:00 UTC ให้ day-diff ตรง.
- [`app/api/cron/morning-report/route.ts`](app/api/cron/morning-report/route.ts) — เดิม proxy POST ไป Apps Script → ตอนนี้ทำงานเอง. Auth: Vercel cron `Bearer CRON_SECRET` หรือ manual `?token=MORNING_REPORT_TOKEN` (`&dry=1` build แต่ไม่ส่ง).
- Single scheduler (Vercel cron `0 1 * * *` = 8 โมงเช้า) = ไม่มีทาง double-fire อีก. ไม่ต้องมี dedup.

**Pull-forward:** งานนี้คือส่วน read-only ของ Phase 4.3 ที่ดึงออกมาทำก่อน — ไม่ผูกกับ Phase 4.2 write migration. ส่วนที่เหลือของ 4.3 (LINE webhook, audit cron) ยังรอ 4.2 close-out ตามเดิม.

**Pending user actions:** set Vercel env `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID` (copy จาก Apps Script Script Properties) → manual-test `?token=` → verify flex → ลบ Morning Report Apps Script project.

### Node 22 LTS upgrade + AI Quoting design doc (2026-05-17)

**Infra:** อัปเกรด Node 18.20.4 (EOL) → **22.22.3 LTS** — แก้ pre-commit hook ที่พังเพราะ vitest/rolldown ต้องการ Node ≥20.12. เพิ่ม `.nvmrc` = `22`. type-check/lint/test/build ผ่านครบบน Node 22. `0adbdbb` + `30d240a`.

**Design:** สร้าง [`design-ai-quoting.md`](design-ai-quoting.md) — research + design doc ระบบ AI ตอบราคาเบื้องต้นงานพิมพ์ (จอ + LINE OA, reuse สูตร calculator, PEAK ตัดออก, sales ทำใบเสนอราคามือ). Decisions D1-D7 + §0 Brain ครบ, status READY TO BUILD. ขั้นต่อไป = build Phase 0 (calc pricing API). ยังไม่มีโค้ดฟีเจอร์ — design doc อย่างเดียว.

### หน่วยจำนวน กล่อง/ถุง/ชิ้น ในฟอร์มใบสั่งงาน (2026-05-16)

`QTY_UNITS` ใน [`app/board/order-form.tsx`](app/board/order-form.tsx) — เดิม `['แผ่น','ชุด','เล่ม']` → เพิ่ม `กล่อง` / `ถุง` / `ชิ้น` รองรับงานบรรจุภัณฑ์. แก้ v2 อย่างเดียว (WP กำลัง retire — ไม่ sync). `238d40d`.

เซสชันเดียวกัน — root-cause `DATA-dateIn-double-encoded` ผ่าน `/diagnose`: ตัวการคือ Apps Script `objectToRow()` ที่เดิมไม่มี Date guard (ไม่ใช่ `addOrder` ตามที่ AUDIT-BACKLOG เดา) — source fixed ไปแล้ว 2026-05-08, 3 rows ที่เหลือเป็น legacy residue, display self-corrects ผ่าน `displayDate()` → ปิดเป็น `[accepted]` ไม่ต้องแก้. รายละเอียดใน [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md).

### Admin cross-dept reassign + Phase 2 stale-read fix #3 + cowork "เสร็จงาน" button (2026-05-14)

**3 features shipped, 3 commits, smoke-tested by user:**

#### 1. Admin reassign ข้ามแผนกได้ — `c2cd3b5`

Card "ย้าย" dropdown สำหรับ admin → list staff ทั้ง 3 แผนก พร้อม prefix `[กราฟิก]` / `[พิมพ์]` / `[หลังพิมพ์]` เวลา cross-dept. Server `/api/jobs/reassign` รับ optional `targetDept` (admin-only ถ้า ≠ srcDept). `dateIn` ไม่แตะ — admin reassign คือ "fix-mistake tool" ไม่ใช่ workflow advance. Wrong-direction (post → graphic) allowed เพื่อรองรับ "พนักงานส่งต่อผิด ต้องส่งกลับ". Drag-drop semantic เดิม (cross-column = forward dialog) — ไม่แตะ. Audit data carries `prevDept` + `prevStaff`.

#### 2. Phase 2 stale-read fix #3 — `159333c` (user-reported on order #202605093)

**User-reported:** แก้ไขงานแล้วเปลี่ยนชื่อ → submit → "ไม่พบใบสั่งงาน #202605093". Order มีอยู่จริงใน Postgres + Sheet, อายุ 5 วันแล้ว.

**Root cause:** `/api/orders/update` (line 114) เรียก `loadAllFresh()` ที่อ่าน Apps Script Sheet ตรง. Comment ที่ `lib/api.ts:92` ยัง claim "write paths need authoritative Sheet state" ที่กลับด้านหลัง Phase 2 — Sheet กลายเป็น cron-lagged mirror, Postgres เป็น authoritative. Existence check ที่ `snap.orders.find(o => Number(o.id) === id)` ล้มเหลวเมื่อ Sheet มี edge case (sync lag / orphan / archived).

**Same disease as 2 fixes ก่อน — third occurrence:**

| Round | Caller | Fix | Date |
|---|---|---|---|
| 1 | `/api/orders/promote-draft` | new helper `loadOrderAndJobsForPromote` | 2026-05-11 (`1f62d3b`) |
| 2 | `loadOrder()` (5 callers) | refactor Postgres-first ทุก call | 2026-05-12 (`c0be3b8`) |
| **3** | `/api/orders/{update, cancel, delete}` | reuse helper #1 — widen scope | 2026-05-14 (`159333c`) |

**Fix per memory rule "helper #2 = root cause signal":** ไม่เขียน helper #2/#3. Renamed `loadOrderAndJobsForPromote` → `loadOrderAndJobs` (drop misleading "ForPromote" scope-binding) + reuse ใน 3 routes. `/api/orders/{add, jobs/add, jobs/restore}` ยังต้องใช้ `loadAllFresh` ต่อ เพราะต้องการ `nextId` (Postgres ยัง track ตัวนี้ไม่ได้) — ไม่แตะ.

**Files changed:** `lib/api.ts` + 4 route files. 70 insertions / 52 deletions.

#### 3. ปุ่ม "เสร็จงาน Co-work" บน guest cards — `af8597b`

Guest cowork cards (badge "ร่วมพิมพ์" บน column ของ cowork member) ตอนนี้มีปุ่ม violet "เสร็จงาน Co-work". Confirm dialog → POST `/api/jobs/cowork` ส่ง list ใหม่ที่ลบ self ออก → optimistic hide. All roles allowed (เครื่องที่ทำเสร็จเป็นคน mark เองได้).

**Why explicit `BoardJob.guestStaff` field:** `BoardJob.staff` บน guest copy ยังชี้ host (จาก `{...job, isGuest: true}` spread ที่ fan-out). ต้อง derived field set ที่ `computeBoard` (lib/board.ts:244) เพื่อให้ guest action รู้ว่า "ฉันเป็นคนไหนใน list".

**Reused infrastructure:** `/api/jobs/cowork` endpoint เดิม + `usePendingMutations` optimistic hide pattern. Zero server change.

#### Verified ทั้ง 3 commits
- Type-check ✅ / 72 vitest tests ✅ / production build ✅
- User smoke test ผ่านครบ 3 features

#### Lessons
- **Memory rule "helper #2 = root cause signal" จับได้แม่น** — เห็นปัญหาตั้งแต่ขั้นเช็ค `loadAllFresh` callers ก่อน patch route เดียว. ลด churn จากการเขียน helper #2/#3 ที่จะกลายเป็น tech debt
- **Cross-dept reassign ≠ forward** — semantic แยก: reassign = "ย้ายเครื่อง" (ไม่บัมพ์ dateIn), forward = "ส่งต่อ workflow" (บัมพ์ dateIn ปลายทาง). ขยาย reassign ดีกว่ารวม semantic เข้าด้วยกัน
- **Guest cards ต้อง explicit self id** — fan-out logic ที่ spread host job → field ปัจจุบันไม่ยึดกับ column ที่ render. Set `guestStaff` ตอน fan-out ป้องกัน future guest-action features เจอปัญหาเดียวกัน
- **`loadAllFresh` is the next likely landmine** — เหลือ 6 callers ที่ยังต้องใช้เพราะต้องการ `nextId`. ถ้า Phase 4.x ย้าย nextId allocation ลง Postgres → refactor ตามต่อ

### Print stale-read root-cause fix (2026-05-12) — `loadOrder()` Postgres-first ทุก call

**User-reported:**
1. แก้ไขงานเสร็จ → กดพิมพ์ใบสั่งใหม่ → ค่ายังเป็นก่อนแก้
2. กด "พิมพ์+ส่ง" / "พิมพ์" → บางครั้ง 404

**Root cause (one bug, two symptoms):** [`lib/api.ts`](lib/api.ts) `loadOrder()` มี carve-out `if ((opts.revalidate ?? 0) > 0)` ที่ skip Postgres เมื่อ caller ขอ fresh read. Logic นี้ assumes "Postgres mirror lag + Sheet fresh" — true ตอน Phase 1 แต่กลับด้านหลัง Phase 2 (createOrder/updateOrder writes ลง Postgres เท่านั้น, Sheet lag ≤5 min via heal cron). Print page เรียก `loadOrder(id)` ไม่ใส่ opts → revalidate=0 → skip Postgres → Apps Script `getOrder` → ค่าเก่า (Bug 1) หรือ null=404 (Bug 2).

**Sister bug ที่เคย patch:** `1f62d3b` (promote-draft) สร้าง `loadOrderAndJobsForPromote()` workaround helper. NEXT-SESSION 2026-05-11 บันทึก lesson ไว้แล้ว ("Pattern fix: write Postgres-first helpers"). Refactor นี้ปิด root cause ที่ลึกกว่า patch (ทำที่ `loadOrder` เอง แทนสร้าง helper ใหม่ทุกรอบ).

**Fix** — `lib/api.ts`:
- ลบ `if ((opts.revalidate ?? 0) > 0)` carve-out → Postgres-first ทุก call
- `loadOrderFromPostgres` throws `PostgresStaleError` เมื่อ row not found → `tryPostgres` returns null → fall through ไป Apps Script (สำหรับ Phase 1.x stragglers ที่ mirror cron ยังไม่ทัน)
- `app/orders/[id]/print/page.tsx` comment อัปเดต

**Verified:** type-check ✅ / 72 vitest tests ✅ / production build ✅

**Behavior change ของ 5 callers:**

| Caller | เดิม | หลัง refactor |
|---|---|---|
| `/api/track/lookup` | Postgres (revalidate=30) → retry Apps Script | Postgres ทั้งคู่ + Apps Script fallback |
| `/api/orders/raw/[id]` | Postgres-first (revalidate=30) | เหมือนเดิม |
| `/api/jobs/restore` | Apps Script direct | **ดีขึ้น** — Postgres-first |
| `/orders/[id]/tracking-card` | Apps Script direct | **bug fixed** (Phase 2 track 404) |
| `/orders/[id]/print` | Apps Script direct | **bug fixed (รายงานนี้)** |

**Lessons:**
- **Strangler-pattern read paths invert staleness assumption when write side migrates.** Hard-coded staleness model = recurring bug factory จนกว่าจะ refactor ที่ root
- **Workaround helpers signal latent root cause.** `loadOrderAndJobsForPromote` คือ helper #1 — refactor ป้องกัน helper #2 ที่ทำงานเดียวกัน

**Rollback:** `git revert` — ไม่มี env flag ใหม่ (behavior strictly improves ภายใต้ `READ_FROM_POSTGRES=1` ที่ ON อยู่แล้ว). Postgres ล่ม → unset `READ_FROM_POSTGRES` → กลับ Apps Script 100% รวม path นี้

### 5-dimensional audit batch + Sprint 1/2 (2026-05-12) — 10 audit findings closed

After the morning's `loadOrder` Postgres-first refactor + cleanup batch, ran a comprehensive audit across 5 dimensions via 4 parallel subagents (data-doctor + perf + a11y + security) + manual architecture review. Total findings: 18 a11y / 12 perf / 12 security / 6 medium tech-debt. Net assessments: 🟡 yellow across the board — production-grade with surgical gaps.

**Sprint 1** (`6e46d82`) — 6 high-impact fixes:
- **PERF-F1** Route-segment `loading.tsx` for /board, /orders, /calendar, /analytics — eliminates blank-screen gap on navigation
- **A05-1** HTTP security headers in `next.config.mjs` (X-Frame-Options DENY + X-Content-Type-Options + Referrer-Policy + Permissions-Policy)
- **PERF-B2** `allSettledLimit(cap=3)` on `/api/orders/update` cascade — closes M5 consistency gap (other cascade routes already had it)
- **A11Y-R1** `<main id="main-content">` landmark + skip-to-content link in DashboardShell + global `focus-visible:` outline rule
- **A11Y-O2** Touch targets bumped to 44×44 — 9 modal close buttons + MobileUserMenu trigger + toast dismiss
- **PERF-C1** Card `arePropsEqual` field-level compare replaces `JSON.stringify` on `cowork`/`order` — ~500KB string work/auto-sync tick eliminated on /board

**Sprint 2** (`190c5fe`) — 4 security + a11y deeper fixes:
- **A04-1** /track 3-layer brute-force resistance — IP rate-limit via Upstash + per-id PIN-failure lockout (5/hr/orderId) + constant-time `timingSafeStringEqual` PIN compare. New `peekRateLimit` + `recordFailure` helpers in `lib/rate-limit.ts` lets the lockout check fire WITHOUT burning the counter on legitimate lookups.
- **A09-1** Login audit logging — `[auth]` grep-able structured `console.warn` in Vercel Logs + Sentry breadcrumb on suspicious events; covers success/fail/rate-limit/invalid-input
- **A11Y-P1** Urgency badge contrast — new `URGENCY_BADGE` paired Tailwind tokens (~8:1 vs prior ~3:1 with `bgHex + '20'` alpha pattern); refactored 6 callsites (card.tsx ×2, orders-table.tsx, calendar/grid.tsx ×2, calendar/page.tsx Pill)
- **A11Y-U2** Form errors gain `role="alert" aria-live="assertive"` — login + /track + ForwardDialog + ReassignDialog (×3) + BulkActionsBar; SR users now hear errors on submit

**Audit items deferred to Sprint 3** (ROI lower than Sprint 1+2 per honest ROI review):
A04-2 token rotation, M-A01-1 /api/orders/raw role gate, PERF-A1 OrdersData payload trim, MFA, E2E tests, Phase 4.2 close-out

**Memory captured**: [`feedback_loadorder_postgres_first.md`](~/.claude/projects/-Users-witsarut-p/memory/feedback_loadorder_postgres_first.md) — strangler-pattern staleness lesson (write side migrates → read paths invert assumption → recurring bug factory until refactored at root).

### Phase 2 mega-session (2026-05-11) — 11 actions migrated + tombstone infra + UX overhaul

19+ commits + 5 Apps Script clasp pushes + 28→72 vitest tests in one ~17-hour day. End state: virtually all hot-path mutations on jobs + orders run Postgres-first.

**P1 guardrails first** (`a7082f0` + `521292d`):
- husky 9 pre-commit hook: tsc + lint + vitest blocks every commit. Verified teeth (bad TS → refused).
- vitest 4.1 + 28 initial tests covering `lib/feature-flags`, `lib/postgres-write`, `lib/sync-from-sheet`. TDD red-phase verified retroactively for every Phase 2 migration after this point. Mock helper `tests/helpers/mock-postgres.ts` records both tagged-template and `.query()` invocations.

**Phase 2 jobs hot-path** (`a52381e`, `fda396d`, `825857e`, `d1fb66e`, `1746946`) — 8 actions migrated. Each: new `*InPostgres` helper in [lib/postgres-write.ts](lib/postgres-write.ts) + flag in [lib/feature-flags.ts](lib/feature-flags.ts) + route phase2 branch + `appendAuditToPostgres` for instant `/board` history visibility. Heal cron `/api/cron/sync-to-sheet` pushes dirty rows to Sheet within ~5 min. New Apps Script actions per migration (setOrderRow, setShippedRow, setCancelledRow, deleteJobByIdRow), all idempotent upserts mirroring setJobRow/setTemplateRow pattern.

**Tombstone pattern** (`825857e`) — new `jobs.phase2_deleted_at` column unblocks moveToShipped/cancelJob/bulkForward (operations that "move row out of jobs sheet"):
- Phase 2 path tombstones the jobs row (`UPDATE jobs SET phase2_deleted_at = NOW() WHERE id = X`)
- `/board` queries filter `phase2_deleted_at IS NULL` so the card disappears instantly
- Heal cron `healJobsTombstone()` calls Apps Script `deleteJobByIdRow` per tombstone, then hard-DELETEs from Postgres on success
- From-Sheet cron predicate updated to `phase2_dirty_at IS NULL AND phase2_deleted_at IS NULL` so tombstones aren't re-inserted by Sheet refresh

**Phase 2 orders** (`b3d6515`, `010cf35`) — 4 actions: createOrder (hot path), updateOrder + cascade rename, promoteDraft, cancelOrder (cascade-cancel all jobs of order). `deleteOrder` + `deleteOrderCascade` intentionally skipped after verifying zero v2 UI callers — no need for order tombstone infrastructure.

**Audit log full pipeline** (`48a3127`, `242db89`, `d19ba75`, `f524fbd` + Apps Script v5.10.12 push) — 5-layer fix discovered via /diagnose skill loop:
- L1 audit.ts: extract `d.order.id` for createOrder action
- L2 write.ts: `data.order.id = orderId` mutation after allocation so appendAudit sees it
- L3 ★ sync-from-sheet bootstrap loop — was importing `loadAllWithAudit` (Postgres-first when READ_FROM_POSTGRES=1), refreshing Postgres FROM Postgres = no-op. Fixed via new `loadAllFromAppsScriptForSync()` that bypasses wrapper
- L4 syncAuditLog: `TRUNCATE` → `DELETE WHERE source='sheet'` so Phase 2-written entries (source='postgres') survive cron passes
- L5 `appendAuditToPostgres` helper — Phase 2 routes write audit direct to Postgres for instant `/board` history
- Schema: `audit_log.source TEXT DEFAULT 'sheet'` via db-migrate (idempotent ALTER)

**promote-draft Postgres-first** (`1f62d3b`) — new `loadOrderAndJobsForPromote()` helper in lib/api.ts bypasses Sheet stale-read so Phase 2 createOrder orders can be promoted immediately. Without this, draft promote failed with "ไม่พบใบสั่งงาน" for orders just created via Phase 2 (Sheet not yet healed).

**UX combined button** (`e9c60a9` + `030dabf`) — edit-draft footer gets `"บันทึก + ส่งเข้าระบบ"` button (orange, next to "บันทึกการแก้ไข"). OrderForm `submit()` mode `'submitAndPromote'` chains `/api/orders/update` → `/api/orders/promote-draft` → toast + auto-redirect `/board`. `busy=true` stays throughout chain (no "เงียบ" flash). Removed the redundant amber-banner promote button — single source of truth.

**UX spec restructured** (`e2094c0`) — `lib/spec-format.ts` builds WP-aligned section list (ขนาด & จำนวน / กระดาษ & สี / PLATE / งานบิล / เข้าเล่ม / เคลือบ-ปั๊ม / อื่นๆ / catch-all). Boolean flags render as `✓ <label>` chips. Size pairs with sizeUnit, qty with qtyUnit. Hidden header keys (name/customer/dateIn/dateDue/pin) no longer leak into spec body.

**Diagnostic endpoints** — `/api/admin/diagnose-audit?id=&test=1` + `/api/admin/diagnose-order?id=` — surface Postgres flat + raw + Sheet state + validation pass/fail per source. Used to pin every bug today (audit-log stale, promote-draft Sheet 404, draft assignStaff empty).

**Lessons captured** (memory + lessons in this file):
- Phase 2 stale-read pattern recurring (any write-then-read path through Apps Script direct misses Postgres). Pattern fix: Postgres-first helpers with Apps Script fallback for Phase 1.7 stragglers.
- /diagnose skill loop saved multiple bugs. Initial fixes were wrong direction; Phase 4 instrumentation (read Vercel route source) pinned actual cause.
- Combined-action UX requires busy state spanning entire chain. `setBusy(false)` before chained fetch flickers button back to idle = "เงียบ" symptom.
- Legacy `addJob` Apps Script double-bumps nextId (calls incrementConfig after getNextId already bumped) → id gaps in Sheet. Phase 2 addJob eliminates by skipping addJob Apps Script call.

### Phase 1.7 dual-write mirror + 2 bug fixes (2026-05-10 afternoon batch 2)

User-reported bug after Phase 1 cutover: writes "เด้งกลับหมด" — every drag-drop forward / create order / move card appeared to fail. Root cause: 10-min Postgres mirror cron lag meant `loadAll()` Postgres-first returned the OLD snapshot after every write, the optimistic UI commit revealed pre-write state, and the user concluded the write didn't go through.

**Phase 1.7 — dual-write** (`33d9978`): kill staleness window without going Phase 2.

- [`lib/postgres-write-mirror.ts`](lib/postgres-write-mirror.ts) 17 mirror handlers cover every action surface: `addJob`/`updateJob`/`deleteJob` (upsert + delete), `setCowork` (single-column UPDATE), `moveToShipped` / `cancelJob` / `restoreJob` (state transition INSERT+DELETE), `bulkForward` (per-item DELETE old + INSERT new with server-allocated id from response.succeeded), `addOrder` / `updateOrder` / `deleteOrder` / `addTemplate` / `deleteTemplate`, plus the 4 atomic compound actions (`createOrder`, `cancelOrder`, `deleteOrderCascade`, `promoteDraft`) which read each cascaded job's data BEFORE delete and use `jsonb_set` to flip the order's status field.
- [`lib/api.ts`](lib/api.ts) `post()` calls `mirrorWriteToPostgres()` AFTER Apps Script success (Sheet remains source of truth). Awaited (not fire-and-forget) so the response only returns after Postgres reflects the change — next read guaranteed fresh.
- Mirror failures NEVER block the user-facing response. On error, `mirrorWriteToPostgres` marks `sync_meta.last_sync_at = NOW() - INTERVAL '1 hour'` so reads fall back to Apps Script until the next cron run repairs drift, plus a Sentry capture with `tags.layer = 'postgres-mirror'` for audit.
- 70-80% of these handlers translate directly to Phase 2 (writes go through Postgres) when ready — only the "after Apps Script success" wrapper is throwaway, not the SQL operations themselves.

**Bug fix 1 — OrderForm SuccessView flicker** (`9969af9`)

OrderForm's init useEffect depended on `initial` reference. Phase 1.7's faster refresh (Postgres ~200ms vs Apps Script ~1.5s) made the bug visible: after save success, `router.refresh()` triggered a server re-render that handed OrderForm a fresh `initial` object with the same id but new reference. useEffect re-ran, called `setSuccess(null)`, and the SuccessView vanished mid-frame. The user saw the form re-rendered with their just-saved values and concluded the save didn't go through, clicking save again.

Fix: `initializedIdRef` tracks the id we've already populated for. On useEffect re-run with the same id AND mid-session (not a fresh modal-open), skip re-init to preserve local form state including `success`. `wasOpenRef` tracks closed→open transitions so modal "fresh open" (different from server refresh) still re-initializes correctly.

**Bug fix 2 — Edit-from-/orders speed** (`870aaa4`)

User noticed clicking "แก้ไข" from /orders list felt slower than from /board card. The /board card path renders OrderForm inline with data already in client memory (~16ms), but `/orders/[id]/edit/page.tsx` was SSR-fetching `loadOrder(id)` (uncached, default `revalidate: 0` skips Postgres → Apps Script TextFinder ~200-500ms) AND `loadAll()` (Postgres ~200ms) in parallel — total max(~500, ~200) ≈ ~500ms.

Fix: drop `loadOrder()` entirely. Phase 1.7's dual-write guarantee means `loadAll()` is fresh, and `snap.orders` already contains every order with full `rawData`. `snap.orders.find(o => Number(o.id) === id)` covers both target + recentOrders autocomplete in ONE Postgres fetch. /orders → edit ~500ms → ~200ms.

### Phase 1 Postgres read mirror LIVE (2026-05-10 afternoon batch 1)

Bench-driven decision shipped same session as the PoC. Migration plan estimated 1 week → done in 1 session because the bench (`/admin/bench-audit`) gave a single number (Postgres 23.9× faster on loadAll-shaped queries) that made the go/no-go call obvious.

**PoC arc (audit_log → loadAll-shaped):**
- Audit-only PoC tied at p50 (~108ms) — best case for Sheet (small targeted filter). Postgres better tail (p95 8×) but verdict was inconclusive.
- Phase 1.5 added `jobs` mirror + `/api/board/sheet` + `/api/board/postgres` shadow endpoints.
- Bench 2 (full jobs payload, no filter): Sheet ~4400ms p50 / Postgres ~200ms p50 = **23.9×**. Strong-GO verdict.

**Phase 1 deploy:**
- Schema: 4 new mirror tables (orders + shipped + cancelled + templates) + sync_meta tracking + indexes (`idx_orders_status`, `idx_orders_customer LOWER`, `idx_shipped_order`, `idx_cancelled_order`)
- Sync mechanism: [`lib/sync-from-sheet.ts`](lib/sync-from-sheet.ts) — full re-sync via TRUNCATE + bulk INSERT chunks of 100. Records sync_meta per table. ~500ms end-to-end for current Sheet sizes (32 jobs, 124 orders, 86 shipped, 18 cancelled, 9 templates, 500 audit).
- Endpoints: `/api/admin/sync-all` (manual, admin-gated) + `/api/cron/sync-from-sheet` (Vercel cron `*/10 * * * *`)
- Read path: [`lib/api-postgres.ts`](lib/api-postgres.ts) — Postgres-flavored `loadAllFromPostgres` + `loadOrderFromPostgres` + `getAuditByTargetFromPostgres` with `PostgresStaleError` thrown when sync_meta says stale (>30 min) or sync failed.
- Feature flag: [`lib/api.ts`](lib/api.ts) `tryPostgres()` helper — when `READ_FROM_POSTGRES=1` env var set, public read functions try Postgres first and fall back to Apps Script on `PostgresStaleError`. Sentry breadcrumb on every fallback for audit.
- /track migration: switched from `loadAll().filter()` (200KB payload) to `loadOrder()` (1KB targeted). Public QR scan flow ~3-5× faster.

**Sheet drift discovery:** shipped table had 2 duplicate ids (likely from old restore/ship cycles), causing PRIMARY KEY violation on first sync. Added `dedupeById()` safety net to all 5 mirror sync functions (last occurrence wins, surfaces dropped count). Backlog: clean Sheet duplicates manually.

**lib/postgres.ts env aliasing:** Vercel marketplace UI lets users pick a custom prefix (`STORAGE_*`, `POSTGRES_*`, `DATABASE_URL`). [`lib/postgres-env-alias.ts`](lib/postgres-env-alias.ts) is a side-effect import that copies any of those into `POSTGRES_URL` so `@vercel/postgres` (which hard-codes the lookup) works regardless of which prefix the user chose.

**Region pairing:**
- Vercel function: iad1 (US East) by default — bench was running cross-region for the audit_log PoC, accounting for the ~555ms Postgres latency observed
- After Phase 1 cutover, the function-region mismatch wasn't fixed — Postgres still in sin1 — but Postgres-first reads still beat Sheet by an order of magnitude even with cross-region overhead. **Future improvement: add Singapore (sin1) to Vercel Function Regions** for further -200-300ms RTT savings.

**Rollback procedure:** Vercel project → Settings → Environment Variables → delete `READ_FROM_POSTGRES` → redeploy → reads return to Apps Script in seconds. Sheet remains source of truth throughout — 0% data loss risk.

**Phase 2 (write migration) deferred** — writes ~1.5-3s currently is acceptable per user. Trigger conditions to revisit: writes feel slow, LockService timeouts, multi-user concurrent edit need.

**Decision log:**
- Why raw SQL (`@vercel/postgres` `sql` tag) instead of Drizzle ORM: PoC scope, can swap later. Phase 2 will likely add Drizzle.
- Why TRUNCATE+INSERT cron instead of trigger-based sync: simpler + robust + bounded staleness (10 min) acceptable for read use cases.
- Why sin1 Postgres region (despite Vercel iad1): user's primary location is Thailand → faster for Vercel function in sin1 IF we ever add it. For now cross-region overhead is absorbed.

**Files added:**
- [`lib/postgres.ts`](lib/postgres.ts) + [`lib/postgres-env-alias.ts`](lib/postgres-env-alias.ts)
- [`lib/sync-from-sheet.ts`](lib/sync-from-sheet.ts)
- [`lib/api-postgres.ts`](lib/api-postgres.ts)
- [`lib/rate-limit.ts`](lib/rate-limit.ts) (Tier B 4/4 — morning session)
- `app/admin/bench-audit/{page,client}.tsx` (PoC validation harness, kept for ongoing perf monitoring)
- `app/api/admin/{db-migrate,sync-all,import-jobs,import-audit-log}/route.ts`
- `app/api/audit/postgres/route.ts`
- `app/api/board/{sheet,postgres}/route.ts` (bench shadow endpoints, kept)
- `app/api/cron/sync-from-sheet/route.ts`
- `app/admin/bench-audit/page.tsx` Sync status table (server probe of sync_meta)

### Tier B leftover Pro features close-out + perf compound (2026-05-10 morning, Apps Script v5.10.9)

ปิด Tier B (cron 3/4 migration + KV rate limit) + perf compound (TextFinder write paths + /board fetch storm fix + quota dashboard widget). 6 tasks ใน 1 session.

**1. Morning Report cron migration (Tier B 3/4)**
- Morning Report Apps Script project ได้ `doPost` handler ใหม่ (verify body.token = Script Property `CRON_TOKEN` → run `morningReport()`). Health-check endpoint via `doGet`.
- `app/api/cron/morning-report/route.ts` — daily 8 AM Bangkok (1 AM UTC), `0 1 * * *`. POSTs to morning-report Apps Script web app with shared token.
- `vercel.json` — 3rd cron entry.
- Env vars: `MORNING_REPORT_APPS_SCRIPT_URL` + `MORNING_REPORT_TOKEN` (set in Vercel after Apps Script web app deploy returns URL).
- ⏳ Pending user actions: deploy morning-report Apps Script as Web App (first time), set Script Property + Vercel env vars, delete Apps Script time trigger after verification.

**2. Vercel KV rate limit (Tier B 4/4)**
- `lib/rate-limit.ts` — fail-open Upstash REST helper. Keys: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel Marketplace auto-injects). Without them logs warn + lets requests through.
- Applied to `/api/audit` (60 req/min/user) + `/api/orders/raw/[id]` (120 req/min/user). 429 response includes `Retry-After`.
- Threat model: logged-in user / compromised credentials spamming Apps Script. Anonymous DDoS already blocked by `requireSession()`.
- ⏳ Pending: connect Upstash KV via Vercel Storage tab → free tier covers our volume by ~1000×.

**3. Apps Script TextFinder pattern in write paths (Apps Script v5.10.9)**
- `helpers.ts` `findRowById` — switched to TextFinder restricted to column A. ~5-15× faster than the previous `getDataRange().getValues()` scan. Affects all 23 write call sites without touching write.ts.
- New `findRowMatchesByColumn` helper — TextFinder-based row scan that preserves Date objects via `getValues()` (not `getDisplayValues()`) so cascade write paths don't re-trigger the 2026-05-08 date corruption bug.
- `cancelOrder` + `deleteOrderCascade` cascade scan refactored to use the new helper. Both also share new `cascadeCancelJobsForOrder_` to DRY the duplicate logic. Estimated -500ms-1.5s per cascade on 100+ row sheets.

**4. /board bundle sweep + fetch storm fix (Vercel)**
- `/board` page bundle: 18.4 kB → 16.4 kB (-11%). First Load 127 kB → 125 kB.
- `KPIDetailModal` lazy-loaded + conditionally mounted in `kpi-bar.tsx`.
- `HistoryTab` lazy-loaded in `card.tsx`.
- **Bigger win — fetch storm fix**: previous `<dialog>` always rendered `DetailContent`+`HistoryTab` for every card on page load (50 cards = 50 `useEffect` audit fetches firing simultaneously, all rate-limit-bound but burning Apps Script quota). Fixed: `[detailsOpen, setDetailsOpen]` state + `{detailsOpen && <DetailContent>}` conditional mount + `useEffect` that fires `dialog.showModal()` on open.

**5. Apps Script quota dashboard widget (Apps Script v5.10.9)**
- `quota.ts` — `bumpUsage_()` increments per-day counter (`qd_YYYY-MM-DD` Properties Service key) on every `doGet`/`doPost`. 14-day rolling window with first-hit-of-day pruning.
- `getQuotaStats` action returns daily array + todayCount + windowTotal + peak.
- `app/analytics/quota-widget.tsx` — server-rendered SVG sparkline + 3-stat header. Suspense-wrapped, ISR 5 min. Pre-v5.10.9 Apps Script returns "Unknown action" → widget shows redeploy hint.

**6. Spawned task — Morning Report icons fix** (already done 2026-05-09 — `1e1f692` committed + live, NEXT-SESSION.md note was stale).

⏳ **Pending user actions** — see NEXT-SESSION.md for the runbook.

### Tier B Pro features — Vercel Cron migration 2/4 (2026-05-09 night, `d0ec15d` + Apps Script v5.10.8)

ย้าย 2 cron จาก Apps Script time triggers → Vercel Cron. Apps Script script time -50% + observable cron logs.

**Apps Script side** (v5.10.8):
- `api.ts` doPost cases: `runQuotaCheck` + `runBackup`
- `auth.ts` ROLE_REQUIREMENTS: both admin-only (cron uses admin service token)

**Vercel side**:
- `app/api/cron/quota-check/route.ts` — daily 8 AM Bangkok (1 AM UTC), `0 1 * * *`
- `app/api/cron/r2-backup/route.ts` — Sunday 3 AM Bangkok (Sat 20:00 UTC), `0 20 * * 6`
- `vercel.json` — Vercel Cron schedule
- Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel auto-injects)

**Gotcha**: CRON_SECRET ไม่ได้ auto-generate ใน account นี้ — manual create เป็น Sensitive env var (43-char random) → force redeploy without build cache → cron Run Now → 200 OK + LINE message arrives.

**Sensitive flag rule** (clarified vs Sentry case): server-only secrets (CRON_SECRET, APPS_SCRIPT_TOKEN, DASHBOARD_AUTH_SECRET) → ✅ Sensitive. NEXT_PUBLIC_* (must inline to client bundle) → ❌ NOT Sensitive.

**Cutover**: Apps Script Manage Deployments → Edit existing → New version v5.10.8. Verify Vercel cron via Run Now. Delete Apps Script time triggers `dailyQuotaCheck` + `backupSheet` (kept other triggers like auto-archive intact).

**Deferred for next session:**
- Morning Report cron migration — separate Apps Script project ("Morning report") doesn't have HTTP doPost handler yet, needs auth model added (~1 hr)
- Vercel KV rate limit on `/api/audit` + `/api/orders/raw` — need to create KV store in Vercel UI first

### History tab v2 port — Apps Script v5.10.7 (2026-05-09 evening, `51e8df5` + `1093a6d`)

ปิด last "🚧 อยู่ระหว่างพัฒนา" placeholder ใน /board card detail + /orders modal. WP `renderJobHistoryTab` (production-monitoring.js:1066) port ครบเป็น React.

**Backend** (Apps Script v5.10.7):
- New action `getAuditByTarget(jobId, orderId)` ใน [load.ts](../production-monitoring/apps-script/dashboard/load.ts) — filter audit_log Sheet for entries matching either id, return chronological list (cap 200). Pure JS filter on full sheet — for ~889-row sheet ~50ms. Wired into doGet ([api.ts](../production-monitoring/apps-script/dashboard/api.ts)).

**Vercel**:
- New route [app/api/audit/route.ts](app/api/audit/route.ts) — GET `?jobId=X&orderId=Y`, any logged-in user, 30s ISR cache.
- New helper [lib/api.ts](lib/api.ts) `getAuditByTarget()` — graceful fallback when Apps Script pre-5.10.7 (returns empty timeline instead of throwing on "Unknown action").

**UI** ([components/history-tab.tsx](components/history-tab.tsx)):
- Mirror WP — vertical timeline, action icon, Thai label, DD/MM HH:MM timestamp, summary, role-by-line.
- Action map covers all atomic actions (`createOrder`, `cancelOrder`, `deleteOrderCascade`, `promoteDraft`, `bulkForward`) + legacy multi-call.
- Loading / error / empty states match modal stone-tone palette.

**Trade-off vs `/spec` tab** (user-driven follow-up): `/spec` reads `job.order.details` inline from loadAll snap (0ms) because details ARE in every order row. Audit lives in separate Sheet that v2 explicitly skips on /board+/orders loadAll (round 5 saves 50-100KB/page). Couldn't get true 0ms inline without either (a) adding audit back to loadAll = undo round 5 win, (b) per-job audit attach in Apps Script = larger refactor.

**Compromise (`1093a6d`)**: prefetch on modal open. HistoryTab always mounts (display:none until ประวัติ tab active), useEffect fires fetch when modal opens. User reads info/spec for ~3-5s while audit loads in background → click ประวัติ feels instant. +1 Apps Script call per modal open, no pageload payload cost.

**Pattern → memory candidate**: prefetch-on-mount-with-display-toggle for tabs that need data but aren't first-clicked. Cleaner than lifting fetch to parent + prop drilling.

### Phase 3.6 cutover — WP retired (2026-05-09 afternoon, DNS switch + 2 bonus fixes)

**WP retire complete via DNS switch.**
- HostAtom DNS: A `203.170.190.20` → CNAME `cname.vercel-dns.com.` (TTL 300)
- Vercel custom domain `app.penprinting.co` added to `penprinting-dashboard` project
- SSL active immediately, HTTP 307 → /login confirmed via curl
- All 4 resolvers (HostAtom NS1+NS2, Google, Cloudflare) propagate ภายใน ~1 นาที

**Cushion**: [next.config.mjs](next.config.mjs) — `/production-monitoring*` → `/board` permanent redirect. กัน staff bookmark 404 ระหว่าง split-brain ~1 ชม. (cached A record ของ resolvers ทั่วโลก ค่อยๆ expire). Verified via `curl -I /production-monitoring/foo/bar` → 308 → /board ✓.

**HostAtom DNS UI gotcha**: relative CNAME value (e.g. `cname.vercel-dns.com`) auto-appends zone → `cname.vercel-dns.com.penprinting.co.` (NXDOMAIN). Fix: trailing dot ใน value (`cname.vercel-dns.com.`). เจอครั้งนี้ user save 2 รอบ. **Pattern → memory if recurring**.

**Bonus 1 — perf bug `e88f386`**: user reported "order create ดูช้ามาก" — static code analysis (no instrumentation needed) เจอใน [lib/api.ts:160](lib/api.ts) PATHS_BY_ACTION map ขาด entry สำหรับ `createOrder` action (fast-path ตั้งแต่ 2026-05-07 commit `a184254`). ทุก atomic action อื่น (`cancelOrder`, `deleteOrderCascade`, `promoteDraft`, `bulkForward`) อยู่ครบ. Effect: หลัง POST /api/orders/add success → router.refresh() returns CACHED snapshot (60s ISR cache, ไม่มี revalidatePath call) → user เห็นใหม่ใน 15-60s แทน ~1.5s. Fix 1 บรรทัด — เพิ่ม `createOrder: ['/board', '/orders', '/orders/new', '/calendar', '/analytics']` (union ของ addOrder + addJob path lists). Verified ใน production after deploy.

**Bonus 2 — quota threshold tune**: morning quota alert 8:44 AM 🟡 ที่ 3080ms = false alarm จาก Apps Script cold-start. Static analysis แสดงว่า `loadOrder` ทำ TextFinder × 4 sheets + N+1 row reads = ~2s warm baseline + ~1s cold-start overhead. Bump `responseTimeWarn` 3000→5000ms / `responseTimeCritical` 10000→15000ms — cold-start friendly + ยังจับ real regression ที่ ≥5s. Pushed via clasp + Manage deployments → New version v5.10.6.

**Logging**: AUDIT-BACKLOG ปิด createOrder bug. monitoring.md (WP doc) marked archived. Tech-Roadmap-Status Phase 3.6 ✅. CLAUDE.md hosting table updated. Marketing site CLAUDE.md redirects updated.

**Pattern → memory candidate**: user-reported perf bug — try static analysis first (read PATHS_BY_ACTION + cache stack) before adding instrumentation. ถ้า code path เห็นชัด (เช่น missing map entry) แก้ได้เลยโดยไม่ต้อง measure จริง

### Phase 3.6 prep day — Retire WP code-side prep (2026-05-09 morning)
Code-side prep ครบสำหรับ DNS-switch retire WordPress legacy. แก้ทั้งหมด 9 hard-coded WP refs across 3 projects, type-check + production build ผ่าน.

| Fix | Location | Why |
|---|---|---|
| Comment fix | [lib/api.ts:5](lib/api.ts) | "legacy Apps Script API at app.penprinting.co" → "Apps Script web app (script.google.com → APPS_SCRIPT_URL)". Apps Script API ไม่เคย host ที่ app.penprinting.co — WP frontend เท่านั้นที่ host ที่นั่น. หลัง retire ก็ยิ่งทำให้สับสน |
| History tab WP link removed | [app/orders/orders-table.tsx:423](app/orders/orders-table.tsx) + [app/board/card.tsx:1070](app/board/card.tsx) | "ดูประวัติงาน → ระบบ WP" link จะ 404 หลัง DNS switch (Vercel ไม่มี /production-monitoring path). แทนด้วย "ประวัติงาน (audit log) อยู่ระหว่างพัฒนา" |
| Marketing site redirects | [penprinting-web/next.config.js](../penprinting-web/next.config.js) | 4 redirects เคยชี้ `app.penprinting.co/production-monitoring*` + `/track*` (อ้อม WP) → ปรับเป็น `dashboard.penprinting.co/board` + `/track` (canonical, ไม่อ้อม alias) |
| Morning Report DASHBOARD_URL | [morning-report/apps-script/v2/Code.js:15](../morning-report/apps-script/v2/Code.js) + mirror `.gs` | เคย `penprinting.co/production-monitoring/` (broken แล้วตั้งแต่ migration 2026-04-26 — penprinting.co Vercel ไม่มี path นั้น) → `dashboard.penprinting.co/board` |

**Verified safe** (no action needed):
- Paper QR codes ที่พิมพ์ไปแล้ว — ใช้ `app.penprinting.co/track?id=...` ตกที่ Vercel `/track` route ทำงานปกติ
- v2 QR generation ใหม่ ([app/orders/[id]/tracking-card/page.tsx](app/orders/[id]/tracking-card/page.tsx) + [print/page.tsx](app/orders/[id]/print/page.tsx)) — ใช้ `dashboard.penprinting.co/track` อยู่แล้ว
- LINE Webhook + Cloudflare Worker — ไม่มี hard-coded WP URL
- `production-monitoring.js:N` doc comments ใน v2 source — historical port refs ไม่ break

**Spawned task**: Morning Report `ICON_BASE` (`penprinting.co/icons/`) ก็ broken เหมือนกัน — icons จริงอยู่ที่ `_shared/icons/` ไม่ได้ expose ผ่าน HTTP. Fix แยก task

**ถัดไป (manual user steps)**: backup WP + add custom domain Vercel + DNS A→CNAME HostAtom + push Morning Report Apps Script. ดู [NEXT-SESSION.md](NEXT-SESSION.md) Section "Phase 3.6 Path A — รายการที่ user ต้องทำเอง"

### Round 5 — Workflow speed sweep (2026-05-07 afternoon, `3cb4501`) + Apps Script v5.10.5
6 fixes spanning hot + cold paths after the perf compound work. Ships with Apps Script v5.10.5 (audit-skip param) — v2 deploys with `audit=0` by default; backwards-compat preserved.

| Fix | File | Saving |
|---|---|---|
| JobForm optimistic close + commit() | [app/board/card.tsx](app/board/card.tsx) | 400ms modal-open lag → 0ms close |
| `/api/jobs/forward-undo` drops `getNextId` round-trip — passes `id: 0` for bulkForward auto-alloc | [app/api/jobs/forward-undo/route.ts](app/api/jobs/forward-undo/route.ts) | ~300ms per undo |
| `/api/jobs/restore` accepts `srcCancelled` snapshot + `loadOrder(id)` | [app/api/jobs/restore/route.ts](app/api/jobs/restore/route.ts) | 1.2s → 400-800ms |
| `/api/auth/{login,logout}` edge runtime | [app/api/auth/login/route.ts](app/api/auth/login/route.ts) + logout | ~150ms cold-start saved on first login of day |
| Apps Script `loadAll({audit?:boolean})` param + Vercel `loadAll()` passes `audit=0`; new `loadAllWithAudit()` for /analytics | [load.ts](../production-monitoring/apps-script/dashboard/load.ts) + [api.ts](../production-monitoring/apps-script/dashboard/api.ts) + [lib/api.ts](lib/api.ts) | -50-100KB Apps Script payload per page on /board/orders/calendar/etc |
| `app/board/card.tsx` `React.memo` + field-level comparator (`arePropsEqual`) | [app/board/card.tsx](app/board/card.tsx) | Auto-sync ticks: only the moved card re-renders (49/50 unchanged refs detected by explicit field check) |

**Apps Script v5.10.5** — `loadAll(opts?: { audit?: boolean })` parameter; `api.ts` switch case honors `e.parameter.audit !== '0'`. Default unchanged so v2 frontend can ship before Apps Script redeploy. ✅ User pushed via push.sh + Manage deployments → live.

**Patterns crystallized**:
- React.memo with field-level comparator beats default shallow when parent re-renders fresh refs (PATTERNS §1.10 added)
- Optimistic-modal-close pattern for any mutation that doesn't change the surrounding card layout (PATTERNS §5.9 added)
- Edge runtime safe for routes that only use Web Crypto + cookies + fetch (auth login/logout, /api/track/lookup) (PATTERNS §1.11 added)
- Backwards-compat param flag pattern — opt-in skip for heavy Apps Script reads, default unchanged so frontend ships before redeploy (PATTERNS §1.12 added)

### /track WP port + 6-step progress + charcoal mood (2026-05-07 afternoon, `ce611b1` + `fe0b38e`)
v2 /track restored to WP visual parity. Customers scanning QR get the same 6-step timeline they expect.

**`ce611b1` — feature port**:
- `/api/track/lookup` returns `currentDept: 'graphic'|'print'|'post'|null` so client positions current step
- Status labels match WP exactly (กราฟิกกำลังดำเนินการ / อยู่ระหว่างพิมพ์ / ขั้นตอนหลังพิมพ์ / ฯลฯ)
- [app/track/page.tsx](app/track/page.tsx) — cream `#f5f5f0` BG, text-only "PENPRINTING" wordmark, robots noindex
- [app/track/client.tsx](app/track/client.tsx) full rewrite: white card rounded-20, status header in cream, 22px job name, **5-variant pill badges** (normal/progress/overdue/shipped/cancelled), 2-column date row, **6-step vertical progress timeline** (received → graphic → print → post → ready → shipped) with done/current/pending/cancelled states + Thai+English labels, reason box for cancellations, contact box with `tel:043220582`, "← ตรวจสอบงานอื่น" back link

**`fe0b38e` — minimal styling pass**:
- Status badge `progress` variant: blue `#dbeafe/#1d4ed8` → charcoal `#e7e5e4/#1a202c`
- Step `current` icon: blue → solid charcoal `#1a202c/#ffffff` (filled black w/ white icon — bold contrast instead of hue shift)
- Step `current` label: `#1a202c` thai bold + `#4a5568` eng
- Contact phone link: blue → black w/ underline + 3px underline-offset
- Kept green (done/shipped), red (cancelled/overdue), amber (received) for semantic meaning

### Mobile bottom-nav refactor + hamburger sheet + top-right user menu (2026-05-07 afternoon, `95c0cb8`)
Closes the mobile-no-logout gap that's been sitting since /board went live.

| Change | File |
|---|---|
| Bottom nav reserves rightmost slot for "เมนู" hamburger sheet. Primary slots = 4 mobile-flagged items (สั่งงาน + กราฟฟิก + พิมพ์ + หลังพิมพ์ for admin/sales; 3 for staff who can't see สั่งงาน) | [components/bottom-nav.tsx](components/bottom-nav.tsx) + [components/nav-config.ts](components/nav-config.ts) |
| Floating top-right circular `IconUser` button (`md:hidden`) → opens bottom sheet w/ avatar + name + role + /track link + logout | [components/mobile-user-menu.tsx](components/mobile-user-menu.tsx) (NEW) |
| `getMoreMenuGroups(role)` helper — returns groups w/ bottom-row items stripped, preserving "การผลิต / รายการ" headings inside the sheet | [components/nav-config.ts](components/nav-config.ts) |
| Added `IconMenu` (3 lines) and `IconExternalLink` | [lib/icons.tsx](lib/icons.tsx) |

### Bundle splits + smart auto-sync backoff + edge runtime (2026-05-07 afternoon, `1d6e57f`)
Five targeted perf wins on cold starts and idle tabs.

| Change | Saving |
|---|---|
| Lazy-load recharts on /analytics via `next/dynamic({ ssr: false })` — new [app/analytics/charts-lazy.tsx](app/analytics/charts-lazy.tsx) | /analytics First Load JS: **295KB → 181KB (-39%)** |
| Dynamic-import OrderForm + JobForm in [app/board/card.tsx](app/board/card.tsx) w/ conditional mount `{editOpen && <JobForm…/>}` | Modal chunks fetch on first ✏️ click instead of every /board hit |
| Smart auto-sync backoff in [lib/auto-sync.tsx](lib/auto-sync.tsx) — replaced fixed 15s setInterval with self-rescheduling setTimeout. Schedule: 15s active / 30s after 2-10min idle / 60s after >10min idle. Activity tracked via passive pointerdown/keydown/wheel/touchstart | **~75% Apps Script quota reduction on idle tabs** |
| Edge runtime on `/api/track/lookup` — public route, all deps Edge-compatible | ~150-300ms TTFB win on first hit of the day |
| Deleted `app/board/bulk-forward-modal.tsx` (424 lines, 20K, no consumers) | Bundle hygiene |

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
