# Penprinting Dashboard v2 — Reusable Patterns

Patterns ที่ค้นพบหรือสร้างขึ้นระหว่าง strangler migration ของ Penprinting dashboard.
อ่านก่อนเริ่ม session ใหม่ — pattern เหล่านี้ตรวจแล้วใช้งานในโปรเจกต์จริง.

> Convention: ทุกครั้งที่เจอ pattern ใหม่ที่ไม่ obvious และ reusable → เพิ่มเข้าที่นี่

---

## 1. Apps Script API patterns

### 1.1 Atomic single-job mutations ใช้ `bulkForward(items=1)`
- Apps Script `bulkForward` ทำใน LockService เดียว → ถ้าใช้กับ 1 job ก็ atomic เช่นกัน
- WP เก่ามี orphan-job class of bugs จาก sequential `deleteJob` + `addJob` (v5.6.2 / v5.9.0)
- v2 [/api/jobs/forward](app/api/jobs/forward/route.ts) ใช้ pattern นี้ — `data.items: [{ oldId, newJob }]`
- Trade-off: extra newJob ID allocation overhead (server fetch nextId เอง) แต่ได้ atomicity

### 1.2 Server-side ID allocation ก่อน mutation
- Frontend ห้าม guess `nextId` หรือ `orderId` — race ได้
- Use Apps Script actions: `getNextId` (job) / `getNextOrderId` (order)
- ตัวอย่าง [/api/orders/add](app/api/orders/add/route.ts) — server flow:
  1. `getNextOrderId` → orderId
  2. `getNextId` → jobId
  3. `addOrder` → if ok → `addJob`
  4. Surface partial success on jobN failure (don't pretend everything's OK)

### 1.3 `loadAllFresh()` for write-path lookups
- Default `loadAll()` cached 60s — fine for read pages
- Mutation routes ที่ต้องอ่าน source state (e.g. `forward` ต้องอ่าน src.dept/staff/cowork ก่อน build newJob) → ใช้ `loadAllFresh` ([lib/api.ts](lib/api.ts))
- ห้ามใช้ `loadAll` cached สำหรับ writes — เคย see-stale-data bug

### 1.4 `revalidate: 0` for POST mutations
- `post<T>(action, body)` หใน [lib/api.ts](lib/api.ts) มี default `next.revalidate: 0` — ห้าม cache writes

### 1.5 Single-row reads via `loadOrder(id)` (prefer over loadAll/loadAllFresh)
- Apps Script `getOrder` action (wired ใน [api.ts:36-37](../production-monitoring/apps-script/dashboard/api.ts) → [load.ts:119](../production-monitoring/apps-script/dashboard/load.ts) `loadOrder()`) คืนแค่ 1 order + jobs ของ order นั้น (~200ms vs full snapshot ~600ms)
- Vercel wrapper: `loadOrder(id)` ใน [lib/api.ts:102](lib/api.ts) — `next.revalidate: 0` (ไม่ cache, page-level cache จัดการเอง)
- **เมื่อไหร่ใช้ `loadOrder`** (single-order context):
  - `/orders/[id]/print` — A4 invoice page
  - `/api/orders/raw/[id]` — order detail "สเปคงาน" tab lazy fetch
  - `/api/track/lookup` — public tracking by id+PIN (fresh-bypass when ISR cache misses brand-new order)
  - Future: `/orders/[id]/edit` data prefill, single-order printables, single-order analytics
- **เมื่อไหร่ใช้ `loadAll`/`loadAllFresh`** (multi-order context):
  - `/board`, `/orders`, `/shipped`, `/cancelled` — list pages need cross-order joins/grouping
  - Write paths ที่ต้องอ่าน multiple rows (เช่น cascade rename ใน `/api/orders/update` ถ้า name เปลี่ยน → scan jobs ของหลาย orders)
- Backwards-compat: ถ้า `getOrder` action ไม่มีบน Apps Script (deploy ก่อน) → loadOrder return error → caller fallback `loadAllFresh()` ถ้าต้องการ. ปัจจุบัน Apps Script live แล้ว (verified ใน api.ts), routes ไม่มี fallback

### 1.6 Client-supplied snapshots > server re-reads (recurring pattern)
- เมื่อ client มี state ที่ครบสำหรับ build mutation อยู่แล้ว → ส่ง snapshot ใน body แทนที่จะให้ server `loadAllFresh()` อ่านอีกที
- ตัวอย่าง:
  - `/api/jobs/forward,bulk-forward,reassign` — รับ `srcJob` snapshot (ดู §1.5 ใน [Phase 2.1 forward perf doc](../production-monitoring/apps-script/dashboard/load.ts) refactor)
  - `/api/orders/update` — รับ `srcOrder` snapshot, skip `loadAllFresh()` ถ้า name+dateDue ไม่เปลี่ยน
- **Trust model**: snapshot ใช้สำหรับ workflow advisory เท่านั้น (e.g. validateForwardTarget). Security-critical (session role + RESTRICTED_TARGETS) ยัง server-authoritative
- **Saving**: -600ms per write (full snapshot read avoided)
- **เมื่อไหร่ไม่ใช้**: Cascade operations ที่ต้องอ่าน rows ของ entities อื่น (เช่น order rename → cascade jobs scan) — ยังต้อง fresh

---

## 2. Permission gating patterns

### 2.1 v2 stricter than Apps Script `ROLE_REQUIREMENTS`
- Apps Script เปิด `updateJob`, `deleteJob` ให้ทุก role เพราะ WP frontend ใช้ drag-drop (สำหรับ workflow)
- v2 มี route gate ที่เข้มกว่า:
  - `/api/jobs/update` — admin only (✏️ แก้ไข)
  - `/api/jobs/delete` — admin only (🗑 ลบ)
  - `/api/jobs/cancel` — admin only (⚠️ ยกเลิก)
- Why: v2 modal-based UI ถือว่า edit = แก้ข้อมูลใจกลาง, ส่วน workflow (forward/reassign/cowork) = open all roles
- ตัวอย่าง memory: [feedback_dashboard_v2_edit_admin_only.md](~/.claude/projects/.../memory/)

### 2.2 Workflow vs Edit split ที่ route-level
- workflow path (`/api/jobs/{forward,reassign,cowork,move-to-shipped}`) → `requireSession()` (any role)
- edit path (`/api/jobs/{update,delete,cancel}` + `/api/orders/*`) → `requireSession(['admin'])` หรือ `['admin', 'sales']`
- pattern: validate `targetStaff` against `STAFF[dept]` map ใน reassign — ถึงแม้ updateJob เปิด, route ของเราจำกัด field ที่แก้ได้ (preserve cowork, status, etc.)

### 2.3 RESTRICTED_TARGETS — vendor columns admin-only
- `outsource` (print) + `diecut_out` (post) เป็น vendor columns
- ใน [lib/forward.ts](lib/forward.ts) มี `RESTRICTED_TARGETS = new Set(['outsource', 'diecut_out'])`
- All forward/reassign routes filter via `getVisibleTargets(fromType, isAdmin)` หรือ `validateForwardTarget(...)` — non-admin ไม่เห็น/ส่งไม่ได้

---

## 3. Frontend state patterns

### 3.1 URL searchParams เป็น source of truth สำหรับ filter state
- Decision (2026-05-06 #3): URL params shareable + Server Component filter พร้อม render
- ใช้กับ:
  - `?dept=graphic` — sidebar deep-link (handled by [components/sidebar.tsx](components/sidebar.tsx) + `useIsActive()`)
  - `?u=overdue` — KPI bar / filter chips
  - `?q=keyword` — search box (debounced 300ms)
- Server: `searchParams` prop ใน page → pass to `computeBoard(data, filters)` → render filtered HTML
- Client: `useSearchParams()` + `router.replace()` (`{ scroll: false }`) ตอน toggle

### 3.2 `useIsActive(href)` hook สำหรับ nav active state
- Reused by sidebar + bottom-nav ([components/sidebar.tsx](components/sidebar.tsx))
- Logic:
  - href without `?` → exact path AND no `dept` query
  - href with `?dept=X` → path match AND searchParams.dept === X
- Caveat: ถ้าจะ extend เป็น filter อื่นๆ (เช่น `?u=`) ต้อง update logic นี้

### 3.3 BroadcastChannel cross-tab sync (`pp_dashboard_sync`)
- Same channel name as WP — v2 + WP cross-pollinate ได้
- Use case: tab A กด ✅ จัดส่งเสร็จ → tab B refresh ทันที (ไม่ต้องรอ 15s polling)
- Helper: `broadcastWrite(action)` ใน [lib/auto-sync.tsx](lib/auto-sync.tsx) — call หลัง POST ทุกครั้ง
- Listener: `useAutoSync()` hook (ใช้ใน `<AutoSync />` component)

### 3.4 BulkModeProvider pattern (Context for client-only state)
- [components/board/bulk-context.tsx](components/board/bulk-context.tsx) — selection state ที่ไม่ได้อยู่ใน URL
- Defensive default: `useBulkMode()` คืน null-context ถ้าใช้นอก provider — ป้องกัน crash
- Cap: 25 selected (matches WP `BULK_FORWARD_MAX`, Apps Script 30s timeout)

---

## 4. UI / iconography patterns

### 4.1 Outline SVG icon set (no emoji)
- User preference (2026-05-06): all icons SVG outline, never emoji
- Single source: [lib/icons.tsx](lib/icons.tsx) — Lucide-style:
  - 24×24 viewBox, `stroke="currentColor"`, strokeWidth=2
  - linecap/linejoin=round
  - default size 16px (override via `size` prop)
- Helper: `makeIcon(<jsx-paths>, displayName)` — concise per-icon definition
- Inherit color via `currentColor` — works with text utility classes (e.g., `text-emerald-600`)

### 4.2 Per-staff icon theming
- [lib/staff-icons.tsx](lib/staff-icons.tsx) — `getStaffTheme(dept, staffId)` → `{ Icon, bgClass, iconClass }`
- Used by [Column](app/board/column.tsx) header — mirrors WP screenshot's icon-square pattern
- Vendor staff (outsource/diecut_out) → violet palette
- Internal-only special staff (diecut_in) → warm amber

### 4.3 inline-flex + gap for icon+label combos
- ทุกที่ที่ icon อยู่ติดกับ text label → wrap with `inline-flex items-center gap-1.5`
- Avoids baseline alignment issues with SVG's natural spacing
- Example: `<button className="inline-flex items-center gap-1.5 ..."><IconCheck size={16} /> จัดส่งเสร็จ</button>`

### 4.4 DashboardShell + sidebar/bottom-nav split
- [components/dashboard-shell.tsx](components/dashboard-shell.tsx) wraps every authenticated page
- Desktop (`md:flex`): fixed 220px left sidebar; main content offset `md:pl-[220px]`
- Mobile (`md:hidden`): fixed bottom-nav with iPhone safe-area; main content `pb-20`
- Single `[components/nav-config.ts](components/nav-config.ts)` source of truth — adding a section updates both nav surfaces

---

## 5. Form patterns

### 5.1 Native `<dialog>` modals (no Headless UI dependency)
- ทุก modal ใน v2 ใช้ `<dialog ref={dialogRef}>.showModal()` — รองรับ ESC + backdrop click natively
- Pattern: `useEffect` to sync `open` prop with `dialog.open` + listen `cancel` event for ESC handling
- Sample: [app/board/job-form.tsx](app/board/job-form.tsx)

### 5.2 Cascading dept → staff selects
- Common in JobForm, OrderForm, cowork repeater
- Pattern: `changeDept(next)` → check if current staff still valid in new dept → reset if not
- See `STAFF[next]?.some((s) => s.id === staff)` check

### 5.3 Date format toISO ←→ display
- Storage: YYYY-MM-DD (matches WP `toISO()`)
- Display: D/M/YYYY no leading zeros (matches WP screenshot — see `displayDate()` ใน [lib/jobs.ts](lib/jobs.ts))
- Form input: `<input type="date">` returns YYYY-MM-DD natively

### 5.4 Partial-success surfacing
- เมื่อ multi-step write สำเร็จบางส่วน (e.g. addOrder OK + addJob fail) → return 200 with `partial: true` + `warning`
- UI แสดง warning ที่ user actionable (e.g. "ใช้ปุ่มสร้างงานใหม่ใน WP เพื่อ recover")
- Don't pretend it's a hard error (data exists), don't pretend it's clean success (data inconsistent)

### 5.5 Repeater UI for nested-array form data (Photobook items)
- [app/board/order-form.tsx](app/board/order-form.tsx) `<PhotobookRepeater>` — list of objects, add/remove rows, validate-on-submit
- Server type + validator separate: [lib/photobook.ts](lib/photobook.ts) — `PhotobookItem`, `validatePhotobook()` returns `{ ok, cleaned, errors[] }`
- Pattern: client renders rows from state array, callbacks for `update(i, patch)` / `add()` / `remove(i)` keep state pure
- Empty rows dropped before validation — user can leave half-filled draft and it won't trigger errors

### 5.6 Edit-mode prop pattern for forms
- Same form component used for create + edit, distinguished by `initial` prop
- Pattern: `useEffect(() => { if (initial) setX(initial.x); else reset(); }, [open, initial])`
- Edit endpoint takes the same body shape minus the auto-allocated fields (id stays, PIN preserved server-side from existing snapshot)
- See [OrderForm](app/board/order-form.tsx), [JobForm](app/board/job-form.tsx)

### 5.7 Cascade rename on order edit
- WP pattern (production-monitoring.js:1798): when an order's `name` or `dateDue` changes, propagate to matching `jobs` rows via `updateJob` so flow tracking stays linked (`getOrderFlowInfo` matches by orderId+name)
- v2 [/api/orders/update](app/api/orders/update/route.ts) does this server-side: scans `snap.jobs` for `orderId === id && name === oldName`, runs `updateJob` per-row
- Returns `{ cascaded, cascadeFailed }` so UI can surface count

### 5.8 Duplicate detection with `force` override
- Server checks for existing non-cancelled order with same (name, customer) lowercase combo
- If found → return 409 `{ error: 'duplicate', duplicates: [...] }` instead of writing
- Client UI shows confirmation list, user clicks "สร้างต่อ" → resubmits with `force: true` query
- See [/api/orders/add](app/api/orders/add/route.ts) duplicate check + `<DuplicateView>` in OrderForm
- Pattern is reusable for any "warn before overwrite" workflow

---

## 6. Auto-sync / observability patterns

### 6.1 Visibility-aware polling (15s)
- [lib/auto-sync.tsx](lib/auto-sync.tsx) `useAutoSync()` — interval ทำเฉพาะตอน `document.visibilityState === 'visible'`
- Saves Apps Script quota when tab is backgrounded
- Pairs with BroadcastChannel for instant cross-tab updates

### 6.2 Undo provider — page-level toast with 10s window
- [components/board/undo-context.tsx](components/board/undo-context.tsx) — `<UndoProvider>` wraps the board, exposes `useUndo().recordForward({...})`
- After admin forward success, Card calls `recordForward()` with pre-forward snapshot + new job ID
- Provider renders persistent `<UndoToast>` — countdown shown, click "↩ ย้อนกลับ" → POST [/api/jobs/forward-undo](app/api/jobs/forward-undo/route.ts) → atomic restore via `bulkForward(items=1)`
- Auto-expires after 10s, replaces previous entry on new forward
- `<ResultToast>` follows up with success/error message
- Pattern reusable for any "I just did X, click to undo" flow

### 6.3 Audit actor = `admin:dashboard` (known limitation)
- Service token signed once → Apps Script audit log shows `admin:dashboard` for all v2 mutations
- Tech debt: per-user signing at dashboard side (sign with API_SECRET → role+user)
- Documented: [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) §"Known issues" #1

---

## 7. Strangler migration patterns (cross-project)

### 7.1 Shared BroadcastChannel name
- WP + v2 both use `pp_dashboard_sync` → mutating in one notifies the other
- Lets staff use both stacks during transition without stale views

### 7.2 Same Google Sheet, dual frontends
- Single source of truth (sheet ID `1QK20K5F_ucCaUHwqdwBWNp6e8-oZPSfUNsdaFHBtbts`)
- Both stacks call same Apps Script → no data divergence risk
- v2 routes are thin proxies that add session-based auth + role-tightening

### 7.3 Iterative port — ship feature-parity per phase
- Phase 3.5.x iterations (3.5.1 → 3.5.8) each ship one feature path end-to-end
- Don't try to port everything before shipping — staff can use both stacks side-by-side during migration

---

## 8. Things to NOT do (learned the hard way)

- **Don't sequence `deleteJob` + `addJob`** for forward — use `bulkForward(items=1)` (atomic). See §1.1.
- **Don't cache loadAll for write paths** — see §1.3.
- **Don't trust frontend nextId** — always allocate server-side. See §1.2.
- **Don't `loadAll`/`loadAllFresh` for single-order reads** — use `loadOrder(id)` (3× faster). See §1.5.
- **Don't loop `await cancelJob(...)` sequentially** — `Promise.allSettled([...])` parallelizes cascade. See `/api/orders/{cancel,delete}` 2026-05-07.
- **Don't use emoji in UI** — user preference, replaced 43+ instances 2026-05-06. See §4.1.
- **Don't delete on Apps Script "New deployment"** — URL changes, frontends 404. Always "Edit existing → New version".
- **Don't change cookie name without re-login plan** — WP did this in v5.3.0 to force re-login (intentional). Plan it.
- **Don't `--no-verify` git commits** unless user explicitly asks.

---

## 9. Where to add new patterns

ถ้าเจอ pattern ใหม่ใน session ที่ใช้ซ้ำได้:
1. เพิ่มที่นี่ใน section ที่เหมาะสม (สร้าง section ใหม่ถ้าไม่ตรงกับที่มี)
2. ลิงก์ไปยังโค้ด (file:line ถ้าเจาะจง) — ป้องกันคำอธิบายเลื่อน
3. เขียนสั้น: pattern + reason + example file path
4. ถ้าเป็น cross-project pattern → เพิ่มที่ workspace `CLAUDE.md` ด้วย

_อัปเดตล่าสุด: 2026-05-07 PM — added §1.5 (loadOrder single-row reads) + §1.6 (client-supplied snapshots) + 2 entries ใน §8 (lifecycle round-trip audit)_
