# Penprinting Dashboard v2 — Project Memory

`dashboard.penprinting.co` — Next.js 15 strangler dashboard ที่ค่อยๆ ย้าย feature มาจาก WordPress dashboard เดิม (`app.penprinting.co/production-monitoring`)

> **Companion doc**: shared infrastructure (Apps Script API, Google Sheet schema, role/permission matrix, lessons learned ที่ apply ทั้ง 2 ฝั่ง) อยู่ที่ [`production-monitoring/monitoring.md`](../production-monitoring/monitoring.md). เอกสารนี้เน้นเฉพาะส่วนที่เป็น Next.js ของ v2 — features, version history, deploy, patterns, lessons.
>
> **Forward-looking**: ที่ยังไม่ได้ทำ → [`NEXT-SESSION.md`](NEXT-SESSION.md). Audit findings → [`AUDIT-BACKLOG.md`](AUDIT-BACKLOG.md). Reusable code patterns → [`PATTERNS.md`](PATTERNS.md). Migration overview → [`../Tech-Roadmap-Status.md`](../Tech-Roadmap-Status.md).

---

## 1. ภาพรวม

ระบบ Kanban + order entry + analytics + calendar + tracking — port จาก WP สู่ Next.js แบบ strangler pattern. ทั้ง 2 ฝั่งใช้ **Google Sheet เดียวกัน** ผ่าน Apps Script API → coexist ได้

### Stack
- **Framework**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 3 _(migrated 2026-06-20, soak-stable 2026-06-27)_
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
| `lib/auto-sync.tsx` | `broadcastWrite` only (cross-tab via BroadcastChannel) — `useAutoSync` retired 2026-06-03 |
| `lib/delta-sync.tsx` | `useDeltaSync` hook (delta-fetch poll + `mergeDelta` + `applyFullList`) — sole auto-sync mechanism |
| `lib/board-delta.ts` | `loadBoardDelta` (server) — `lists`/`fullLists` modes for /orders + /shipped + /cancelled |
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
| `/quote-assistant` | admin + sales | AI Quote Assistant staff chat (Phase 1a — env-gated) |
| `/quote-leads` | admin + sales | Lead table จาก AI quote sessions (status + claim) — Phase 1a |
| `/quote-logs` | admin only | AI conversation log viewer — list ทุก session + filter + แท็บ 🚩 flags (2026-07-20) |
| `/quote-logs/[id]` | admin only | Transcript บับเบิล + quote cards แทรกไทม์ไลน์ + tag 🚩 "AI ตอบผิด" ต่อข้อความ |

Middleware (`middleware.ts`) gates `/analytics /calendar /archive /board /orders /shipped /cancelled /quote-assistant /quote-leads /quote-logs` paths — defence-in-depth on top of per-page `verifySession()`. (API routes self-guard ด้วย `requireSession` — ไม่ใส่ใน matcher ตาม convention.)

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
| `/api/track/lookup` | POST | open | Public order lookup — 3-layer rate-limit: per-IP KV · plaintext cookie 15/hr · per-id PIN lockout (atomic INCR reserve + refund, 5 fails/hr — `1606099`) |
| `/api/ai-quote` | POST | admin + sales | AI Quote chat — `{ sessionId?, message }` → Claude tool-use loop → reply + spec + price. **env-gated** (ANTHROPIC_API_KEY/QUOTE_API_URL/QUOTE_API_TOKEN; 500 ถ้าไม่ตั้ง) |
| `/api/ai-quote/leads` | GET | admin + sales | List leads (จาก `ai_quote_sessions`) — **slim**: lastMessage/turnCount derive ใน SQL, ไม่ส่ง conversation (`8ff707d`) |
| `/api/ai-quote/leads/[id]` | GET | admin + sales | **Lazy transcript (2026-07-22, `8ff707d`)** — conversation ของ lead เดียว สำหรับ expand ใน /quote-leads |
| `/api/ai-quote/leads/[id]` | PATCH | admin + sales | Update lead status / claim — claim owner = `session.user` เสมอ (body = intent เท่านั้น, `91a1322`) |
| `/api/ai-quote/messenger` | POST+GET | Meta (X-Hub-Signature-256) | **Messenger webhook (1c, 2026-07-08)** — GET = hub.challenge handshake (subscribe) / health probe · POST: verify → ack 200 → `after()`: รูป→Haiku pre-filter→Thunder→**text result 4 สถานะ** (Messenger ไม่มี Flex — [slip-messenger.ts](lib/ai-quote/slip-messenger.ts)) · text→โหมด AI (engine เดิม Sonnet 5, mode/hint ร่วมตาราง `ai_quote_line_modes`) · **ไม่มี /track /groupid** (`trackEnabled=false`) · escalation → Flex กลุ่ม LINE พนักงาน + แถว "ช่องทาง". AI arms เปิดเมื่อ `AI_QUOTE_MESSENGER_ENABLED=true` + QUOTE_API/ANTHROPIC ครบ — ขาด = slip-only. env: `FB_APP_SECRET`/`FB_PAGE_TOKEN`/`FB_VERIFY_TOKEN` + `AI_QUOTE_MESSENGER_HINT_ENABLED` (day 1). Setup: [RUNBOOK-1c-messenger-setup.md](RUNBOOK-1c-messenger-setup.md) |
| `/api/ai-quote/line` | POST | LINE (HMAC) | **LINE OA webhook (1b-A + 1b-B)** — verify signature → ack 200 → `after()`: รูป→Haiku pre-filter→Thunder slip-verify→Flex card · `track <id>`→order Flex · **1b-B (2026-07-06):** `ขอราคา`/`ตีราคา`/postback→เข้าโหมด AI · in-mode text→Sonnet 5 customer engine + escalation 4 triggers · นอกโหมด→hint (sub-flag). AI arms เปิดเมื่อ `AI_QUOTE_LINE_ENABLED=true` + `QUOTE_API_URL`/`QUOTE_API_TOKEN`/`ANTHROPIC_API_KEY` ครบ — ขาดอันใด = 1b-A behavior เป๊ะ. env 1b-A เดิม (`LINE_CHANNEL_SECRET`/`LINE_CHANNEL_TOKEN`/`THUNDER_API_KEY`) + ใหม่ `LINE_STAFF_GROUP_ID` (escalation push) |
| `/api/admin/slip-metrics` | GET | admin | Per-day rollup ของ `slip_checks` (images / thunder_calls=quota / filtered_out / slip_ok / duplicates / mismatches), Bangkok-day, 30 วัน |
| `/api/admin/db-migrate` | GET | admin | Idempotent schema runner (`CREATE … IF NOT EXISTS` + counts) — รันหลัง deploy ที่เพิ่ม table/index ใหม่ |

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

### AI Quote Assistant (Phase 1a — shipped 2026-06-24, `91d8dc8` + FAB `66d0286`)
> ดู design + decisions เต็ม: [`design-ai-quoting.md`](design-ai-quoting.md) §13. internal staff/sales tool เท่านั้น — **ยังไม่เปิด LINE channel** (Phase 1b).
- `/quote-assistant` — staff chat ตีราคางานพิมพ์ด้วย AI (`requireSession(['admin','sales'])`). พิมพ์คำขอเป็นภาษาคน → AI สกัด spec → คืนราคาต่อชิ้น **ก่อน VAT** + offset/digital mode + การ์ด VAT. ปุ่ม "คัดลอกข้อความราคา" / "บันทึกเป็น lead".
- **Floating FAB widget** (`components/ai-quote-widget.tsx`, 2026-06-24 `66d0286`) — ปุ่มลอยมุมขวาล่างแบบแชต PEAK Support เปิด AI Quote เป็น popup panel ได้ทุกหน้า dashboard. reuse `QuoteAssistantClient` โหมด `compact`, mount ใน `DashboardShell` **gate `role === 'admin'`**, ซ่อนบน `/quote-assistant` (กันแชตซ้อน), `z-40`, Esc ปิด, responsive (มือถือ near-full-width / desktop panel 400px).
- `/quote-leads` — ตาราง lead + เปลี่ยน `lead_status` (ใหม่/กำลังติดตาม/ปิดการขาย/ไม่สนใจ/**ต้องประเมินเอง**=escalated/ถูกทิ้ง=abandoned) + **กดแถวขยายอ่านบทสนทนาเต็ม** + **ปุ่มลบ (admin only, confirm)**. escalation lead มี badge ส้ม "⚠ ต้องประเมินเอง".
- **ผู้ดูแล (owner)** — กด "บันทึกเป็น lead" → **auto-assign คนกด save** เป็นเจ้าของ (คนที่คุยกับลูกค้า = เจ้าของโดยธรรมชาติ). งาน escalate (AI auto-save, ไม่มีคนคุย) = ว่าง → ปุ่ม "หยิบงาน" (race-safe 409, audit M4). "คืนงาน" ปล่อย owner ได้ (admin = ใครก็ได้ · staff = ของตัวเอง).
- **No-auto-save (2026-06-24)** — chat เป็น **stateless** (client ถือบทสนทนา replay ทุกเทิร์นผ่าน `history`). **ไม่บันทึก lead จนกว่า** (ก) AI escalate → auto-save + flag (กันพลาด hand-off) หรือ (ข) staff กด "บันทึกเป็น lead" → `POST /api/ai-quote/leads` เก็บบทสนทนา+ราคา+ลูกค้า. → ไม่มี junk lead จากแชตทดสอบ. `lib/ai-quote/run.ts`: `shouldPersistTurn` + `sanitizeHistory` (client-owned history = ต้อง clamp).
- **Pricing single source of truth**: tool `compute_quote` เรียก calc `POST /api/quote` (env `QUOTE_API_URL` + `QUOTE_API_TOKEN`) — ราคาตรงกับ calculator UI 100% (verify preview: brochure A4/4สี2หน้า/Art160/1000 = `5.048225 บาท/ชิ้น` ตรงเป๊ะ). AI emit ราคาเองไม่ได้ (บังคับผ่าน tool).
- **Stack**: **Claude Sonnet 5** (`claude-sonnet-5`, swapped จาก Haiku 4.5 2026-07-02 `2bcb56e` — Haiku over-clarify ต้อง hard-rule ซ้ำ; Sonnet 5 ทำ assume-and-disclose faithfully, preview smoke 4/4) + prompt caching บน system block + **manual tool-use loop** (`MAX_TOOL_ROUNDS=6`, `MAX_TOKENS=4096` — Sonnet 5 adaptive thinking default กิน budget, `lib/ai-quote/run.ts`). _(slip pre-filter vision ยังเป็น Haiku — binary gate)_
- **Scope (D8)**: auto-quote แค่ brochure/book/notebook (สูตร validated). กล่อง/ถุง + งานนอก 5 ประเภท → **escalate** (ไม่ตีราคา, บันทึก lead ให้ทีมขายตาม).
- **Clarify policy (assume-and-disclose, 2026-06-24 `237b66d`)**: field ที่มี shop-standard ลูกค้าไม่ระบุ → เติม default แล้วตีราคาเลย + แจ้งบรรทัดสมมติฐาน (โบรชัวร์ A4/4สี/2หน้า/Art120 · book+notebook A5+innerB=0). ถามเฉพาะที่เดาไม่ได้ — qty ทุกงาน + book/notebook ถาม จำนวนหน้า/กระดาษ/สี แบบ batch ครั้งเดียว. กระดาษระบุชื่อแต่นอก list ยัง escalate. ลด over-clarify ที่ Haiku ระวังเกิน (`lib/ai-quote/prompt.ts`).
- **Book cover defaults (2026-06-25 `0b93f8e`)**: ปกหนังสือ/สมุด default = **4 สี + กระดาษ Art 230** (ออกจาก always-ask + เกณฑ์ครบ; เนื้อในยังถาม). กฎ **"X สีทั้งเล่ม"** → set ทั้งปก+เนื้อใน. **hard-rule "⛔ ห้ามถามสีปกเด็ดขาด"** — แม้เนื้อในระบุสีต่าง (ขาวดำ) ก็ไม่ถามปก (live smoke จับ Haiku regression). หนังสือเหลือถามแค่ qty + จำนวนหน้า + กระดาษเนื้อใน + สีเนื้อใน.
- **Paper-name alias (2026-06-25 `a82ad4f`)**: แปลงชื่อกระดาษภาษาพูดก่อนเทียบ list — อาร์ทการ์ด 210/230 → **Art 210/230** · 300/350 → **Art Card 300/350** (stock แยก ราคาต่าง) · ปอนด์ {w} → Bond {w}. **hard-rule**: ลูกค้าระบุกระดาษที่อยู่ใน list = ใช้เลย ไม่ใช่ "กระดาษพิเศษ" แม้ต่างจาก default ("พิเศษ" = ไม่อยู่ใน list เท่านั้น). แก้เคส "ขก ราม" (ปกอาร์ทการ์ด 210 → Art 210 ตีราคาได้).
- **Files**: `lib/ai-quote/{prompt,tools,run,db}.ts` · `app/api/ai-quote/route.ts` (+ `leads/`, `leads/[id]/`) · `app/quote-assistant/` · `app/quote-leads/` · Postgres `ai_quote_sessions` (lead store) + `ai_quotes` (db-migrate route).

### AI Quote — LINE OA Phase 1b-A: webhook takeover (cutover 2026-06-30, PR #11/#12/#13)
> Path 1 architecture: **dashboard ถือ LINE webhook เต็มตัว** (เลิกพึ่ง Thunder-webhook/Cloudflare Worker) → เรียก Thunder verify API เอง + `/track` เอง. channel-agnostic (`channel`+`channel_user_id`) → Messenger เสียบทีหลัง. **AI quote ยังปิด** (`AI_QUOTE_LINE_ENABLED` flag) — 1b-A ทำแค่ slip + track. ดู [`RUNBOOK-1b-a-cutover.md`](RUNBOOK-1b-a-cutover.md) (cutover done) + design `docs/superpowers/specs/2026-06-27-ai-quote-phase1b-line-webhook-takeover-design.md`.
- **Webhook** (`app/api/ai-quote/line/route.ts`) — POST → verify HMAC-SHA256 (ผิด 401 · ไม่มี secret 500) → **ack 200 ทันที** → งานหนักใน `after()` → reply ผ่าน LINE API. เฉพาะ 1-on-1 (group/room ทิ้ง).
- **Slip-verify** — รูปเข้า → **Haiku vision pre-filter** (`isSlipImage`, fail-safe=true) กันเปลือง Thunder quota (Thunder นับ **ทุก** request รวม non-slip) → ถ้าใช่ → `verifyBankSlipImage` (Thunder v2, `matchAccount:true`, `checkDuplicate:true`) → **Penprinting Flex card 4 สถานะ** (สำเร็จ+ยอด+ธนาคาร / ซ้ำ / ยอดไม่ตรงบัญชี / อ่านไม่ได้). port จาก Remedy `lib/thunder.ts`.
- **Pre-filter tuning (debug บน prod 2026-06-29~30)**: เปิด→loosen→**remove ทั้งหมด** (สลิปจ่ายบิล KBank โดน drop ผิด)→**re-add** + แก้ prompt ให้นับ bill-payment/QR/PromptPay/top-up เป็นสลิป (lean-yes, drop เฉพาะ explicit "ไม่"). **Final: pre-filter เปิดอยู่** + recognize bill-payment. → §9 lesson.
- **`/track <id>`** — `^/?track\s+\d{6,}` → `loadOrder(id)` → `buildOrderFlex` (port `buildOrderFlex_` Apps Script → TS) → reply Flex สถานะงาน. loadOrder-backed (Postgres).
- **Metrics** (`2669ee8`) — table `slip_checks` (1 row/รูป, best-effort `recordSlipCheck` NEVER throws, เรียกหลัง reply) + `GET /api/admin/slip-metrics` วัด Thunder quota จริง (`thunder_called` rows == quota ใช้). **Migration applied 2026-06-30** (db-migrate ผ่านเบราว์เซอร์คุณนุ๊ก — slip-metrics 500→200).
- **Diagnostic logging ค้าง 5 จุด** (`7d32666`) — `webhook-router.ts:41/49/53/60` + `slip.ts:105` → ถอดหลัง soak (backlog `LOG-1`).
- **Rollback**: ชี้ LINE Webhook URL กลับค่าเดิม (ไม่ต้อง revert code — code อยู่ใน main แต่ไม่มีใครเรียกถ้า webhook ชี้ที่อื่น). gates เขียว Node 22 (227 tests ตอน 1b-A).
- **Files**: `app/api/ai-quote/line/route.ts` · `lib/ai-quote/{webhook-router,slip,slip-metrics,track-flex,slip-flex}.ts` · `lib/ai-quote/channels/line.ts` · `app/api/admin/slip-metrics/route.ts` · Postgres `slip_checks`.

### AI Quote — LINE OA Phase 1b-B: customer mode (merged 2026-07-06, PR #18 `5f8954e` — flag OFF จนตั้ง env)
> ลูกค้า 1-1 opt-in เข้า "โหมดขอราคา AI" เอง → Sonnet 5 engine เดิม + **customer prompt variant** ([lib/ai-quote/prompt-customer.ts](lib/ai-quote/prompt-customer.ts) — ภาษาร้านค้า, วลี hand-off pin "ส่งต่อทีมงาน") → escalate เข้ากลุ่มพนักงาน + /quote-leads. Spec: `docs/superpowers/specs/2026-07-04-...` · Plan: `docs/superpowers/plans/2026-07-06-...`
- **Mode lifecycle** ([lib/ai-quote/line-mode.ts](lib/ai-quote/line-mode.ts) + ตาราง `ai_quote_line_modes` 1 row/user): entry keyword `ขอราคา`/`ตีราคา`(±AI) หรือ postback `ai_quote_start` → intro · **lazy 30-min idle expiry ไม่มี cron** (`modeActive` เช็คตอนข้อความถัดไป) · exit `จบ`/`ออก`/`ออกจากโหมด AI` · row เดียวกันถือ **24h hint gate** (`last_hint_at` รอดข้าม exit — จงใจ nullable mode fields, deviate จาก spec DDL)
- **Hint นอกโหมด** (§2 conservative): ≤1/user/24h + quick-reply "🤖 เริ่มขอราคา AI" · gate ใน **DB ไม่ใช่ KV** (KV fail-open = spam แชตที่พนักงานดูแล) · ปิดทั้งก้อนด้วย sub-flag `AI_QUOTE_LINE_HINT_ENABLED` (soft launch = ปิด)
- **Escalation 4 triggers** ([lib/ai-quote/customer-triggers.ts](lib/ai-quote/customer-triggers.ts) pure detectors + [escalation-flex.ts](lib/ai-quote/escalation-flex.ts)): ①ขอคุยกับคน (keyword, ก่อน engine) ②นอกขอบเขต (`detectCustomerEscalation` = quote 0 + วลี pin — **ไม่ใช้** staff `out.escalated` ที่กว้างเกิน) ③วน 4 รอบไม่ได้ราคา (`rounds_no_quote` counter) ④ลูกค้ายืนยันสั่ง (keyword แคบ + ต้องมี quote แล้ว → Type B `กำลังติดตาม`). ทุก trigger: save conv → set status → **push Flex กลุ่มพนักงาน** (`LINE_STAFF_GROUP_ID`, การ์ดมี **ราคา AI ล่าสุดจาก DB** — review fix `87246bf`) → ตอบลูกค้า → **ออกโหมด**
- **M5 owner-check ปิดจริง**: LINE session ผูก `line_user_id` (webhook-verified) — `loadSession(id, {lineUserId})` → `WHERE channel='line' AND line_user_id=...`, mismatch → null ไม่ leak; conversation persist ทุก turn (LINE ไม่มี client ถือ history — ต่างจาก dashboard no-auto-save, spec §6 ใช้ sessions เป็น metrics) · `createLineSession` + display name จาก `getLineProfile` (best-effort)
- **Guardrails**: rate limit 30 msg/ชม./user (KV fail-open — defense-in-depth) · message cap 4000 + `sanitizeHistory` clamp · engine throw → ตอบ ERROR_TEXT ไม่เงียบ · **flag OFF = 1b-A เป๊ะ** (regression tests pin; deploy ก่อน migrate ปลอดภัยเพราะ flag ยังไม่ตั้ง)
- **UI**: badge "LINE" (emerald) ใน /quote-leads customer cell
- **Execution**: subagent-driven 12 tasks + 2-stage review; review จับจริง 3 เรื่อง (FK type `session_id` · trigger ④ การ์ดไม่มีราคา [spec §4] · `ANTHROPIC_API_KEY` gate asymmetry) · final opus review = Ready, 0 Critical/Important · **373 tests** (+79) gates เขียว Node 22
- **Rollout จังหวะ 1 (คุณนุ๊ก)**: ตั้ง `LINE_STAFF_GROUP_ID` + `AI_QUOTE_LINE_ENABLED=true` → redeploy → รัน db-migrate → ทีม smoke LINE จริง (เข้า/ออกโหมด · 3 ประเภท · /track+สลิป in-mode · 4 triggers · M5 2 เครื่อง) · **จังหวะ 2**: hint flag + rich menu
- **Files**: `lib/ai-quote/{line-mode,customer-triggers,prompt-customer,escalation-flex}.ts` ใหม่ · `webhook-router.ts` (CustomerAiDeps + arms) · `db.ts` (owner-check/createLineSession/countQuotes/loadLastQuote) · `channels/line.ts` (getLineProfile) · `app/api/ai-quote/line/route.ts` (wiring) · db-migrate (+`ai_quote_line_modes`, `ai_quote_sessions.line_user_id`)

### Track by Customer — ค้นงานด้วยชื่อลูกค้า (2026-07-01, PR #17)
- **LINE (กลุ่มลูกค้า):** `/track` → งาน active ทั้งหมด · `/track <คำ>` กรอง (ชื่องาน+ลูกค้า) · `/track <เลข 6+>` = การ์ดเดิม (ไม่เปลี่ยน). Hybrid: กลุ่มผูกกับชุดชื่อลูกค้า (`customer_registrations.line_group_id`) เป็น boundary. adaptive reply (1→`buildOrderFlex`/หลาย→`buildCustomerJobsFlex`/0→text/unregistered→guide). route `track-customer` + `parseTrackCommand` ใน `lib/ai-quote/webhook-router.ts`
- **Web:** `/track/c/[token]` (public, token = ความลับ 144-bit `randomBytes(18)`, rate-limited by ip+token, **ไม่อยู่ใน middleware matcher**) → รายการงาน active + ค้น (redact ราคา/spec เหมือน /track)
- **Admin:** `/registrations` (admin only, ใน matcher) + `/api/registrations` (GET list / POST create) · `/api/registrations/[id]` (DELETE hard + audit_log) · `/api/registrations/customers` (distinct `raw->>'customer'`)
- **Shared:** `lib/track-status.ts deriveTrackStatus` (pure — ใช้ร่วม track-flex + customer-track; track/lookup ยังไม่ใช้ = deferred) · `lib/customer-track.ts loadActiveJobsByCustomer(names[], {keyword})` · ตาราง `customer_registrations` (`customers text[]` = หลายชื่อ/ลูกค้า)

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
| 3.6 — Decommission WP | ✅ | Cutover 2026-05-09 (DNS app.penprinting.co → Vercel; WP retired) |
| AI Quoting 0 | ✅ | calc `/api/quote` pricing API (2026-06-17, repo penprinting-calc) |
| AI Quoting 1a | ✅ shipped | In-dashboard AI Quote Assistant (PR #2 merge `91d8dc8` 2026-06-24) + FAB widget (PR #4 `66d0286`) + M3/M4 closed + prompt-tuning: assume-and-disclose (`237b66d`) + book cover defaults 4สี/Art230 (PR #9 `0b93f8e` 2026-06-25). M5 IDOR เปิด (ปิดพร้อม 1b) |
| AI Quoting 1b/1c | — | LINE OA channel · กล่อง/ถุง auto-quote (future, ดู design-ai-quoting.md) |

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
| **AI tool-use loop persisted empty-text turn → bricked session** (AI Quote Phase 1a audit H1, 2026-06-23, `902d70a`) | `runQuoteTurn` อาจ persist assistant turn ที่ `text=''` (ชน `MAX_TOOL_ROUNDS` ขณะ `tool_use` / tool-use-only block / `max_tokens` stop). Anthropic API **reject empty text content block** → ทุก message ถัดไปใน session 400 พังถาวร | Fallback non-empty reply ก่อน persist ใน `lib/ai-quote/run.ts`. +2 regression test (`tests/ai-quote-run.test.ts`). Guard: assistant content ที่ persist ต้องไม่ว่าง |
| **calc env "ตั้งแล้ว" แต่ไม่ redeploy = ไม่ live** (AI Quote Phase 1a smoke, 2026-06-23, calc `fd4f755`) | smoke เจอ `/api/ai-quote` คืน 500 "QUOTE_API_TOKEN not configured" — calc มี env ตั้งแต่ 6/20 (All Environments) แต่ production deploy ล่าสุด = `3edcfe1` (6/17, **ก่อน** มี token) → runtime อ่านไม่เจอ. note 6/20 "calc QUOTE_API_TOKEN ตั้งแล้ว ✅" = unverified claim | push empty commit `fd4f755` → calc auto-deploy production สด → token live (curl probe 500→401). Lesson: env var = live ต่อเมื่อมี deploy ใหม่ **หลัง** ตั้ง — verify ด้วย probe per host ([[feedback_omise_secret_roll_vm_sync]] + [[feedback_audit_backlog_hypothesis]]) |
| **Haiku slip pre-filter ตัดสลิปจ่ายบิลทิ้งเงียบ** (Phase 1b-A LINE, 2026-06-29~30, `e4a05b3`→`0139d31`) | สลิป KBank "จ่ายบิลสำเร็จ" → Haiku vision pre-filter ตัดสิน "ไม่ใช่การโอน" → return เงียบ ไม่เรียก Thunder → **ลูกค้าส่งสลิปจริงแต่ระบบไม่ตอบ**. แก้รอบแรกผิดทาง: **ถอด pre-filter ทั้งหมด** (`e4a05b3`, Thunder=sole authority) = ยอมจ่าย Thunder quota ทุกรูป (Thunder นับทุก request) | **Root cause = prompt ไม่ใช่ gate**. re-add pre-filter (`0139d31`) + แก้ prompt: นับ bill-payment/QR/PromptPay/top-up เป็นสลิป, lean-yes (drop เฉพาะ explicit "ไม่"). Lesson: cheap classifier gate หน้า paid API → tune **prompt** ก่อนถอด gate; การ miss = prompt bug ไม่ใช่เหตุให้ลบ gate ([[feedback_ai_quote_phase1b_thunder_prefilter]]). Metrics `slip_checks` (`2669ee8`) ตามดู `filtered_out` vs `thunder_calls` ว่าทูนถูก |

---

## 10. Version History

> WP version history (v5.0 → v5.11) อยู่ใน [`monitoring.md` §10](../production-monitoring/monitoring.md). entries below are v2-specific milestones.

### Audit round 2026-07-21 (จบ, 2026-07-22) — ปิด Low 7/7 → round ปิดสมบูรณ์ 100% ทุกระดับ (tests 510→533)
Low cluster ที่ defer ไว้ ปิดครบใน session เดียว, commit ละ item, TDD ทุกตัวที่มี seam. **📦 widget lazy** ([`c39f53d`](https://github.com/witsarutnook/penprinting-dashboard/commit/c39f53d)): `QuoteAssistantClient` → `next/dynamic` ssr:false — assistant chunk เลิก ride shell bundle ทุกหน้า admin, โหลดตอนกด FAB ครั้งแรก. **🛡 lead claim server-authoritative** ([`91a1322`](https://github.com/witsarutnook/penprinting-dashboard/commit/91a1322)): `body.assignedTo` เหลือ intent signal, owner บันทึกจาก `session.user` เสมอ. **🔁 orders-update cascade baseline** ([`25bf110`](https://github.com/witsarutnook/penprinting-dashboard/commit/25bf110)): legacy caller ไม่ส่ง `srcOrder` เคยได้ flags hard-false = jobs cascade โดน skip เงียบ → srcOrder เหลือบทบาท perf gate, flags + `oldName` มาจาก DB row สดเสมอ (jobs match ด้วย `name = oldName`). **🔒 track PIN lockout atomic** ([`1606099`](https://github.com/witsarutnook/penprinting-dashboard/commit/1606099)): peek-then-record (TOCTOU + ล็อกหลัง 6 ครั้ง) → `checkRateLimit` INCR reserve + `refundAttempt` ใหม่ใน [lib/rate-limit.ts](lib/rate-limit.ts) คืน budget เมื่อ outcome ไม่ใช่ PIN ผิด → นับเฉพาะ fail, race-free, ล็อกหลัง 5 ครั้งจริง (PATTERNS §2.4). **⚡ edit page slim** ([`2988153`](https://github.com/witsarutnook/penprinting-dashboard/commit/2988153)): port PERF-H1 ไปหน้า `/orders/[id]/edit` (ตัว loadAll สุดท้าย) → `loadOrder(orderOnly)` + `loadRecentOrdersSlim`; แถมจับ latent bug `notFound()` ใน try โดน catch กลืนเป็น error banner. **📉 quote-leads slim + lazy transcript** ([`8ff707d`](https://github.com/witsarutnook/penprinting-dashboard/commit/8ff707d)): listLeads เลิก `SELECT s.*` (conversation เต็ม 200 leads เข้า browser) → lastMessage/turnCount derive ใน SQL + GET `/api/ai-quote/leads/[id]` ใหม่ lazy-fetch ตอน expand + cache; `LeadRow` ตัด conversation ที่ type level. **📝 misc** ([`84b952e`](https://github.com/witsarutnook/penprinting-dashboard/commit/84b952e)): `listDistinctCustomers` query คอลัมน์ `customer` ตรง (เลิก detoast raw) + comment โกหก 3 จุด (rate cookies "signed"→plaintext-by-design, analytics "ISR"→dynamic); เหลือ accepted-as-is จดใน AUDIT-BACKLOG.

### Audit round 2026-07-21 (ต่อ, Mac PM) — ปิด Medium 7/7: 6 fixed + 1 accepted (tests 488→509)
ปิดหางของ round เดียวกันภายในวัน — commit ละ item, TDD ทุกตัว. **🛡 reassign** ([`38c6593`](https://github.com/witsarutnook/penprinting-dashboard/commit/38c6593)): guard เลิกเชื่อ `srcJob.dept` จาก client → `loadJobDeptStaffFromPostgres` (live rows only) + `validateReassign` pure fn ([lib/forward.ts](lib/forward.ts)) — signature ไม่มี client-dept = ปลอมไม่ได้; update ส่งเฉพาะ dept/staff ให้ raw-merge preserve ที่เหลือฝั่ง server (ปิด sibling hole: payload เดิมให้ non-admin เขียน name/dates ทับได้). **🔐 login** ([`02ca9bd`](https://github.com/witsarutnook/penprinting-dashboard/commit/02ca9bd)): Layer 1 IP failure lockout (10 fails/15min, Upstash peek+recordFailure) ก่อน cookie window — นับเฉพาะ fail เพราะทั้งโรงพิมพ์ share office NAT IP. **🏁 promote-draft** ([`fa535ff`](https://github.com/witsarutnook/penprinting-dashboard/commit/fa535ff)): gate-first flip `WHERE status='draft' RETURNING` + compensate un-flip + loser 409 — pattern H2/H3 ตัวเดียวกัน. **🔒 jobs-add** ([`8710941`](https://github.com/witsarutnook/penprinting-dashboard/commit/8710941)): race นี้ conditional statement ปิดไม่ได้ (INSERT ไม่มี common row; NOT EXISTS ใต้ READ COMMITTED รูเดียวกัน) → **partial unique index `uq_jobs_active_order`** (db-migrate สแกน dupes ก่อน เจอ = SKIPPED+ids) + `isActiveJobConflict` → 409; writer sweep ครบ (forward/undo tombstone-first ปลอดภัยโดย construction). **🚫 cancelOrder** ([`b082ef6`](https://github.com/witsarutnook/penprinting-dashboard/commit/b082ef6)): `failedJobs[]` + flip เฉพาะ cascade ครบ → 502 retry-to-converge. **📜 quote-logs append-only persist** ([`c15cb91`](https://github.com/witsarutnook/penprinting-dashboard/commit/c15cb91)): router เคย persist `out.newHistory` (trimmed-40 replay view) ทับ history เต็ม → `turn_index` เลื่อน ~2/รอบหลัง 40 turns พัง flag key; ตอนนี้ทุก path persist `[...conversation, user, assistant]` ผ่าน `persistedConv()` เดียว — trim เหลือที่ replay เท่านั้น, schema ไม่แตะ, viewer ได้ history เต็ม. **🤝 LINE /track no-PIN = accepted WP-parity** (คุณนุ๊กตัดสิน — ลูกค้าใช้สะดวก, revisit ถ้าเจอ abuse). บวกเช้า: **H2 prod smoke ผ่าน** (double-tap forward → toast, การ์ดไม่ซ้ำ — pin expected พบ forward เดี่ยวคืน 502 ไม่ใช่ 409 ตาม doc, พฤติกรรม user เหมือนกัน). db-migrate applied same-day (`CREATE UNIQUE INDEX uq_jobs_active_order` ขึ้น = prod ไม่มีงานซ้ำค้าง). **บวก follow-up: 📓 สมุด digital ≤200 เล่ม** — calc [`ecb30af`](https://github.com/witsarutnook/penprinting-calc/commit/ecb30af) (shared `computeBookDigital`, qty 201 byte-identical, baselines 16→18, prod smoke เขียว) + staff prompt mode line ครอบสมุด (TDD +1 = **510 tests**) + คุณนุ๊ก smoke ผ่าน same-day — งานที่ session iPad เช้าคุยค้างแต่ไม่เคย push (ตรวจ git = 0 ร่องรอย) ทำใหม่จบในวัน.

### Audit round 2026-07-21 — ปิด 3 High: board rerender + job-transition races (☁️ cloud session, PR [#21](https://github.com/witsarutnook/penprinting-dashboard/pull/21) squash [`721cdff`](https://github.com/witsarutnook/penprinting-dashboard/commit/721cdff), tests 485→488)
Audit เต็ม 2 มิติ (perf × correctness) ด้วย 4 subagents คู่ขนาน — scan แรกตั้งแต่ 2026-05-12. ของเดิมที่ปิดแล้ว **hold ครบ** (delta slim projection · cached id-sets · adaptive poll · signature verify · middleware matcher · M5 owner-check). **H1 — บอร์ด re-render ทุก poll** ([`b18b978`](https://github.com/witsarutnook/penprinting-dashboard/commit/b18b978)): [pending-mutations.tsx](components/board/pending-mutations.tsx) ส่ง context value เป็น object literal สด → identity เปลี่ยนทุก provider render → Card ทุกใบที่ subscribe re-render ล้ม `arePropsEqual` memo (PA-M2/PERF-C1) — sibling providers (Undo/BulkMode) memo ถูกอยู่แล้ว ตัวนี้ตัวเดียวหลุด → `useMemo` ครอบ (stability chain verified: `pollNow` ← `pollOnce` deps `[]`). **H2/H3 — write-transition race class** ([`887b8e7`](https://github.com/witsarutnook/penprinting-dashboard/commit/887b8e7)): forward/ship/cancel/delete ใน [postgres-write.ts](lib/postgres-write.ts) เคยเป็น SELECT-check → INSERT → tombstone **unconditional** (autocommit, ไม่มี lock) → double-click forward = 1 job กลาย 2 การ์ด · ship∥cancel = id เดียวลง 2 ตาราง terminal (archive/analytics นับซ้ำ) → **conditional-tombstone-first gate**: `UPDATE jobs SET phase2_deleted_at=NOW() WHERE id=? AND phase2_deleted_at IS NULL RETURNING ...` เป็น statement แรก — statement atomicity = racing transitions mutual-exclusive (ผู้แพ้ 409/failed[] "Job not found or already forwarded") + **compensate un-tombstone** เมื่อ terminal INSERT/ID-collision ล้ม (การ์ดไม่หายเงียบ + failed forward = board ไม่เปลี่ยน); `deleteJob` = 1 conditional statement · `cancelJob` gate `RETURNING raw` แทน pre-SELECT (query ลดลง 1). เลือก approach นี้แทน full transaction บน pooled client — mutual exclusion เท่ากัน ไม่ต้องเพิ่ม connection model/mock layer. Tests +3 compensation ผ่าน `queueError` ใหม่ใน mock-postgres (ยิง reject ทดสอบ rollback path). **ยัง open จาก round นี้:** 7 Medium (reassign dept trust · login IP rate-limit · quote-logs flag index ใต้ trim-40 · promote-draft/jobs-add double-submit · cancelOrder partial-failure · LINE /track no-PIN) + Low cluster — ดู AUDIT-BACKLOG.

### Quote Logs Viewer + Book digital pricing + ซอง/แฟ้ม (2026-07-20) 🔍📚 (ทุกอย่าง prod-verified in-session, tests 471→485)
**🔍 Quote Logs Viewer** — ตอบโจทย์คุณนุ๊ก "เก็บ log การคุยลูกค้า↔AI ดูย้อนหลัง วิเคราะห์ปรับ prompt": ข้อมูลมีครบอยู่แล้ว (`ai_quote_sessions.conversation` + `ai_quotes`) — งานคือ "หน้าดู" + ของใหม่ 2 ชิ้น. **(1) per-turn timestamp** ([`df7b4b4`](https://github.com/witsarutnook/penprinting-dashboard/commit/df7b4b4)): `ConversationTurn.ts?` stamp ผ่าน `mkTurn` helper จุดสร้าง turn ทั้ง 4 (runQuoteTurn shared + 3 canned-reply sites ใน webhook-router) — LINE/Messenger ได้ครบแน่นอน (server เป็นเจ้าของ history), dashboard ได้เมื่อ session-backed; `sanitizeHistory` preserve ts ที่ valid + drop ที่เพี้ยน; **ไม่ส่งเข้า Anthropic API** (toMessages เลือก role+text อยู่แล้ว). **(2) ตาราง `ai_quote_turn_flags`** ([`b9033fb`](https://github.com/witsarutnook/penprinting-dashboard/commit/b9033fb)): tag "AI ตอบผิด" ระดับข้อความ + โน้ต — **snapshot role+text ในแถว flag** เพราะ turn_index drift ได้ (sanitizeHistory trim 40 turns ฝั่ง dashboard) → UI anchor flag กับบับเบิลเฉพาะเมื่อ text ตรง snapshot ไม่ตรง = detached section. Data layer [lib/ai-quote/logs.ts](lib/ai-quote/logs.ts): `loadQuoteLogSessions` single-query aggregate (jsonb_array_length + subquery counts, NULL-param + `ANY(array)` pattern เดิม — no N+1) · `flagTurn` snapshot จาก DB ฝั่ง server (client ส่งแค่ index — กัน mismatch) + assistant-only 422 + ON CONFLICT → duplicate 409 · `mergeTimeline` pure fn แทรก quote cards ตามเวลา (session เก่าไม่มี ts → ต่อท้าย). **API** [`57c1011`](https://github.com/witsarutnook/penprinting-dashboard/commit/57c1011) POST/DELETE `/api/ai-quote/flags` admin + audit_log. **UI** [`524d3d0`](https://github.com/witsarutnook/penprinting-dashboard/commit/524d3d0): `/quote-logs` (admin, URL filter state: channel/customer-shortcut/q/flagged/escalated/page) + `/quote-logs/[id]` transcript บับเบิล + `?view=flags` worklist (anchor `#turn-N`) + nav "AI Logs" + middleware matcher + cross-link "ดูบทสนทนาเต็ม" ใน /quote-leads ([`fad8453`](https://github.com/witsarutnook/penprinting-dashboard/commit/fad8453), ซ่อนจาก sales). **Prod-verified:** db-migrate applied + คุณนุ๊กเปิดใช้จริง (30 sessions/28 quotes). **📚 Book digital ฝั่ง dashboard** ([`2fda57f`](https://github.com/witsarutnook/penprinting-dashboard/commit/2fda57f), TDD +1): prompt staff บรรทัด mode ครอบหนังสือ (calc คิด digital เมื่อ ≤200 เล่ม — ดู [calc `b9874c6`](https://github.com/witsarutnook/penprinting-calc/commit/b9874c6) + spec ฝั่ง calc) + กัน AI ทักราคา digital ว่าแพงผิดปกติ; ราคาลูกค้าถูกอัตโนมัติผ่าน `/api/quote` — prod smoke calc 17/17 + คุณนุ๊ก smoke น้อง PP ผ่าน. **📦 ซอง/แฟ้ม** ([`72f0b04`](https://github.com/witsarutnook/penprinting-dashboard/commit/72f0b04)): `QTY_UNITS` + 2 หน่วย — order-form จุดเดียวครอบสร้าง/แก้/สั่งซ้ำ.

### Gate "/" reverted + 🔥 Incident: staff suppression ตายเงียบตั้งแต่ ship — Meta Page-level subscription (2026-07-17)
**Gate revert ([`c445d53`](https://github.com/witsarutnook/penprinting-dashboard/commit/c445d53), TDD +1 = 469 tests):** พิมพ์ "ขอราคา"/"ตีราคา"/"ขอราคา AI" เปล่าๆ เข้าโหมด AI ได้แล้วทั้ง 2 channel — soft-launch จบ. จุดที่ต่างจากแผน revert เดิม: **"/" เป็น optional แทนตัดทิ้ง** (`^\/?(ขอราคา|ตีราคา)(\s*ai)?$`) เพราะปุ่ม hint quick-reply ที่ส่งไปแล้วในแชตลูกค้า carry `/ขอราคา AI` — ตัดทิ้ง = ปุ่มเก่าพังเงียบ; เมนู ☰/rich menu ใช้ postback `ai_quote_start` ไม่กระทบ. `HINT_QUICK_REPLY.text` → `ขอราคา AI`. ประโยคยาว ("ขอราคาโบรชัวร์ 1000 ใบ") ยังไม่เข้าโหมด (exact-match pins เดิม). **🔥 Incident + /diagnose (เคส LukTarn 7/16):** hint แทรกหลัง Giift ตอบจบบทสนทนา ทั้งที่ HINT-1 live → อ่านโค้ดครบ chain = ถูกหมด → **DB Neon (read-only ผ่าน Chrome คุณนุ๊ก): ทั้งตาราง 17 rows `last_staff_reply_at` = NULL หมด** — echo ไม่เคยมาถึงตั้งแต่ ship → Meta dashboard: Page-level Webhook Subscription มีแค่ 2 fields. **Root cause: `message_echoes` ที่กด 7/11 ไม่ persist ที่ระดับ Page** (Meta มี subscription 2 ชั้น — ชั้น Page ตัดสินว่า event ถูกส่ง) → **verify ⑤ 7/11 = false positive** (วัดจากพฤติกรรม "AI เงียบ" — อธิบายได้จาก mode idle-expire) → **suppression + takeover ตายจริงทั้งคู่ 6 วัน** (AI ไม่ถูกเตะออกโหมดเมื่อ staff ตอบด้วย). **Fix (คุณนุ๊กอนุมัติ):** ติ๊ก `message_echoes` ใน Edit Page Subscriptions → "See Full 3 fields" → **verified ด้วยหลักฐานตรง: staff ส่ง "test" จาก Page inbox 10:45 → `last_staff_reply_at` stamp 10:45:08 ตรงวินาที** — suppression + takeover ทำงานจริงครั้งแรกตั้งแต่ ship. Runbook HINT-1 แก้ step 4/5 เป็น Page-level + DB-evidence-only verify ([`43af38f`](https://github.com/witsarutnook/penprinting-dashboard/commit/43af38f)). Lesson → [[meta-page-level-webhook-subscription]]. Regression net เสนอเป็น chip: smoke check `GET /me/subscribed_apps` ทุก deploy. **ฝั่ง calc วันเดียวกัน ([`ee5e9f6`](https://github.com/witsarutnook/penprinting-calc/commit/ee5e9f6)):** smoke follow-ups 7/16 ปิดครบ — node 20→22 ทั้ง 2 workflows (ปิด drift) + baselines 11→**14 cases** (box auto-bottom/custom + bag custom — pin `pressUsed` ด้วยเพราะ style arms มี bug history · book pin `finishing.coat/spotuv.unit`) — ค่า capture จาก API, prod smoke จาก deploy จริงเขียว 15/15.

### Post-deploy smoke system — ทั้ง 2 repos, live-proven ครบวงจร (2026-07-16) 🔥 + staff prompt current-turn-only ([`87303ac`](https://github.com/witsarutnook/penprinting-dashboard/commit/87303ac))
ปิดปัญหา "deploy จบที่ Vercel Ready โดยไม่มีใครพิสูจน์ของบน prod" — smoke ค้างเป็นคิวข้ามวัน (นามบัตร 3 วัน) + bug ราคาถึงลูกค้าก่อนถูกจับ (เคส 4,776.25). **สถาปัตยกรรม (Approach A)**: GitHub Actions `on: deployment_status` (event ที่ Vercel ส่งอยู่แล้ว — ไม่ต้อง poll/token) filter `state=success ∧ startsWith(environment,'Production')` แยก workflow ตาม repo เจ้าของ ไม่มี cross-repo trigger. **dashboard** = เจ้าของ routes: [scripts/smoke-core.mjs](scripts/smoke-core.mjs) shared core (compareFields exact-=== subset recursive + array deep-compare · withRetry 3×5s · runChecks collect-all ไม่หยุดตัวแรก · pushLine · smokeMain exit-1 backstop เสมอแม้ LINE พัง) **TDD 9 tests** + [scripts/smoke.mjs](scripts/smoke.mjs) 7 checks read-only (login/track 200 · board 307→/login · LINE GET 200 + POST bad-sig 401 · Messenger wrong-token 403 · admin no-session 401) + [.github/workflows/smoke.yml](.github/workflows/smoke.yml) (`workflow_dispatch` มี input `test_notify` ทดสอบท่อแจ้งเตือน; log step env-indirection กัน script injection — review catch). **calc** = เจ้าของราคา: twin core byte-identical + `smoke-baselines.json` 11 cases ครบทุกชนิดงาน (namecard fix rate 4 ช่อง + ปัดกล่อง 250→3 · brochure offset/digital ทั้ง 2 mode · book · notebook · box · bag — ค่า capture จาก API เท่านั้น เทียบเป๊ะถึงทศนิยมเต็ม ผิด 0.01 = fail) + auth-fail-closed + `--validate` guard (sentinel null/"CAPTURE" recursive — CI เช็คทุก push) + `--capture` recapture mode. **แจ้งเตือน**: fail เท่านั้น → LINE กลุ่มทีมงาน (env ชุด morning report) repo/check/expected vs actual/hint/ลิงก์ run; ผ่าน = เงียบ. **Live proof**: dashboard 3+ runs เขียวจาก deploy จริง (environment=`Production`) · calc parity 12 checks เขียว = ราคา prod ตรง baseline · test-notify 🧪 · fail-path จริง break 500→499 → run แดง + LINE 🔥 diff เป๊ะ → revert → เขียวคืนเอง (`3ed1359`/`293846a` cancel เป๊ะ). Secrets 5 ตัวผ่าน `gh secret set` (ไม่ผ่านแชต). `/sync-paper-prices` เพิ่มขั้นตอน baseline บังคับ — ราคาเปลี่ยนโดยตั้งใจ = อัปเดต baselines คอมมิตเดียวกัน. Accepted deviations ใน [spec](docs/superpowers/specs/2026-07-16-post-deploy-smoke-design.md) (retry 5s แทน ~10s · timeout 15m แทน ~5m · pin top-level price fields). Subagent-driven 8 tasks + 2-stage review/task (จับจริง: array reference-compare · script injection · sentinel 0) + final review READY-WITH-NOTES. Tests 459→**468**. **Ops ตั้งแต่นี้: push ที่ทำราคาเพี้ยน/ประตู auth หลุด → กลุ่ม LINE รู้ใน ~3 นาที.** (+`87303ac` staff prompt current-turn-only — twin ของ `a521529`, follow-up 7/15 ปิด)

### AI quote customer UX — เสนอกระดาษแทนก่อน escalate + ปัดราคาขั้น 0.05 + กระชับ + current-turn-only (2026-07-15) 💬 (4 commits ตรง main, verified prod ครบ)
Hotfix loop จากเคสลูกค้าจริง (Messenger, Art 130) — ทุกตัว smoke สดโดยคุณนุ๊กระหว่าง session. **(1) [`d94a600`](https://github.com/witsarutnook/penprinting-dashboard/commit/d94a600) กระดาษนอกรายการ**: เดิม escalate ทันที + model แถมสัญญา "แจ้งกระดาษแทนได้เลย ประเมินทันที" ทั้งที่ escalate = `exitMode` → ลูกค้าตอบ "120" เจอความเงียบ. กฎใหม่ใน [prompt-customer.ts](lib/ai-quote/prompt-customer.ts): มีตัวใกล้เคียงชนิดเดียวกันใน list (Art 130 → 120/160) → **ถามก่อน 1 ครั้ง ไม่ใช้วลี hand-off = ยังอยู่ในโหมด** → เลือกแล้วตีราคาต่อทันที; ยืนยันกระดาษเดิมค่อย escalate + **ข้อความ hand-off ต้องจบการสนทนา** (ห้ามชวนคุยต่อ — โหมดปิดแล้ว). ตัดสินใจไม่แตะ mode machinery: exit-on-escalate คง (กัน AI แทรก staff + LINE ไม่มี takeover detection). **(2) [`ddafb7b`](https://github.com/witsarutnook/penprinting-dashboard/commit/ddafb7b) ปัดราคา + กระชับ (คุณนุ๊กสั่ง)**: `ceilTo05` ปัดขึ้นขั้น 0.05 เสมอ ขั้นต่ำ 0.05 (1.17625→1.20 · ไม่มีวันต่ำกว่าราคาจริง) ผ่าน `roundOutcomeForCustomer` **wrap compute dep ใน [customer-deps.ts](lib/ai-quote/customer-deps.ts) — ปัดก่อน model เห็น = ราคาเต็มหลุดไม่ได้เพราะไม่เคยเห็น**; เฉพาะ 2 route แชตลูกค้า (quote-assistant staff เห็นเลขเป๊ะเดิม); ราคาปัดไหลเข้า saveQuote → lead/Flex = เลขที่ลูกค้าเห็นจริง; drop VAT fields; prompt: คำตอบราคา ≤3 บรรทัดหลัก + ไม่ทวนสเปกที่ลูกค้าระบุเอง + ตัด "แนบเลขเต็ม". **(3) [`d2f2e7f`](https://github.com/witsarutnook/penprinting-dashboard/commit/d2f2e7f) ราคารวมสอดคล้อง**: smoke จับ "ใบละ 2.40 รวม 4,776.25" (total ดิบจาก unit เต็มผ่านทะลุ) → non-namecard totalPrice = ปัดแล้ว × qty (=4,800); qty ไม่รู้ → drop; **namecard คงเดิม** (กล่อง×fix rate — qty×unit จะ undercharge กล่องไม่เต็ม). **(4) [`a521529`](https://github.com/witsarutnook/penprinting-dashboard/commit/a521529) current-turn-only**: ถามสเปกเดิมซ้ำใน session → model ข้าม tool, copy เลขเก่าจาก text history (ดูเหมือน deploy ไม่ทำงาน — จริงๆ format ใหม่ live แล้วในข้อความเดียวกัน) → กฎ "ตัวเลขราคาจาก `compute_quote` ของเทิร์นปัจจุบันเท่านั้น ห้ามนำจากข้อความก่อนหน้า". Lesson → [[llm-reuses-stale-tool-numbers-from-history]] (smoke หลัง deploy = เปิด session ใหม่เสมอ). TDD ตลอด tests 446→**458**. Follow-up เล็กเปิด: staff prompt ยังไม่มีกฎ current-turn-only (bug class เดียวกันถ้าราคากระดาษเปลี่ยน).

### นามบัตรเข้า AI quoting (2026-07-13, follow-up 3) 🪪 (calc `d64f38f` → dashboard [`4cd4320`](https://github.com/witsarutnook/penprinting-dashboard/commit/4cd4320) — deploy order: calc ก่อน)
**Fix rate ต่อกล่อง (100 ใบ) จากคุณนุ๊ก**: 1 หน้า 150 / 1 หน้า+เคลือบ 250 / 2 หน้า 300 / 2 หน้า+เคลือบ 500 (เงา/ด้านราคาเดียว · ก่อน VAT · ปัดใบขึ้นเป็นกล่องเต็ม — ลูกค้าได้ใบครบกล่อง). **ราคาอยู่ calc repo ที่เดียว** (`computeNamecard` lookup table + `DEFAULT_CONFIG.namecard` — API-only ไม่มีแท็บ UI, backlog แยก). ฝั่งนี้: tool enum+desc · prompts staff+customer scope 3→4 + กฎนามบัตร (ตอบต่อกล่อง+จำนวนกล่อง+รวม · default 1 หน้า ไม่เคลือบ+สมมติฐาน · ถอดจาก escalate list — กล่อง/ถุง/สติกเกอร์/โปสการ์ดยัง escalate) · INTRO/HINT scope · PRODUCT_LABEL (quote-assistant UI + escalation Flex). **Verified calc บน local API จริง**: 4 ช่องราคาเป๊ะ · 250 ใบ→3 กล่อง=450 · ขั้นต่ำ 1 กล่อง · 422 เมื่อ spec ขาด · brochure regression 4.78 ตรง prod baseline. Tests **446** ทั้ง 2 repos gates เขียว. รอ smoke prod โดยคุณนุ๊ก (ดู NEXT-SESSION).

### น้อง PP persona + LINE rich menu LIVE + AI-quote quality refactor (2026-07-13) 🤖 (`5ada186` + `4e7574a` ตรง main → auto-deploy)
สามเรื่องใน session เดียว: **(1) AI ลูกค้าได้ชื่อ "น้อง PP"** ([`4e7574a`](https://github.com/witsarutnook/penprinting-dashboard/commit/4e7574a)) — persona ใน [prompt-customer.ts](lib/ai-quote/prompt-customer.ts) (แทนตัวเอง "น้อง PP"; generalize ช่องทาง LINE→แชต LINE/Messenger) + `INTRO_TEXT` แนะนำตัว + `HINT_TEXT` "กับน้อง PP (AI)" — ตรงดีไซน์เมนู "CHAT with PP BOT"; quick-reply label + `/ขอราคา AI` คงเดิม (soft-launch gate). +2 tests pin ชื่อ (**444**). **(2) LINE rich menu LIVE** (kit `../line-oa-richmenu/` นอก repo): รูป final จากคุณนุ๊ก → resize 2500×1686 447KB + remap JSON **4 โซน** (บนเต็ม=portfolio · ล่างซ้าย=postback `ai_quote_start` · กลาง=tel · ขวา=maps — โซน /track ตัดตามดีไซน์; วัด dividers จากรูปจริง x=827/1672 + overlay verify) → deploy รอบแรกล้ม step set-default: **POST ตัวเปล่าไม่มี body โดน Akamai edge ของ LINE ตอบ HTML Bad Request** (diagnose ด้วย token ปลอม: HTML 400 = shape ผิด / JSON 401 = shape ถูก) → fix `-d ''` + สคริปต์เก็บตก `set-default-richmenu.sh` → **verified บนมือถือคุณนุ๊ก — ทางเข้าโหมด AI หลักของ LINE เปิดแล้ว** (lesson [[line-api-empty-post-akamai]]). **(3) Quality follow-ups 7/10 ปิดครบ 4** ([`5ada186`](https://github.com/witsarutnook/penprinting-dashboard/commit/5ada186), zero behavior): extract shared `buildCustomerAiDeps` → [lib/ai-quote/customer-deps.ts](lib/ai-quote/customer-deps.ts) (duplicate ~90% ใน 2 routes หาย, −51 LOC; channel เลือก session scope + rate-limit key) · hint-flag pure fns + tests (`messengerHintEnabled` pin fail-closed flag∧FB_APP_ID · `normalizeFbAppId` · `rateLimitKey` pin historical prefixes) · แยก `CustomerAiDeps` → Mode/Session/Engine/EscalationDeps (extends, call sites ไม่แตะ) · `LoadSessionOpts` type-level pairing (channelUserId เดี่ยวๆ = compile error, runtime fail-closed คงไว้). **Bonus: hint Messenger ผ่านการเฝ้า 2 วัน (11→13) ไม่มีเคสแทรกผิดที่ — HINT-1 watch จบ.** Gates เขียว Node 22 ทุก commit.

### HINT-1 — staff-activity suppression + takeover (Messenger) SHIPPED (2026-07-10) 🤫 (PR [#20](https://github.com/witsarutnook/penprinting-dashboard/pull/20) `59d85de` — **rollout ครบ 6 steps + verified 2026-07-11, hint Messenger เปิดแล้ว**)
ตอบ incident 7/09 (hint แทรกกลางบทสนทนาพนักงาน): บอทรู้ว่า staff คุยอยู่ผ่าน Meta `message_echoes` — echo ที่ `app_id` ≠ app เรา (หรือไม่มี = Page inbox) = staff ตอบ → `InboundMessage` kind ใหม่ **`staff-echo`** (PSID จาก recipient) → arm เงียบใน [webhook-router.ts](lib/ai-quote/webhook-router.ts) → `recordStaffReply` ([line-mode.ts](lib/ai-quote/line-mode.ts)) upsert เดียว atomic: stamp `last_staff_reply_at` (คอลัมน์ใหม่, migration idempotent) + เคลียร์โหมด = **takeover — staff ตอบ = AI หยุดทันที** (คง `last_hint_at`). Hint arm เพิ่ม gate `staffActive` **48h** เช็คก่อน 24h gate (suppressed hint ไม่เผา quota). **Fail-safe ทางเดียว:** ไม่มี `FB_APP_ID` (env ใหม่, `.trim()` แล้ว) → skip echo ทุกตัว + `hintEnabled` fail-closed — จำแนกพลาด = บอทเตะตัวเองหลุดโหมดทุก reply จึงต้อง fail ไปทาง "ไม่ทำอะไร" เท่านั้น. **LINE: ตรวจไม่ได้โดยสภาพ** (OA Manager ตอบไม่มี webhook) → `AI_QUOTE_LINE_HINT_ENABLED` ปิดถาวร (rich menu = ทางเข้า); LINE route diff = wiring 2 บรรทัด zero behavior. Flow: brainstorm→spec→plan→subagent-driven (2-stage review/task) → final opus review anchor spec = **READY** (จับ I1 FB_APP_ID whitespace/precision → trim hardening + M1 runbook ordering; opus verify **deploy = byte-identical prod ทั้ง 4 rollout stages**). Gates เขียว Node 22 (**436 tests** +16/build). Rollout 6 steps = user actions: [RUNBOOK-hint1-staff-suppression.md](RUNBOOK-hint1-staff-suppression.md) — ลำดับ load-bearing: subscribe echoes → **verify "บอทไม่เตะตัวเอง"** → ค่อยเปิด hint. Spec: `docs/superpowers/specs/2026-07-10-hint-staff-suppression-design.md`. **Rollout completed + verified 2026-07-11** (session ถัดมา): db-migrate → `FB_APP_ID=890064264151011` → subscribe `message_echoes` → verify 3 ข้อผ่านบน Messenger จริง (ไม่เตะตัวเอง · takeover · suppress) → hint flag on + redeploy Ready — hint Messenger กลับมาเปิดหลัง incident 7/09 แบบมี detector คุ้มกัน. **Same session (ก่อน HINT-1): polish `**` markdown** ([`5e22d8b`](https://github.com/witsarutnook/penprinting-dashboard/commit/5e22d8b) ตรง main) — `stripChatMarkdown` ใน [run.ts](lib/ai-quote/run.ts) จุดสร้าง reply เดียวครอบทุก surface (LINE/Messenger/quote-assistant ล้วน plain text) + กฎห้าม markdown ใน customer prompt.

### AI Quote 1c — Messenger จังหวะ 2 GO-LIVE 🚀 (2026-07-09, same-day กับ entry ล่าง — docs-only ฝั่ง repo)
App **"AI Quoting" Published = เปิดสาธารณะ** — ลูกค้าจริงทัก Page Penprinting เจอบอทแล้ว. เส้นทางจริง (Claude ไล่หน้าจอผ่าน Chrome MCP): app แบบ use case **ไม่ต้อง App Review** — privacy policy URL (สร้าง+กรอกวันเดียวกัน) + Test use cases ✅ → หน้า Publish ขึ้น "All required app settings are complete" → กด Publish จบ. **กับดักที่หลบได้:** "Add to App Review" = บังคับ **Tech Provider** (สำหรับ app ให้บริการธุรกิจอื่น, **irreversible**) → [[feedback_meta_usecase_app_review_tech_provider_trap]]. **Verified non-tester ครบ flow บน prod:** ทัก → hint copy ใหม่ → ปุ่ม → intro → AI ถาม spec → ตีราคาหนังสือธรรมะ 300 เล่ม 54.98 บ./เล่ม. **2.4 persistent menu + ice breaker deployed** (kit `../messenger-profile/` — Get Started/menu/ice breaker ทุกปุ่ม postback `ai_quote_start` [webhook-router.ts:77](lib/ai-quote/webhook-router.ts) bypass gate "/"; เมนู ☰ ขึ้นจริงบนมือถือ, client cache ~ครึ่งชม.). Rollback: Unpublish ปุ่มเดียว / `AI_QUOTE_MESSENGER_ENABLED=false`. เหลือ: M5 2-account + polish `**` markdown ดิบใน quote reply (LINE โดนด้วย). ดู [RUNBOOK-1c-messenger-setup.md](RUNBOOK-1c-messenger-setup.md) จังหวะ 2.

### slip-metrics `?channel=` filter (2026-07-09) 📊 (`db2eebd`, ตรง main → auto-deploy)
ปิด follow-up จาก 1c review: `/api/admin/slip-metrics` รับ `?channel=line|messenger` — extract SQL จาก route ลง [lib/ai-quote/slip-metrics.ts](lib/ai-quote/slip-metrics.ts) เป็น `loadSlipMetrics(channel?)` + `parseSlipMetricsChannel` (route เหลือ parse+delegate ตาม pattern track-result). Filter ใช้ NULL-param trick `AND (${ch}::text IS NULL OR channel = ${ch})` = query เดียวไม่มี dual SQL ให้ drift; ไม่ใส่ param = aggregate เดิมเป๊ะ (response เพิ่ม field `channel: 'all'` — additive); ค่า typo → **400** กันอ่านค่าศูนย์เงียบๆ. **TDD** +6 tests ([tests/slip-metrics.test.ts](tests/slip-metrics.test.ts) pin param parse / SQL binds / totals math). Gates เขียว Node 22 (**414 tests**/build). RUNBOOK-1c caveat เดิม (aggregate-only) ลบแล้ว. **Same session ฝั่ง penprinting-web: privacy policy page live ที่ `penprinting.co/privacy-policy`** — ปลดล็อก App Review `pages_messaging` (จังหวะ 2 go-live Messenger; runbook 2.1 ✅).

### AI Quote Phase 1c — Messenger channel SHIPPED (2026-07-08) 💬 (PR [#19](https://github.com/witsarutnook/penprinting-dashboard/pull/19) `3e198d6` — env Messenger ยังไม่ตั้ง = route เงียบ)
Brainstorm→spec→plan→execute จบใน session เดียว (subagent-driven, 12 tasks). **Adapter ตัวที่ 2** ตาม seam ที่ 1b-A เตรียม: [channels/messenger.ts](lib/ai-quote/channels/messenger.ts) (X-Hub-Signature-256 · parse skip `is_echo` + quick_reply payload · Send API v23.0) + route `/api/ai-quote/messenger` (GET hub.challenge + POST mirror LINE) · `routeInbound` **`trackEnabled`** gate (Messenger ไม่มี /track /groupid — D1) · **M5 generalize** `loadSession({channel, channelUserId})` fail-closed + `createMessengerSession` (PSID reuse column `line_user_id` — **zero DB migration**) · [slip-messenger.ts](lib/ai-quote/slip-messenger.ts) text 4 สถานะ share classify/formatters จาก slip-flex · escalation → กลุ่ม LINE เดิม + แถว "ช่องทาง: Facebook Messenger" (LINE zero visual change) · badge /quote-leads · mode/hint reuse ตาราง `ai_quote_line_modes` (PSID กับ LINE userId ID space ไม่ชน). **Review จับจริง:** slip parity gap (duplicate sender/mismatch amount — plan gap, `3dc3a55`) + slip-metrics ไม่มี channel filter (runbook caveat). Final review (opus, เทียบ spec ต้นทาง) = 0 Critical/Important. Gates เขียว Node 22 (**408 tests** +35). **Rollout = user actions ทั้งหมด:** [RUNBOOK-1c-messenger-setup.md](RUNBOOK-1c-messenger-setup.md) — Meta app dev mode (soft launch ฟรี, tester-only) → App Review `pages_messaging` ก่อนเปิดลูกค้าจริง. env: `FB_APP_SECRET`/`FB_PAGE_TOKEN`/`FB_VERIFY_TOKEN`/`AI_QUOTE_MESSENGER_ENABLED`/`AI_QUOTE_MESSENGER_HINT_ENABLED` (hint day 1 — Hybrid D2). Spec: `docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md` **Rollout same-day (จังหวะ 0+1): Meta app "AI Quoting" dev mode + webhook verified (probe: health 200 / wrong-token 403 fail-closed) + smoke 8/9 ✅ บน Messenger จริง** — hint+gate · ตีราคา (ใบปลิว A3 3.55 บ.) · escalation ①④ → Flex กลุ่ม LINE พร้อมแถวช่องทาง + FB profile name (lead #25/#26) · slip duplicate จับข้าม channel · non-slip เงียบ · exit — เหลือ **M5 2-account (deferred)**; go-live จังหวะ 2 = App Review

### AI Quote 1b-B rollout จังหวะ 1 — LIVE บน OA จริง + escalation verified e2e (2026-07-07) 🚀
Soft launch เปิดจริง: iPad cloud session เมื่อเช้าตั้ง env ครบ (`AI_QUOTE_LINE_ENABLED=true` + `LINE_STAFF_GROUP_ID`) + push [`8572297`](https://github.com/witsarutnook/penprinting-dashboard/commit/8572297) (a11y aria-label board search/bulk-select, A11Y partial) + [`25890f6`](https://github.com/witsarutnook/penprinting-dashboard/commit/25890f6) **TEST-ONLY gate "/"** — เข้าโหมดต้อง `/ขอราคา`/`/ตีราคา` กันลูกค้าพิมพ์คำธรรมดาหลุดเข้าโหมดช่วง soft launch (revert instructions ใน comment `isEnterAiKeyword`/`HINT_QUICK_REPLY`). **Verified prod (session นี้):** db-migrate applied (`ai_quote_line_modes`+`line_user_id`) · lead #23 badge LINE ตีราคาหนังสือ 71.64/เล่ม · **escalation ① end-to-end: Flex เข้ากลุ่มพนักงานจริง พร้อมราคาล่าสุดจาก `loadLastQuote`** (fix `87246bf` พิสูจน์บน prod) + lead → `escalated` + exit "จบ" ✅. Flex ยิงเฉพาะ 4 escalation triggers (`escalate()` webhook-router) — ตีราคาปกติไม่ push (by design, กัน spam). Smoke เหลือ: ④ order intent · **M5 2-account** · /track+slip in-mode. **ทางเข้าโหมดถัดไป = rich menu ปุ่ม postback `ai_quote_start`** (bypass gate "/", OA Manager ตั้งไม่ได้ → Messaging API; ทับเมนูเดิมแบบถอดคืนได้) — ชุด deploy พร้อมที่ workspace `../line-oa-richmenu/` (png/json/script), รอรูปดีไซน์จากคุณนุ๊ก. docs: `a516c9d`.

### AI Quote Phase 1b-B — LINE customer mode SHIPPED (2026-07-06) 🤖 (PR [#18](https://github.com/witsarutnook/penprinting-dashboard/pull/18) `5f8954e` — flag OFF, รอ rollout)
Execute spec 7/04 ด้วย **subagent-driven development** (12 tasks, implementer + 2-stage review/task): migration `ai_quote_line_modes` + `ai_quote_sessions.line_user_id` · mode state lazy-expiry + 24h hint gate · trigger detectors + canned copy · customer prompt (pin "ส่งต่อทีมงาน") · escalation Flex · M5 owner-check `loadSession({lineUserId})` · routeInbound keywords · handleInbound arms (`CustomerAiDeps` ฉีดทุก side-effect) · route wiring (Sonnet 5 + rate-limit 30/ชม.) · LINE badge /quote-leads. **Review จับจริง**: `session_id` FK type (BIGINT→INTEGER REFERENCES ... SET NULL) · **trigger ④ Flex ไม่มีราคา** (spec §4 "ราคา AI ถ้ามี" — plan เองพลาด, แก้เป็น `escalate` ดึง `loadLastQuote` จาก DB uniform ทุก trigger, `87246bf`) · `ANTHROPIC_API_KEY` gate asymmetry (`0caa049`). Final review (opus): Ready, 0 Critical/Important — minors รับได้ (quick-reply หายบน push fallback · redelivery double-insert quotes = documented). Gates เขียว Node 22 (type-check/lint 0-err/**373 tests** +79/build). **Flag OFF = 1b-A เป๊ะ → merge/deploy ปลอดภัยก่อน migrate/env.** ดู §5 "Phase 1b-B" + §3 route. Lesson: plan-verbatim execution — per-task spec review เทียบ plan (byte-match) ผ่านได้ทั้งที่ plan เอง drift จาก spec → final review ต้องเทียบ **spec ต้นทาง** เสมอ.

### Slip Flex reword + หน่วย "ห่อ" + Phase 1b-B spec (2026-07-04, same day) ✍️
**Tweaks** ([`8ed3997`](https://github.com/witsarutnook/penprinting-dashboard/commit/8ed3997)): slip unreadable Flex message → "ระบบไม่สามารถยืนยันสลิปได้ / รบกวนส่งรูปสลิปใหม่ให้ชัดเจน / หรือรอทีมงานตรวจสอบอีกครั้ง" (3 บรรทัด, [lib/ai-quote/slip-flex.ts](lib/ai-quote/slip-flex.ts); header label เดิม) — คำขอคุณนุ๊กหลังเจอเคสใบเสนอราคาผ่าน Haiku gate → Thunder ยืนยันไม่ได้ (พฤติกรรมถูกต้อง — flow คือ Haiku pre-filter ก่อน Thunder เสมอ, ไม่ได้ส่งตรง) · `QTY_UNITS` order form + **'ห่อ'** ([order-form.tsx](app/board/order-form.tsx)). **Phase 1b-B DESIGNED** ([`39627bb`](https://github.com/witsarutnook/penprinting-dashboard/commit/39627bb)): brainstorm ครบ + spec approved — [docs/superpowers/specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md](docs/superpowers/specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md) (opt-in mode + hint conservative + escalation 4 triggers + Sonnet 5 zero model change + M5 owner-check); execution รอ `LINE_STAFF_GROUP_ID` env.

### Slim order delta payload (PERF-H2/M2) + delta route dynamic/no-store (PERF-M3) (2026-07-04) ⚡ (verified prod, perf backlog = 0)
**PERF-M3** ([`2d8ad7a`](https://github.com/witsarutnook/penprinting-dashboard/commit/2d8ad7a)): [`app/api/board/delta/route.ts`](app/api/board/delta/route.ts) เพิ่ม `export const dynamic='force-dynamic'` (match session-gated route convention — requireSession อ่าน cookies = dynamic โดยปริยายอยู่แล้ว) + `Cache-Control: no-store` บน success response (payload per-cursor/per-session ห้าม browser/CDN/proxy cache; client ยิง `cache:'no-store'` อยู่แล้ว = server pair). zero behavior.
**PERF-H2/M2 — slim order delta** ([`af45644`](https://github.com/witsarutnook/penprinting-dashboard/commit/af45644), **TDD**, 8-ไฟล์ phase): `loadBoardDelta` เลิกส่ง `orders.rawData`/`orders.details` blob เต็มทุกใบทุก payload (baseline prod: bootstrap = **464 orders × ~1KB rawData ≈ 0.5MB spec** ที่ list/board ไม่ render inline). **SQL slim projection** ([lib/board-delta.ts](lib/board-delta.ts)) `(raw - 'rawData' - 'details') || jsonb_build_object('pin', COALESCE(raw#>>'{rawData,pin}', raw#>>'{details,pin}'), 'hasSpec', <non-empty check>)` — เก็บ top-level display fields ครบ + project 2 derived field ที่ list/board ต้องใช้: **`pin`** (โชว์ /orders row modal) + **`hasSpec`** (คุม board card "สเปคงาน" tab visibility). **Key: ทั้ง /board + /orders SSR bootstrap และ client poll ผ่าน `loadBoardDelta` ตัวเดียว → slim จุดเดียว = server+client slim uniform (ไม่มี dual-shape).** Full spec lazy-fetch ผ่าน [`/api/orders/raw/[id]`](app/api/orders/raw/[id]/route.ts) ที่มีอยู่แล้ว. Consumers: [lib/orders-list.ts](lib/orders-list.ts) (pin จาก top-level, `rawData→null`; orders modal มี fetch fallback อยู่แล้ว = ไม่ต้องแก้) · [lib/board.ts](lib/board.ts) (OrderSummary +`hasSpec`, details/rawData→null) · [app/board/card.tsx](app/board/card.tsx) (spec tab lazy-fetch merged rawData → `buildSpecSections` เหมือน orders modal; `hasSpec` จาก flag; memo comparator swap dead `details` ref-check → `hasSpec`) · [app/board/order-form.tsx](app/board/order-form.tsx) (edit จาก board card [slim initial] lazy-fetch spec ก่อน prefill, header apply ทันที; /orders edit page ส่ง full order → skip fetch). **+6 tests** (board-delta SQL shape · computeOrdersList pin+null-rawData · computeBoard hasSpec — `tests/board.test.ts` ใหม่). Gates เขียว Node 22 (type-check/lint 0-err/**294 tests**/build). **Verified prod (Chrome MCP หลัง deploy):** delta shape = pin+hasSpec ไม่มี rawData/details · 464 ครบ 0 missing display field · pins จริง (7752/8831/8358) · **payload 126KB จาก ~600KB (−78%)** · UI smoke 6/6 (/board render+0 err · card spec tab curated · **card edit prefill 9/9+spec เต็ม** · /orders 464 rows · modal PIN 7752 · modal spec lazy-fetch). **Zero behavior change.** Lesson: slim wire-shape phase = 1 loader ที่ server+client share (ไม่มี dual-shape); consumer ที่มี fetch-fallback อยู่แล้วไม่ต้องแตะ, ที่อ่าน inline เพิ่ม lazy-fetch pattern เดียวกัน; verify SQL projection บน prod data จริง (mock test pin แค่ text) — hit `/api/board/delta` เทียบ baseline shape.

### สั่งซ้ำ WP-parity + iPad PWA install + perf M1/L1/H1 (2026-07-03) 🔁📱⚡ (all verified prod)
**"สั่งซ้ำ" fix** ([`c7daeb0`](https://github.com/witsarutnook/penprinting-dashboard/commit/c7daeb0), smoke-verified): duplicate flow (`/orders/new?from=`) เคย blank ชื่องาน+ชื่อลูกค้าตั้งแต่ commit แรก (`089ad08`) — **port-regression จาก WP** (`duplicateOrder()` carry ทั้งคู่, docstring "Mirrors WP" โกหก). ถอด blanking ([order-form.tsx:189](app/board/order-form.tsx:189)) + inject canonical name/customer ใน [page.tsx](app/orders/new/page.tsx) กัน stale rawData; คงเตือน duplicate ไว้ (คุณนุ๊กเลือก). +3 guard tests ([[feedback_port_mirrors_comment_lies]]).
**iPad PWA install** ([`d414e0e`](https://github.com/witsarutnook/penprinting-dashboard/commit/d414e0e), verified — session ค้างข้ามสลับ app): home-screen web app เด้ง `/login` ทุกครั้งที่สลับ app = **missing PWA config** (iOS evict storage container), ไม่ใช่ cookie bug (persistent 30d ถูก). เพิ่ม [`app/manifest.ts`](app/manifest.ts) (display standalone, start `/board`, icons 192/512) + `appleWebApp` ใน [lib/seo.ts](lib/seo.ts) (emit `apple-mobile-web-app-capable`). user re-add icon. ([[feedback_ipad_pwa_standalone_session]]).
**Perf** (audit = hot path verified clean): **M1** ([`e5a0bdb`](https://github.com/witsarutnook/penprinting-dashboard/commit/e5a0bdb)) cache shipped/cancelled orderId sets (`loadOrderIdSetsCached` unstable_cache 15s tag LOAD_ALL_TAG) → coalesce DISTINCT scans ข้าม tab · **L1** memoize `rows.find` active row ([orders-table.tsx](app/orders/orders-table.tsx)) · **H1** ([`8720a9e`](https://github.com/witsarutnook/penprinting-dashboard/commit/8720a9e), verified) `/orders/new` เลิก `loadAll()` → 3 targeted reads (`loadRecentOrdersSlim` projection LIMIT 1000 · `loadOrderFormTemplates` · `loadOrder(orderOnly)` prefill), behavior เดิมเป๊ะ. Deferred: **H2/M2** (slim Order display shape แยกจาก spec — งาน phase) · **M3** (delta route annotate). Gates เขียว Node 22 (288 tests/build).

### AI Quote engine Haiku 4.5 → Sonnet 5 + cleanup (LOG-1 · track/lookup refactor) (2026-07-02) 🤖
**Model swap** ([`2bcb56e`](https://github.com/witsarutnook/penprinting-dashboard/commit/2bcb56e)): quote engine `MODEL` `claude-haiku-4-5` → **`claude-sonnet-5`** ([ai-quote/route.ts](app/api/ai-quote/route.ts)) + `MAX_TOKENS` 2048→4096 ([run.ts](lib/ai-quote/run.ts) — Sonnet 5 เปิด adaptive thinking auto เมื่อ `thinking` unset [Haiku ไม่เปิด] → กัน reply truncate). Haiku over-clarify ซ้ำ (ถามสีปก 3 รอบ, soft-default แพ้) → Sonnet 5 ทำ assume-and-disclose faithfully โดยไม่พึ่ง hard-rule ที่สะสมมา. **Preview smoke 4/4** (Chrome MCP nook/ADMIN): underspecified `โบรชัวร์ 1000` ตีเลย 4.78/ชิ้น · "ขก ราม" cover-color (เคย hard-rule 3 รอบ) ไม่ถามสีปกช็อตแรก + alias อาร์ทการ์ด→Art 210 · เนื้อในขาวดำ ไม่ re-ask ปก · book quote 32.64/เล่ม robust (typo ปอนด→Bond). Prod verified live. **Slip pre-filter vision ([line/route.ts](app/api/ai-quote/line/route.ts) `VISION_MODEL`) ยังเป็น Haiku** — binary gate ก่อน Thunder, model ใหญ่แพงเปล่า. Cost Sonnet 5 = 2× Haiku (intro ถึง 31 ส.ค.)/3× หลังนั้น — staff volume ต่ำ. ([[feedback_ai_quote_model_upgrade_over_hardrule]]). Rollback = แก้ string กลับ Haiku + `thinking:{type:'disabled'}` ถ้าต้องการ.
**Cleanup (same day):** LOG-1 ถอด slip diagnostic logs 5 จุด ([`24f2e68`](https://github.com/witsarutnook/penprinting-dashboard/commit/24f2e68), เก็บ error log) · Issue #1 refactor `track/lookup` → shared `deriveTrackStatus` via pure [`lib/track-result.ts`](lib/track-result.ts) `buildTrackResult` + **7 characterization tests** ([`55691c8`](https://github.com/witsarutnook/penprinting-dashboard/commit/55691c8), zero behaviour change — empty-dept quirk `status='in_progress'` preserved เพราะกระทบสี badge). Gates เขียว Node 22 (**285 tests**/build).

### Track by Customer — LINE กลุ่มลูกค้า + web tokenized link (2026-07-01) 🔎 (merged `5d9971e`, SHIPPED live)
ลูกค้าเช็คงาน active ทั้งหมดของตัวเอง: **LINE** `/track` ในกลุ่มที่ผูกลูกค้า (Hybrid group-bound + keyword filter, adaptive 1→การ์ดเต็ม/หลาย→bubble สรุป) · **web** `/track/c/[token]` (public, token 144-bit) · **admin** `/registrations` (ผูก group id + ชื่อลูกค้า[] → gen token). ตาราง `customer_registrations` + shared `deriveTrackStatus` (track-flex refactor ใช้ร่วม) + `loadActiveJobsByCustomer`. subagent-driven + final opus review = yes-with-minor (array-param verified ปลอดภัย · audit_log fixed · track/lookup refactor deferred โดยตั้งใจ). 278 tests (+51). **Live-verified prod:** db-migrate applied (table+2 index) · registration #1 `รัฐกุล` (audit ทำงาน) · web `/track/c/<token>` = 6 งาน active จริง (**array-bind พิสูจน์บน prod**, daysHint/sort/TZ ถูก) · LINE smoke OK · nav link `/registrations` admin (`0a052a0`).

### AI Quote LINE Phase 1b-A — webhook cutover + slip-verify iterate + slip_checks migration (2026-06-30) 📲

> **Cutover เสร็จ + เก็บ doc gap.** session ก่อนหน้าทำ cutover + iterate ไปแล้วแต่ไม่ลง doc (NEXT-SESSION ค้างที่ "PR #11 รอ cutover"). main = [`a23496d`](https://github.com/witsarutnook/penprinting-dashboard/commit/a23496d).

**Cutover (Path 1):** PR [#11](https://github.com/witsarutnook/penprinting-dashboard/pull/11) ([`c1fcbad`](https://github.com/witsarutnook/penprinting-dashboard/commit/c1fcbad)) merged + redeploy ([`209f53f`](https://github.com/witsarutnook/penprinting-dashboard/commit/209f53f)) → webhook `dashboard.penprinting.co/api/ai-quote/line` LIVE (probe 200). คุณนุ๊กตั้ง Thunder/LINE env + webhook URL ครบ (pending actions ใน RUNBOOK ปิดหมด). **PR [#12](https://github.com/witsarutnook/penprinting-dashboard/pull/12)** ([`627bfce`](https://github.com/witsarutnook/penprinting-dashboard/commit/627bfce)) slip-verify → Penprinting Flex card 4 สถานะ · **PR [#13](https://github.com/witsarutnook/penprinting-dashboard/pull/13)** ([`d68743d`](https://github.com/witsarutnook/penprinting-dashboard/commit/d68743d)) อ่าน Thunder v2 slip fields จริง (date, bank.name).

**Slip pre-filter ดราม่า (debug บน prod ตรง main):** `7d32666` diagnostic logging → `d81c6e6` loosen → **`e4a05b3` remove Haiku pre-filter** (สลิปจ่ายบิล KBank โดน drop, Thunder=sole authority) → **`0139d31` re-add** (แก้ prompt นับ bill-payment/QR/PromptPay เป็นสลิป, lean-yes) → **`2669ee8` slip-check metrics** (`slip_checks` table + `GET /api/admin/slip-metrics`). Final = pre-filter เปิด + recognize bill-payment + metrics วัด quota.

**Session นี้:** sync main + **รัน `slip_checks` migration** (db-migrate ผ่าน Chrome MCP เบราว์เซอร์คุณนุ๊ก — table ยังไม่ถูกสร้าง: slip-metrics **500→200**, applied "CREATE TABLE slip_checks"+idx, data เดิมครบ jobs 657/orders 421) + เขียน doc ปิด gap (NEXT-SESSION + §3/§5/§9/§10 + AUDIT-BACKLOG + RUNBOOK done). **เหลือ:** ถอด diagnostic logging 5 จุด (`LOG-1`) · ดู slip-metrics หลัง traffic 2-3 วัน · Phase 1b-B. **Lesson:** cheap classifier gate หน้า paid API → tune prompt ก่อนถอด gate ([[feedback_ai_quote_phase1b_thunder_prefilter]]).

### AI Quote — M5 IDOR resolved + 3 Low closed + housekeeping (2026-06-26) 🔒

> ปิด AI Quote audit backlog ให้เหลือ 0 open. ไม่มี PR แยก — commit ตรง main (internal hardening + doc, ไม่กระทบ user flow). Gates เขียว Node 22 (type-check/lint/**193 tests**/build 40).

**M5-loadsession-idor** — finding เองแนะนำ defer ไป 1b; **decision คุณนุ๊ก: fold เข้า Phase 1b spec + prep channel guard now**. Phase 1a shared team inbox (admin/sales ภายใน) → `loadSession` ไม่ผูก owner = **design ที่ตั้งใจ ไม่ใช่ช่องโหว่**; owner-binding ตอนนี้ = regression + ยังไม่มี identity model. IDOR จริงเกิดตอน LINE (1b) ที่ลูกค้าถือ sessionId เอง — fix นั้น (ผูก `line_user_id`) เป็นส่วนหนึ่งของ 1b เอง. **ทำ 2 อย่าง:** (1) เขียน M5 เป็น **acceptance criterion ของ Phase 1b** ใน [design-ai-quoting.md §7](design-ai-quoting.md) (set `line_user_id` + เช็ค sender ก่อนคืนบทสนทนา → mismatch 404) (2) **zero-regression channel guard:** staff chat route เรียก `loadSession(id, { channel: 'dashboard' })` → staff `sessionId` ↔ LINE `sessionId` cross-load กันไม่ได้ตั้งแต่ก่อน 1b ([db.ts](lib/ai-quote/db.ts) loadSession + [route](app/api/ai-quote/route.ts)). session ปัจจุบันทั้งหมด `channel='dashboard'` → ไม่กระทบ behavior.

**3 Low ปิดหมด:** (1) **quote id=array index** — `saveQuote` คืน `ai_quotes.id` (`RETURNING id`) → route ใช้ `savedQuoteIds[i] ?? i` (real DB id ตอน persist; transient index ตอน unsaved plain chat). client ใช้ map-index เป็น key อยู่แล้ว ไม่เคยอ่าน `q.id` → zero behaviour change แต่ field truthful (2) **run.ts comment** `caller maps to 500`→**502** (route map compute throw เป็น 502 จริง) (3) **db-migrate row-count** เพิ่ม `ai_quote_sessions`+`ai_quotes` ใน counts array.

**Housekeeping:** ปิด stale **PR [#3](https://github.com/witsarutnook/penprinting-dashboard/pull/3)** (FAB widget — ของจริง ship ผ่าน PR #4 `66d0286` แล้ว, branch `feat/ai-quote-fab` ไม่เคย merge). **Lesson**: security finding ที่ "ปิดเดี่ยวๆ ไม่ได้สะอาด" → แยกเป็น **non-regressive prep ทำได้ทันที** (channel scope) + **acceptance criterion fold เข้า phase ที่มี identity model** (owner-check) แทนที่จะ force owner-binding ที่ regress shared inbox.

### AI Quote prompt-tuning — book cover defaults (4 สี + Art 230) + hard-rule (2026-06-25) 🤖

> **PR [#9](https://github.com/witsarutnook/penprinting-dashboard/pull/9) squash → [`0b93f8e`](https://github.com/witsarutnook/penprinting-dashboard/commit/0b93f8e)** (prompt-only). Spec: `docs/superpowers/specs/2026-06-25-ai-quote-book-cover-color-design.md`.

คุณนุ๊กเจอเคสจริง: AI ถามซ้ำ "สีปก 4 สีใช่ไหม?" 2 รอบ ทั้งที่ลูกค้าพิมพ์ "พิมพ์ 4 สีทั้งเล่ม". แก้ `lib/ai-quote/prompt.ts` (prompt-only, 3 commit): **(1)** default ปก = **4 สี + กระดาษ Art 230** → ปกออกจาก always-ask + เกณฑ์ "ครบพอตีราคา" (เนื้อในยังถาม — เป็นตัวขยับราคาแรง, เก็บ decision 6/24) **(2)** กฎ **"X สีทั้งเล่ม"** → set ทั้ง `cover.color` + `inner.color` = X ไม่ถามซ้ำ **(3)** **hard-rule "⛔ ห้ามถามสีปกเด็ดขาด"** — live smoke พบ soft default แพ้ Haiku ตอนเนื้อในระบุสีต่าง ("เนื้อในขาวดำ" → Haiku ถามปก) → hard-rule ห้ามใช้ "เนื้อในต่าง" เป็นเหตุถามปก + worked example เคส B&W. **Live smoke PASS preview** (nook/ADMIN, 2 เคส): "4 สีทั้งเล่ม 500" → **47.27 บาท/เล่ม** · "เนื้อในขาวดำ 1000" → **20.49 บาท/เล่ม** — ทั้งคู่ตีราคาเลย ปก default 4สี/Art230 แจ้งในสมมติฐาน **ไม่ถามปก**. TDD +11 assertion (179→**190 tests** บน main). Gates เขียว Node 22 (type-check/lint/190/build 40). Lesson (ซ้ำ 6/24): soft prompt ไม่พอกับ Haiku ที่ระวัง — ต้อง hard-rule + few-shot เคส fail; live smoke จับ regression ที่ unit test จับไม่ได้ → [[feedback_llm_assume_and_disclose_clarify]].

> **+ ต่อ same session — แปลงชื่อกระดาษ "อาร์ทการ์ด" ([PR #10](https://github.com/witsarutnook/penprinting-dashboard/pull/10) squash → [`a82ad4f`](https://github.com/witsarutnook/penprinting-dashboard/commit/a82ad4f), 2 commit `10f294f`+`e53aa98`):** คุณนุ๊กชี้ว่า "อาร์ทการ์ด 210/230 = Art 210/230 ใน calc". เพิ่ม section แปลงชื่อกระดาษภาษาพูด (ทำก่อนเทียบ list): **อาร์ทการ์ด 210/230 → Art 210/230** (ไม่มี Art Card น้ำหนักนี้) · **300/350 → Art Card 300/350** (stock แยก ราคาต่าง) · อื่น → escalate · **ปอนด์ {w} → Bond {w}**. **+ hard-rule:** ลูกค้าระบุกระดาษที่อยู่ใน list = ใช้เลย ไม่ใช่ "กระดาษพิเศษ" แม้ต่างจาก default (smoke เคส "ขก ราม" รอบแรก Haiku งงว่า Art 210 = พิเศษ เพราะ ≠ default Art 230 → hard-rule แก้). **smoke PASS:** "ปกอาร์ทการ์ด 210 ... 4 สีทั้งเล่ม 500" → **47.09 บาท/เล่ม** ปก Art 210 ตีราคาเลย. +5 assertion (190→**193**). "กระดาษพิเศษ" = ไม่อยู่ใน list เท่านั้น ไม่ใช่ "ไม่ตรง default".

### AI Quote — Floating FAB widget + audit M3/M4 (2026-06-24) 🤖

> **PR [#4](https://github.com/witsarutnook/penprinting-dashboard/pull/4) squash → [`66d0286`](https://github.com/witsarutnook/penprinting-dashboard/commit/66d0286)** (หลัง Phase 1a merge `91d8dc8`).

> **+ ตามด้วย (same session, branch เดียวกัน):** delete leads (admin) · **no-auto-save** + เก็บบทสนทนาตอนกด save · conversation viewer ขยายอ่านได้ใน /quote-leads — จาก user feedback ระหว่าง preview (lead auto-save เยอะ + ข้อความล่าสุดอ่านไม่หมด). chat → stateless, persist เฉพาะตอน escalate/explicit save (`shouldPersistTurn`/`sanitizeHistory` + `POST /api/ai-quote/leads`). +9 test (170→**179**). [PR #5 `a028ce0`]
>
> **+ ผู้ดูแล auto-assign ([PR #7](https://github.com/witsarutnook/penprinting-dashboard/pull/7) `a77861a`):** "หยิบงาน" ดูแปลก (claim งานตัวเอง) → **กด save → auto-assign คนกด save** เป็นเจ้าของ (server-side `session.user` ใน `createLead`). escalate (ไม่มีคนคุย) ยังว่าง → "หยิบงาน" (race-safe 409). + **"คืนงาน"** (`releaseLead`: admin คืนใครก็ได้ · staff คืนของตัวเอง, `PATCH {release:true}`).

ต่อจาก Phase 1a merge. คุณนุ๊กรายงาน "AI quote widget ไม่ขึ้น" บน iPad → **diagnose: FAB ไม่เคยถูก build** (ค้างขั้น brainstorm) ไม่ใช่บั๊ก PWA. **(1) Build FAB widget** `components/ai-quote-widget.tsx` 🆕 — ปุ่มลอยมุมขวาล่างเปิด AI Quote เป็น popup panel ได้ทุกหน้า, reuse `QuoteAssistantClient` โหมด `compact` (prop ใหม่ — conversation 52vh→44vh + ตัด intro), mount ใน `DashboardShell` gate `role === 'admin'`, ซ่อนบน `/quote-assistant`, z-40, Esc ปิด. **Preview-verified iPad** (ใบปลิว 5000 → 1.58 บาท/ชิ้น offset + assume-and-disclose). **(2) Audit M3/M4** (gate Phase 1b): **M3** wire escalation — pure `detectEscalation(quoteCount, reply)` ใน run.ts → `out.escalated` → route `markEscalated` (เลิก dead code) + `/quote-leads` STATUS_LABEL 'escalated'→"ต้องประเมินเอง" + badge ส้ม · **M4** `claimLead` conditional UPDATE + 409 race-safe หยิบงาน. **M5 (loadSession IDOR) คงเปิด — ตั้งใจ** (shared inbox 1a; ปิดพร้อม Phase 1b LINE identity). +5 test (170→**175**). Gates เขียว Node 22. **Lesson**: "ไม่ขึ้น" = "ยังไม่สร้าง" ไม่ใช่ "พัง" — grep หา component จริงก่อน diagnose env/PWA.

### AI Quote prompt-tuning — assume-and-disclose defaults (2026-06-24) 🤖

> **Branch `feat/ai-quote-phase1a` (เข้า PR #2 เดียวกับ Phase 1a)** — pushed [`237b66d`](https://github.com/witsarutnook/penprinting-dashboard/commit/237b66d). Spec: `docs/superpowers/specs/2026-06-24-ai-quote-clarify-defaults-design.md`.

คุณนุ๊กสังเกตจาก preview smoke 6/23 ว่า Haiku **clarify เยอะไป** — ถามซ้ำ field ที่มี shop-standard. แก้ด้วย **assume-and-disclose**: เติมค่ามาตรฐาน (โบรชัวร์ A4/4สี/2หน้า/Art120 · book+notebook A5+innerB=0) ให้ field ที่ลูกค้าไม่ระบุ → เรียก `compute_quote` ตีราคาเลย + แจ้งบรรทัดสมมติฐานให้แก้ได้. ถามเฉพาะที่เดาไม่ได้ (qty ทุกงาน + book/notebook batch จำนวนหน้า/กระดาษ/สี, ไม่ drip). กระดาษ named-but-unknown ยัง escalate. **prompt-only** (`lib/ai-quote/prompt.ts`) — run.ts/tools/schema/calc ไม่แตะ. **2 commit**: [`237b66d`](https://github.com/witsarutnook/penprinting-dashboard/commit/237b66d) tuning + [`7a203d9`](https://github.com/witsarutnook/penprinting-dashboard/commit/7a203d9) **hardening** (preview smoke รอบแรกพบ assume-and-disclose ❌ Haiku ยังถาม — soft "ห้ามถาม" สู้ caution ไม่ได้ → เพิ่ม hard-rule "ครบพอตีราคา" + worked ✅/❌ example เคส "ใบปลิว 1000 ใบ"). TDD +9 assertion รวม (161→**170 tests**). Gates เขียว Node 22. **Re-smoke PASS preview** `gfitp6wvy`: ตีราคา **4.77625 บาท/ชิ้น** (Art 120 offset จาก compute_quote) + 📋 สมมติฐาน + การ์ดราคา. Lesson: soft prompt ไม่พอกับ Haiku — ต้อง hard-rule + few-shot ที่โชว์เคส fail → [[feedback_llm_assume_and_disclose_clarify]].

### AI Quote Assistant Phase 1a — built + preview-verified + audited (2026-06-23) 🤖

> **Branch `feat/ai-quote-phase1a` — ยังไม่ merge main.** Pending = merge PR (Vercel auto prod-deploy) + 1 happy-path prod smoke + เคลียร์ test lead. Design/decisions: [`design-ai-quoting.md`](design-ai-quoting.md) §13 · audit: [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) (top entry).

**Goal:** in-dashboard AI Quote Assistant ให้ทีม sales/admin ตีราคางานพิมพ์ (brochure/book/notebook) ผ่าน chat โดยราคามาจาก calc `/api/quote` ตัวเดียวกับ calculator UI (single source of truth, decision D2). internal tool — ยังไม่เปิด LINE (1b).

**Tasks 1-10 build (2026-06-22, 10 commits `1424bfa`→`5d2de19`):** Postgres CRUD (`ai_quote_sessions` lead store + `ai_quotes`) · prompt (`lib/ai-quote/prompt.ts` — 5 product schema + รายการกระดาษ + กฎ "ห้ามเดาราคา/escalate กล่องถุง") · tools (`compute_quote` → fetch calc) · run loop (`lib/ai-quote/run.ts` — manual tool-use loop `MAX_TOOL_ROUNDS=6`, Haiku 4.5 + prompt caching) · API routes (`/api/ai-quote` + leads + leads/[id]) · 2 หน้า UI (`/quote-assistant` chat + `/quote-leads` table) + nav 2 เมนู (`adminOrSalesOnly`). **TDD** — +11 tests (148→159).

**Reconcile (2026-06-23):** session 6/22 commit ผ่าน `--no-verify` ทิ้ง lint แดง + ไม่ push/doc. fix lint [`d773ea9`](https://github.com/witsarutnook/penprinting-dashboard/commit/d773ea9) (3× `no-explicit-any` ใน test → `unknown`-routed casts) → push branch. NEXT-SESSION reconcile [`8c23fe8`](https://github.com/witsarutnook/penprinting-dashboard/commit/8c23fe8). Lesson: [[feedback_session_discipline]] — context check จับ git ≠ doc mismatch.

**Deploy + preview verify (2026-06-23):** ตั้ง env ครบ Vercel `penprinting-dashboard` (ANTHROPIC_API_KEY + QUOTE_API_URL + QUOTE_API_TOKEN, All Environments) + empty commit [`80d5c2a`](https://github.com/witsarutnook/penprinting-dashboard/commit/80d5c2a) trigger preview. **Preview smoke ผ่านครบ:** db-migrate (ai_quote_sessions + ai_quotes + idx, idempotent) · quote brochure A4/4สี2หน้า/Art160/1000 → **5.048225 บาท/ชิ้น ตรง calc เป๊ะ** + offset mode + VAT card · escalation (กล่อง → ไม่ตีราคา, escalate ทีมขาย D8) · lead flow (บันทึก→/quote-leads→เปลี่ยน status ปิดการขาย + หยิบงาน nook → reload persist) · auth admin (nook) เข้า 2 เมนู.

**Calc-side fix (lesson):** smoke เจอ calc คืน 500 "QUOTE_API_TOKEN not configured" — env ตั้งใน calc ตั้งแต่ 6/20 แต่ production deploy ล่าสุด = `3edcfe1` (6/17, ก่อนมี token) → runtime อ่านไม่เจอ. push empty commit `fd4f755` → calc repo `penprinting-calc` main → auto-deploy production สด → token live (curl probe 500→401). **env var live ต่อเมื่อ deploy ใหม่หลังตั้ง** (ดู §9 row + [[feedback_omise_secret_roll_vm_sync]]).

**Audit (penprinting-auditor) → fix 4 ตัวก่อน merge [`902d70a`](https://github.com/witsarutnook/penprinting-dashboard/commit/902d70a), +2 regression test (159→161):**
- **H1 (High, session-brick)**: `runQuoteTurn` อาจ persist assistant turn `text=''` (ชน MAX_TOOL_ROUNDS ขณะ tool_use / tool-use-only / max_tokens stop) → Anthropic reject empty content block → ทุกข้อความถัดไปใน session 400 พังถาวร → fallback non-empty reply + 2 test.
- **H2**: middleware matcher เพิ่ม `/quote-assistant` + `/quote-leads` (API self-guard ด้วย requireSession — ไม่ใส่ /api/* ตาม convention).
- **M1**: เลิก echo calc error body ไป client → generic message + `console.error` ฝั่ง server.
- **M2**: guard `message` เป็น non-empty string (non-string เคย throw 500) + cap 4000 chars.
- **Deferred → AUDIT-BACKLOG open (Phase 1a internal-only, ปิดก่อนเปิด LINE)**: M3 (`markEscalated()` dead code + escalation lead ไม่ auto-escalate) · M4 (lead-claim race last-write-wins) · M5 (`loadSession` IDOR — ไม่ผูก owner) · Low (quote id=array index, comment typo, db-migrate row-count).

**Gates ทุก commit เขียว Node 22:** type-check / lint "No issues found" / **161 tests** / build 40 หน้า. Lessons → §9 (empty-text turn bricks session · calc env unverified).

### Next 14→15 + React 18→19 migration + board hydration fix (2026-06-20) 🏁

**Goal:** ปิด migration ตัวสุดท้ายของ 4 Vercel repo (calc/web/photobook จบแล้ว). ไม่มี architectural change — async-request-API + deps bump ตาม plan `migration-plan-next15.md` (audit 6/18, ~27 จุด, no re-audit; plan **ลบแล้ว 2026-06-27** หลัง soak ปิด — งานจบ, history อยู่ใน git).

**PR [#1](https://github.com/witsarutnook/penprinting-dashboard/pull/1) → `2c22301` (squash), 2 commits:**

1. [`1d9cb6e`](https://github.com/witsarutnook/penprinting-dashboard/commit/1d9cb6e) **migration** — deps (next 15.5.19 · react/react-dom 19.2.7 · @types 19 · eslint-config-next 15) · async `cookies()` (await ใน route-helpers/api currentActor + 12 pages) · async `params` Promise<> (3 dynamic pages + raw/[id]) · async `searchParams` Promise<> (6 pages) · React 19 global `JSX` namespace → `import { type JSX }` (history-tab) · eslint-config-next 15 จับ app-router `<a href>` → เก็บ 5 ลิงก์ full-reload ที่ตั้งใจ (3 filter-reset + 2 error-boundary) ด้วย documented eslint-disable · tsconfig auto-add `target: ES2017`. Codemod ทำ cat 1-3, hand-fix lib/api dynamic-import cookies() + print page (revert codemod's 323-line JSX churn → hand-edit 3 บรรทัด)
2. [`45d6c77`](https://github.com/witsarutnook/penprinting-dashboard/commit/45d6c77) **board #418 fix** — React 19 throw hydration text mismatch บน /board (React 18 กลืนเงียบ). **ยืนยัน real ผ่าน incognito** (ไม่ใช่ extension) + harness พิสูจน์ค่า**ถูกต้อง** (date math offset cancel เป๊ะ; mismatch = data-derived text จาก live `useDeltaSync` snapshot). **Root-class fix**: `BoardClient` gate data-derived tree ด้วย post-mount flag → SSR + first client render = `<BoardSkeleton/>` เดียวกัน (byte-clean hydration), board จริง paint หลัง mount. extract `BoardSkeleton` → `app/board/board-skeleton.tsx` (share กับ page.tsx Suspense fallback). + `.eslintrc` ignore `next-env.d.ts` (Next 15.5 routes.d.ts triple-slash ref).

**Verify:** gates เขียว Node 22 (type-check/lint/148 tests/build 38 หน้า). **Preview smoke 8/8** (login edge HMAC · board · orders · analytics+recharts · calendar `?m=` · print async params · track edge route · create-order cache-bust ผ่าน order จริง #202606110) · **#418 fix verified ทั้ง preview + production** (skeleton→board, console 0 error). **✅ Soak ปิด 2026-06-27** (1 สัปดาห์): routes health-check เขียวหมด (`/login` 200 · `/board`/`/` 307→login · `/track` 200 · RSC payload ปกติ) + คุณนุ๊ก verify /board ด้วยตา (skeleton→board, console 0 error) + Sentry project dashboard ไม่มี error spike → migration **stable**, plan doc ลบ. **Next 15 + React 19 = 4/4 repos จบ 🏁**. **Lessons** → [[feedback_react19_hydration_realtime_board]] (real-time delta-sync view อย่า SSR volatile content บน React 19) + [[feedback_port_sibling_repo_framework_drift]] (codemod JSX churn → revert+hand-edit หน้าใหญ่).

### Spec "อื่นๆ" — กราฟฟิก row + staff-name resolution (2026-06-17)

**Goal:** user ขอเพิ่มแถว "กราฟฟิก" ในส่วน "อื่นๆ" ของ tab สเปคงาน (modal ใบสั่งงาน)

[`0133d2d`](https://github.com/witsarutnook/penprinting-dashboard/commit/0133d2d) — แก้ `lib/spec-format.ts` จุดเดียว (มีผลทั้ง modal /board `DetailsTable` + /orders `SpecSection` ที่ share renderer): (1) เพิ่ม `assignStaff` → label "กราฟฟิก" ใน "อื่นๆ" section (เดิมอยู่ใน `SPEC_HIDDEN_KEYS`) (2) resolve staff ID → ชื่อ สำหรับทั้ง `assignStaff` (graphic) + `forwardPrint` (print) ผ่าน `STAFF` — `pook`→ปุ๊ก, `sm74`→"SM74 (ต้อม)" (เดิม forwardPrint โชว์ ID ดิบ) (3) ใบที่ส่งตรงพิมพ์ (ไม่มีกราฟฟิก) → แถวซ่อนอัตโนมัติ · unknown id → fallback raw id. +5 regression tests (143→148). **Visual verified บน dev** (throwaway preview route + Chrome MCP screenshot, ลบก่อน commit). Lesson: ก่อน DROP/แก้ field ที่ "ซ่อน" ต้องเช็คว่า data อยู่ใน `details` จริง — ยืนยันผ่าน write path (`add/route.ts` formSnapshot = `{...body}` มี assignStaff+forwardPrint) ก่อนแก้ กัน no-op.

### Duplicate-order warning — only still-open orders + clearer copy (2026-06-11)

**Goal:** ปิด user report "คนใช้ งง" dialog พบใบสั่งงานคล้ายกัน — staff โดนเตือนตอนสั่ง repeat order ให้ลูกค้าเดิมทั้งที่ใบเก่าส่งไปแล้ว + ปุ่ม "ยกเลิก"/"สร้างต่อ" อ่านกำกวม

**2 commits:**

1. [`8b132f8`](https://github.com/witsarutnook/penprinting-dashboard/commit/8b132f8) — `findDuplicateOrdersInPostgres` match เฉพาะใบที่ยังเปิดจริง: active job (`jobs` row ที่ `phase2_deleted_at IS NULL`) หรือ draft รอ promote — เช็คผ่าน jobs table เพราะ `orders.status` ไม่ได้อัพเดตเป็น 'shipped' เสมอ (state นั้น derive จากตาราง shipped ดู `orders-list.ts:68`). Copy ใหม่ใน `DuplicateView`: header "งานนี้อาจมีใบสั่งงานอยู่แล้ว" + body ระบุ "ใบเดิมจะไม่ถูกแก้ไข" + ปุ่ม "กลับไปแก้ฟอร์ม" / "ยืนยัน สร้างใบใหม่"
2. [`e0b1ae4`](https://github.com/witsarutnook/penprinting-dashboard/commit/e0b1ae4) — audit follow-up (penprinting-auditor): **H1** force-confirm เดิมเรียก `submit(true)` mode default → ผู้ใช้ "พิมพ์+สั่ง" ได้ใบสั่งแต่หน้าพิมพ์ไม่เปิด + กดพิมพ์ซ้ำชน 409 กับใบตัวเอง → เก็บ `mode` ใน `DuplicateInfo` + `openPrintPlaceholder()` helper เปิด popup ใน confirm click handler (popup-blocker safe). **M1** pure orphan (partial createOrder failure — order มีแต่ job INSERT ล้ม) หลุดจากเตือน → retry mint ใบซ้ำเงียบ → เพิ่ม NOT EXISTS (jobs+shipped+cancelled) branch. + L1 LOWER(status) / L3 stale comment / L4 overflow-y-auto. เหลือ L2/L5/L6 ใน AUDIT-BACKLOG

Tests 146→147 · เงื่อนไข dedupe ใหม่: เตือนกลับมาเมื่อ restore job จาก cancelled (intended) · ใบ multi-job ที่บาง job ส่งแล้วยังเตือน (ใบยังเปิด)

### Wholesale-strangler finish + B consolidate — useAutoSync retired (2026-06-03)

**Goal:** ปิด NEXT-SESSION งานหลัก #1 + #2 — ลบ `NEXT_PUBLIC_DELTA_FETCH` flag-OFF paths (delta path live in prod >1 wk) AND consolidate auto-sync ให้เหลือ `useDeltaSync` ทางเดียว (โดยขยาย delta endpoint รองรับ `/cancelled` + `/shipped` แทน `useAutoSync`'s `router.refresh()`).

**3 commits (-561 LOC net):**

1. [`db8091d`](https://github.com/witsarutnook/penprinting-dashboard/commit/db8091d) — `refactor: drop NEXT_PUBLIC_DELTA_FETCH flag-OFF paths` (-445 LOC). ลบ flag branches + dead `BoardData`/`OrdersData`/`CalendarData` server functions จาก [`app/board/page.tsx`](app/board/page.tsx) + [`app/orders/page.tsx`](app/orders/page.tsx) + [`app/calendar/page.tsx`](app/calendar/page.tsx). 4 client files (board-client/calendar-client/orders-list-client/pending-mutations) drop docstring refs ถึง flag. `PendingMutationsProvider` รับ `pollNow` แบบ required ตอนนี้ (ลบ legacy `router.refresh()` fallback + `useRouter`/`useTransition`/`queuedCleanups`/`wasPending` machinery — all dead).
2. [`0edd926`](https://github.com/witsarutnook/penprinting-dashboard/commit/0edd926) — `feat(delta): include full shipped/cancelled rows in fullLists mode` (+339/-44 LOC). Extend [`lib/board-delta.ts`](lib/board-delta.ts) + [`/api/board/delta`](app/api/board/delta/route.ts): + `{ fullLists: true }` opt → returns `shipped`+`cancelled` full rows + `shippedAllIds`/`cancelledAllIds` (current PK ID set for delete detection). Cursor: `imported_at` (those tables have no `updated_at` — append-on-write + hard-delete-on-restore). Extend [`useDeltaSync`](lib/delta-sync.tsx) + `mergeDelta` + new `applyFullList` helper (fast-path same-ref shortcut on no-change). **+11 tests** (137 total).
3. [`fe2bec5`](https://github.com/witsarutnook/penprinting-dashboard/commit/fe2bec5) — `refactor(auto-sync): delete useAutoSync, /cancelled+/shipped now delta-driven` (+609/-725 LOC). New [`app/cancelled/list-client.tsx`](app/cancelled/list-client.tsx) + [`app/shipped/list-client.tsx`](app/shipped/list-client.tsx) — client-side filter/paginate/CSV/restore. Pages เป็น bootstrap shell. Old `client.tsx` ใน 2 folder ถูกลบ. `<AutoSync />` ออกจาก /analytics (60s ISR พอ). [`lib/auto-sync.tsx`](lib/auto-sync.tsx) slim down เหลือแค่ `broadcastWrite` (10 mutation sites ยังใช้). `useAutoSync` + `AutoSync` + `useRouter`/timer machinery — ทั้งหมดหายไป.

**Bytes Impact (`next build`):**
| Page | Before | After |
|---|---|---|
| /shipped | 3.42 kB | 2.94 kB |
| /cancelled | 2.75 kB | similar |
| /orders | 8.41 kB | 7.38 kB (filter logic merged into client) |
| /board | 16.1 kB | unchanged (already delta-driven) |

**Delta endpoint shape (new `fullLists` mode):**
- Bootstrap (`since=null`): SELECT raw FROM shipped/cancelled ORDER BY id DESC (full table read, one-time per page mount).
- Incremental: WHERE imported_at > since (new rows) + SELECT id (current PK set so client drops /restore'd rows). No tombstone column needed.
- /orders stays on cheap `{ lists: true }` (orderId set only). /shipped + /cancelled use `{ fullLists: true }`.

**Why imported_at (not updated_at):** shipped + cancelled rows are immutable once written — only INSERT (move-to-shipped, cancel) or DELETE (restore). `imported_at` set by `DEFAULT NOW()` on INSERT serves as created_at; deletes caught via the PK ID set comparison, not the cursor.

**Pending user action:** ลบ Vercel env vars `NEXT_PUBLIC_DELTA_FETCH` + `NEXT_PUBLIC_DELTA_FETCH_LIST` (no longer read by any code; cleanup-only, no functional impact).

**Gates Node 22:** type-check ✅ · lint ✅ · vitest **137/137** · build ✅

---

### Hot-fix: drop `sync_meta` freshness gate from `lib/api-postgres.ts` (2026-05-28)

**Bug:** /analytics threw `Postgres mirror stale: jobs last synced 1491 min ago` ~24 hours after the §12 Step 1-5 deploy ([`745d36f`](https://github.com/witsarutnook/penprinting-dashboard/commit/745d36f)). §12 retired the `sync-from-sheet` cron (the only writer of `sync_meta.last_sync_at`), but `lib/api-postgres.ts` still ran `checkStaleness()` in `loadAllFromPostgres` + `getAuditByTargetFromPostgres` and threw `PostgresStaleError` once the 30-min threshold tripped. Same anti-pattern the [2026-05-12 `loadOrderFromPostgres` refactor](#single-order-load-refactor-2026-05-12) had removed — just left in the other two functions.

**Why gates passed but production broke:** pre-merge gates (vitest/lint/build/manual smoke) all ran while `last_sync_at` was still recent — the check passed. Deploy shipped. ~24 hours later the threshold crossed and production broke for the first time. Time-threshold checks escape test coverage because they're testing a wall-clock condition no fixture controls.

**Fix:** deleted `checkStaleness()` + `STALENESS_LIMIT_MS` + 2 pre-gate call sites from [`lib/api-postgres.ts`](lib/api-postgres.ts). Renamed `PostgresStaleError` → `PostgresReadError` (the class now only fires for "env not configured" / "row not found", neither of which is staleness) + message prefix `Postgres read failed:`. Updated `/track` route comment to match.

**Regression tests (+6, total 126):** new "no sync_meta query" invariant tests for `loadAllFromPostgres` + `getAuditByTargetFromPostgres`; reworded the existing `loadOrderFromPostgres` test to cite both the 2026-05-18 and 2026-05-28 regressions.

**Lesson** (new memory [[feedback_retire_cron_grep_readers]]): when retiring a sync cron, grep readers of every column it wrote BEFORE merging. Time-threshold checks bomb hours after deploy when the staleness window trips — they always pass at deploy time. Prefer presence-checks (`row exists?`) over freshness-checks (`NOW() - x > T?`) against your own authoritative store.

**Gates Node 22:** type-check ✅ · lint ✅ · vitest **126/126** · build ✅

**Commit:** [`5b61973`](https://github.com/witsarutnook/penprinting-dashboard/commit/5b61973)

---

### §12 Step 6 — Apps Script cleanup + `<AutoSync />` consolidate (2026-05-28)

**Goal:** ปิด §12 ([migration-plan-apps-script-shrink.md](migration-plan-apps-script-shrink.md) Step 6) — ลบ dead handlers + dead modules ใน Apps Script project หลัง §12 Step 1-5 ตัด dashboard→AS path. + Step B ปลีกย่อย: ลบ `<AutoSync />` JSX จาก 3 หน้าที่ delta-fetch live แล้ว (redundant).

**Apps Script surface (production-monitoring/apps-script/dashboard/):**
- **`api.ts` (8.6K → 4.2K, -50%)** — เหลือ doPost ที่ dispatch แค่ `searchArchive`; ลบ 25 handlers (17 write + 6 heal Phase 2 `setJobRow`/`setOrderRow`/`setShippedRow`/`setCancelledRow`/`deleteJobByIdRow`/`setTemplateRow` + 3 read `loadAll`/`getOrder`/`getAuditByTarget` + `saveAll` + `runQuotaCheck` + `runBackup` + `getQuotaStats`). doGet stub: return `Action retired (§12 Postgres-only): <action>`. ลบ `bumpUsage_()` calls (quota.ts ถูกลบ). inline `jsonResponse` helper
- **`auth.ts` ROLE_REQUIREMENTS trim** — `{ searchArchive: ['admin'] }` เท่านั้น (ลบ 9 admin + 6 sales actions)
- **7 modules ถูกลบทั้งไฟล์** —
  - `write.ts/.js` (~30K) — 17 write handlers (addJob/updateJob/.../bulkForward) + heal helpers
  - `quota.ts/.js` (~10K) — dailyQuotaCheck/sendQuotaReport_/bumpUsage_/getQuotaStats (quota observability moved to Vercel logs)
  - `backup.ts/.js` (~5K) — Drive folder backup (Neon PITR replaces)
  - `r2.ts/.js` (~7K) — Cloudflare R2 off-drive backup (Neon PITR replaces)
  - `load.ts/.js` (~12K) — loadAll/loadOrder/getAuditByTarget (Postgres-only since §12 Step 1-5)
  - `templates.ts/.js` (~4K) — addTemplate/deleteTemplate/setTemplateRow (templates now Postgres-native)
  - `helpers.ts/.js` (~10K) — sheetToArray/findRowById/objectToRow/getConfig/getNextId stubs/findDuplicateOrderIds/setupOrderCounters (all callers in deleted modules)
- **คงไว้:**
  - `setup.ts/.js` — ops tool: `generateServiceToken` (regen `APPS_SCRIPT_TOKEN` every 5y) + `setupSheets` (first-time bootstrap). Editor-run, not called by dashboard
  - `archive.ts/.js` — `archiveOldData` daily 3 AM trigger + `searchArchive` (serves /archive page) + setupArchiveTrigger/testArchiveNow
  - `audit.ts/.js` — `appendAudit` (log searchArchive)
  - `Code.js` (93 → 70 lines) — sheet IDs/headers + post-§12 module map comment block
- **`push.sh`** — เดิม; `npx tsc -p tsconfig.build.json` compile + `clasp push -f`. Pushed 9 files (was 16) at 2026-05-28 12:24

**Frontend surface (penprinting-dashboard):**
- **Step B — `<AutoSync />` consolidate** ([`app/board/page.tsx`](app/board/page.tsx) · [`app/orders/page.tsx`](app/orders/page.tsx) · [`app/calendar/page.tsx`](app/calendar/page.tsx)) — ลบ `<AutoSync />` JSX + `import { AutoSync }` จาก 3 pages. 3 หน้านี้ delta-fetch live ตั้งแต่ 5/21 (`NEXT_PUBLIC_DELTA_FETCH`) + 5/22 (`NEXT_PUBLIC_DELTA_FETCH_LIST`); `<AutoSync />` redundant ตอน flag ON (production state). คง `useAutoSync` hook + `<AutoSync />` ใช้ที่ /analytics /cancelled /shipped (ไม่มี delta-fetch). `broadcastWrite` helper ยังอยู่ใน [lib/auto-sync.tsx](lib/auto-sync.tsx) (ใช้ทั่วระบบหลัง write mutations)
- **Note:** legacy flag-OFF branches ยังอยู่ใน 3 pages (BoardData/OrdersData/CalendarData functions). Wholesale-strangler-finish opportunity — ดู NEXT-SESSION §1

**Gates Node 22 (penprinting-dashboard):** type-check ✅ · lint ✅ · vitest **120/120** · build ✅. Apps Script: `npx tsc -p tsconfig.build.json` ✅ no errors

**Deploy:**
- **penprinting-dashboard**: git push → Vercel auto-deploy
- **Apps Script**: clasp push -f ✅. **Pending คุณนุ๊ก deploy "Edit existing → New version"** ที่ Apps Script editor (URL คงเดิม)

**Pending user actions:** Apps Script deploy + smoke verify /archive search + ค้างจากเซสชั่นก่อน (Vercel env vars cleanup, Sentry alert rule, /track ใบ #202605173 test, optional incognito test /board)

**Trap หลีก:**
- setup.ts ดูเหมือน "dead post-§12" แต่จริงๆ เป็น ops tool (token regen + bootstrap). คงไว้
- `bumpUsage_` defined ใน quota.ts — ลบ quota.ts โดยไม่ trim api.ts call = ReferenceError runtime
- `clasp push` ≠ deploy — push อัพ source, URL คงเดิม. ห้าม "New deployment" = URL เปลี่ยน = LINE webhook + frontend พังเงียบ

**Commit:** [`accce6b`](https://github.com/witsarutnook/penprinting-dashboard/commit/accce6b) (Step B code + docs covering both Step 6 + Step B; Step 6 source pushed via clasp)

---

### §12 Step 1-5 — Postgres-only (Apps Script fallback retired) (2026-05-27)

**Goal:** ตัด Apps Script dependency จาก dashboard reads + writes ในก้อนเดียว ([migration-plan-apps-script-shrink.md](migration-plan-apps-script-shrink.md) Step 1-5). Apps Script project ยังคงอยู่ (host `searchArchive` until §13 + LINE webhook) แต่ dashboard ไม่เรียกอีก ยกเว้น /archive page.

**Code surface (-4,968 LOC, 47 files):**
- **`lib/api.ts`** — drop `tryPostgres()` + AS fallback in `loadAll`/`loadAllWithAudit`/`loadOrder`/`getAuditByTarget`. Drop `loadAllFresh`/`loadAllFromAppsScriptForSync`/`getQuotaStats`. Keep `AppsScriptError` + `post()` + `searchArchive` only. `loadOrderAndJobs` becomes Postgres-direct (was Postgres-first with AS fallback)
- **17 write routes** — strip `if (phase2WriteEnabled(...)) ... else { post(...) }` pattern. Each route calls postgres-write helper directly. `jobs/add` idempotency check migrated from `loadAllFresh()` → direct SQL `SELECT id FROM jobs WHERE order_id = X AND phase2_deleted_at IS NULL LIMIT 1`
- **Deleted (dead post-§12):** `lib/feature-flags.ts` (phase2WriteEnabled + 14 WRITE_* flags + phase2OwnsTable) · `lib/sync-to-sheet.ts` + `lib/sync-from-sheet.ts` (~770 LOC heal cron) · 4 cron routes (sync-to-sheet/sync-from-sheet/quota-check/r2-backup) · 9 admin diagnose/import routes (diagnose-{cowork,order,audit,board,shipped-dupes}, import-{jobs,audit-log}, sync-all, /api/board/postgres, /api/audit/postgres, /api/board/sheet) · `app/admin/bench-audit/` dir · `app/analytics/quota-widget.tsx` · `app/api/orders/delete/route.ts` (no frontend caller — verified via grep)
- **Added:** [`app/error.tsx`](app/error.tsx) — per-route error boundary. Postgres-outage friendly UI ("⚠️ ระบบขัดข้องชั่วคราว · กำลังตรวจสอบ — กรุณารอ 30 วินาทีแล้วลองใหม่") with retry button. Auto-tags Sentry events `postgres-error=true` when error message matches `/postgres|neon|connection refused|ECONNREFUSED|relation .* does not exist/i`
- **`vercel.json`:** 5 crons → 1 (morning-report only)
- **Bonus cleanup:** removed `generatedAt: new Date().toISOString()` from `computeBoard` ([lib/board.ts:292](lib/board.ts:292)) — unused impure field that broke pure-compute invariant. Not the root cause of /board hydration warnings but removing it eliminates one variable

**Deploy order — Trap 1 handled:** Dashboard ลบ AS-write paths **ก่อน** Apps Script cleanup (Step 6 next session). Apps Script handlers ยังเปิดทุก action — dashboard ไม่เรียกอีกแล้ว ดังนั้นไม่เกิด "Unknown action" 502. Apps Script handlers จะกลายเป็น dead code ที่จะลบใน Step 6.

**Deferred (intentionally) — §12 Step 2F DB migration:** ลบ phase2_dirty_at + phase2_deleted_at columns เลื่อนไป follow-up session. **phase2_dirty_at**: column ค้าง dirty_at=NOW() ตลอด (no heal cron มาเคลียร์) — cosmetic, low cost. ลบต้อง refactor 20+ `SET phase2_dirty_at = NOW()` instances ก่อน DROP. **[2026-06-13]** docstring cleanup ([`a985e62`](https://github.com/witsarutnook/penprinting-dashboard/commit/a985e62)) flag column + markRowClean/markRowDirty helpers ว่า legacy/pending-removal แล้ว + grep ยืนยัน 0 operational reader → spawn background task ทำ phase2_dirty_at half (DROP COLUMN migration, user apply ผ่าน dashboard). **[2026-06-16] phase2_dirty_at half SHIPPED (code) — [`587044a`](https://github.com/witsarutnook/penprinting-dashboard/commit/587044a):** ลบ column ออกจาก writer ทุกตัว (INSERT/UPDATE/ON CONFLICT ~13 จุด) + ลบ markRowClean/markRowDirty + DirtyTable + แปลง db-migrate ADD→DROP (idempotent, DROP INDEX+COLUMN IF EXISTS). **Hidden-reader check ก่อน DROP:** ยืนยัน bump_updated_at triggers key off `raw`/`phase2_deleted_at` ไม่ใช่ column นี้ + Apps Script 0 ref + ไม่มี SELECT/WHERE. Gates เขียว Node 22 (143 tests, was 147 −4 markRow). **✅ DROP migration APPLIED 2026-06-16** (same session, Claude รัน `GET /api/admin/db-migrate` ผ่านเบราว์เซอร์ คุณนุ๊ก หลัง deploy `7acb6d0` success): 4 DROP lines + idempotent re-run 0 lines + /board reload 0 errors. **phase2_dirty_at half = closed.** phase2_deleted_at ยังคงไว้ (live tombstone — bigger refactor รอ tombstone cleanup phase). **phase2_deleted_at**: ใช้เป็น soft-delete tombstone ใน SELECTs (`WHERE phase2_deleted_at IS NULL`) — ลบต้อง refactor moveToShipped/cancelJob/deleteJob ให้ hard-DELETE jobs row (bigger refactor, ทำเมื่อ tombstone cleanup phase)

**Gates Node 22:** type-check ✅ · lint ✅ · vitest 120/120 (was 139, -19 from removed feature-flags + sync-from-sheet tests) · build ✅

**Pending user actions** (post-deploy):
1. ลบ Vercel env vars (no-op now): 14 `WRITE_*_TO_POSTGRES` + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES`
2. สร้าง Sentry alert rule: tag `postgres-error=true` > 10 events/5min → notify
3. Apps Script project: Step 6 cleanup ใน next session (Claude เขียน + คุณนุ๊ก deploy "Edit existing → New version")

**Smoke verified (Chrome MCP):** /board · /orders (252 ใบ) · /calendar (61 รายการ) · /analytics (179 ใบ/89.4% success) · /track (lookup form). All Postgres-only path works.

**Commits:** [`745d36f`](https://github.com/witsarutnook/penprinting-dashboard/commit/745d36f) (§12) · `3da9266` (generatedAt cleanup)

---

### /track shipping-queue active step (2026-05-27)

**Bug:** ใบสั่งงานที่ `staff='ship'` (อยู่คิว "รอจัดส่ง" ใน /board) เคยค้าง active ที่ step 4 "ขั้นตอนหลังพิมพ์" บน timeline /track. Step 5 "สินค้าพร้อมรับ" ไม่เคย active จนกว่า shipped จริง (status='shipped'). User report ผ่าน screenshot ใบ #202605173.

**Root cause:** `lib/board.ts` มี 3 depts (`graphic`/`print`/`post`); "รอจัดส่ง" เป็น **staff `ship`** ภายใต้ dept `post`. `/api/track/lookup` map แค่ `currentDept = (dept === 'graphic' || dept === 'print' || dept === 'post') ? dept : null` → งานที่ staff='ship' ส่ง `currentDept='post'` เหมือนงานในไดคัท/เครื่องตัด → client ไฮไลต์ step 4

**Fix:** เพิ่ม `awaitingShipment: boolean` ใน `TrackResult` (set true เมื่อ `dept='post' && staff='ship'`). Client `Steps` component: เมื่อ flag = true → step 4 (หลังพิมพ์) = `done`, step 5 (สินค้าพร้อมรับ) = `current`. `statusLabel` badge override เป็น "สินค้าพร้อมรับ" ให้ตรงกับ active step. **ไม่ rename step / ไม่เพิ่ม step** (คุณนุ๊ก confirm คงชื่อ "สินค้าพร้อมรับ / Ready for pick up")

**ไฟล์แก้:** [`app/api/track/lookup/route.ts:236-282`](app/api/track/lookup/route.ts) · [`app/track/client.tsx:248-315`](app/track/client.tsx)

**Commit:** [`0cb98c3`](https://github.com/witsarutnook/penprinting-dashboard/commit/0cb98c3)

---

### Delta-fetch — extend to /orders + /calendar (2026-05-22)

**Goal:** ขยาย delta-fetch (เดิมมีแค่ `/board`) ไป `/orders` + `/calendar` — เลิก `router.refresh()` poll เต็มหน้ารายตึ๊ก. Flag-gated (`NEXT_PUBLIC_DELTA_FETCH_LIST`) — OFF = path เดิมไม่แตะ; deploy = 0 impact จน flip.

**`/calendar` (ง่าย):** `computeCalendar` อ่านแค่ jobs+orders → reuse `/api/board/delta` + `useDeltaSync` verbatim. `<CalendarClient>` ถือ state + re-run `computeCalendar` ตาม `useSearchParams` (month/filter URL-driven).

**`/orders` (ต้อง 4 ตาราง):** status badge ต้องรู้ shipped/cancelled. `loadBoardDelta(since, {lists:true})` คืนเพิ่ม `shippedOrderIds`/`cancelledOrderIds` — **full sorted number array ต่อ poll** (set เล็ก ~150 แถว; เลี่ยงปัญหา shipped/cancelled hard-delete ที่ delta-by-`updated_at` จับไม่ได้). `mergeDelta` เทียบ array — ไม่เปลี่ยน keep ref เดิม → idle poll ไม่ re-render (PA-M2). enrichment (orders→table rows + orphans + duplicates) ย้ายเป็น pure `computeOrdersList()` — server `OrdersData` + client `OrdersListClient` ใช้ตัวเดียวกัน.

**ไฟล์ใหม่:** [`lib/orders-list.ts`](lib/orders-list.ts) (`computeOrdersList`) · [`app/orders/orders-list-client.tsx`](app/orders/orders-list-client.tsx) · [`app/orders/orders-body.tsx`](app/orders/orders-body.tsx) (shared toolbar+table) · [`app/calendar/calendar-client.tsx`](app/calendar/calendar-client.tsx)
**ไฟล์แก้:** `board-delta.ts` (+`lists` opt) · `delta/route.ts` (`?lists=1`) · `delta-sync.tsx` (`DeltaState`/`mergeDelta`/`useDeltaSync` รับ list — **board path byte-identical** เมื่อไม่ส่ง `?lists=1`) · `calendar.ts` (`computeCalendar` รับ `Pick`) · 2× `page.tsx` (flag branch)

**Rollout (2026-05-22):** commit `88b31d7` deploy (flag OFF) → ตั้ง `NEXT_PUBLIC_DELTA_FETCH_LIST=1` + redeploy → smoke-verify ✅ /orders poll `?...&lists=1` (~0.34KB) · /calendar poll `/api/board/delta` 200. **Tests:** 128→139.

**Rollback:** ลบ env var + redeploy = กลับ path เดิมทันที.

---

### Hardening — ID-collision guard + loadOrder over-fetch trim (2026-05-22)

**A — post-insert read-back assertion (§6/R5):** fresh-id INSERT 4 จุดที่ใช้ `ON CONFLICT (id) DO NOTHING` (createOrder order+job · promoteDraft · bulkForward) — ถ้า Postgres counter mint id ซ้ำ DO NOTHING กลบ INSERT เงียบ + route return success → order/job หาย. Fix: `... RETURNING id` + helper `assertNoIdCollision()` — RETURNING ว่าง = conflict → SELECT row เดิมเทียบ name(+orderId); ต่าง = collision → throw ดังๆ. (`addJobToPostgres` เป็น plain INSERT ไม่มี ON CONFLICT → throw ดังอยู่แล้ว.)

**B2 — PA-L1 loadOrder over-fetch:** `loadOrderFromPostgres` เดิมยิง 4 query ขนานเสมอ. เพิ่ม opt `orderOnly` → caller ที่อ่านแค่ `.order` (print page · tracking-card · `/api/orders/raw` · restore parent-status check) รัน 1 query. full-shape path (`/track`) ไม่แตะ.

**Tests:** 122→128. **Commit:** `74ac78d`.

---

### ID-allocation → Postgres (2026-05-21)

**Goal:** ตัด Apps Script ออกจาก critical path การสร้าง order/job. จาก diagnose order-submit latency — กด "ส่งใบสั่งงาน" 2-3 วิ, ~80-90% หมดกับ Apps Script ID round-trip (`getNextOrderId` + `getNextId`).

**กลไก:** ตาราง `counters(key, value)` — mint ด้วย `UPDATE counters SET value = value + N ... RETURNING` (atomic row-lock; concurrent mint serialize บน row เดียว — ดีกว่า Apps Script LockService ที่ lock ทั้งแอป). Job id = monotonic counter ล้วน (**ห้าม MAX-derive** — job ถูก hard-delete ตอนย้าย shipped/cancelled → MAX ต่ำกว่า id ที่เคยใช้). Order id = `YYYYMMNNN` per-month + cross-check `MAX(orders.id)` ของเดือน (orders ไม่เคยลบ → MAX เชื่อถือได้; Bangkok-TZ prefix).

**ไฟล์:** ใหม่ [`lib/id-allocation.ts`](lib/id-allocation.ts) (`mintJobId`/`mintJobIds`/`mintOrderId`) · [`/api/admin/seed-id-counters`](app/api/admin/seed-id-counters/route.ts) (raise-only seed) · `counters` table ใน db-migrate. 6 routes mint จาก Postgres ตรงๆ — orders/add · promote-draft · jobs/add · forward · forward-undo · bulk-forward. แผนเต็ม + risk table: [migration-plan-id-allocation.md](migration-plan-id-allocation.md).

**Rollout (2026-05-21):** db-migrate → seed (`nextId`=740, verified ตรง Sheet `config.nextId`) → flag ON + redeploy → smoke ✅ — job `740`, order `202605145`, ไม่มี ID ชน, ส่งใบสั่ง 2-3 วิ → ~0.3-0.6 วิ (คุณนุ๊กยืนยัน).

**Step 7 retire (2026-05-25):** soak 4 วัน ไม่พบ ID ชน + ไม่มี Sentry. ลบ flag `ALLOCATE_IDS_IN_POSTGRES` + else-branch Apps Script จาก 6 routes + `getNextId`/`getNextIds`/`getNextOrderId` ออกจาก Apps Script `api.ts`/`helpers.ts`. legacy `addOrder`/`addJob`/`bulkForward`/`createOrder` write handlers ใน Apps Script `write.ts` ยังมี internal call ของ `getNext*` แต่เป็น dead code (Phase 2 flags ON — ไม่ถูก call) — รอลบรวมกับ phase Apps Script write retire ตามแผน §12. workaround: stub 3 helpers ใน `helpers.ts` ที่ throw "RETIRED" ให้ tsc compile + fail loud ถ้าถูก call. **Smoke-verified 2026-05-25**: order `#202605171` (monotonic ต่อจาก `#202605145`@5/21) · job `#820` (ต่อจาก `#740`@5/21) · PIN `6762` random.

**PIN/QR ไม่กระทบ:** PIN เป็นเลขสุ่ม ไม่เกี่ยว counter · QR เข้ารหัสแค่ order id (`track?id=`) — format `YYYYMMNNN` คงเดิม → QR เก่า/ใหม่ใช้ได้หมด.

**Rollback หลัง Step 7:** ไม่มี Apps Script fallback แล้ว — ถ้า Postgres counter พัง ต้องแก้ที่ counter ตรงๆ (re-seed ผ่าน `/api/admin/seed-id-counters?min=<n>`). คุณนุ๊กลบ env var `ALLOCATE_IDS_IN_POSTGRES` ได้แล้ว (no-op หลัง Step 7).

**Tests:** +10 ([`tests/id-allocation.test.ts`](tests/id-allocation.test.ts)) — total 112→139 (cumulative through Step 7).

**Neon transfer-rate measurement (2026-05-25):** 1.16 GB / 7 วัน (18-25 พ.ค.) = **~0.166 GB/วัน** ⭐ ลด **76% จาก baseline 0.7 GB/วัน** · ทะลุเป้า P3 (<0.3) ~2×. ปัจจัยลด: loadAll caching (60s ISR + tag) · delta-fetch P3 `/board` · delta-list `/orders` + `/calendar` ([`88b31d7`](https://github.com/witsarutnook/penprinting-dashboard/commit/88b31d7)) · Postgres mint (ตัด Apps Script proxy ออก). Storage 35.64 MB เล็กมาก — ไม่ใช่ bottleneck. Compute ~2.4 CU-hrs/วัน.

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

**1. Morning Report cron migration (Tier B 3/4)** — ✅ standalone Apps Script retired 2026-05-23
- ~~Morning Report Apps Script project ได้ `doPost` handler ใหม่~~ ของเดิมถูกแทนด้วย self-contained Vercel route ใน revamp ถัดมา (`lib/morning-report.ts` + `app/api/cron/morning-report/route.ts` ใช้ `loadAll()` + LINE push API ตรง — ไม่มี Apps Script hop)
- `app/api/cron/morning-report/route.ts` — daily 8 AM Bangkok (1 AM UTC), `0 1 * * *`. Auth: `CRON_SECRET` (Vercel-injected) หรือ `?token=${MORNING_REPORT_TOKEN}` (manual `&dry=1` test).
- `vercel.json` — 3rd cron entry.
- Env vars: `MORNING_REPORT_TOKEN` (manual test) + `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID` + `CRON_SECRET` (auto). ~~`MORNING_REPORT_APPS_SCRIPT_URL`~~ ลบแล้ว (ไม่ถูก reference ใน code อีก).
- ✅ "Morning Report V2" standalone Apps Script project ลบทิ้งแล้ว (2026-05-23). Vercel cron เป็น single scheduler.

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

Backwards-compat fallbacks should be in v2 routes when needed (e.g. Phase 2 routes still keep an Apps Script fallback path under `!phase2WriteEnabled(...)` — dead while flags are ON, scheduled for cleanup with the legacy Apps Script write actions).

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
