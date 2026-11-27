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

### 1.15 Windowed list reads + check/reconcile delete detection (2026-07-24, `29baea0` + `b56b156` + `3923558`)
- **ปัญหา 3 หน้าเดียวกัน**: list-shaped reads ที่ payload/queries โตเชิงเส้นตาม row count ตลอดไป — bootstrap ไม่มี LIMIT · poll ส่ง id array เต็มเพื่อจับ hard-delete ที่นานๆ เกิด · bootstrap ไม่ coalesce ข้าม tabs
- **Recipe window (ที่ DB ไม่ใช่ client)**:
  1. เลือก **window เดียว** (`LIST_WINDOW = '12 months'`) แล้ว apply กับ *ทุกชิ้นที่ cross-reference กัน* — rows, id sets, checks, orderId sets. Half-windowed pair = badge/orphan logic เพี้ยนเงียบ
  2. **Invariant ที่ทำให้ window ปลอดภัย**: event rows (ship/cancel) เกิด*หลัง* order creation เสมอ ⟹ order อยู่ใน window ⟹ event rows อยู่ด้วย — พิสูจน์ก่อนตัด อย่าเดา
  3. Rows ที่ foreign key ยังอ้างถึง (orders ของ active jobs) → **UNION เข้า window เสมอ** ไม่ว่าอายุเท่าไหร่
  4. เลือก timestamp ให้ตรง semantic: id scheme ที่ encode เดือน (YYYYMM×1000) = เดือนจริง ดีกว่า `imported_at` ที่เป็น backfill date ของ rows ที่ bulk-migrate
  5. Incremental delta ไม่ต้อง window (cursor ครอบแล้ว) — pin ด้วย test กัน over-apply
- **Recipe check/reconcile (แทน full id array ทุก poll)**: default poll ส่ง `{count, maxId}` windowed (~30B); client เทียบกับ merged state ผ่าน pure fn → mismatch = re-poll พร้อม `?ids=1` **ครั้งเดียว** แล้วใช้ allow-list drop เดิม. Row aging out ของ window ก็ heal ผ่านเส้นเดียวกัน. ไม่มี tight loop by construction: reconcile response ทำให้ state match checks ของ response ตัวเอง
- **Recipe coalesce**: bootstrap ผ่าน `unstable_cache` (tag เดียวกับ write invalidation, revalidate = poll floor) — cursor stale ≤ revalidate แค่ over-fetch poll แรก (merge idempotent). **อย่า cache payload ที่เสี่ยงเกิน ~2MB data-cache entry limit** (fullLists) — ตัดสินต่อ variant ไม่ใช่เหมารวม
- **TDD pin**: SQL shape (window param ใน values + `id >=` ใน text) · pure fns (staleness matrix: clean/deficit/maxId-drift/empty) · cache routing ผ่าน passthrough mock ที่ record registrations (`tests/helpers/mock-next-cache.ts`)

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

### 2.5 One-shot admin data-repair endpoint — POST apply + retire หลังรันจบ (2026-08-21, audit L1)
- **Template เดิม** (fix-date-anomaly → cleanup-orphan-cancelled): dry-run default + `?apply=1`, conditional-gated statement เดียว + RETURNING, audit_log, cache bust, idempotent — ส่วนนี้ดีแล้ว ใช้ต่อ
- **จุดที่แก้**: `?apply=1` บน **GET** + cookie `SameSite=Lax` = mutation โดน CSRF ได้ทาง top-level link click (Lax ส่ง cookie บน cross-site GET navigation) — impact ต่อ endpoint ที่ pin target + idempotent ≈ ศูนย์ แต่ template นี้ถูก copy ต่อเรื่อยๆ → ตัวถัดไป: **GET = dry-run / POST = apply**
- **Retire หลังรันจบ**: endpoint ที่ apply บน prod สำเร็จ + verified แล้ว ไม่มีเหตุผลอยู่ต่อในโค้ด — ลบ route + lib + tests ทั้งก้อน (git history เก็บไว้ให้อยู่แล้ว ถ้าต้อง resurrect ก็ cherry-pick) — เคสแรกที่ retire: `cleanup-orphan-cancelled` (applied 2026-08-20, retired 2026-08-21) · เคสที่สอง: `fix-date-anomaly` (applied 2026-06-04 [`608f145`](https://github.com/witsarutnook/penprinting-dashboard/commit/608f145), retired 2026-08-21 — ก่อนลบ dry-run บน prod ยืนยัน no-op ครบ 3 orders 202605046/047/049, `pendingChangeCount: 0`)
- **Control บนข้อมูลจริงก่อนเขียน (2026-11-21 → รัน 2026-11-27, `backfill-markers`)**: ตัวซ่อมที่ *สร้างค่าใหม่* (ไม่ใช่ลบ/ย้ายแถว) ต้องพิสูจน์สูตรกับแถวที่ยังดีอยู่ก่อน — GET คืน 3 รายการ: `missing` (จะเติมอะไร + `patchable`) · `unseen` (แถวที่ระบบรู้จักแต่ตัวซ่อมสร้างค่าให้ไม่ได้ — ให้คนดู ไม่เดา) · `control` (สร้างค่าของแถวที่ยังมีค่าอยู่ แล้วเทียบกับของจริง). POST ปฏิเสธ (409) ถ้า control เทียบได้ 0 แถว หรือมีแถวที่ต่าง. "เสร็จ" = `nothingLeft` (ทั้ง `missing` และ `unseen` ว่าง) ไม่ใช่ `missing` ว่างอย่างเดียว. ผลจริง: control 26 ใบ ต่าง 0 → เติม 3 ใบ → GET ซ้ำ 2 ครั้ง `nothingLeft` → retire [`4e7e071`](https://github.com/witsarutnook/penprinting-dashboard/commit/4e7e071). **รัน GET ก่อนบอกขอบเขตให้เจ้าของงาน**: ตัวเลขที่คาดจากการเช็คบางช่วง (2 ใบ จากการไล่ตั้งแต่ #202611102) ไม่เท่ากับที่ GET เจอ (3 ใบ — มี #202611094 จากก่อนช่วงนั้น)
- **ตัวซ่อมที่ *ออกค่าใหม่* (ไม่มีค่าเดิมให้เทียบ) — `reissue-pins` (2026-11-27, รันแล้ว + ลบแล้ว)**: ไม่มี control แบบ "สร้างค่าของแถวที่ยังดีแล้วเทียบ" ให้ใช้ → ใช้ 4 อย่างแทน: (1) นิยาม "เข้าเงื่อนไข" **ข้อความเดียว** ฝังทั้งใน SELECT ของ dry run และ WHERE ของ UPDATE; (2) POST รับ **รายการ id ที่เจ้าของงานเห็นใน dry run** — ใบที่โผล่มาใหม่ระหว่างนั้นไม่ถูกเขียน (บทเรียน "คาด 2 เจอ 3" ของเช้าวันเดียวกัน); (3) ทุกที่ที่ UPDATE จะเขียนต้อง **เป็น object อยู่แล้ว** — ไม่สร้างจากความว่าง (§12.6 ข้อ 8); (4) ก่อน/หลังรัน เก็บ hash ของทุก key ที่ไม่ใช่ key ที่ซ่อม แล้วเทียบ — พิสูจน์ว่าแตะเฉพาะที่ตั้งใจ. ค่าที่ออกใหม่ไม่ใส่ใน response/แถวประวัติ (อ่านจากหน้าของใบ). แถวประวัติเขียน **ต่อใบพร้อม targetId** จะอ่านกลับได้ทาง `/api/audit?orderId=` (ตัวซ่อมของเช้าวันเดียวกันเขียนแถวเดียวไม่มี target → ยืนยันไม่ได้)
- **Read-only census variant (2026-10-21, audit L14)**: ก่อนตัดสิน follow-up เรื่อง data shape/parser drift ที่ไม่เคยนับข้อมูลจริง → endpoint แบบเดียวกันแต่ **GET = ผลลัพธ์เดียว ไม่มี apply/params** (`date-shape-census`): นับ distinct shape ที่ไม่ canonical + ≤5 sample (id+value) ต่อ class **ทั้งคอลัมน์ TEXT และ `raw` JSONB ที่แอป render จริง** (dashboard อ่าน `SELECT raw` ไม่ใช่คอลัมน์) + mismatch count, และให้ endpoint **คำนวณ drift ระหว่าง reader ทุกตัวบนเซิร์ฟเวอร์เลย** (host TZ = Vercel UTC = สภาพจริงของ /track + LINE) — ผลจริง: shape ที่คาดว่าเป็นปัญหา (quoted/`…Z`/comma) = 0 แถว, ที่ drift จริง = `Date.toString()` ×455 ที่ display ถูกแต่ compute path อ่าน host-local → ตัดสิน L13 ด้วยตัวเลข. หลังแก้ seam → **re-run census บน prod ยืนยัน drift 0 ก่อน retire** (เทสต์พิสูจน์ logic, census พิสูจน์ข้อมูล). Table/column names มาจาก pinned list, regex bind เป็น parameter. Retired หลังบันทึกลง AUDIT-BACKLOG (same-day)

### 2.6 ปลายทางที่มาจาก URL (`?next=`): ตรวจแล้ว **คืนค่าตามที่รับมา** — ห้ามคืนค่าที่ parser จัดรูปใหม่ ([lib/safe-next-path.ts](lib/safe-next-path.ts)) (2026-11-27, audit M7)
- **ปัญหา**: หน้า login ทำ `window.location.href = next` โดย `next` มาจาก `?next=` ตรง ๆ → ลิงก์ที่ถูกแต่งพาผู้ใช้ออกเว็บอื่นหลังกรอกรหัสผ่าน; ค่า `javascript:` จะรันใน origin ของเรา
- **กฎ**:
  1. รับเฉพาะ path ของเว็บเรา: ขึ้นต้นด้วย `/` ตัวเดียว · ไม่มี backslash (เบราว์เซอร์อ่าน `/\` เป็น `//`) · ไม่มีอักขระควบคุม (เบราว์เซอร์ตัดแท็บ/ขึ้นบรรทัดใหม่ทิ้งก่อนอ่าน → `/<tab>/x.com` = `//x.com`) · resolve กับ origin สมมติแล้วยังอยู่ origin นั้น
  2. **คืนค่า input เดิม ไม่ใช่ `url.pathname`** — parser พับ dot segment: `/.//example.com` อยู่บน origin เรา แต่ `pathname` ของมันคือ `//example.com`. ร่างแรกคืนค่าที่จัดรูปแล้ว = เปิดช่องเอง. และปฏิเสธเมื่อ pathname ที่ได้ขึ้นต้นด้วย `//`
  3. หน้าเท่านั้น: segment แรก (ถอด `%` + ตัวเล็ก จาก path ที่ parser ได้) เป็น `api` / `_next` / `login` = ไม่รับ — route ของ admin บางตัวเขียนข้อมูลบน GET
  4. เทสต์เป็น **คุณสมบัติบน corpus**: ทุกค่าที่ฟังก์ชันคืนต้อง resolve กับหน้าจริงแล้วอยู่บน origin เรา และเท่ากับ input หรือค่า default เท่านั้น. corpus ต้องมีอักขระนอก ASCII (fullwidth slash, zero-width) — ไม่งั้นเวอร์ชันที่ normalize แบบ NFKC ผ่านเทสต์
  5. ตัวตรวจแบบนี้ให้คนนอกลองเจาะ + รันฟังก์ชันจริงในเบราว์เซอร์จริงบน origin จริง (parser ที่ตรวจต้องเป็นตัวเดียวกับที่นำทาง)
- **ไฟล์**: [lib/safe-next-path.ts](lib/safe-next-path.ts) · [app/login/form.tsx](app/login/form.tsx) · เทสต์ `tests/safe-next-path.test.ts`

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
- **Parsing (อ่าน cell ที่เก็บแล้ว): seam เดียว `parseDateParts()` ใน [lib/jobs.ts](lib/jobs.ts)** (L13 2026-10-21) — `displayDate`/`displayDatePadded` (render), `parseDateDMY` ใน lib/analytics (daysLeft/urgency, month buckets, list filters, calendar → host-local **midnight** Date ของวันนั้น) และ `dmyToISOInput` (prefill ฟอร์มแก้ไข) อ่านผ่านตัวนี้ทั้งหมด → วันที่ลูกค้าเห็น = วันที่คำนวณ = วันที่ prefill เสมอ ไม่ขึ้นกับ TZ ของ host. กฎ: ISO ไม่มี zone → ตามที่เขียน · D/M/YYYY + ช่องว่าง/comma + อะไรก็ได้ → ส่วนวันที่ · อย่างอื่นที่ `new Date()` อ่านได้ (`…Z`, `+07:00`, `Date.toString()`) → วัน Asia/Bangkok · quote-wrapped → unwrap ก่อน. **ห้าม** เพิ่ม `new Date(cell)` ใหม่ที่อื่น (ที่เหลือนอก seam: `displayDateTime` ซึ่งต้องการเวลา และ `lib/morning-report.ts:82`). เทสต์ต้องรันทั้ง `TZ=UTC` และ `TZ=Asia/Bangkok` (ตั้ง `process.env.TZ` ในเทสต์ได้ — Node อ่านใหม่ทุกครั้ง)
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
- **Schedule** — ⚠️ ตัวเลขด้านล่าง + sketch เป็นของเดิม 2026-05-07; **ปัจจุบัน** (source of truth = [lib/poll-schedule.ts](lib/poll-schedule.ts), loop อยู่ใน [lib/delta-sync.tsx](lib/delta-sync.tsx)): 15s (<2 min) → 30s (2-5 min) → 120s (5-30 min) → **หยุดสนิทหลัง 30 นาที** ไม่มี activity (PA-H1 2026-05-19) — input/visibility กลับมา = refresh ทันที. วัดจริง 2026-10-03: hidden 25 นาที = 0 fetch, visible idle = 1 fetch ว่าง/15s 0 re-render
  - (เดิม) 15s if last activity within 2 min (active typing/clicking/scrolling)
  - (เดิม) 30s if last activity within 2-10 min (warm tab)
  - (เดิม) 60s if last activity > 10 min (idle tab)
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

### 6.5 สิ่งที่ส่งออกไป error tracker: ตัดตามตำแหน่ง ไม่ตามชื่อ + ยืนยันด้วยของที่ปลายทางเก็บจริง ([lib/sentry-scrub.ts](lib/sentry-scrub.ts)) (2026-11-27, audit M3)
- **ปัญหา**: `@sentry/nextjs` 10 ใส่ header ของ request ลง root span ของทุก request ที่ถูกสุ่ม (attribute ต่อ cookie: `http.request.header.cookie.<ชื่อ>`) และปิดค่าเฉพาะ cookie ที่ **ชื่อ** มีคำในรายการของ SDK (auth, session, token, …). `pp_dashboard_v6` ไม่เข้าคำใด → ค่า cookie ล็อกอิน 30 วันถูกส่งทั้งค่า (20,800 spans เมื่อพบ) และอยู่ใน `request.cookies` ของ error event ด้วย. `sendDefaultPii: false` (ค่า default) ไม่ได้กันเรื่องนี้
- **กฎ**:
  1. ตัดตาม **ตำแหน่ง** (ทุก cookie, header Authorization, body ของ request) ใน hook ของ SDK เอง (`beforeSend` + `beforeSendTransaction`) — ไม่พึ่งการตั้งชื่อ cookie ให้ "ดูเป็นความลับ". hook ต้องคืน event เสมอ (คืน null = event หาย)
  2. **ยืนยันจากของที่ปลายทางเก็บจริง ไม่ใช่จากโค้ด**: เปิด span/event ในเครื่องมือนั้นดูชื่อ attribute ทั้งหมด (ให้สคริปต์ปิดค่าก่อนแสดง — ไม่ดึงค่าความลับเข้ามา) · หลังแก้ เทียบ span ของ deployment เก่ากับใหม่ด้วย attribute ที่บอก deployment (`x_vercel_deployment_url`) — ต้องเห็นทั้ง "ของเก่ามี" และ "ของใหม่ไม่มี แต่ attribute อื่นยังอยู่"
  3. อัปเกรด SDK = เช็คซ้ำ: SDK รุ่นใหม่เปลี่ยนสิ่งที่เก็บโดย default ได้ (header ลง span เป็นของรุ่น 10); span streaming (`traceLifecycle: 'stream'`) ไม่ผ่าน `beforeSendTransaction`
  4. sampling ตาม trace ของหน้า: fetch ซ้ำ ๆ จากหน้าเดียวไม่ได้ span ใหม่ถ้าหน้าไม่ถูกสุ่ม — ใช้ span ของการโหลดหน้าเป็นตัวอย่างหลัง deploy
- **ของที่ส่งไปแล้ว**: อยู่ที่ปลายทางจนหมดอายุการเก็บ — ทำให้ใช้ไม่ได้ด้วยการหมุน secret ที่ใช้เซ็น (`DASHBOARD_AUTH_SECRET`)
- **ไฟล์**: [lib/sentry-scrub.ts](lib/sentry-scrub.ts) · `sentry.server.config.ts` · `sentry.edge.config.ts` · เทสต์ `tests/sentry-scrub.test.ts` (รวมเทสต์ว่า init ทั้งสองตัวต่อ hook จริง)

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

### 7.4 Shared semantic core — surface ที่ port มาต้องใช้ผลลัพธ์ให้ครบทุก field (2026-09-17, `3952c33`)
- `lib/track-status.ts` (`deriveTrackStatus`) ถูกสกัดมาเพื่อให้ `/track` เว็บ · การ์ด Flex `/track` · การ์ดรายการงานลูกค้า ตัดสินสถานะเหมือนกัน — presentation แยกตาม surface ได้ แต่ **semantic ต้องมาจาก core ตัวเดียว**
- กับดัก: field ที่เพิ่มเข้า core ทีหลัง (`awaitingShipment`) ไหลเข้าแค่ 2 ใน 3 surface — `lib/ai-quote/track-flex.ts` ยังอ่านแค่ `currentDept` อยู่หลายเดือนโดยไม่มีอะไรเตือน
- กฎ: เพิ่ม field เข้า shared core เมื่อไหร่ → `grep` ทุก caller แล้วไล่ให้ครบทุก surface ในคอมมิตเดียว + เทสต์ต่อ surface (ไม่ใช่เทสต์แค่ที่ core)
- เทสต์ที่จับได้: `tests/ai-quote-track-flex.test.ts` เคส `staff=ship` — เทสต์ core อย่างเดียวผ่านหมดทั้งที่ surface เพี้ยน

### 7.5 สินค้าแบบตารางขั้นราคา + รูปตารางคู่กัน (2026-10-19, `c3d1da7..7a2c714`)
- **เมื่อไหร่ใช้ tier table แทนสูตร**: ราคาที่ทีมตั้งเป็นขั้น (จำนวน → บาท/หน่วย) อยู่แล้ว ไม่มีสูตรกระดาษ/แม่พิมพ์ให้ derive (นามบัตร · ปฏิทิน · บัตร PVC) — เก็บตารางใน `DEFAULT_CONFIG` ตรงๆ อย่าสร้างสูตรปลอมที่ fit ตัวเลข
- **helper เกลี่ยตัวเดียวทุกตาราง** (`tierUnitPrice` ใน calc): ช่วงที่เป็นช่วง = ราคาคงที่ · ระหว่างจุดติดกัน = เกลี่ยเชิงเส้น · ปัดขึ้นขั้น 0.25 — ตารางใหม่ = เพิ่มข้อมูล ไม่เพิ่มโค้ด
- **ขอบตาราง = 422 ที่ recoverable** (`below_min` / `above_max` + message): model ได้ข้อความจริงไปแจ้ง/ส่งต่อ แทนการเดาหรือลากเส้นต่อเอง — เกินตาราง → วลี hand-off pin · ต่ำกว่าขั้นต่ำ → แจ้งแล้วถามต่อ (ห้ามใช้วลี pin)
- **tool ที่ไม่มี I/O เป็นสัญญาณให้ router** (`send_price_table` → `{ sent: true }`): model "บอก" ว่าเทิร์นนี้ควรส่งรูปอะไร, `runQuoteTurn` รวมเป็น `priceTables` (dedupe) แล้ว router ประกอบ `[image…, text]` — model ไม่แตะ URL/ช่องทาง/ข้อจำกัด array เลย
- **รูปกับตัวเลขต้องเปลี่ยนคู่กัน**: รูปอยู่ dashboard, ราคาอยู่ calc → แก้คู่ 2 repo (deploy ให้ใกล้กัน — ลำดับไหนก็มีช่วงสั้นๆ ที่รูปกับเลขไม่ตรง) + **รูปใหม่ใช้ชื่อไฟล์ใหม่** (URL ไม่มี version → CDN/client cache ตาม URL; `is_reusable: true` ของ Messenger แค่ให้ Meta คืน `attachment_id` ที่เราไม่ได้เก็บ จึงไม่มี reuse จริง — เหตุผลของกฎคือ cache ตาม URL). ⚠️ id ของตาราง = ชื่อไฟล์ (`priceTableUrl = ${id}.jpg`) และ id ถูกฝังใน prompt ทั้งสอง (`prompt.ts` + `prompt-customer.ts` กฎ `send_price_table`) + เทสต์ → ชื่อใหม่ = **id ใหม่ใน `price-tables.ts` + แก้ prompt ทั้งสอง + เทสต์** ไม่ใช่แค่แก้ `price-tables.ts`; ทางเลือก: แยกชื่อไฟล์ออกจาก id ด้วย file map (id คงที่ → แก้แค่ map + ไฟล์)
- **calc ไม่มี unit test → `scripts/smoke-baselines.json` คือ suite เดียว**: ใส่ค่ามือคำนวณจาก spec ก่อนเขียนโค้ด (RED) แล้วทำให้โค้ดตามเลข — ห้ามดัดเลขตามโค้ด · pin ทุก field (`unitPrice` `totalPrice` `designFee` `sheetsPerSet`) + เคส 422 ผ่าน `expectStatus`

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
- **Don't เทียบการ์ด LINE กับหน้าเว็บโดยไม่ส่งการ์ดใหม่ก่อน** — Flex message เป็นภาพนิ่ง ส่งแล้วไม่อัปเดตตาม DB. screenshot การ์ดเก่า + เว็บสดคือ snapshot คนละเวลา จะได้ "บั๊ก" ปลอม (2026-09-17: ชื่อลูกค้าที่ดูเหมือนไม่ตรงกัน จริงๆ คือข้อมูลถูกแก้ระหว่างสองช็อต)
- **Don't เห็นด้วยกับสมมติฐานที่ตรวจสอบได้โดยยังไม่ตรวจ** — "น่าจะแค่ font" ใช้เวลาพิสูจน์ 2 นาทีด้วย `sharp` (ซูม 10×: U/S ละติน vs บ/ร มีหัวขมวด = คนละ string จริง). `sharp` มีใน `node_modules` อยู่แล้ว ส่วน PIL/ImageMagick ไม่มีใน cloud container

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

_อัปเดตล่าสุด: 2026-11-27 (ค่ำ) — §2.6 (ปลายทางจาก URL: คืนค่าตามที่รับมา); เย็น: §12.6 ข้อ 7–9 (PIN: ไล่ทุก key + ทุกทางเข้า · ตัวอ่านเลือกสำเนาไหนก่อน · นิยาม "มี key" ที่เดียว) + §6.5 (สิ่งที่ส่งออกไป error tracker); ก่อนหน้า: 2026-11-27 — added §12.6 (key ของเซิร์ฟเวอร์ใน JSON ที่ฟอร์มเขียนทับ) + bullet ใน §2.5 (control บนข้อมูลจริงก่อนเขียน)_

## 11. Eval harness สำหรับ LLM flow (2026-10-24, `eval/pp-customer/`)

### 11.1 เรียก entry point จริง ไม่เขียน API call ใหม่
- runner เรียก `runQuoteTurn` ตัวเดียวกับ prod ผ่าน deps ที่ประกอบเหมือน `customer-deps.ts` ทุกอย่าง ต่างแค่ `client` เป็น recorder บางๆ รอบ `Anthropic.messages.create` (เก็บ request/response ทุก round → transcript + usage) และ `compute_quote` ชี้ calc dev server local (`.claude/launch.json` → `calc-dev` :3100 token `test`) = โค้ด path เดียวกับ prod โดยไม่ต้องใช้ secret prod
- import TS ของแอปนอก Next: `node --import tsx --conditions=react-server` (ทำให้ `import 'server-only'` เป็น no-op) · named exports อยู่ใต้ `.default` (CJS interop) → `pick(m,k)`
- ห้ามแตะ `run-eval.mjs` (scaffold จาก Claude API skill: resume ต่อ `(case, rep)`, backoff, ceiling, served-model assert, errors sidecar, harness sha gate) — ส่วนของแอปอยู่ `impl.mjs` อย่างเดียว

### 11.2 Grader = กฎแข็งด้วยโค้ดก่อน กรรมการ LLM เฉพาะที่ต้องใช้วิจารณญาณ
- กฎที่ตรวจด้วยโค้ดได้ต้องตรวจด้วยโค้ด: outcome ของเทิร์น (quote/ask/escalate/template/table จาก signal เดียวกับที่ router ใช้ เช่น `detectCustomerEscalation`) · สเปกที่ส่ง tool (partial match แบบ recursive — pin เฉพาะ field ที่ label ระบุ) · **ทุก "N บาท" ในคำตอบต้องเป็นเลขจาก tool result ของเทิร์นนี้** (จับราคาเดา/เลขเก่าจาก history) · format (markdown, VAT note, disclaimer, วลีส่งต่อเฉพาะตอนส่งต่อจริง — วลีนี้ปิดโหมด AI, 📊 เฉพาะเมื่อส่งตาราง)
- กรรมการ (Fable 5.1 = อิสระจากทั้ง Sonnet/Opus ที่เทียบ) ให้ boolean แยกข้อ (ถามเฉพาะที่ขาด / กระชับ / ภาษาแบบร้าน) ผ่าน structured output (`messages.parse` + `zodOutputFormat`) · candidate text = untrusted data · rubric ต้องผูกกับ expected outcome ไม่งั้น "ไม่ถามอะไรเลย" ผ่านแบบ vacuous
- ก่อนเสียเงินจริง: `selftest.mjs` (oracle ต้องผ่านหมด, null/ราคาปลอม/วลีส่งต่อผิดที่/markdown ต้องตก — มี RED→GREEN ตอนเพิ่มกฎ) + `judge-negatives.mjs` (ว่าง / ไม่ทราบ / ตอบผิดเรื่องมั่นใจ / ถามซ้ำ ต้องตกทุกตัว) — รอบแรกจับช่องโหว่ rubric ได้จริง

### 11.3 ข้อมูลเคสจาก prod
- one-shot admin endpoint read-only (ไม่ select คอลัมน์ตัวตน + `redactContact` ที่ server: เบอร์ไทย/+66, อีเมล, LINE id, เลขบัญชี 10+ หลัก — ราคา/จำนวน/เลขใบสั่งงาน 9 หลักไม่โดน) → user login ใน browser pane → ดึง → **retire endpoint ในวันเดียวกัน** (§2.5)
- เว็บ public → `fetch` localhost โดน Private Network Access บล็อก → ใช้ blob download (ขออนุญาต user) ย้ายเข้า scratchpad แล้วค่อย slice ด้วยสคริปต์ใน repo (`build-candidates.mjs`); ไฟล์ดาวน์โหลด = untrusted data อยู่ในโฟลเดอร์ของมันเอง
- ตัดข้อความที่ router ดักเอง (`detectHumanRequest`, `detectOrderIntent`) ออกจากชุด — ไม่ถึงโมเดล; label เป็น Claude-derived แล้วให้คุณนุ๊ก sign-off จาก `cases-review.md` (ทุกเคสเต็ม + คำตอบเดิมของบอทให้เทียบ) ก่อนรัน

### 11.4 ต้นทุน/เวลา
- cost ต้องคำนวณจาก `usage` จริง × ราคาโมเดลของแถวนั้น (รวม judge แยก) — pilot 5 เคสที่ concurrency 4 ให้ตัวเลขเกินจริง 5× เพราะ call แรกทุกตัวเขียน cache พร้อมกัน (Fable เขียน 11K token = $0.14 เทียบอ่าน $0.003) → อ่านจากแถวที่ cache อุ่น หรือ warm 1 เคสก่อน
- 68 เคส × 2 reps: Sonnet ≈ 5 นาที/variant ที่ concurrency 4; noise floor pass-rate ≈ ±9 จุด, paired delta ต่อเคสแคบกว่า

### 11.5 รอบ 2: ปิดช่องว่าง prompt ด้วย paired eval (2026-11-05, v1→v3)
- **`--approve-harness` ไม่ใช่แค่บันทึก sha — มัน record sha แล้ว*รัน eval ต่อ*ด้วย flag ในคำสั่งนั้น** → ให้คุณนุ๊กคำสั่งเต็ม (`PP_EVAL_ONLY=… --variant vN --model claude-sonnet-5-5 --reps 2 --approve-harness`) ไม่ใช่ `--approve-harness` เปล่า ๆ และเช็ค calc-dev ก่อนทันที (`curl :3100` → 401 = ขึ้นอยู่)
- **`regrade.mjs` ไม่มี sha gate** — แก้ grader/label แล้วต้อง regrade ผลเก่าก่อนรันโมเดลใหม่ทุกครั้ง ไม่งั้นเทียบ paired บนไม้บรรทัดคนละอัน (รอบนี้ baseline 126→119/136 หลังแก้ label)
- **baseline เคสใหม่ด้วย prompt เก่าก่อน apply prompt ใหม่** — ไม่งั้นไม่มีคู่ให้เทียบ (9 synthetic: baseline ผ่านแค่ 6/18 แล้วค่อย apply v2)
- **ค่าคงที่ใน grader ต้องผูกทั้งบริบทและบรรทัด** — whitelist ทั้งคำตอบปล่อย "เล่มละ 15 บาท" ผ่านในที่ที่ไม่ใช่บรรทัดสันห่วง (I1) → match 300 ค่าออกแบบ / 15 สันห่วง ในบรรทัดที่ถูกบริบท + `\s*บาท`
- **เกณฑ์ ship = เป้าหมาย 2/2 + ไม่มี paired hard regression ไม่ใช่ point estimate** — v2 ดู +16.9 จุดแต่มี regression เดียว (s75-t0) → ไม่ ship, แก้เป็น v3
- **กฎ prompt รั่วข้ามชนิดสินค้า** — scope ทุก default ตามสินค้า: "อาร์ตมัน = Art 120" ใช้กับใบปลิวแผ่นเดียวเท่านั้น ไม่งั้นหนังสือเลิกถามแกรมเนื้อใน
- **รีวิวทั้ง branch (final whole-branch review) ก่อน push production** — รอบเดียว deploy เดียว; รอบนี้จับ I1 grader ที่ผ่าน task review รายตัวมาหมด
- **metric กรรมการ (judge_*) เป็นข้อมูลประกอบ** — ไม่ใช่ gate (within noise ±); gate ใช้กฎแข็งด้วยโค้ดเท่านั้น


### 11.6 รอบ 3: หมวด hand-off ใน prompt ต้องเทียบกับสิ่งที่ tool ตอบได้ (2026-11-09, v3→v4)
- **วลีส่งต่อ = ประตูทางเดียว** — `detectCustomerEscalation` จับ "ส่งต่อทีมงาน/ให้ทีมงานประเมิน" แล้ว `exitLineMode` ปิดโหมด AI ลูกค้าถามต่อกับบอทไม่ได้ → กฎ prompt ที่โยน*ทั้งหมวด*ไปส่งต่อ ("ขอส่วนลด → ส่งต่อ") ต้องถามก่อนว่า **ในหมวดนั้นมี intent ที่ tool ตอบได้ไหม** — "สั่งเยอะขึ้นถูกลงไหม" คือคำถามเรื่องจำนวนที่ `compute_quote` ตอบได้อยู่แล้ว แต่คำว่า "ลดราคา" ลากไปหมวดส่วนลด (เคส LINE 11/09)
- **แยก intent ด้วยสัญญาณในข้อความ ไม่ใช่คำหลัก** — มีจำนวนใหม่/ถามเรื่องจำนวน = คำถามราคา (เรียก tool หรือถามจำนวน) · ขอลดจากราคาที่แจ้งแล้วโดยไม่มีจำนวนใหม่ = ขอส่วนลด (ส่งต่อ) · สินค้าที่ราคาไม่ขึ้นกับจำนวน (นามบัตรต่อกล่อง) ยกเว้นทั้งหมวด ไม่งั้นโมเดลถามจำนวนกล่องที่กฎนามบัตรห้าม
- **ประโยคที่คงอยู่ในโหมด AI ต้องเปิดทางไปหาคนด้วยตัวเอง** — pinned sentence ชี้ "คุยกับทีมงาน" (ที่ `detectHumanRequest` จับ) ลูกค้าที่ต้องการส่วนลดจริงไม่ติดอยู่กับบอท; เทสต์ pin ทั้ง (ก) ประโยคไม่ trip `detectCustomerEscalation` และ (ข) คำที่ประโยคแนะนำ trip `detectHumanRequest` จริง — ผูก prompt กับ router ในเทสต์เดียว
- **pilot = เป้า + guard จากกฎข้างเคียง** — เลือกเคสเดิมที่อยู่คนละฝั่งของเส้นแบ่งใหม่ (ขอลดเฉย ๆ s27-t4 · ราคาตามจำนวน s47-t4 · ประโยคคงที่ synth-leadtime-followup) เข้า pilot ก่อนรันเต็ม — จับการรั่วข้ามหมวดได้ใน 27 วิ/$0.5 แทน 4 นาที/$5
- **เคสตกที่ "นอก edit" ให้ระบุตระกูล** — s106-t4 คำ "ระบบ" หลุดในประโยคส่งต่อปกแข็ง = class เดียวกับ M4 ที่ defer (ข้อความ tool `tools.ts:27`/`run.ts:180` ยังใช้ "ระบบ") → ผูกเข้า backlog เดิม ไม่เปิดรายการใหม่

## 12. Integration patterns — external OAuth + LINE group postback (2026-11-14, `feat/peak-order-line`)

> ⚠️ ทั้งสองข้อมาจากฟีเจอร์ `/order` (Peak MCP → ใบสั่งงานผ่านกลุ่ม LINE) ที่สร้างบน branch `feat/peak-order-line` (PR [#29](https://github.com/witsarutnook/penprinting-dashboard/pull/29) — **merged เข้า `main` 2026-11-16 · migrate แล้ว + เชื่อม Peak แล้ว (บ่ายวันเดียวกัน) · ยังไม่เปิด flag**); บน Neon production รันแล้วแค่ DDL + SQL ของ `peak_oauth` (§12.1 เก็บ token) — SQL ของ gate/claim ร่าง (§12.2) ยังไม่เคยรันบน production (เทสต์ใช้ mock + fake in-memory; ผู้ตรวจรอบสุดท้ายรันบน Postgres 16 local) — ยืนยันตอน smoke จริง (ดู NEXT-SESSION 2026-11-16)

### 12.1 Refresh token แบบ rotate ⇒ DB single-flight + persist-before-use ([lib/peak/token-store.ts](lib/peak/token-store.ts))
- **ปัญหา**: Peak MCP ออก access token อายุ 1 ชม. และ **refresh token เปลี่ยนตัวใหม่ทุกครั้งที่ใช้ (ตัวเก่าใช้ไม่ได้อีก)**. Vercel มีหลาย lambda instance — สองตัวที่ refresh พร้อมกันด้วย refresh token เดียวกัน ตัวที่สองจะถูกปฏิเสธและ/หรือทำให้การเชื่อมต่อทั้งชุดพัง (ต้องให้คุณนุ๊กล็อกอิน Peak ใหม่)
- **กฎ**:
  1. **จอง lease ระดับ DB ก่อน refresh** — `UPDATE peak_oauth SET refresh_lock_until = NOW() + INTERVAL '30 seconds' WHERE id = 'peak' AND (refresh_lock_until IS NULL OR refresh_lock_until < NOW()) RETURNING …` ได้แถว = ชนะ; ไม่ได้แถว = แพ้
  2. **ผู้ชนะ refresh แล้ว "เขียน token ชุดใหม่ลง DB ให้สำเร็จก่อน" ค่อยคืน access token ไปใช้** (`savePeakTokens` เข้ารหัส AES-256-GCM, ปล่อย lease, ล้าง error ในคำสั่งเดียว) — refresh token ตัวเก่าถูกใช้ไปแล้ว ถ้าเขียนตัวใหม่ไม่ได้ก็ไม่มีทางกู้
  3. **ผู้แพ้ไม่ refresh** — poll อ่านแถว (สูงสุด 10 ครั้ง × 500 ms) รอ token ใหม่ที่ **ต่างจากตัวที่เห็นตอนแรก** และอายุเหลือ > 5 นาที; หมดเวลา → `PeakUnavailableError` (ลองใหม่ได้ ไม่ใช่ "ต้องเชื่อมต่อใหม่")
  4. **เขียน DB ไม่สำเร็จหลัง refresh สำเร็จ = auth error** — บันทึก `last_error` แล้ว throw `PeakAuthError` (ถือว่าการเชื่อมต่อเสี่ยงพัง ไม่ใช่ error ชั่วคราว)
  5. refresh ล้มก่อนเขียน → ปล่อย lease (`clearLock`) ให้ instance อื่นลองต่อได้; lease หมดเองใน 30 วินาทีถ้าปล่อยไม่ได้
- **ไฟล์**: [lib/peak/token-store.ts](lib/peak/token-store.ts) (`getPeakAccessToken`), [lib/peak/crypto.ts](lib/peak/crypto.ts) (token ใน DB เป็น ciphertext เสมอ · key = env `PEAK_TOKEN_ENC_KEY`), [lib/peak/mcp-client.ts](lib/peak/mcp-client.ts) (401 → `forceRefresh` หนึ่งครั้ง) · เทสต์ `tests/peak-token-store.test.ts`
- **กับดักที่กัน**: (a) "refresh ทุก call" ทำให้ rotate พร้อมกัน → พังเงียบ ๆ ตอนมี traffic; (b) ใช้ access token ใหม่แล้วค่อย persist — ถ้า lambda ตายตรงกลาง refresh token ใหม่หายไปกับ memory; (c) รับ token ที่ "ยังไม่หมดอายุ" แต่เพิ่งถูกปฏิเสธ (401) จาก poll — ต้อง "ต่างจากตัวเดิม"; (d) log/error ที่มี token — ห้ามทุกรูปแบบ (ข้อความ error เป็น class label เท่านั้น)
- **แจ้งเตือนจาก cron keep-alive** (`app/api/cron/peak-keepalive/route.ts`): `claimDailyAlert` = slot **20 ชม.** (ไม่ใช่ 24 — cron ที่ยิงเร็วกว่าเมื่อวานไม่กี่วินาทีต้องยังแจ้งได้; ยังไม่เกินวันละครั้ง) · หา group id ก่อน ไม่มี → ไม่จอง · push ล้ม → `releaseDailyAlert()` คืน slot · ตอบ 200 เสมอหลัง auth
- **รู้ว่ายังหลวม (ledger Task 3, minor)**: ทางไม่ force ไม่ re-check freshness ใน lease UPDATE (อาจ refresh ซ้ำอีกครั้ง — ไม่ทำให้ rotation เสีย) · persist ล้มแล้ว lease 30 วินาทีค้าง · ผู้แพ้ที่เจอผู้ชนะล้มด้วย auth error จะเห็น `PeakUnavailableError`
- **ใช้ซ้ำได้กับ**: OAuth provider ใด ๆ ที่ rotate refresh token (เฟส 2 ของ Peak ที่ขอ `mcp:write` ก็ใช้ชั้นเดียวกัน)

### 12.2 Flow ปุ่ม postback ในกลุ่ม: conditional gate ต่อ (unit, step) + claim-first idempotency ([lib/peak-order/db.ts](lib/peak-order/db.ts) + [handler.ts](lib/peak-order/handler.ts))
- **ปัญหา**: LINE ไม่มี dedupe ของ webhook event (redelivery ถูกประมวลผลซ้ำ), ปุ่มใน Flex แตะซ้ำ/แตะของขั้นเก่าได้, สองคนเปิดใบเสนอราคาเดียวกันได้ — แต่ **ห้ามเกิดใบสั่งงานซ้ำ** (anti-goal #1 ของ spec)
- **กฎ**:
  1. **ทุกการแตะที่เปลี่ยนสถานะผ่าน gate เดียวต่อ (unit, step)**: handler โหลดร่างมาเช็คเจ้าของ/กลุ่ม/อายุเป็นตัวกรองเบื้องต้น แต่ตัวตัดสินจริงคือ `advanceDraft` = `UPDATE peak_order_drafts SET … WHERE id = $1 AND unit_idx = $2 AND step = $3 RETURNING *` — ได้ 0 แถว = แตะซ้ำ/ขั้นเก่า → **เงียบ** (ไม่ตอบ ไม่ทำอะไรต่อ); ผู้ชนะ gate เท่านั้นไปต่อ
  2. **ขั้นสร้างงาน**: ชนะ gate เข้า `creating` แล้ว **claim บรรทัดของใบเสนอราคาก่อนสร้าง** (`claimLines` = `INSERT … ON CONFLICT (qo_code, line_key) DO UPDATE … WHERE <แถวเดิมตายแล้ว> RETURNING` — all-or-nothing, เรียงคีย์คงที่; ได้ไม่ครบ → `releaseClaim` ทั้งหมด) → **ตรวจ marker ก่อนสร้างทุกครั้ง** (`findOrderByPeakMarker` หา order ที่ยังไม่ยกเลิกซึ่งมี `raw_data.peak` ตรงใบ+บรรทัด; เจอ = รับช่วง order นั้น ไม่สร้างใหม่) → `createOrder` (จุดเดียวในโค้ด) → **finalize** (`finalizeLinks` เขียน `order_id` ลงแถว claim)
  3. **ลำดับ guard ตายตัว**: ชนะ gate → `claimLines === true` → `findOrderByPeakMarker === null` → `createOrder`. ขาดข้อใดห้ามสร้าง
  4. **แถว link "ยังมีชีวิต"** = `order_id` ชี้ order ที่ยังมีชีวิต หรือ (`order_id IS NULL` และ claim อายุ < 2 นาที). อย่างอื่น "ตาย" → takeover ได้ (ยกเลิกงานแล้วเปิดใหม่ได้ / lambda ตายระหว่างทาง). **order ยังมีชีวิต = นิยามเดียวกับแดชบอร์ด** (`lib/order-lock.ts` / `lib/orders-list.ts`): มีแถว `orders` **และ** `status <> 'cancelled'` **และ** ไม่มีแถวใน `cancelled` ของ order นั้น (`NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)`) — ยกเลิกงานจากการ์ดบนบอร์ดทิ้ง `status = 'sent'` + แถวใน `cancelled`; ใช้ predicate นี้ทั้ง 4 ที่ (`liveLinks`, `openedCodes`, takeover ใน `claimLines`, `findOrderByPeakMarker`) และ fake ใช้ helper `orderAlive` ตัวเดียว
  4b. **ใบที่มีงานผูกกับ line key ที่ไม่อยู่ในใบแล้ว** (บรรทัดถูก re-key ใน Peak) → `/order` ได้**การ์ดสถานะ** (spec §4.5: ใบที่เปิดงานแล้วไม่เริ่มร่างใหม่) — key ที่หายไม่บล็อกบรรทัดปัจจุบัน (ปุ่ม "เปิดรายการที่เหลือ" เปิดได้); claim ที่ยังวิ่ง (`order_id NULL`) บน key ที่หาย = ไม่นับเลย
  5. **หน้าต่าง stale 2 นาที ผูกกับ `maxDuration = 60` ของ route LINE** (`CREATING_STALE_MS` ใน handler.ts = 2 นาที = เกณฑ์ claim ใน SQL) — ความพยายามสร้างหนึ่งครั้งจบภายใน 60 วินาทีจึงไม่มีทางอยู่เกิน claim ของตัวเอง; **ห้ามเพิ่ม `maxDuration` ของ `/api/ai-quote/line` เกินนี้** (เทสต์ `tests/peak-order-line-route.test.ts` pin ไว้ที่ 60 และ pin `CREATING_STALE_MS > maxDuration × 1000`) · การค้น Peak ของหนึ่งคำสั่งมีงบเวลา **25 วินาที** (`RESOLVE_BUDGET_MS` ใน resolve.ts — เกิน = `PeakUnavailableError` → "Peak ไม่ตอบ") เพื่อเหลือเวลาให้ DB + reply ภายใน 60 วินาที
  5b. **ไม่เงียบเมื่อพัง**: error ที่ไม่คาดคิดหลุดจาก handler → wrapper (`lib/peak-order/deps.ts`) log fixed string + class (+ SQLSTATE) แล้ว**ตอบ** `TEXT.unexpected`; order ที่ถูกรับช่วงด้วย marker ตอบการ์ด + `TEXT.adopted` (ให้เช็คว่างานขึ้นบอร์ด — insert order+job ไม่อยู่ใน transaction เดียวกัน)
  6. **ตัวกรองก่อน gate (อ่านอย่างเดียว)**: กลุ่มตรงกับร่าง · ผู้แตะ = ผู้เริ่ม (คนอื่นได้ข้อความสั้น ๆ) · ร่างไม่เกิน 30 นาที · ขั้นของปุ่ม = ขั้นปัจจุบันของร่าง; แตะ `creating` ที่ค้างเกิน 2 นาที → เส้นทาง recovery (หา order ด้วย marker ก่อน, ไม่เจอจึงปล่อย claim แล้วถอยไปขั้นสรุป — ไม่เรียก `createOrder` ในเส้นทางนี้)
- **ไฟล์**: [lib/peak-order/db.ts](lib/peak-order/db.ts) (gate/claim/finalize/marker) · [lib/peak-order/handler.ts](lib/peak-order/handler.ts) (`handlePeakOrderPostback`) · [lib/peak-order/postback.ts](lib/peak-order/postback.ts) (data `po1|…` ≤ 300 ตัวอักษร) · เทสต์ fake in-memory ที่ mirror SQL: `tests/helpers/peak-order-fakes.ts` + mutation check 3 ข้อ (ถอด gate / claim ปลอมว่าชนะ / ตัด marker check → เทสต์ต้องแดง)
- **กับดักที่กัน**: (a) double-tap ✅ / redelivery สร้าง 2 ใบ; (b) สองร่างของใบเดียวกันสร้างพร้อมกัน; (c) retry หลังสร้างแล้วแต่ยังไม่ finalize → ไม่มี marker check ก็สร้างซ้ำ; (d) claim ค้างตลอดกาลหลัง lambda ตาย (ไม่มี TTL); (e) `encodePostback` throw ถ้าค่าไม่เข้า 300 ตัวอักษร → การ์ดต้องไม่ใส่ค่า Peak ที่ไม่ผ่านการ encode ลงปุ่มตรง ๆ
- **ช่องที่ยังเปิดอยู่ (audit 2026-11-27, AUDIT-BACKLOG M1-recover-not-gate-first)**: ทาง recovery ของ `creating` ที่ค้าง **ไม่ใช่ gate-first** (อ่านร่าง → ตัดสิน → เขียน) และ token ของ claim = draft id → recovery สองตัวที่อ่านค่าเดียวกัน ตัวหลังลบ claim + ถอยขั้นของความพยายามใหม่ของร่างเดียวกันได้. กฎข้อ 1 ("statement แรกเป็น gate") ต้องใช้กับทางฟื้นด้วย ไม่ใช่แค่ทางสร้าง (เหมือน §12.3 ที่ใช้กับปุ่มกู้งาน)
- **ช่องที่เคยเปิด — ปิดแล้ว 2026-11-21 (`c06a0ea`: การแก้ไขใบเก็บ marker ที่อยู่ในแถวไว้เสมอ → retry รับช่วงได้; §12.6)**: marker อยู่ใน `orders.raw_data` ซึ่ง route แก้ไขของแดชบอร์ดสร้าง snapshot ใหม่จากฟอร์ม → ถ้า lambda ตายหลัง `createOrder` ก่อน `finalizeLinks` **และ** มีคนแก้ order ใบใหม่นั้นก่อนใครแตะซ้ำ retry จะไม่เจอ marker และอาจสร้างใบที่สอง (ต้องตายพร้อมแก้ภายในไม่กี่นาที)
- **ใช้ซ้ำได้กับ**: flow ปุ่มหลายขั้นใน LINE/Messenger ที่ต้องสร้าง side effect ครั้งเดียว (เฟส 2 สร้างใบเสนอราคาใน Peak = 1 เครดิต/ใบ ยิ่งต้องใช้)

### 12.3 ทาง "ฟื้น" ต้องผ่าน gate เดียวกับทาง "สร้าง" + token ของ claim ไม่ซ้ำต่อ request ([lib/peak-order/restore-guard.ts](lib/peak-order/restore-guard.ts)) (2026-11-16)
- **ปัญหา**: นิยาม "ใบสั่งงานตาย" ของ §12.2 รวมสถานะที่ **ย้อนกลับได้** — แถว `cancelled` ลบได้ด้วยปุ่มกู้คืน (`restoreJobInPostgres`) → ยกเลิก job จากบอร์ด → `/order` เปิดบรรทัดเดิมเป็นใบใหม่ → กู้คืน job เก่า = 2 ใบ live บนบรรทัดเดียว โดยที่ flow `/order` เองไม่เคยสร้างซ้ำ (1485 tests + mutation + Postgres จริงไม่จับ เพราะทุกเทสต์อยู่ในขอบเขตของ feature).
- **กฎ**:
  1. ทุกทางที่ทำให้ของ "ตาย" กลับมา live (restore / undo) ต้อง **claim ผ่าน gate เดียวกับทางสร้าง** (`claimLines`) ก่อนเขียน แล้วรัน marker lookup เหมือน takeover ทุกครั้ง — "เช็คก่อนแล้วค่อยกู้" เหลือช่องระหว่าง look กับ `DELETE`.
  2. **token ของ claim ไม่ซ้ำต่อ request** (`restore:<jobId>:<random>`) — `claimLines` ปล่อยแถวของ *ผู้เรียก* เมื่อ claim ไม่สำเร็จ; สอง request ที่ใช้ id เดียวกัน (double click / 2 แท็บ) = ผู้แพ้ลบ claim ของผู้ชนะ.
  3. ถือ claim แล้วต้องปล่อยทุกทางออก (best-effort — ปล่อยไม่ได้ก็หมดอายุเอง 2 นาที แล้ว `/order` ครั้งถัดไป adopt ใบที่กู้คืนผ่าน marker).
  4. ตัวเช็คเองล่ม = **ไม่กู้** (502) ไม่เดา.
  5. ของที่ไม่มี marker ห้ามแตะตารางของ feature (`peak_order_*` อาจยังไม่ถูกสร้าง) — เทสต์ด้วย Proxy ที่ throw ทุก method.
- **วิธีหาช่องแบบนี้**: grep writer ทุกตัวของ column/ตารางที่เงื่อนไข "ตาย" อ่าน (`DELETE FROM cancelled`, `SET status`) ทั้ง repo ไม่ใช่แค่ใน feature; เทสต์ concurrency ให้ครบ 3 คู่: A vs B, **A vs A**, และตัวเช็คล่ม.
- **ไฟล์**: [lib/peak-order/restore-guard.ts](lib/peak-order/restore-guard.ts) · [app/api/jobs/restore/route.ts](app/api/jobs/restore/route.ts) · เทสต์ `tests/peak-restore-guard.test.ts` + `tests/jobs-restore-peak-guard.test.ts` (รัน guard จริงบน fake ของ link table).
- **ช่องที่ยังเปิด (มีมาก่อน)**: `restoreJobInPostgres` เป็น 2 statement (INSERT job → DELETE cancelled) — DELETE ล้ม = job กลับขึ้นบอร์ดแต่ order ยังนับว่าตาย · order ที่มีหลาย job ถูกยกเลิกและกู้กลับแค่ตัวเดียวยังนับว่าตายตามนิยาม "มีแถว cancelled".

### 12.4 รายการจาก API ภายนอกที่ sort ไม่ได้: อย่าเดาลำดับจากตัวอย่างเล็ก — อ่านของจริงแล้วเรียงเองด้วย key ที่ผู้ใช้เห็น ([lib/peak/read.ts](lib/peak/read.ts)) (2026-11-17)
- **อาการ**: `/order` เฉย ๆ ("5 ใบล่าสุด") และปุ่ม "ทดสอบ" ตอบ QO-…110 ทั้งที่ Peak มี 111–120. โค้ดกลับลำดับ "ท้ายรายการ" เพราะสเปกเขียนจาก probe ว่า `list_quotation` "เรียงเก่า→ใหม่เสมอ".
- **ของจริง** (ตัวอ่านชั่วคราวบน production): เรียงตาม **วันที่ออก** เก่า→ใหม่ แต่ **ภายในวันเดียวกันเลขมากมาก่อน** และเลขไม่ตามวันที่เสมอ (ย้อนวัน/แก้วันได้). ตัวอย่างเล็กของ probe มีวันละใบ จึงดูเหมือนเรียงเก่า→ใหม่ล้วน.
- **Rule**:
  1. "ล่าสุด/ลำดับ" ต้องนิยามด้วย **สิ่งที่ผู้ใช้เห็นบนหน้าจอของระบบต้นทาง** (ที่นี่ = แท็บ "ทั้งหมด" ของเว็บ Peak = เลขเอกสารมากสุดก่อน) แล้ว **เรียงในโค้ดเราเอง** ด้วย key นั้น — อย่าพึ่งลำดับที่ API ส่งมา ถ้า API ไม่มี sort.
  2. Pool ที่เอามาเรียงต้อง **กว้างกว่าที่ต้องการ**: อ่านจากท้าย ≥ 2 หน้า. หน้าเดียวไม่พอเมื่อบล็อกของกลุ่มล่าสุดเรียงกลับด้าน — ขอบหน้าตัดกลางบล็อกได้ และตัวที่ต้องการอยู่ต้นบล็อก. อ่าน 2 หน้าพร้อมกัน (`Promise.all`) = เวลาเท่าเดิม.
  3. เลขเอกสารเทียบเป็น **จำนวน** (ดึงตัวเลขออกมา เทียบความยาวก่อนแล้วค่อยเทียบตัวอักษร) ไม่ใช่ string — `QO-99` ต้องแพ้ `QO-100`.
  4. เขียน **ข้อจำกัดของ pool** ไว้ที่ interface (ที่นี่: ใบที่ย้อนวันไกลกว่า 2 หน้าท้ายไม่ติด "ล่าสุด") และให้มีทางอื่นไปถึงของนั้น (ค้นด้วยเลข).
  5. สมมติฐานเรื่องพฤติกรรม API ภายนอกที่ทดสอบในเครื่องไม่ได้ → ต้องเป็น **ข้อใน checklist smoke ที่มีวิธีเช็ค** ("เทียบรายการกับหน้าเว็บต้นทาง") ไม่ใช่แค่บรรทัด "parked" ใน ledger. ครั้งนี้คนเจอคือคุณนุ๊ก ไม่ใช่ checklist.
  6. Fake ระดับบนต้องใช้ **comparator ตัวเดียวกับของจริง** (`byCodeDesc` export ให้ `tests/helpers/peak-order-fakes.ts` ใช้) — ไม่งั้น fake กับของจริงเรียงคนละแบบโดยไม่มีเทสต์ไหนแดง.
- **วิธีหาคำตอบ**: เมื่อมีคำอธิบาย ≥ 2 แบบที่แก้ต่างกัน (ส่งสลับลำดับ vs ส่งช้า) → §2.5 ตัวอ่านอย่างเดียว 1 deploy: dump ลำดับตามที่ได้รับ + ตำแหน่งของตัวที่ควรเป็นอันดับต้น + ชื่อฟิลด์ (ไม่คืนชื่อลูกค้า/ยอดเงิน) → ยืนยันหลังแก้ด้วยตัวอ่านเดียวกัน → ลบ.
- **เทสต์**: จำลองลำดับตาม wire จริง (`block()` ใน `tests/peak-read.test.ts`) + เคสขอบหน้าตัดกลางวัน + เคสเลขไม่ตามวันที่.

### 12.5 กฎที่อ่านข้อความอิสระแล้วเติมช่อง: นับของจริง 2 ฝั่ง → ไม่แน่ใจ = ว่าง → รันกับของจริงก่อนต่อ → ให้คนนอกลองประโยคหลอก ([lib/peak-order/spec-from-text.ts](lib/peak-order/spec-from-text.ts)) (2026-11-18)
- **งาน**: ข้อความรายการในใบเสนอราคา → ช่องสเปกของฟอร์มใบสั่งงาน ด้วยกฎคำหลัก (ไม่มี AI). ใบที่กด "สร้างงาน" ขึ้นบอร์ดโดยไม่มีคนตรวจ → **ช่องที่เติมผิดแพงกว่าช่องว่าง**
- **ลำดับที่ใช้ได้ผล**:
  1. **นับของจริง 2 ฝั่งก่อนเขียนกฎ** (§2.5 ตัวอ่านอย่างเดียว): *ต้นทาง* = คนเขียนข้อความแบบไหน · *ปลายทาง* = ทีมกรอกช่องนั้นด้วยคำแบบไหน. ฝั่งปลายทางตอบคำถามที่เดาไม่ได้ (งานแผ่นเดียวกรอก "กระดาษเนื้อใน" 69% ไม่ใช่ "ปก"; ขนาด A4 ปล่อยหน่วยเป็น "ซม.")
  2. **ไม่แน่ใจ = ว่าง** เป็นกฎของกฎ: ช่องเดียวเจอ 2 ค่า = ว่าง · บรรทัดที่มี "หรือ" = ตัวเลือก ไม่ติ๊ก · ไม่/หาก/ถ้า/ยกเว้น นำหน้า = ไม่ติ๊ก · คำที่ไม่เคยเห็นในของจริงไม่เขียนกฎเผื่อ
  3. **ตัวอ่านเป็นฟังก์ชันล้วนคืน `{ fields, summary }`** แล้วให้ *ทุกที่* (ตัวสร้างใบ + การ์ดที่คนเห็นก่อนกด) เรียกตัวเดียวกันจากข้อมูลชุดเดียวกัน → สิ่งที่คนเห็นกับสิ่งที่ถูกบันทึกแยกกันไม่ได้. ค่าที่อ่านได้ spread **ก่อน** ค่าที่คน/ระบบต้นทางกำหนด จึงทับไม่ได้
  4. **รันกฎกับของจริงทั้งชุดบน production ก่อนต่อเข้ากับการเขียนข้อมูล** แล้วให้เจ้าของงานดูตาราง "ข้อความ → ช่องที่จะเติม" (ตัวอ่านชั่วคราวตัวเดิม เพิ่มผลของกฎต่อบรรทัด). หลังแก้กฎทุกครั้ง → รันซ้ำแล้ว **diff กับรอบก่อน**: แถวที่เปลี่ยนต้องเป็นแถวที่ตั้งใจเท่านั้น
  5. **เทสต์จากข้อความจริงพิสูจน์ได้แค่คำที่เคยเห็น** — ผู้ตรวจอิสระที่เขียนประโยค "ห่างจากของจริงหนึ่งขั้น" (~170 ประโยค) เจอ 59 กรณีเติมผิดที่เทสต์ 84 ตัว + mutation 26/26 ของผู้เขียนไม่เห็น. ก่อนเปิดใช้ตัวอ่านข้อความ ให้คนนอก (หรือ subagent ที่ไม่เห็นข้อสรุปของเรา) ลองประโยคหลอก: ปฏิเสธ · ตัวเลือก · 2 สินค้าในบรรทัดเดียว · ตัวเลขที่หน้าตาเหมือนขนาด/น้ำหนัก/จำนวนสี · คำของ attribute อื่นที่มีคำ trigger
  6. **Mutation check ต่อกฎ**: จงใจทำแต่ละกฎพังทีละจุด แล้วดูว่าเทสต์แดง — mutant ที่รอดชี้เทสต์ที่ขาด (หรือโค้ดที่ไม่จำเป็น: stop-word ที่ไม่มีเทสต์ไหนต้องการ = ลบ)
- **ลบข้อความ ≠ เติมช่อง (ต่อยอดวันเดียวกัน — หมายเหตุไม่ซ้ำกับช่อง, [`e2e5066`](https://github.com/witsarutnook/penprinting-dashboard/commit/e2e5066))**: พอจะ *ตัด* บรรทัดที่ลงช่องแล้วออกจากหมายเหตุ ความเสี่ยงเปลี่ยนชนิด — เติมช่องผิดยังมีข้อความต้นฉบับค้ำ แต่ตัดผิด = ข้อมูลหายจากใบสั่งงาน. กฎที่ใช้:
  1. **ตัดได้เมื่อ "ไม่มีอะไรเหลือ" ไม่ใช่ "อ่านได้บางอย่าง"**: จดตำแหน่งของทุกค่าที่ลงช่อง (เฉพาะที่เขียนตรงกับที่ช่องเก็บ) แล้วลบออกจากบรรทัด — ถ้าเหลือตัวอักษร ตัวเลข หรือสัญลักษณ์ใด บรรทัดอยู่ทั้งบรรทัด (ไม่ตัดเป็นท่อน)
  2. **คำนำ (`พิมพ์` `ขนาด` `เข้าเล่ม`) หายได้เฉพาะเมื่อติดหน้าค่าที่มันนำ** — รายการ "คำเชื่อม" แบบลบทุกที่ในบรรทัดทำให้ "พิมพ์ 1 สี ปรุ เข้าเล่ม" เสียคำว่าเข้าเล่ม
  3. **ช่องต้องเก็บได้ครบทั้ง "ค่า" และ "ของส่วนไหน"**: ช่องติ๊กที่ไม่แยกปก/เนื้อใน (เคลือบ ปรุ ดิจิตอล) ห้ามใช้ตัดบรรทัดที่ระบุส่วน
  4. **ความหมายของบรรทัดขึ้นกับบรรทัดข้างเคียง**: บรรทัดที่ไม่มีค่าลงช่องเลยอาจเป็นหัวข้อ ("ด้านหน้า", "ซอง") หรือคำขยาย ("ทั้ง 2 ด้าน", "หรือเคลือบเงา") → บรรทัดติดกันข้างบน/ล่างของมันห้ามตัด; บรรทัดหัวส่วน (`ปก` / `เนื้อใน`) อยู่ตราบที่ยังมีบรรทัดใต้มันอยู่
  5. **ก่อนลบตาข่าย ต้องกลับไปแก้ค่าที่ลงผิดช่องซึ่งตาข่ายเคยค้ำ** (กระดาษปกไหลไปช่องเนื้อใน, สีห่วงเป็นสีหมึก) — เว้นว่างแทน
  6. รันของจริงก่อน/หลังแก้แล้วเทียบ 2 อย่าง: ช่องที่เติมต้องเหมือนเดิมทุกรายการ + บรรทัดที่ตัดต้อง "มีแต่ลดลง"
  - ตัวเลขจริง: ผู้เขียนอ่านผล 98 ข้อความ + mutation 56/56 = ไม่เจออะไร; ผู้ตรวจอิสระ 299 ข้อความ = ข้อมูลหาย 8 แบบ. กฎข้างเคียงทำให้ตัดได้น้อยลง ~10% (336→139 กลายเป็น 335→154) — ยอมแลก
- **ผลลัพธ์ของกฎตัดบรรทัด (2026-11-19) — เลิกใช้หลังเปิด 1 วัน** ([รายงานผู้ตรวจรอบสอง](docs/superpowers/reviews/2026-11-19-peak-order-notes-rule-review-2.md), spec §13.7): ผู้ตรวจอิสระดูชุดแก้ `e2e5066` → ข้อมูลหายได้อีก 8 กลุ่ม (ชิ้นที่สองในรายการเดียว · ด้านหน้า/ด้านหลัง · "ราคานี้ไม่รวม" …). คุณนุ๊กตัดสินหยุดตัดบรรทัดสเปก คงแค่ตัดบรรทัดชื่องาน. สิ่งที่ใช้ซ้ำได้:
  1. **ผู้ตรวจรอบ N เจอจำนวนพอ ๆ กับรอบ N−1 = กฎไม่ลู่เข้า → หยุดแก้ทีละจุด** (กฎ 3+ fixes). กฎที่ตัดสินทีละบรรทัดต้อง "รู้จักอันตราย" (หัวข้อ, ชิ้นที่สอง, คำปฏิเสธ) — อันตรายแบบที่ยังไม่รู้จัก = ข้อมูลหาย. กฎที่ปลอดภัยโดยโครงสร้างคือกฎที่ "ไม่รู้จัก = คงไว้ทั้งหมด"
  2. **ก่อนแก้รอบถัดไป วัดกฎที่ปลอดภัยโดยโครงสร้างกับของจริง** แล้วเอาตัวเลขให้เจ้าของงานตัดสิน: ที่นี่กฎเดิมตัด 43 จาก 130 บรรทัด · กฎปลอดภัย 3 แบบตัด 15 / 10 / 2 → ไม่มีทางกลาง → คำถามกลายเป็น "ประโยชน์ ~1–1.5 บรรทัดต่อใบ คุ้มกับสเปกหายเงียบ ๆ ไหม" ซึ่งไม่ใช่โจทย์วิศวกรรม. วิธีวัด: สำเนาแยก (worktree ใน scratchpad) + ตัวแปร debug ชั่วคราวในสำเนา + เทสต์ที่เขียนผลลงไฟล์ — ไม่แตะ repo
  3. **ผลตรวจอิสระต้องลง repo** (`docs/superpowers/reviews/`) พร้อมเทสต์ที่ล้มของผู้ตรวจ (`.txt` — ไม่ถูก type-check / ไม่อยู่ในชุดเทสต์). scratchpad หายเมื่อเครื่องรีบูต
  4. **ปิดกฎแล้วต้องเช็คของที่สร้างระหว่างกฎเปิดอยู่**: ไล่ `/api/orders/raw/<id>` ตั้งแต่ใบสุดท้ายที่รู้จักจนเจอ 404 แล้วเทียบหมายเหตุของใบที่มาจาก `/order` กับข้อความต้นทาง
  5. โค้ดที่เลิกใช้แต่ยังอยู่ในไฟล์ (`linesReadFrom`) ต้องเขียนเหตุผล + เงื่อนไขของการต่อกลับไว้ที่ตัวฟังก์ชัน ไม่ใช่แค่ในเอกสาร
  6. **เมื่อเจ้าของงานตัดสินว่าไม่กลับมา → ลบทั้งสาย แล้วพิสูจน์ด้วยการเทียบโค้ดก่อน/หลัง** (2026-11-21, ลบ `linesReadFrom`): ลบฟังก์ชัน + ทุกอย่างที่มีไว้เพื่อมันอย่างเดียว (ตัวแปรจดตำแหน่งในตัวอ่าน, พารามิเตอร์, เทสต์) ไม่ทิ้งท่อที่ไม่มีใครอ่าน. เทสต์เดิมที่ยังเขียวบอกได้แค่กรณีที่เคยเขียนไว้ — หลักฐานว่า "ส่วนที่เหลือทำงานเหมือนเดิม" คือ **รันโค้ดก่อนลบ (`git show HEAD:<file>` เก็บใน scratchpad) กับโค้ดหลังลบ ด้วย input ชุดเดียวกันจำนวนมาก แล้วนับผลต่าง**: ข้อความทุกตัวในไฟล์เทสต์ (รวมของเทสต์ที่กำลังจะลบ + ไฟล์ของผู้ตรวจ) + สุ่มจากบรรทัดจริงผสมคำหลัก. ที่นี่ 401,406 ข้อความ → ต่าง 0. **สคริปต์เทียบต้องจับโค้ดที่จงใจทำพังได้ก่อน** (6 จาก 6 แบบ) ไม่งั้น "ต่าง 0" ไม่มีความหมาย. ไฟล์ `.ts` ที่ import แบบ `import type` อย่างเดียว รันด้วย `node --experimental-strip-types` ได้ตรง ๆ ไม่ต้องผ่าน vitest; ฟังก์ชันในไฟล์ที่มี runtime import ผ่าน alias `@/` → ตัดข้อความของฟังก์ชันออกมาเป็นไฟล์แยกด้วยสคริปต์ (ไม่พิมพ์ซ้ำ)
- **กับดักที่เจอ**: (a) section ที่ "ลามข้ามบรรทัด" (ปก → บรรทัดถัดไป) กลืนข้อมูลของส่วนอื่น → ให้ลามเฉพาะส่วนที่ของจริงลามจริง (เนื้อใน) (b) คำ trigger ที่เป็นทั้งชนิดและด้าน (`เคลือบด้าน` vs `ด้านหน้า`) (c) ตัวเลขใน A4 / 4/1 / 8 1/2 ถูกอ่านเป็นจำนวนสี/ขนาด → lookbehind + ต้องมีคำกริยา "พิมพ์" นำ (d) Write tool แปลง `\uXXXX` ในเนื้อไฟล์เป็นตัวอักษรจริง → ช่วง Thai / NBSP / ZWSP กลายเป็นตัวอักษรล่องหนใน source; สแกนด้วย perl แล้วแทนกลับ

### 12.6 Key ของเซิร์ฟเวอร์ใน JSON ที่ฟอร์มเขียนทับ: เซิร์ฟเวอร์เป็นเจ้าของที่จุดเขียนเดียว ([lib/postgres-write.ts](lib/postgres-write.ts) `updateOrderInPostgres`) (2026-11-21, [`c06a0ea`](https://github.com/witsarutnook/penprinting-dashboard/commit/c06a0ea))
- **ปัญหา**: แถวเก็บ snapshot ของฟอร์มเป็น JSON (`orders.raw_data` / `details` / สำเนาใน `raw`) แล้วโค้ดฝั่งเซิร์ฟเวอร์ฝาก key ของตัวเองไว้ในก้อนเดียวกัน (`raw_data.peak` = ใบนี้เปิดจากรายการไหนของใบเสนอราคา — ตัวกันปุ่มกู้งาน §12.3 อ่าน). route แก้ไขเขียน snapshot ของฟอร์มทับทั้งก้อน → key หายตั้งแต่การแก้ไขครั้งแรก เพราะฟอร์มไม่เคยถือ key นั้น. เทสต์เขียว, post-deploy smoke เขียว, smoke มือก็ผ่าน (ขั้น "กู้คืน" ใช้ใบที่ไม่เคยถูกแก้). ของจริง: ใบจาก `/order` ถูกแก้ไขผ่านเว็บหลังสร้าง 20 จาก 23 ใบ (21–26 พ.ย.) — ทางที่ทำ key หายคือทางปกติของทีม ไม่ใช่กรณีขอบ
- **สัญญาณที่มีอยู่แล้วในโค้ด**: route เดียวกันยก `pin` มาจากแถวเดิมเป็นกรณีพิเศษ = รูปแบบนี้เคยเกิดแล้วครั้งหนึ่ง
- **กฎ**:
  1. ก่อนฝาก key ของเซิร์ฟเวอร์ลง JSON ของแถวที่มีฟอร์มแก้ไข → grep ทุก statement ที่เขียนคอลัมน์นั้น แล้วถามทีละตัวว่า "ค่าที่เขียนมาจากไหน ฟอร์มส่ง key นี้กลับมาไหม"
  2. เซิร์ฟเวอร์เป็นเจ้าของ key ที่ **จุดเขียนจุดเดียว** (ฟังก์ชันที่ออก UPDATE): อ่านค่าที่อยู่ในแถวมากับแถว เขียนกลับทุกสำเนา ทิ้งค่าที่ผู้เรียกส่งมา — รวมกรณีผู้เรียกไม่ส่ง snapshot และกรณีล้าง snapshot. ทางเข้าฝั่งสร้างจากเว็บทิ้ง key นั้นจาก body ด้วย
  3. วินิจฉัยด้วย census 2 กลุ่มจากประวัติ: แถวที่มี `updateOrder` กับแถวที่ไม่มี — ของที่หายเฉพาะกลุ่มแรก = ฟอร์มเขียนทับ. **census ต้องครอบตั้งแต่วันที่ feature เปิด** ไม่ใช่ตั้งแต่ใบที่รู้จัก (ไล่จาก #202611102 เจอ 2 ใบ; ตัวซ่อมสแกนทั้งตารางเจอ 3)
  4. checklist smoke ของ feature ที่อาศัย key แบบนี้ต้องมีขั้น "แก้ไขผ่านเว็บก่อน" แล้วค่อยทำขั้นที่อ่าน key
  5. ตัวซ่อม: แหล่งข้อมูลต้องเป็นบันทึกที่ไม่ถูกเขียนทับ (`peak_order_drafts.units[].result`) ไม่ใช่ตารางที่ตามสถานะปัจจุบัน (`peak_order_links` ย้ายไปใบใหม่เมื่อรายการถูกเปิดซ้ำ — ผู้ตรวจอิสระรอบแรกพิสูจน์ว่าได้เครื่องหมายแคบกว่าเดิม) + control บนข้อมูลจริงก่อนเขียน (§2.5)
  6. SQL ที่เทสต์ mock ไว้ → แยกข้อความ SQL เป็นไฟล์ค่าคงที่ที่ไม่มี import แล้วรันของจริงบน Postgres ในเครื่อง (PGlite ใน scratchpad ไม่แตะ repo)
  7. **ไล่ key ของเซิร์ฟเวอร์ทุกตัวในก้อนเดียวกัน และทุกทางเข้าของฟอร์ม — ไม่ใช่แค่ key ที่เพิ่งพัง (2026-11-27, audit H1)**: `pin` ที่ข้อ "สัญญาณ" ข้างบนยกเป็นตัวอย่าง พังเองมา 5 เดือน — route ยก PIN จาก **สิ่งที่ client ส่งกลับ** (`srcOrder.rawData`) ไม่ใช่จากแถว และฟอร์มที่เปิดจากการ์ดบนบอร์ดถือใบ slim ที่ไม่มีมัน → เขียน `pin: ""` (production 19 ใบ). "มีกรณีพิเศษอยู่แล้ว" ไม่ใช่หลักฐานว่ากรณีพิเศษนั้นทำงาน: ถามว่า **ค่ามาจากแถว หรือมาจากผู้เรียก** และไล่ทุกทางเข้า (ใบเต็ม / ใบ slim / สั่งซ้ำ / template). Census ที่จับได้: ค่าเป็น `""` (ไม่ใช่ key หาย) + มีแถว `updateOrder`
  8. **ก่อนเขียน key ลง JSON ที่มีสำเนาหลายที่ ต้องรู้ว่าตัวอ่านเลือกสำเนาไหนก่อน**: ตัวอ่านทุกตัวของใบ (print / tracking-card / `/api/orders/raw` / edit / new) ใช้ `rawData` เมื่อมันเป็น object แล้วค่อย `details` → `{pin}` ที่สร้างจากความว่างใน `rawData` จะ **บังสเปกที่อยู่ใน `details`**. กฎที่ใช้: key ของเซิร์ฟเวอร์ใส่ลง snapshot **ที่มีอยู่**; ไม่มีเลย = ให้ `details` ถือ ไม่สร้าง `rawData`. ตัวซ่อมข้อมูลก็เหมือนกัน: บังคับให้ทุกที่ที่จะเขียน **เป็น object อยู่แล้ว** (ไม่ใช่ "object หรือว่าง") แถวที่ไม่ตรงรูป = รายงานว่าไม่เข้าเงื่อนไข ไม่แตะ (ผู้ตรวจอิสระเจอทั้งสองจุดก่อน push)
  9. **นิยาม "มี key" ต้องมีที่เดียว หรือเป็นข้อความเดียวกัน**: จุดเขียน (`btrim` ใน SQL + `.trim()` ใน JS) กับตัวซ่อม (`NO_PIN`) ต้องตอบตรงกันว่าแถวไหนมี PIN — ต่างกัน = ใบที่จุดเขียนมองว่าไม่มี แต่ตัวซ่อมมองว่ามี จะค้างไม่มี PIN ตลอด
- **ไฟล์**: [lib/postgres-write.ts](lib/postgres-write.ts) (`storedPeakMarker` / `storedPin` / `withoutServerKeys` / `withStoredMarker`) · [app/api/orders/add/route.ts](app/api/orders/add/route.ts) · เทสต์ `tests/postgres-write.test.ts` + `tests/orders-update-pin.test.ts` (route + ฟังก์ชันเขียนจริงบน SQL mock) + `tests/orders-add-route.test.ts`. ตัวซ่อม (รันแล้ว 2026-11-27, ลบแล้ว [`4e7e071`](https://github.com/witsarutnook/penprinting-dashboard/commit/4e7e071)): โค้ดอยู่ใน git ที่ `9a54dcd`
