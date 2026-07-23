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

### 1.7 Atomic multi-step actions via Apps Script + fallback to legacy multi-call
- เมื่อสร้าง Apps Script action ใหม่ที่รวม multiple writes ใน LockService scope เดียว (e.g. `cancelOrder` = cascade-cancel jobs + flip order status) → v2 route ส่งไปที่ atomic action ก่อน. ถ้า Apps Script ยังไม่ deploy (return `error: 'Unknown action: X'`) → catch + fall through to legacy multi-call path
- **Pattern crystallized 2026-05-07 PM2** (`c95c451`):

```ts
// app/api/orders/cancel/route.ts (sketch)
async function POST(req) {
  const { id } = await req.json();
  // Try atomic action first
  const r = await post('cancelOrder', { id, _actor });
  if ((r as any)?.error === 'Unknown action: cancelOrder') {
    // Apps Script not yet redeployed → fall back
    return cancelLegacyCascade(id);
  }
  if ((r as any)?.error) return NextResponse.json(r, { status: 400 });
  return NextResponse.json({ ok: true, atomic: true, ...r });
}
```

- **Why this matters**: Vercel and Apps Script have different deploy lifecycles. Atomic action ships in Apps Script via clasp + "Edit existing → New version". Vercel ships via `git push`. Without fallback = coordinated-deploy window where v2 ping new action and gets 'Unknown action' (silent breakage). With fallback = Vercel can ship first; Apps Script picks up later; system is correct in either order.
- **Examples**:
  - `bulkForward` auto-alloc id (Phase 2.1 forward perf) — backwards-compat: client allocs id if Apps Script side doesn't auto-alloc
  - `cancelOrder` / `deleteOrderCascade` / `promoteDraft` (PM2 v5.10.4) — full atomic actions with multi-call fallback
- **เมื่อไหร่ไม่ใช้**: New actions where atomicity is required for correctness (no legacy non-atomic equivalent that's safe to fall back to). In that case: deploy Apps Script first, gate v2 push on Apps Script live verification.
- **Trust model**: fallback path = same security as main (route-level role gate, RESTRICTED_TARGETS, signed actor) — fallback is just slower, not weaker.

---

### 1.9 Lazy-load heavy client deps via `next/dynamic({ ssr: false })` + conditional mount (2026-05-07 afternoon, `1d6e57f`)
- เมื่อ component ใช้ heavy library (recharts ~110KB, complex modals) ที่ไม่ได้ใช้ใน first paint → lazy-load ผ่าน `next/dynamic` + `ssr: false` + conditional render
- **Pattern**:
```ts
// app/analytics/charts-lazy.tsx
const KPIChart = dynamic(() => import('./kpi-chart'), { ssr: false, loading: () => <Skeleton /> });
```
```ts
// app/board/card.tsx — conditional mount
{editOpen && <JobForm onClose={...} />}    // chunk fetched on first ✏️ click
```
- **Saving**: /analytics First Load 295KB → 181KB (-39%) on the recharts case
- **What to lazy-load**: heavy chart libs (recharts/d3), admin-only modals (OrderForm, JobForm), complex editors (Markdown, code editors), client-only animation libs
- **What NOT to lazy-load**: forms users always see on a page (OrderForm on /orders/new is the FIRST paint), sidebar/nav (mounts everywhere), small components < 5KB (chunk overhead > saving), components above the fold
- **Trade-off**: First click feels slightly slower (~50-150ms chunk fetch on fast network) but typical-user flows skip the chunk entirely
- **Caveat**: Server Components can't use `dynamic({ ssr: false })` — wrap inside Client Component boundary

### 1.10 React.memo with field-level comparator on context-consuming components (2026-05-07 afternoon, `3cb4501`)
- เมื่อ parent re-renders บ่อย (auto-sync ticks → fresh `jobs[]` from SSR every N seconds) แต่ child ไม่ได้เปลี่ยน → default `React.memo` shallow check fails because every prop ref is new → unnecessary re-renders all the way down
- **Pattern**: provide explicit `arePropsEqual` comparator that checks the fields that actually drive render
```ts
// app/board/card.tsx
export default React.memo(Card, (prev, next) => {
  const a = prev.job, b = next.job;
  return a.id === b.id && a.name === b.name && a.dept === b.dept &&
    a.staff === b.staff && a.dateDue === b.dateDue && a.dateIn === b.dateIn &&
    a.status === b.status && a.orderId === b.orderId &&
    JSON.stringify(a.cowork || []) === JSON.stringify(b.cowork || []);
});
```
- **Saving**: 49/50 cards skip re-render on each auto-sync tick (only the moved card actually changed)
- **Why it works with context**: Internal context updates (BulkMode/PendingMutations/Toast) still re-render via the `useContext` hook subscription path — `arePropsEqual` ONLY governs the prop-change path. Optimistic UI keeps working.
- **เมื่อไหร่ใช้**: list items rendered in a long list where parent re-fetches data (Kanban cards, table rows under polling). Default shallow memo is fine when prop refs are stable.
- **Caveat**: Don't memoize callback props' identity — pass them through `useCallback` in parent; otherwise comparator must skip them and you've subtly disabled re-renders that should fire. Better: derive callbacks from item id inside Card.

### 1.11 Edge runtime for routes using only Web Crypto + cookies + fetch (2026-05-07 afternoon, `3cb4501` + `1d6e57f`)
- Vercel Edge runtime starts ~150-300ms faster than Node serverless on first hit of the day. ทุก auth flow + public-facing route ที่ไม่พึ่ง Node-only APIs → ใช้ edge ได้
- **Pattern**: `export const runtime = 'edge';` ใน route module
- **Verified safe**:
  - `/api/auth/login` + `/api/auth/logout` — uses Web Crypto for HMAC sign/verify, cookies, no Node deps
  - `/api/track/lookup` — public route, signed cookie rate-limit, fetch to Apps Script
- **Don't move to edge** if route uses:
  - Node-only modules (`fs`, `path`, `child_process`, native crypto APIs not in Web Crypto)
  - Sentry server SDK (some integrations are Node-only — verify before flipping)
  - Heavy libraries that pull Node polyfills (look at `next build` output: edge bundle is rejected if too big or uses incompatible modules)
- **Saving**: ~150ms cold-start saved on first login of day; ~150-300ms TTFB win on /track lookup

### 1.12 Backwards-compat param flag for opt-in skip of heavy Apps Script reads (2026-05-07 afternoon, `3cb4501`)
- Apps Script `loadAll` was always returning `recentAudit` (50-100KB) for every page even though only /analytics consumed it
- **Pattern**: add boolean param ที่ default = old behavior, route opts in to skip
```ts
// load.ts
function loadAll(opts?: { audit?: boolean }) {
  const result = { jobs: [...], orders: [...], shipped: [...], cancelled: [...] };
  if (opts?.audit !== false) result.recentAudit = loadRecentAudit();   // default unchanged
  return result;
}
// api.ts switch case
case 'loadAll': result = loadAll({ audit: e.parameter.audit !== '0' }); break;
```
```ts
// lib/api.ts
export async function loadAll() { return fetch(`${url}?action=loadAll&audit=0&token=${tk}`); }
export async function loadAllWithAudit() { return fetch(`${url}?action=loadAll&token=${tk}`); }
```
- **Saving**: -50-100KB Apps Script payload per call on /board, /orders, /calendar, /shipped, /cancelled
- **Why default unchanged matters**: Vercel can ship `loadAll()` (which now sends `audit=0`) BEFORE Apps Script redeploy. Old Apps Script ignores the param, returns full payload — no breakage. New Apps Script honors it, saves bytes.
- **Same pattern reused for atomic-action-with-fallback** (§1.7) — additive flags, default-back-to-old behavior, ship in either order
- **Anti-pattern**: changing default behavior of an existing action ("oh now `loadAll` ALWAYS skips audit") = forces coordinated deploy = brittle. Keep flag opt-in.

### 1.8 Server-computed audit data passed to client modal (no extra round-trip)
- ถ้า client modal ต้องการ derived data (orphan orders, duplicate jobs, etc.) ที่ compute จาก same Sheet snapshot ที่ page already fetched → compute server-side ใน the page route, pass via prop
- **Pattern**: page route ใช้ `loadAll()` (already cached 60s) → derive orphans + duplicates ใน same render path → pass `{orphans, duplicates}` to `<DataAuditModal>` client component
- **Avoid**: client opening modal then firing separate `/api/audit/orphans` fetch — duplicates the snapshot read
- **Example**: [app/orders/data-audit-modal.tsx](app/orders/data-audit-modal.tsx) — receives `orphans`, `duplicates` as props from `app/orders/page.tsx`. Modal renders + lets user act (recover via POST `/api/jobs/add`, remove dup via POST `/api/jobs/delete`)
- **Saving**: 1 round-trip; modal opens instantly with data ready
- **เมื่อไหร่ไม่ใช้**: Audit data that's expensive to compute (e.g. cross-archive scan) — defer to dedicated endpoint with own cache

### 1.13 Batch round-trip collapse: ANY() gate + multi-VALUES INSERT (2026-07-23, `0df9efd`)
- **ปัญหา**: per-item loop ที่แต่ละ item ยิง 2-3 statements = round-trips โตเชิงเส้นตาม batch size (bulk forward 25 งาน ≈ 75 hops ≈ 1-4s บน Neon HTTP driver)
- **Recipe** (คง statement-level race gate ของ §H2 ไว้ครบ):
  1. Validate + dedupe ทั้ง batch ใน JS ก่อน (item เสีย → failed[] โดยไม่แตะ SQL; oldId ซ้ำใน batch = gate-loser class เดิม)
  2. **Gate เดียวครอบทุก row**: `UPDATE ... SET tombstone WHERE id = ANY(${ids}::bigint[]) AND <precondition> RETURNING id` — statement atomicity ยังใช้ต่อ row: id ที่หายจาก RETURNING = แพ้ race → failed[] (ข้อความเดิม)
  3. **INSERT ทุก winner ใน statement เดียว**: `sql.query('INSERT ... VALUES ($1..$10),($11..$20),... ON CONFLICT DO NOTHING RETURNING id', flatParams)` — casts ต่อ value เหมือน template เดิมเป๊ะ (template literal เขียน dynamic VALUES ไม่ได้ — `sql.query` คือทางออก, mock harness รองรับอยู่แล้ว)
  4. **Read-back guard เฉพาะ id ที่โดน ON CONFLICT กลืน** (rare path — reuse `assertNoIdCollision` ต่อ id ได้ ไม่ต้อง batch): identical row = idempotent retry → succeeded; ต่างจริง = collision → compensate + failed
  5. **Compensation 2 ระดับ**: statement ล้มทั้งก้อน → un-tombstone ทุก winner ผ่าน `ANY()`; collision รายตัว → un-tombstone เฉพาะ id นั้น
  6. Side-tables (audit log) → multi-row INSERT function แยก (never-throws contract เดิม)
- **TDD pin**: `callsContaining(gate)/(INSERT)` ต้อง `toHaveLength(1)` ไม่ว่า batch โตแค่ไหน + reject-injection ทดสอบ compensation ทั้ง 2 ระดับ
- **Driver notes**: `ANY(${jsArray}::bigint[])` พิสูจน์บน prod แล้ว (track-customer) — cast ใน template เป็น compile-only, driver ส่ง array ตรงเข้า pg
- **เมื่อไหร่ไม่ใช้**: batch ปกติ ≤1 item เสมอ (เช่น saveQuote/turn) — กำไร ≈ 0 ไม่คุ้ม blast radius ของการแตะ interface

### 1.14 Parallel independent persists before reply (2026-07-23, `14013e1`)
- **ปัญหา**: webhook hot path await DB writes เรียงกันทั้งที่เขียนคนละตาราง ไม่ dependent กัน — ลูกค้ารอ +150-400ms/turn ทับบน LLM latency
- **Recipe**: จัดกลุ่ม ops ตาม dependency จริง → กลุ่มที่ไม่พึ่งกันรวมใน `Promise.all` เดียว; ลำดับข้ามกลุ่มที่เป็น contract (persist-before-reply — กฎ incident 7/23) คงไว้เป็น stage: `all(persists) → all(side-effects) → reply`
- **Semantics ที่เปลี่ยนโดยตั้งใจ**: ตัวใดตัวหนึ่ง reject = ตัวอื่นในกลุ่มยัง**ถูก attempt** (เดิม serial = โดน skip เงียบ) — reply ยังไม่ถูกส่งเหมือนเดิม (Promise.all reject ก่อนถึง reply)
- **TDD pin สำหรับ parallelism** (black-box): mock ตัวแรกให้ reject แล้ว assert ว่าตัวที่สองยังถูกเรียก — ใต้ serial shape เดิม test นี้ RED เอง
- **เมื่อไหร่ไม่ใช้**: writes ที่ order เป็น invariant จริง (เช่น saveQuote ต้องมาก่อน trigger ที่ `loadLastQuote`) — อ่าน dependency จากโค้ดก่อน อย่าเหมารวม

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

### 2.4 Atomic failure-only rate gate: `checkRateLimit` reserve + `refundAttempt` (2026-07-22, `1606099`)
- **ปัญหา**: อยากนับเฉพาะ "ความพยายามที่ล้มเหลว" (PIN ผิด / รหัสผ่านผิด) เข้า lockout counter — pattern เดิม peek-then-record (`peekRateLimit` gate → `recordFailure` หลัง fail) **ไม่ atomic** (requests พร้อมกันอ่านค่า stale หลุด gate) + **off-by-one** (peek deny ที่ `n > limit` = โดนล็อกหลังครั้งที่ limit+1)
- **Pattern**: gate ด้วย `checkRateLimit` (INCR+compare — atomic ระดับ Redis) = *reserve* หนึ่ง attempt ทันที แล้ว `refundAttempt(key)` (DECR; DEL ถ้าติดลบ) คืน budget ในทุก outcome ที่ไม่ควรนับ (สำเร็จ / 404 / 502) → semantics "นับเฉพาะ fail" เหมือนเดิมแต่ race-free
- **เมื่อไหร่ใช้อันไหน**: traffic ที่ success กับ fail แชร์ entry point เดียว + ต้องกัน concurrent slip → reserve+refund (เคส `/track` PIN per-id). ถ้า outcome รู้ช้าหรือ refund แพง/ไม่อยาก INCR ก่อน (เคส login shared office NAT — ทุกเช้า login ถูกพร้อมกันหลายคน ไม่อยากให้ INCR ชั่วคราวชน limit) → peek+record เดิมยังโอเค ตราบใดที่ TOCTOU window ยอมรับได้และมี layer อื่น bound
- อยู่ที่ [lib/rate-limit.ts](lib/rate-limit.ts) `refundAttempt` + ผู้ใช้จริง [app/api/track/lookup/route.ts](app/api/track/lookup/route.ts) Layer 3

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

### 5.9 Optimistic modal close on submit (2026-05-07 afternoon, `3cb4501`)
- เมื่อ submit handler ทำ mutation ที่ไม่เปลี่ยน surrounding card layout (edit job fields, set cowork) → close modal ทันทีบน click + show toast progress + commit() in background
- **Pattern**:
```ts
async function handleSubmit() {
  onClose();                            // 0ms close (was: wait for fetch then close)
  toast.show('กำลังบันทึก…');
  try {
    await commit();                     // background fetch
    toast.show('บันทึกแล้ว', 'success');
  } catch (err) {
    toast.show('บันทึกไม่ได้', 'error');
  }
}
```
- **เมื่อไหร่ใช้**: edit-only mutations where the updated card is in the same column (no movement), cowork updates, settings changes
- **เมื่อไหร่ไม่ใช้**: actions that change card position (forward/reassign — use phantom-card injection §6.2 instead) or where confirmation matters (delete — keep dialog open until success)
- **Saving**: 400ms perceived lag → 0ms close (matches CoworkDialog pattern from PM batch)

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

### 6.4 Smart polling backoff via self-rescheduling setTimeout (2026-05-07 afternoon, `1d6e57f`)
- Replace fixed `setInterval(15000)` with self-rescheduling `setTimeout` whose delay depends on user-activity recency. Idle tabs poll less; active tabs feel real-time.
- **Schedule** (tuned for Penprinting workflow):
  - 15s if last activity within 2 min (active typing/clicking/scrolling)
  - 30s if last activity within 2-10 min (warm tab)
  - 60s if last activity > 10 min (idle tab)
- **Activity events**: passive listeners on `pointerdown`, `keydown`, `wheel`, `touchstart`. Update `lastActivityAt` ref on each.
- **Pattern sketch** ([lib/auto-sync.tsx](lib/auto-sync.tsx)):
```ts
function schedule() {
  const idleMs = Date.now() - lastActivityAt.current;
  const next = idleMs < 120_000 ? 15_000 : idleMs < 600_000 ? 30_000 : 60_000;
  timer.current = setTimeout(async () => {
    if (document.visibilityState === 'visible' && !skipGuards()) await sync();
    schedule();    // re-arm after work completes
  }, next);
}
```
- **Saving**: ~75% Apps Script quota reduction on idle tabs (e.g. dashboard left open overnight no longer pulls 4 reqs/min for 8 hours)
- **เมื่อไหร่ใช้**: any client polling where freshness need scales with user attention. Live Kanban, status pages, monitoring dashboards.
- **เมื่อไหร่ไม่ใช้**: trading/finance/safety-critical UIs where stale data has real cost — fixed interval is correct there
- **Pre-existing visibility-aware skip retained** — backgrounded tabs still skip the call entirely; this just changes the schedule when tab is visible-but-idle

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
- **Don't call `notFound()`/`redirect()` inside a `try` that catches generic errors** — Next's control-flow throws get swallowed by the catch and render as your error UI instead of the 404/redirect. Set a flag in the try, throw outside. (Latent bug in /orders/[id]/edit — caught while porting PERF-H1, `2988153` 2026-07-22.)
- **Don't change cookie name without re-login plan** — WP did this in v5.3.0 to force re-login (intentional). Plan it.
- **Don't `--no-verify` git commits** unless user explicitly asks.

---

## 9. Testing rules (anti-patterns from Superpowers TDD skill, ported 2026-05-23)

> Source: [`superpowers/5.1.0/skills/test-driven-development/testing-anti-patterns.md`](file:///Users/witsarut.p/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/test-driven-development/testing-anti-patterns.md) — condensed สำหรับ TS/vitest stack ของ Penprinting (139 tests). อ่านต้นฉบับเมื่อเขียน test ใหม่ หรือสงสัยว่า mock เยอะเกินไป
>
> **Core principle:** Test what the code does, not what the mocks do. Mocks = isolation tool, not test target.

### 9.1 Iron Laws (3 ข้อ — apply ทุกครั้งก่อนเขียน test)

1. **NEVER test mock behavior** — assertion ที่ผ่านเพราะ mock มีอยู่ ≠ proof ว่า code ถูก
2. **NEVER add test-only methods to production classes** — เช่น `destroy()` ที่ใช้แค่ใน `afterEach()` — ให้ย้ายไป `tests/helpers/`
3. **NEVER mock without understanding dependency chain** — รู้ก่อนว่า real method มี side effect อะไรบ้างที่ test พึ่ง

### 9.2 Gate functions (ใช้เป็น checklist ก่อน assert / mock)

**ก่อน assert ใด ๆ บน mock element:**
```
ถาม: "กำลัง test real component behavior หรือ test ว่า mock มีอยู่?"
ถ้า test mock existence → STOP, ลบ assertion หรือ unmock
```

**ก่อนเพิ่ม method ใน production class:**
```
ถาม: "method นี้มีแค่ test ที่เรียก?"
ถ้าใช่ → STOP, ย้ายไป tests/helpers/
```

**ก่อน mock method ใด ๆ:**
```
1. ถาม: real method มี side effect อะไร?
2. ถาม: test พึ่ง side effect ตัวไหนของมั้ย?
3. ถ้าพึ่ง → mock ที่ระดับล่างกว่า (slow/external operation จริง) ไม่ใช่ high-level method
4. ถ้าไม่แน่ใจ → รัน test ด้วย real implementation ก่อน ดูว่าพังตรงไหน
```

### 9.3 Anti-pattern: incomplete mocks

```typescript
// ❌ BAD — mock เฉพาะ field ที่นึกได้
const mockOrder = {
  id: 123,
  customer: 'ACME',
  // missing: dateIn, dateDue, status, jobs[] — downstream code อ่าน
};

// ✅ GOOD — mirror real schema ครบ
const mockOrder: Order = {
  id: 123, customer: 'ACME', dateIn: '...', dateDue: '...',
  status: 'open', jobs: [], pin: null, /* …all fields */
};
```

**Iron Rule:** mock ต้อง mirror real data structure ครบ — partial mock fail เงียบเมื่อ downstream code อ่าน field ที่ขาด. ใช้ TS type (เช่น `Order`, `Job`) เป็น shape contract — `satisfies Order` บังคับ compile-time check

### 9.4 Red flags — สังเกตในตัวเอง

- assert ที่ check `*-mock` test ID
- method ใน production code ที่ถูกเรียกแค่ใน `tests/*`
- mock setup ยาวกว่า test logic
- test พังเมื่อลบ mock ออก
- อธิบายไม่ได้ว่าทำไมต้อง mock ตัวนี้
- "mock เผื่อ safe" — เป็น smell

### 9.5 Penprinting-specific implications

- **`tests/postgres-write.test.ts` (42KB)** = แม่บทของ pattern ที่ดี — ใช้ vitest + pg-mem (real Postgres semantics ใน memory) ไม่ mock SQL queries → test catch SQL behavior ของจริง
- **ถ้าจะ test poll-loop effect** (เป้า B consolidate session หน้า) — อย่า mock `setTimeout` / `BroadcastChannel` — ใช้ `vi.useFakeTimers()` + real `BroadcastChannel` API
- **API route handlers** — test handler โดยตรง (call `POST(req)` กับ `Request` จริง) ดีกว่า mock `next/server` — handler return type คือ `NextResponse` ตรง ๆ

---

## 10. Where to add new patterns

ถ้าเจอ pattern ใหม่ใน session ที่ใช้ซ้ำได้:
1. เพิ่มที่นี่ใน section ที่เหมาะสม (สร้าง section ใหม่ถ้าไม่ตรงกับที่มี)
2. ลิงก์ไปยังโค้ด (file:line ถ้าเจาะจง) — ป้องกันคำอธิบายเลื่อน
3. เขียนสั้น: pattern + reason + example file path
4. ถ้าเป็น cross-project pattern → เพิ่มที่ workspace `CLAUDE.md` ด้วย

_อัปเดตล่าสุด: 2026-05-23 — added §9 (Testing rules — ported from Superpowers TDD anti-patterns)_
