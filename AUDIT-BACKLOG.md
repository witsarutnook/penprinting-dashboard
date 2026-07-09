# 🐞 Audit Backlog — Dashboard v2

> Last scan: **2026-05-12** (5-dimensional audit — 4 parallel subagents covering data/perf/a11y/security + manual architecture review)
>
> Data-integrity scan: **2026-05-15** (`runPhase2IntegrityScan` — 9-dimension Sheet scan post Phase 2; see "Data integrity scan" section below)
>
> Latest update: **2026-07-09** — **slip-metrics `?channel=` follow-up ปิด** ([`db2eebd`](https://github.com/witsarutnook/penprinting-dashboard/commit/db2eebd), TDD +6 tests = **414**): `loadSlipMetrics(channel?)` + `parseSlipMetricsChannel` extract ลง [lib/ai-quote/slip-metrics.ts](lib/ai-quote/slip-metrics.ts), NULL-param single-query, ไม่ใส่ param = aggregate เดิม (additive `channel:'all'`), typo → 400. Endpoint layer ตามทัน data layer แล้ว — runbook caveat ลบ. **Bonus ฝั่ง penprinting-web: privacy policy page live** (`penprinting.co/privacy-policy`) — Meta App Review gate จังหวะ 2 ปลดล็อก (RUNBOOK-1c 2.1 ✅). Prod-verify filter = optional user smoke (admin-gated). ไม่มี audit item ใหม่เปิด.
>
> Previous: **2026-07-08** — **Phase 1c Messenger channel merged (PR [#19](https://github.com/witsarutnook/penprinting-dashboard/pull/19) `3e198d6`, env unset = route เงียบ) → ไม่มี audit item ใหม่เปิด.** M5 generalized เป็น `loadSession({channel, channelUserId})` **fail-closed** (channelUserId ไม่มี channel → `channel = NULL` ไม่ match — test pin ทั้ง line+messenger ใน `tests/ai-quote-db-{line,messenger}.test.ts`) + `createMessengerSession` ผูก PSID owner ตอน create. **M5-messenger prod-verify รอ soft-launch smoke 2-account** (RUNBOOK-1c-messenger-setup.md จังหวะ 1 — คู่กับ M5-line ที่ยังค้างจาก 7/07). Review รอบ execute จับ 2: slip renderer parity gap (`3dc3a55`) · slip-metrics endpoint ไม่มี `?channel=` filter แม้ `slip_checks.channel` มี 'messenger' rows แล้ว (runbook caveat, follow-up เล็ก — data layer ครบ endpoint layer ยังรวม). Gates เขียว Node 22 (**408 tests** +35). Zero regression LINE (diff route = 1 บรรทัด loadSession opts). **Same-day rollout: จังหวะ 0+1 smoke 8/9 ✅ บน prod** (webhook fail-closed verified · escalation ①④ Flex ครบ field · slip duplicate cross-channel · hint gate) — **M5-messenger 2-account ยังค้าง (deferred พร้อม M5-line, ดู NEXT-SESSION pending #1)**.
>
> Previous: **2026-07-06** — **Phase 1b-B merged (PR [#18](https://github.com/witsarutnook/penprinting-dashboard/pull/18) `5f8954e`, flag OFF) → M5 owner-check acceptance criterion ปิดจริง.** `loadSession(id, {lineUserId})` บังคับ `channel='line' AND line_user_id=<webhook-verified sender>` ใน WHERE เดียว, mismatch → null ไม่ leak (ตาม design-ai-quoting.md §7 ที่ fold ไว้ 6/26) + LINE session ทุก row ผูก owner ตอน create. Test pin 2 ชั้น: SQL shape (`tests/ai-quote-db-line.test.ts`) + handler fallback สร้าง session ใหม่เมื่อ mismatch (router test). **รอ prod-verify ตอน soft-launch smoke (2 LINE accounts) — ดู NEXT-SESSION pending #3.** Review รอบ execute จับเพิ่ม 3 (FK type / trigger ④ ราคาหาย spec §4 / ANTHROPIC_API_KEY gate) — แก้ครบใน branch. Gates เขียว Node 22 (**373 tests**). ไม่มี audit item ใหม่เปิด.
>
> Previous: **2026-07-04** — **PERF-M3 + PERF-H2/M2 ปิด → perf backlog = 0 open ทั้ง cluster.** (1) **PERF-M3** ([`2d8ad7a`](https://github.com/witsarutnook/penprinting-dashboard/commit/2d8ad7a)) — `/api/board/delta` เพิ่ม `export const dynamic='force-dynamic'` (match session-gated route convention) + `Cache-Control: no-store` (payload per-cursor/per-session ห้าม CDN/proxy cache). zero behavior. (2) **PERF-H2/M2** ([`af45644`](https://github.com/witsarutnook/penprinting-dashboard/commit/af45644)) — **slim order delta payload** ผ่าน **TDD** (8-ไฟล์ phase, 3 render paths). `loadBoardDelta` เลิกส่ง rawData/details blob เต็มทุกใบ → SQL slim projection `(raw - 'rawData' - 'details') || jsonb_build_object('pin', ..., 'hasSpec', ...)` เก็บ display fields + project `pin` (โชว์ /orders row) + `hasSpec` (คุม card spec tab). ทั้ง SSR bootstrap + client poll ผ่าน `loadBoardDelta` ตัวเดียว = **ไม่มี dual-shape**. Consumers lazy-fetch ผ่าน `/api/orders/raw/[id]`: orders-list.ts (pin top-level, rawData→null; orders modal มี fetch fallback อยู่แล้ว) · board.ts (OrderSummary +hasSpec) · card.tsx (spec tab lazy-fetch → buildSpecSections; memo swap `details`→`hasSpec` ref-check) · order-form.tsx (edit จาก board card slim → lazy-fetch spec ก่อน prefill; /orders edit page full order → skip). **+6 tests** (board-delta SQL shape / computeOrdersList pin+null / computeBoard hasSpec; `tests/board.test.ts` ใหม่). Gates เขียว Node 22 (type-check/lint 0-err/**294 tests**/build). **Verified prod (Chrome MCP):** delta = pin+hasSpec ไม่มี rawData/details, 464 ครบ 0 missing display field, pins จริง · **payload 126KB จาก ~600KB (−78%)** · UI smoke 6/6 (board render · card spec tab · **card edit prefill 9/9+spec** · /orders 464 rows · modal PIN 7752 · modal spec lazy-fetch). **Zero behavior change.** Lesson: slim wire-shape phase → ยิง 1 loader ที่ server+client share (ไม่มี dual-shape); verify SQL projection บน prod data จริง (mock test pin แค่ text) — hit delta เทียบ baseline shape.
>
> Previous: **2026-07-03 (cont.)** — **Performance audit (penprinting-auditor) + iPad PWA logout fix — M1/L1/H1 shipped, H2/M2/M3 open.** hot path **verified clean** (delta-fetch / `unstable_cache` coalescing / adaptive-poll 15→30→120s+30min hard-stop / bundle-split recharts-lazy / indexes ครบรวม `idx_orders_customer_norm` / pagination ไม่ต้อง virtualize). findings ใหม่ = payload/scan ที่โตตาม row count (ไม่พังที่ ~220 orders). **PWA logout** ([`d414e0e`](https://github.com/witsarutnook/penprinting-dashboard/commit/d414e0e)): iPad home-screen เด้ง `/login` ตอนสลับ app = **missing PWA config** (ไม่มี manifest/appleWebApp → iOS evict storage container), **ไม่ใช่ cookie bug** (persistent 30d/httpOnly/secure/lax ถูก). Fix `app/manifest.ts` (display standalone) + `appleWebApp` ใน lib/seo.ts. ⚠️ user ต้อง remove+re-add home-screen icon. **PERF-M1** ([`e5a0bdb`](https://github.com/witsarutnook/penprinting-dashboard/commit/e5a0bdb)) cache shipped/cancelled orderId sets (`loadOrderIdSetsCached` unstable_cache 15s tag LOAD_ALL_TAG — job writes invalidate) → N tabs coalesce แทน DISTINCT full-scan/tab/poll. **PERF-L1** (`e5a0bdb`) memoize `rows.find` active row ใน OrdersTable. **PERF-H1** ([`8720a9e`](https://github.com/witsarutnook/penprinting-dashboard/commit/8720a9e)) `/orders/new` เลิก `loadAll()` → 3 targeted reads (`loadRecentOrdersSlim` projection+LIMIT 1000, `loadOrderFormTemplates`, `loadOrder(orderOnly)` prefill) — behavior เดิมเป๊ะ; **smoke-verified prod** (template dropdown + autocomplete + สั่งซ้ำ prefill ครบ). **iPad PWA + H1 smoke = คุณนุ๊ก verified ผ่านทั้งคู่.** **OPEN (deferred):** **PERF-H2/M2** — board/orders delta re-send `orders.raw` (spec เต็มทุกใบ) ทุกครั้ง order ถูกแตะ → slim Order display shape แยกจาก spec (**งาน phase**, blast-radius กว้าง: computeBoard/computeOrdersList/detail modal พึ่ง inline rawData) · **PERF-M3** — annotate `/api/board/delta` `dynamic`/`Cache-Control` (S). Gates เขียว Node 22 ทุก commit (288 tests/build). Lesson: [[feedback_ipad_pwa_standalone_session]].
>
> Previous: **2026-07-03** — **Bug fix: "สั่งซ้ำ" duplicate flow ดึงชื่องาน + ชื่อลูกค้ากลับมา (restore WP parity) ✅ SHIPPED + smoke-verified prod (`c7daeb0`, commit ตรง main).** คุณนุ๊กรายงานชื่องาน+ลูกค้าว่างตอนกดสั่งซ้ำ. `/diagnose`: duplicate prefill effect ([order-form.tsx:189](app/board/order-form.tsx:189)) จงใจ blank `next.name`/`next.customer` ตั้งแต่ commit แรกของฟีเจอร์ (`089ad08`) — **port-regression จาก WP** (`duplicateOrder()` carry ทั้ง 2 + clear แค่ due date; v2 docstring โกหกว่า "Mirrors WP"). คุณนุ๊กเลือก carry ทั้ง 2 + คงเตือน duplicate (safety net). Fix: ถอด blanking (เหลือ reset dates) + inject canonical name/customer ใน page.tsx กัน stale rawData + 2 docstrings. **+3 guard tests** ([tests/order-form-from-raw.test.ts](tests/order-form-from-raw.test.ts)) pin `orderFormFromRaw` carries name/customer; component effect ไม่มี RTL harness → seam noted, input bind `data.name`/`data.customer` ยืนยันถูกโดยโครงสร้าง. consistent กับ WP + ปุ่มดึงงานล่าสุด; applyTemplate คงล้าง (ถูก). Gates เขียว Node 22 (type-check/lint 0-err/**288 tests** +3/build). Lesson: [[feedback_port_mirrors_comment_lies]].
>
> Previous: **2026-07-02 (cont.)** — **AI Quote engine Haiku 4.5 → Sonnet 5 ✅ SHIPPED (merged `2bcb56e`).** คุณนุ๊กถามว่าใช้ Haiku โอเคมั้ย → grep เจอ 2 จุด: slip pre-filter vision (`VISION_MODEL`) = **keep Haiku** (binary gate ก่อน Thunder, model ใหญ่แพงเปล่า) · quote engine (`MODEL`) = **swap Sonnet 5** (จุดที่ Haiku over-clarify ซ้ำ — ถามสีปก 3 รอบ). Change: `MODEL='claude-sonnet-5'` + `MAX_TOKENS` 2048→4096 (Sonnet 5 เปิด adaptive thinking auto เมื่อ `thinking` unset → กัน truncate). Preview smoke (Chrome MCP) **4/4 ผ่าน** — assume-and-disclose ตีเลย · cover-color case ไม่ถามช็อตแรก (เคย hard-rule 3 รอบ) · book quote 32.64/เล่ม tool ทำงาน robust. <10 วิ, tool-eagerness ดี, no truncate/500. Gates เขียว Node 22 (**285 tests**/build), branch ลบแล้ว. Cost 2× Haiku (intro)/3× — volume ต่ำ. Lesson: patch hard-rule ซ้ำ → upgrade base model > เพิ่ม rule ([[feedback_ai_quote_model_upgrade_over_hardrule]]).
>
> Previous: **2026-07-02** — **Cleanup sweep: LOG-1 ปิด + Issue #1 track/lookup refactor ปิด (commit ตรง main → auto-deploy prod).** งาน follow-up จาก session 7/01. (1) **LOG-1** ([`24f2e68`](https://github.com/witsarutnook/penprinting-dashboard/commit/24f2e68)) — ถอด diagnostic `console.log` 5 จุด (webhook-router: inbound / slip pre-filter / thunder result / reply sent + `slip.ts` haiku answer); เก็บ error log ที่ LINE route ([route.ts:69](app/api/ai-quote/line/route.ts:69)); `slip_checks` metrics ครอบ observability แทน. (2) **Issue #1 (`track/lookup` refactor)** ([`55691c8`](https://github.com/witsarutnook/penprinting-dashboard/commit/55691c8)) — extract pure [`lib/track-result.ts`](lib/track-result.ts) `buildTrackResult` + **7 characterization tests** ([tests/track-result.test.ts](tests/track-result.test.ts)) pin พฤติกรรมเดิมทุก branch **ก่อน** refactor (public route เดิมไม่มี test = เหตุ defer) → delegate status core (currentDept/awaitingShipment/daysLeft) ไป `deriveTrackStatus` (web `/track` + LINE Flex + customer list = source เดียว); **preserve empty-dept quirk** `status='in_progress'` (deriveTrackStatus จะบอก `'received'` — quirk นี้กระทบสี badge ใน client `badgeVariant`) → **zero behaviour change**; route −135 LOC net. Gates เขียว Node 22 (type-check / lint 0-err / **285 tests** +7 / build). **Follow-up 7/01 = ปิดทั้งคู่.**
>
> Previous: **2026-07-01** — **Track by Customer feature ✅ SHIPPED + verified live prod (merged `5d9971e`, subagent-driven + final opus review).** ค้นงานด้วยชื่อลูกค้า → งาน active ทั้งหมด: LINE กลุ่มลูกค้า (route `track-customer` ใหม่, Hybrid group-bound + keyword filter, adaptive output) + web `/track/c/[token]` (tokenized) + admin `/registrations`. ตาราง `customer_registrations` + shared `deriveTrackStatus` + `loadActiveJobsByCustomer`. **278 tests** (+51), gates เขียว Node 22. **Final review = yes-with-minor**: array-param `= ANY(${...})` **verified ปลอดภัย** (driver ส่ง array ตรงเข้า pg; cast compile-only — [[feedback_ts_cast_hides_runtime_arraybind]]); **Issue #2 audit_log บน create/delete registration → FIXED** (`3fb8de6`); **Issue #1 refactor `track/lookup` → OPEN (deferred โดยตั้งใจ** — public route ไม่มี test → ทำพร้อม extract `buildTrackResult`+test); Minor #3 (bare-"track" noise) / #5 (token-collision msg) = accepted. **Live-verified prod:** db-migrate applied (table+2 index) · registration #1 `รัฐกุล` (audit ทำงาน) · web `/track/c` = 6 งาน active จริง (**`= ANY(${...})` array-bind พิสูจน์บน prod**, daysHint/sort/TZ ถูก) · LINE smoke OK · nav link `0a052a0`.
>
> Previous: **2026-06-30** — **AI Quote LINE Phase 1b-A cutover เสร็จ + slip_checks migration applied + doc gap ปิด.** session ก่อนทำ cutover + iterate slip-verify ไปแล้วแต่ไม่ลง doc → context check จับ git/doc mismatch (NEXT-SESSION ค้างที่ "PR #11 รอ cutover" แต่ main = `a23496d` มี PR #11/#12/#13 merged + 6 commits ตรง main). **Cutover:** webhook `dashboard.penprinting.co/api/ai-quote/line` LIVE (probe 200), Thunder/LINE env ครบ. **Slip pre-filter:** เปิด→remove (`e4a05b3`, สลิปจ่ายบิลโดน drop)→re-add (`0139d31`, แก้ prompt นับ bill-payment) → §9 lesson. **Migration applied 2026-06-30** (db-migrate ผ่าน Chrome MCP เบราว์เซอร์คุณนุ๊ก: table `slip_checks` ยังไม่ถูกสร้าง → slip-metrics 500→200, idempotent rerun data เดิมครบ). **เปิด open Low `LOG-1-slip-diagnostic-verbose`** (ดู Low section). ไม่มี code change (verification + doc only).
>
> Previous: **2026-06-27** — **Dashboard Next 15 + React 19 soak ปิด (migration 4/4 repos จบ 🏁).** ครบ soak window 1 สัปดาห์ (ship 6/20 `2c22301` → 6/27). Health-check production (agent `/usr/bin/curl`): `/login` 200 · `/`+`/board` 307→login · `/track` 200 · `/login` RSC payload ปกติ (`__next_f` ×5, ไม่มี error page). คุณนุ๊ก verify manual: /board render skeleton→board console 0 error (#418 fix holds) + Sentry project dashboard ไม่มี error spike. **UI-1 hydration /board** ปิดสมบูรณ์ (root-class fix `45d6c77` holds 1 wk live). Cleanup: ลบ `migration-plan-next15.md` + update Stack doc `Next.js 14`→`15 + React 19`. ไม่มี code change (verification + doc only). **A11Y-board-form-label** ยัง open (board เป็น client-only render แล้ว — re-check ตอน a11y pass ถัดไป).
>
> Previous: **2026-06-26** — **M5 IDOR resolved (fold into 1b spec + channel-guard prep) + 3 Low closed + stale PR #3 closed.** **M5-loadsession-idor**: accepted-for-1a (shared inbox = design) → **folded into Phase 1b as an acceptance criterion** (design-ai-quoting.md §7: bind `line_user_id` + sender-check before load) + **zero-regression channel guard prepped now** (staff chat route → `loadSession(id, { channel: 'dashboard' })`; all current sessions are dashboard-channel so no behaviour change). **3 Low** all closed: `saveQuote` now `RETURNING id` (quote id truthful, client never read it) · run.ts comment `500`→`502` · db-migrate row-count adds `ai_quote_sessions`/`ai_quotes`. **PR #3** (stale FAB — real FAB shipped via PR #4 `66d0286`) closed. Gates green Node 22 (type-check / lint / **193 tests** / build 40 หน้า). AI Quote audit backlog = **0 open** (1a internal items all cleared; M5 owner-check lands in 1b).
>
> Previous: **2026-06-24** — **Floating AI-quote FAB widget shipped + audit fast-follow M3/M4 closed.** (1) **FAB widget** (PR [#4](https://github.com/witsarutnook/penprinting-dashboard/pull/4) → `66d0286`): ปุ่มลอยมุมขวาล่างเปิด AI Quote เป็น popup panel ได้ทุกหน้า (reuse `QuoteAssistantClient` โหมด `compact`), gate admin, ซ่อนบน `/quote-assistant`, z-40, Esc ปิด. Preview-verified บน iPad (ใบปลิว 5000 → 1.58 บาท/ชิ้น offset). (2) **ปิด M3 + M4** (gate ของ Phase 1b): **M3** wire escalation badge (detectEscalation pure fn → `out.escalated` → markEscalated + badge "ต้องประเมินเอง" ใน /quote-leads) · **M4** claimLead conditional UPDATE + 409. **M5 (loadSession IDOR) คงเปิด — ตั้งใจ** (shared team inbox ของ 1a, ปิดพร้อม Phase 1b LINE identity). Gates เขียว Node 22 (type-check / lint / **175 tests** / build).
>
> Previous: **2026-06-23** — **AI Quote Assistant Phase 1a audit (penprinting-auditor)** บน branch `feat/ai-quote-phase1a` (ยังไม่ merge). security/SQL/permission สะอาด. **ปิด H1/H2/M1/M2 ก่อน merge ใน [`902d70a`](https://github.com/witsarutnook/penprinting-dashboard/commit/902d70a)** (+2 regression test, 159→161): **H1 (High, session-brick)** `runQuoteTurn` persist assistant turn `text=''` (ชน `MAX_TOOL_ROUNDS` ขณะ tool_use / tool-use-only block / `max_tokens` stop) → Anthropic reject empty text content block → ทุกข้อความถัดไปใน session 400 พังถาวร → fallback non-empty reply + 2 test (`tests/ai-quote-run.test.ts`) · **H2** middleware matcher ไม่ครอบหน้าใหม่ → เพิ่ม `/quote-assistant` + `/quote-leads` (API self-guard ด้วย requireSession, ไม่ใส่ /api/* ตาม convention) · **M1** เลิก echo calc error body ไป client → generic message + `console.error` server · **M2** guard `message` เป็น non-empty string (non-string เคย throw 500) + cap 4000 chars. **เปิดใหม่ 3 Medium + Low (Phase 1a internal-only — ปิดก่อนเปิด LINE 1b)**: M3-aiquote-escalation-not-wired · M4-leadclaim-race · M5-loadsession-idor + Low (quote id=array index · run.ts:73 comment typo · db-migrate row-count). ดู Medium/Low sections. Smoke lesson (calc env "ตั้งแล้ว" แต่ไม่ redeploy = ไม่ live) → [[feedback_ai_quote_phase1a]]. Gates เขียว Node 22 (type-check/lint/161 tests/build 40 หน้า).
>
> Previous: **2026-06-20** — **Next 15 + React 19 migration shipped + board hydration #418 fixed** (PR [#1](https://github.com/witsarutnook/penprinting-dashboard/pull/1) → `2c22301`: migration [`1d9cb6e`](https://github.com/witsarutnook/penprinting-dashboard/commit/1d9cb6e) + board fix [`45d6c77`](https://github.com/witsarutnook/penprinting-dashboard/commit/45d6c77)). **Closes UI-1 hydration /board** (was wontfix-as-extension-noise 6/05) — turned out React 19 surfaces a **real** mismatch React 18 silently recovered from: `/board`'s data-derived text (KPI counts, "รับ Xว", card order) is computed client-side off a live `useDeltaSync` snapshot, so SSR pass ≠ first client render. Diagnosed via /diagnose: **incognito** repro proved it's NOT the polkadot.js extension; a **TZ harness proved the date math can't diverge** (server-UTC vs client-Bangkok `getBangkokToday()` offsets cancel exactly → displayed values always correct). **Root-class fix** (not suppressHydrationWarning): `BoardClient` gates the data-derived tree on a post-mount flag → SSR + first client render emit the same `<BoardSkeleton/>` (byte-clean hydration), board paints post-mount. `BoardSkeleton` extracted to `app/board/board-skeleton.tsx` (shared w/ page Suspense fallback). + `.eslintrc` ignore `next-env.d.ts` (Next 15.5 routes.d.ts triple-slash ref). **Verified preview 8/8 smoke + #418 gone on preview + production** (skeleton→board, console 0 error). Gates green Node 22 (type-check/lint/148 tests/build 38 หน้า). Soak Sentry 1-2d. **A11Y-board-form-label** still open — note: board is now client-only render, re-check the issue next a11y pass. Lesson → [[feedback_react19_hydration_realtime_board]].
>
> Previous: **2026-06-16** — **phase2_dirty_at column removal (§12 Step 2F, phase2_dirty_at half)** ([`587044a`](https://github.com/witsarutnook/penprinting-dashboard/commit/587044a), net −98 LOC). ปิดงานที่ background task spawn ไว้ 6/13. ลบ dead column ออกจาก writer ทุกตัวใน `postgres-write.ts` (INSERT column+NOW() value 7 จุด · UPDATE SET 5 จุด · ON CONFLICT 3 จุด) + ลบ `markRowClean`/`markRowDirty` + type `DirtyTable` + refresh docstrings · cowork route comments · **db-migrate ADD COLUMN → DROP INDEX+COLUMN IF EXISTS (idempotent)** · tests flip `toContain`→`not.toContain` (pin การลบ, 147→143 −4 markRow suite). **Safety — hidden-reader check ก่อน DROP** ([[feedback_retire_cron_grep_readers]] — §12 เคยลืม checkStaleness reader): ยืนยัน `bump_updated_at` triggers key off `raw`/`phase2_deleted_at` **ไม่ใช่** column นี้ + Apps Script 0 ref + ไม่มี SELECT/WHERE ที่ไหน → 0 reader จริง. Gates เขียว Node 22 (type-check/lint/143 tests/build 39 หน้า). **✅ DROP migration APPLIED 2026-06-16** (same session, Claude รัน `GET /api/admin/db-migrate` ในเบราว์เซอร์ คุณนุ๊ก หลัง deploy `7acb6d0` success): status 200 + 4 DROP lines · idempotent re-run 0 lines (column gone) · /board reload 0 console errors. **§12 Step 2F phase2_dirty_at half = closed.** `phase2_deleted_at` ยังคงไว้ (live tombstone — future tombstone-cleanup phase). Lesson → [[feedback_retire_cron_grep_readers]] (DB trigger/function bodies = readers ด้วย ตอน DROP COLUMN; deploy code-first then DROP).
>
> Previous: **2026-06-13** — Quick sweep ([`a985e62`](https://github.com/witsarutnook/penprinting-dashboard/commit/a985e62)). ปิด **L2** + **L5** + doc-nit. **L5-duplicate-dialog-status-badge** ✅ `findDuplicateOrdersInPostgres` คืน `kind` (`draft`/`active`/`orphan`) ผ่าน CASE + `DuplicateView` โชว์ badge — staff แยกร่างค้างกับงาน production ออก. **L2-stale-healcron-docstrings** ✅ จริง ๆ ไม่ใช่แค่ 2 บรรทัด — header postgres-write.ts ทั้งดุ้น + ~18 inline + cowork route describe สถาปัตยกรรมก่อน §12/§7 (heal cron / feature-flags / Apps Script getNextId ที่ลบหมดแล้ว). Rewrite เป็น Postgres-only reality — comment ล้วน zero behaviour change (subagent + spot-check, 147 tests เขียว). **doc-nit** ✅ db-migrate hint เลิกชี้ `/api/admin/sync-all` ที่ §12 ลบ. **phase2_dirty_at dead column** — ระหว่าง L2 ไป re-surface ของที่ dashboard-v2.md:422 track ไว้แล้วเป็น **§12 Step 2F deferred** (ไม่ใช่ของใหม่ — L2 audit note แค่ไม่ cross-ref): เขียน 26 จุด + `markRowClean`/`markRowDirty` helpers + partial index แต่ grep ยืนยัน **0 operational reader post-§12** (heal cron ที่เคยอ่านถูกลบ) → spawn background task ลบทั้ง cluster (DROP COLUMN+index, user apply ผ่าน dashboard). Lesson: cross-ref dashboard-v2.md "Deferred" section ก่อนเรียกว่า new finding. **L6-orders-update-no-dedupe** ยัง open (by design). Lesson: [[feedback_audit_backlog_hypothesis]] อีกครั้ง — note บอก 2 บรรทัด จริง ~20 จุด + เจอ dead code ที่ note ไม่เห็น.
>
> Previous: **2026-06-11** — Duplicate-order warning fix + audit sweep. User report: staff งง dialog "พบใบสั่งงานคล้ายกัน" ตอนสั่ง repeat order. [`8b132f8`](https://github.com/witsarutnook/penprinting-dashboard/commit/8b132f8) dedupe เฉพาะใบเปิดจริง (active job ผ่าน `phase2_deleted_at IS NULL` หรือ draft — ไม่ใช้ orders.status เพราะ 'shipped' derive จากตาราง shipped) + copy ใหม่ ("กลับไปแก้ฟอร์ม" / "ยืนยัน สร้างใบใหม่"). Audit (penprinting-auditor) เจอ **H1** force-confirm ทิ้ง mode 'print' → ใบสั่งสร้างแต่หน้าพิมพ์ไม่เปิด + เสี่ยงใบซ้ำจริงตอน retry + **M1** pure orphan (partial createOrder failure) หลุดจากเตือน → retry mint ใบซ้ำเงียบ. ปิด H1+M1+L1+L3+L4 ใน [`e0b1ae4`](https://github.com/witsarutnook/penprinting-dashboard/commit/e0b1ae4) (DuplicateInfo.mode + openPrintPlaceholder ใน confirm click + orphan NOT EXISTS branch + LOWER status + overflow-y-auto). **เปิดใหม่ 3 Low**: L2-stale-healcron-docstrings (postgres-write.ts:668-670, 798-801 อ้าง heal cron ที่ retire ไปกับ §12 — tombstone ไม่มีอะไร hard-delete แล้ว, doc nit) · L5-duplicate-dialog-status-badge (รายการใน dialog ไม่บอกว่าเป็นร่างหรืองาน production — ร่างเก่าที่ถูกลืมเตือนตลอด, ทำพร้อม UX รอบหน้า) · L6-orders-update-no-dedupe (rename order ชนชื่อใบเปิดอื่นไม่เตือน — pre-existing, by design แต่ note ไว้). +1 test (147 total)
>
> Previous: **2026-06-05** — UI-1 hydration `/board` ปิด **wontfix** หลัง incognito A/B test ยืนยัน crypto wallet extensions (Backpack + Nightly + anti-phishing) inject `window.ethereum` + DOM ก่อน React hydrate → tree mismatch → CSR recovery. Console clean ใน incognito; `#422` + 6 errors ใน normal mode. Static analysis ของ /board client tree วันนี้ก็ scan clean (Date.now/Math.random/storage/window references). Memory note: [[feedback_extension_hydration_noise]]. + **A11Y-board-form-label** เปิดใหม่ Low (100 issues "No label associated with a form field" จาก DevTools Issues panel — น่าจะเป็น kanban card checkboxes หรือ filter chips ขาด aria-label, defer ทำพร้อม a11y sprint).
>
> Previous: **2026-06-04 (late)** — Pending actions sweep. Admin endpoints **applied** by คุณนุ๊ก via dashboard.penprinting.co: `db-migrate` (2 indexes idempotent rerun) + `fix-date-anomaly?apply=1` (3 orders × 2 fields = 6 cells normalized, Bangkok TZ math verified) → **DATA-dateIn-double-encoded** + **DATE_ANOMALY ×7** ปิดสมบูรณ์. Vercel env cleanup 18 dead vars via CLI (14× WRITE_*_TO_POSTGRES + 2× delta-fetch + 2× phase-flag). FB Sharing Debugger refreshed 7 URLs (web 2 + photobook 5 — closes [[feedback_nextjs_metadata_shallow_merge]] residue). Sentry alert rule `postgres-error>10/5min` configured. **Carryover backlog = 0**.
>
> Previous: **2026-06-03 (afternoon)** — Dashboard cleanup C + D (+2 commits). [`b44394b`](https://github.com/witsarutnook/penprinting-dashboard/commit/b44394b) add `idx_shipped_imported` + `idx_cancelled_imported` ใน db-migrate route (powers fullLists incremental polls, ~ms perf as shipped grows). [`608f145`](https://github.com/witsarutnook/penprinting-dashboard/commit/608f145) new `/api/admin/fix-date-anomaly` endpoint (shipped, not yet applied at the time). `normalizeDate` unwraps JSON-ISO → Bangkok DD/MM/YYYY. +9 tests (137→146).
>
> Previous: **2026-06-03 (morning)** — Wholesale-strangler finish + B consolidate. **3 commits, -561 LOC net.** [`db8091d`](https://github.com/witsarutnook/penprinting-dashboard/commit/db8091d) ลบ `NEXT_PUBLIC_DELTA_FETCH` + `NEXT_PUBLIC_DELTA_FETCH_LIST` flag-OFF paths จาก board/orders/calendar pages + 4 client files + slim down PendingMutationsProvider (`pollNow` now required, drop router.refresh fallback). [`0edd926`](https://github.com/witsarutnook/penprinting-dashboard/commit/0edd926) extend `loadBoardDelta` + `useDeltaSync` + endpoint รองรับ `{ fullLists: true }` (returns full shipped+cancelled rows + PK ID set for delete detection). [`fe2bec5`](https://github.com/witsarutnook/penprinting-dashboard/commit/fe2bec5) convert /cancelled + /shipped เป็น delta-driven pattern + drop `<AutoSync />` จาก /analytics (60s ISR พอ) + delete `useAutoSync` hook + `AutoSync` component (keep `broadcastWrite`). **+11 tests** (137 total).
>
> Previous: **2026-05-28 (evening)** — Hot-fix `sync_meta` gate ([`5b61973`](https://github.com/witsarutnook/penprinting-dashboard/commit/5b61973)): /analytics bomb 24h หลัง §12 ship เพราะ `lib/api-postgres.ts` ยังเรียก `checkStaleness()` (อ่าน sync_meta) แม้ §12 ลบ sync-from-sheet cron แล้ว → 30-min threshold ตรงทุก request. ลบ checkStaleness + rename `PostgresStaleError` → `PostgresReadError`. +6 regression tests (120→126). Apps Script: คุณนุ๊ก deploy "Edit existing → New version" สำเร็จ ✅
>
> Previous: **2026-05-28 (afternoon)** — §12 Step 6 Apps Script cleanup (production-monitoring/apps-script/dashboard/): ลบ 7 modules (write/quota/backup/r2/load/templates/helpers) + trim api.ts (25 handlers → 1 searchArchive) + trim auth.ts ROLE_REQUIREMENTS. คง setup.ts (ops tool — generateServiceToken every 5y), archive.ts (auto-archive + searchArchive), audit.ts (appendAudit). clasp push 9 files (was 16). + Step B `<AutoSync />` consolidate: ลบจาก /board /orders /calendar (delta-fetch live, redundant). Gates ผ่าน Node 22 (type-check/lint/120 tests/build).
>
> Previous: **2026-05-27** — §12 Step 1-5 Postgres-only ship ([`745d36f`](https://github.com/witsarutnook/penprinting-dashboard/commit/745d36f), -4,968 LOC). Apps Script fallback ตัดทั้งหมดจาก dashboard reads + writes. 17 routes Postgres-direct. Dead code purge: feature-flags.ts + sync-to-sheet.ts + sync-from-sheet.ts + 4 cron routes + 9 admin diagnose/import routes + bench-audit + quota-widget. Gates ผ่าน Node 22 (type-check/lint/120 tests/build). + `/track` shipping-queue active step fix ([`0cb98c3`](https://github.com/witsarutnook/penprinting-dashboard/commit/0cb98c3)) — ใบที่ staff='ship' โชว์ step 5 active ถูก (เคยค้าง step 4). + chore: ลบ generatedAt impure side effect (`3da9266`). ใหม่: **OPEN — UI-1 hydration warnings /board** (pre-existing since 5/21, ไม่ block ship — ดู Low section).
>
> Previous: **2026-05-25** — ID-allocation Step 7 retire: ลบ `getNextId`/`getNextIds`/`getNextOrderId` + flag `ALLOCATE_IDS_IN_POSTGRES` จาก dashboard + Apps Script (api.ts/helpers.ts/auth.ts/Code.js). 6 routes mint จาก Postgres ตรงๆ. Gates ผ่าน Node 22 (type-check/lint/139 tests/build). Apps Script internal calls ใน write.ts ที่เหลือเป็น dead code (legacy `addOrder`/`addJob`/`bulkForward`/`createOrder` action handlers). ดู [migration-plan-id-allocation.md §7](migration-plan-id-allocation.md).
>
> Previous: **2026-05-22** — Hardening (A — ID-collision read-back guard · B2 — loadOrder over-fetch trim, `74ac78d`) + delta-fetch extended to /orders + /calendar (`88b31d7`, flag `NEXT_PUBLIC_DELTA_FETCH_LIST`). ปิด **PA-L1** (`74ac78d`) + **L3** (wontfix). scan v2 รันแล้ว — **DATA-orphan-order ×122 = confirmed false-positive** (ORPHAN_ORDER หายเกลี้ยง).
>
> Previous: **2026-05-21** — Delta-fetch P3 landed (`BoardClient` + `useDeltaSync`, flag `NEXT_PUBLIC_DELTA_FETCH`). ปิด **PA-H2** + **PA-M2** (`6412d5b`). เหลือ **PA-L1** (loadOrder over-fetch — minor, แยก session).
>
> Previous: **2026-05-20** — Delta-fetch P1+P2 landed (schema + bump triggers + delta endpoint + 9 tests). PA-H2/M2/L1 ยัง open รอ P3 client refactor (target session ถัดไป).
>
> Previous: **2026-05-19** — performance audit (penprinting-auditor) + quick wins. ปิด: PA-H1 (auto-sync idle hard-stop) · PA-M3 (nested-cache fallback) · M1 = invalid · PA-M4 = verified clean (index มีอยู่แล้ว). เหลือ open: PA-H2 · PA-M2 · PA-L1 (รอทำพร้อม delta-fetch). ดู "Perf audit — 2026-05-19" section.
>
> Previous: **2026-05-16** — `DATA-dateIn-double-encoded` root-caused via `/diagnose` → **accepted** (ไม่ใช่ `addOrder` แต่เป็น `objectToRow` Date bug, source fixed 2026-05-08; ดู Data integrity scan section). ไม่มี code/data fix — display self-corrects อยู่แล้ว.
>
> Previous: **2026-05-12** — **10 audit items closed across 5 commits today**:
>
> Morning batch (loadOrder refactor + cleanup):
> - ✅ M3-jobform-stale-toast (closure capture clarity, `7e9fa6b`)
> - ✅ M-restore-cancelled-parent (block restore at cancelled parent, `7e9fa6b`)
> - ✅ L2-currentactor-edge-comment (doc clarity, `7e9fa6b`)
> - ✅ L4-data-audit-modal-sales-no-action (hide button for non-admin, `7e9fa6b`)
> - ✅ M4 narrow `loadOrderFromPostgres` staleness gate to `['orders']` (`f4f3474`)
> - ✅ M1 drop redundant retry in `/api/track/lookup` (loadOrder ทำ fallback ในตัวอยู่แล้ว) (`f4f3474`)
> - ✅ L1/L2/L4 stale comments in print/page.tsx + track/lookup + loadOrder docstring (`c0be3b8`)
>
> Afternoon Sprint 1 (`6e46d82`) — 6 high-impact fixes:
> - ✅ PERF-F1 4 route-segment `loading.tsx` (board/orders/calendar/analytics)
> - ✅ A05-1 Security headers in `next.config.mjs`
> - ✅ PERF-B2 `allSettledLimit(cap=3)` on `/api/orders/update` cascade
> - ✅ A11Y-R1 `<main>` landmark + skip-link + global `focus-visible:` rule
> - ✅ A11Y-O2 Touch targets 44×44 (9 close buttons + MobileUserMenu + toast)
> - ✅ PERF-C1 Card `arePropsEqual` field-compare (no more JSON.stringify hot path)
>
> Afternoon Sprint 2 (`190c5fe`) — 4 security + a11y deeper fixes:
> - ✅ A04-1 /track 3-layer brute-force (Upstash IP + per-id PIN lockout + constant-time compare)
> - ✅ A09-1 Login audit logging + Sentry breadcrumb
> - ✅ A11Y-P1 Urgency badge contrast (URGENCY_BADGE Tailwind pair, 6 callsites)
> - ✅ A11Y-U2 Form errors `role="alert"` (login + track + ForwardDialog + Reassign + BulkActions)
>
> Previous: **2026-05-09** — ปิด 1 user-reported perf bug (`createOrder` missing from PATHS_BY_ACTION → order create perceived 15-60s instead of ~1.5s)
>
> Previous: **2026-05-08** — ปิด 9 (3 High + 5 Medium + 1 doc), defer 6 (M1, M3, L1-L4) ที่ audit เองแนะนำให้ defer
>
> ✅ = ปิดแล้ว / commit hash อยู่ในวงเล็บ
> ⏳ = ยังเหลือ
>
> Convention: tick checkbox + ใส่ commit hash + ย้ายลง "Closed" section หลังแก้

---

## 🔴 Critical

_(ไม่พบใน scan 2026-05-08)_

---

## 🟠 High

_(ปิดครบ — ดู Closed section)_

---

## 🟡 Medium (open — defer per audit recommendation)

### AI Quote Phase 1a — deferred (open, ปิดก่อนเปิด LINE channel 1b)
> Phase 1a = internal admin/sales tool (shared team inbox, ยังไม่เปิดลูกค้า). 3 item ข้างล่างยอมรับได้ตอน internal แต่ **ต้องปิดก่อน Phase 1b (LINE OA, ลูกค้าเข้าถึง session เอง)**.
- [x] ✅ **M3-aiquote-escalation-not-wired** (closed 2026-06-24) — **เลือก wire badge** (ไม่ลบ dead code). Extract pure `detectEscalation(quoteCount, reply)` ใน `run.ts` (no-quote + handoff wording) → `RunQuoteTurnOutput.escalated` เป็น source of truth เดียว → route เรียก `markEscalated(sess.id)` ตอน escalate (markEscalated promote เฉพาะ lead ที่ยัง 'ใหม่' → ไม่ทับ status ที่คนตั้งเอง). `/quote-leads`: STATUS_LABEL แปลง 'escalated'→"ต้องประเมินเอง" / 'abandoned'→"ถูกทิ้ง" + badge ส้ม "⚠ ต้องประเมินเอง" ในแถวลูกค้า. +5 test (detectEscalation + escalated output). `markEscalated` ไม่ใช่ dead code อีกต่อไป.
- [x] ✅ **M4-leadclaim-race** (closed 2026-06-24) — new `claimLead(id, user)` ใน `db.ts` = conditional `UPDATE ... WHERE assigned_to IS NULL` คืน `rowCount > 0`. `PATCH /api/ai-quote/leads/[id]` แยก claim path ออกจาก COALESCE `updateLead` → คืน **409 "มีคนหยิบงานนี้ไปแล้ว"** ถ้า 0 rows. Client `onClaim` จับ 409 → `load()` refresh โชว์ผู้ดูแลจริง.
- [x] ✅ **M5-loadsession-idor** (closed 2026-06-26 — **accepted for 1a + folded into Phase 1b spec + channel-guard prep**) — Phase 1a = shared team inbox (admin/sales ภายในเท่านั้น) → `loadSession` ไม่ผูก owner = **design ที่ตั้งใจ ไม่ใช่ช่องโหว่**; owner-binding ตอนนี้ = regression ของ shared inbox + ยังไม่มี identity model (v2 sign เป็น `admin:dashboard` หมด). IDOR จริงเกิดตอน LINE (1b) ที่ลูกค้าถือ `sessionId` ของตัวเอง — และ fix นั้น (ผูก LINE userId) **เป็นส่วนหนึ่งของ 1b เอง** (bind ก่อนสร้าง LINE identity ไม่ได้). **Decision (คุณนุ๊ก 2026-06-26):** (1) เขียน M5 เป็น **acceptance criterion ของ Phase 1b** ใน [design-ai-quoting.md §7](design-ai-quoting.md) (เซ็ต `line_user_id` + เช็ค sender ก่อนคืนบทสนทนา, mismatch→404) → 1b มี gate ในตัว ไม่ใช่ blocker แยก (2) **prep channel guard now (zero-regression):** staff chat route เรียก `loadSession(id, { channel: 'dashboard' })` → staff `sessionId` ↔ LINE `sessionId` cross-load กันไม่ได้ตั้งแต่ก่อน 1b ([`lib/ai-quote/db.ts`](lib/ai-quote/db.ts) loadSession + [route](app/api/ai-quote/route.ts)). session ปัจจุบันทั้งหมด `channel='dashboard'` → ไม่กระทบ behavior. 1b เพิ่ม owner-check ทับ channel scope.

- [x] ✅ **M1-card-memo-deep-compare** (closed 2026-05-19 — **invalid**) — item บรรยาย `app/board/card.tsx:459-489` ว่ามี `JSON.stringify`/deep-compare `a.order` — **โค้ดนั้นไม่มีแล้ว**. PERF-C1 (2026-05-12) ลบ `JSON.stringify` ออกไปแล้ว. comparator ปัจจุบัน [`card.tsx:552-612`](app/board/card.tsx:552) เป็น flat primitive compare (~20-25 scalar `!==` ต่อ card → ~1000-1250 ต่อ auto-sync tick = sub-ms บน iPhone, ไม่ใช่ปัญหา CPU). verified ผ่าน perf audit 2026-05-19. ไม่มี code fix — "รอ profiler" overcautious + profile ผิดจุด. **ตัวจริงที่ควร profile** = React reconciliation ของ 50-card tree ตอน parent re-render (PA-M2) ไม่ใช่ comparator.
- [x] ✅ **M3-jobform-stale-toast** (closed 2026-05-12) — snapshot `editId` at top of `onSubmit()` ใน `app/board/job-form.tsx`. Toasts ใช้ `editId` แทน `initial?.id` ตรง — closure ยังถูกต้องอยู่แล้ว แต่ explicit snapshot ทำให้ตามอ่านง่ายขึ้น + ป้องกัน future refactor ที่อาจ break.
- [x] ✅ **M-restore-cancelled-parent** (closed 2026-05-12) — `app/api/jobs/restore/route.ts` ตอน reattach parent order ตรวจ `orderResult.order.status === 'cancelled'` → return 409 message "ใบสั่งงาน #N ถูกยกเลิกแล้ว — กรุณา restore ใบสั่งงานก่อน หรือ recover ผ่าน data-audit modal".

---

## 🟢 Low (open — defer per audit recommendation)

### AI Quote Phase 1b-A (LINE) — Low (open, 2026-06-30)
- [x] ✅ **LOG-1-slip-diagnostic-verbose** (closed 2026-07-02, [`24f2e68`](https://github.com/witsarutnook/penprinting-dashboard/commit/24f2e68)) — ถอด diagnostic `console.log` 5 จุด (soak ครบ, flow นิ่ง, `slip_checks` metrics `2669ee8` ครอบ observability แล้ว): `webhook-router.ts` inbound / slip pre-filter / thunder result / reply sent + `slip.ts` isSlipImage haiku answer. **คง** error log ที่ `app/api/ai-quote/line/route.ts:69` (handleInbound — ของจริง). Line refs เดิมใน note นี้ (`:41/:49/:53/:60`) stale หลัง track-customer เลื่อนบรรทัด — grep ยืนยันจุดจริงก่อนลบ ([[feedback_audit_backlog_hypothesis]]).

### AI Quote Phase 1a — Low (open, 2026-06-23)
- [x] ✅ **L-aiquote-id-array-index** (closed 2026-06-26) — `saveQuote` คืน `ai_quotes.id` (`RETURNING id`) → route ใช้ `savedQuoteIds[i] ?? i` (real DB id ตอน persist; transient within-turn index ตอน plain chat ที่ยังไม่ save). client ปัจจุบันใช้ map-index เป็น React key อยู่แล้ว (ไม่เคยอ่าน `q.id`) → **zero behaviour change วันนี้** แต่ field truthful เมื่อ persist แล้ว.
- [x] ✅ **L-aiquote-run-comment-typo** (closed 2026-06-26) — comment `// throws on 401/500 → caller maps to 500` → **502** (route map compute throw เป็น 502 จริง — [route.ts:54](app/api/ai-quote/route.ts:54)). line drift จาก audit (73→104).
- [x] ✅ **L-dbmigrate-rowcount-newtables** (closed 2026-06-26) — เพิ่ม `ai_quote_sessions` + `ai_quotes` ใน counts array ของ `GET /api/admin/db-migrate` ([route.ts:393](app/api/admin/db-migrate/route.ts:393)).

- [ ] ⏳ **L1-bottomnav-iphonese-truncate** — `components/bottom-nav.tsx:31, 86-96` admin 5-col @ 320px → "หลังพิมพ์ / จัดส่ง" truncate. **Defer reason**: audit เองระบุ "Acceptable (icon carries meaning)" — รอ user feedback จาก iPhone SE จริง
- [ ] ⏳ **A11Y-board-form-label** (added 2026-06-05 during UI-1 incognito test) — DevTools Issues panel reports **100 "No label associated with a form field"** violations on `/board`. ไม่ใช่ hydration issue (Console clean ใน incognito) — แค่ a11y debt. ที่มาน่าจะเป็น kanban card checkboxes (bulk-mode "เลือกหลายงาน" — `components/board/bulk-actions-bar.tsx` + Column inputs) หรือ filter chips ขาด `aria-label`/`<label>`. **Defer reason**: 100 ตัวเลข axe ลึกอยู่ (ไม่ใช่ 100 unique field — count includes `<input>`/`<button role="checkbox">` ทุกใบใน board), block by user navigating to filter view + click "เลือกหลายงาน" → DevTools rescan. Severity low (no blocking screen reader behaviour, native inputs ยังมี implicit role). Bundle กับ dedicated a11y pass ครั้งหน้า.
  - **Partial (2026-07-06)** — grep ยืนยัน form field ที่ render ใน board base + toolbar surface (นอก modal) มีจริงแค่ 2 ตัว: `components/board/search-box.tsx` `<input type="search">` (มี `placeholder` แต่ไม่มี accessible name) + `components/board/bulk-actions-bar.tsx` `<select>` ปลายทางส่งต่อ. ทั้งคู่เพิ่ม `aria-label` แล้ว (`"ค้นหางาน"` / `"เลือกปลายทางส่งต่องานที่เลือก"`) — zero behaviour change. `filter-chips.tsx` = `<button>` ล้วน (ไม่ใช่ form field). ที่เหลือของ 100-count น่าจะมาจาก modal fields (order-form/job-form) + axe count semantics — **ยัง open** รอ DevTools rescan ตอน dedicated a11y pass.
- [x] ✅ **UI-1 /board hydration warnings** (closed 2026-06-05 — **wontfix, browser extension confirmed**) — Incognito A/B test ปิด root cause: โหมด incognito (no extensions) `/board` Console **clean ไม่มี React #422/#425**; โหมดปกติ (extensions เปิด) `Uncaught Error: Minified React error #422` + 6 console errors. Stack trace + sibling console messages เผยตัว extensions ที่ inject ก่อน hydrate: **Backpack wallet** (`Backpack was unable to override window.ethereum`), **Nightly Wallet** (`Nightly Wallet Injected Successfully`), **anti-phishing** (`Check phishing by URL: Passed.` + `[Revoke][antiphish]`). Crypto wallet content scripts override `window.ethereum` + DOM modifications ก่อน React hydrate → tree mismatch → React 18 recovers via CSR fallback. Static analysis วันนี้ก็ scan client-tree ลึก (`Date.now`/`Math.random`/`localStorage`/`window.`) ทุก /board client component — clean, ยืนยันว่าไม่ใช่ code issue. Outcome: no code fix possible (outside our control), recovery is automatic + non-functional. Parallel กับ [[feedback_sentry_extension_noise]] pattern. ดู memory note: `feedback_extension_hydration_noise.md`.
- [x] ✅ **L2-currentactor-edge-comment** (closed 2026-05-12) — `lib/api.ts` `currentActor()` docstring เขียนใหม่ชัดเจน: ระบุ 3 cases ที่ return undefined (no request context / edge import fail / no session) + อธิบาย service identity fallback path ของ Apps Script v5.10.1+.
- [x] ✅ **L3-edge-build-warnings** (closed 2026-05-22 — **wontfix**) — ตรวจ build จริง: เหลือ warning เดียว `⚠ Using edge runtime on a page currently disables static generation` — informational บรรทัดเดียวที่ **inherent กับ edge runtime** ลบไม่ได้นอกจากทิ้ง `export const runtime = 'edge'` ของ 3 routes (track/lookup + auth/login + auth/logout) ซึ่งเป็น optimization ที่ตั้งใจ (~150ms cold-start). ไม่มี Node-import leak (verified 2026-05-08). ไม่มีอะไรให้แก้.
- [x] ✅ **L4-data-audit-modal-sales-no-action** (closed 2026-05-12) — `app/orders/data-audit-modal.tsx` `DataAuditButton` return null ถ้า `!isAdmin` → sales/staff ไม่เห็นปุ่มอีกแล้ว. Page-level role gate ของ /orders ยัง admin+sales เหมือนเดิม.

---

## ⚡ Perf audit — 2026-05-19 (penprinting-auditor, perf-only scope)

Performance-only audit หลัง Phase 4.2 close-out. ผล: **0 critical · 2 high · 3 medium · 1 low**. Hot path โดยรวมสภาพดี — cache coalescing (2026-05-18), recharts route-split, card lazy-loading verified clean.

- [x] ✅ **PA-H1-autosync-idle-leak** (closed 2026-05-19, `c43999b`) — `lib/auto-sync.tsx` backoff (15s→30s→120s) ไม่เคยถึง 0 → tab ที่เปิดทิ้งข้ามคืน fire ~720 `router.refresh()`/คืน (server re-render + stream board HTML กลับทุกครั้ง). Fix: เพิ่ม hard-stop — idle > 30 นาที หยุด poll สนิท, resume เมื่อ user input / tab re-visibility (resume refresh ทันที 1 ครั้ง = ไม่เสีย freshness).
- [x] ✅ **PA-H2-loadall-overfetch** (closed 2026-05-21, `6412d5b`) — เดิม `/board` ดึงครบ 5 ตารางผ่าน `loadAllFromPostgres` (ลาก `shipped`+`cancelled` history เปล่า). Delta-fetch P3 ทำ /board bootstrap ด้วย `loadBoardDelta(null)` — อ่านแค่ `jobs`+`orders`. มีผลเมื่อ `NEXT_PUBLIC_DELTA_FETCH=1` (flag-OFF /board ยังใช้ `loadAll()` เดิม). หน้าอื่น (orders/analytics ฯลฯ) ใช้ตารางครบจริง — ไม่ใช่ over-fetch.
- [x] ✅ **PA-M2-parent-rerender-churn** (closed 2026-05-21, `6412d5b`) — เดิม `router.refresh()` ทุก tick rebuild `KPIBar`/`BoardToolbar` แม้ snapshot ไม่เปลี่ยน. Delta-fetch P3: `mergeDelta` คืน state reference เดิมเมื่อ delta ว่าง → `useMemo(computeBoard)` ไม่ recompute → idle tick ไม่ re-render เลย. มีผลเมื่อ flag ON.
- [x] ✅ **PA-M3-nested-cache-fallback** (closed 2026-05-19, `f82734f`) — `loadAllSnapshot` ([`lib/api.ts:132`](lib/api.ts)) Apps Script fallback เรียก `get('loadAll')` ด้วย default `fetch` cache 60s ขณะรันใน `loadAllCached` (`unstable_cache` 15s + tag) → cache ชั้นที่ 2 ที่ไม่ถูก tag → `revalidateTag(LOAD_ALL_TAG)` บัสต์ไม่ถึง = write ตอน Postgres ล่มไม่โผล่นานสุด 60s. Fix: pass `{ revalidate: 0 }` ให้ `get()` → outer `unstable_cache` เป็น cache + invalidation ชั้นเดียว.
- [x] ✅ **PA-M4-auditlog-index** (closed 2026-05-19 — **no action, verified clean**) — index มีอยู่แล้ว: [`db-migrate/route.ts:52`](app/api/admin/db-migrate/route.ts:52) สร้าง `idx_audit_target ON audit_log(target_id, timestamp DESC)`. query ใน `getAuditByTargetFromPostgres` เป็น `target_id = X OR target_id = Y` บน column เดียว (`::bigint IS NOT NULL` guard constant-fold) → planner ใช้ BitmapOr ของ 2 index scan = indexed ไม่ seq-scan. auditor flag เพราะมองไม่เห็น migration route.
- [x] ✅ **PA-L1-loadorder-overfetch** (closed 2026-05-22, `74ac78d`) — `loadOrderFromPostgres`/`loadOrder` มี opt `orderOnly`. caller 4 ตัวที่อ่านแค่ `.order` (print page · tracking-card · `/api/orders/raw` · restore parent-status check) flip เป็น `orderOnly:true` → รัน **1 query แทน 4**. full-shape path (`/track`) คง 4-parallel เดิม — ไม่มี latency เพิ่ม. +2 tests.

Verified clean: loadAll coalescing + `revalidateTag`, auto-sync guards, recharts route-split, `html-to-image`/`qrcode` leaf-only, card lazy-loading, `React.memo` card comparator (= M1 invalid), `BulkModeProvider` `useMemo`, `computeBoard` single-pass. `computeBoard` GC churn = หายเองเมื่อ PA-H1+PA-M2 ลง.

---

## 🔬 Data integrity scan — 2026-05-15 (`runPhase2IntegrityScan`)

Proactive 9-dimension scan ของ Google Sheet หลัง Phase 2 live ~2 อาทิตย์. Scan file: `production-monitoring/_scan-phase2.gs`. Counts: orders=171 jobs=41 shipped=115 cancelled=28. Result: **0 critical / 1 high / 2 medium / 0 low**.

- [x] ✅ **DATA-dateIn-double-encoded** (closed 2026-06-04 — applied via [`608f145`](https://github.com/witsarutnook/penprinting-dashboard/commit/608f145) `/api/admin/fix-date-anomaly?apply=1`): 3 orders × 2 fields = 6 cells normalized (dateIn + dateDue, Bangkok TZ math verified `17:00Z + 7h = 00:00 Bangkok next day → DD/MM/YYYY +1`). Data layer ตอนนี้สะอาด 100%, display ไม่ต้องพึ่ง `displayDate()` unwrap quote อีก. **Original root-cause (verified 2026-05-16, /diagnose)**: ❌ ไม่ใช่ `addOrder` อย่างที่เดาไว้ — ตัวการคือ Apps Script `objectToRow()` ([helpers.ts:45](apps-script/dashboard/helpers.ts) ใน production-monitoring) ที่เดิมไม่มี Date guard. `cancelOrder` ([write.ts:591-611](../production-monitoring/apps-script/dashboard/write.ts)) + `promoteDraft` ([write.ts:743-761](../production-monitoring/apps-script/dashboard/write.ts)) อ่าน order row ด้วย `getValues()` (date cell → JS `Date`) → flip status → เขียนกลับผ่าน `objectToRow` → `Date` ตก catch-all `typeof==='object'` → `JSON.stringify(date)` → quoted ISO. **Source fixed 2026-05-08** — `helpers.ts:49` มี `if (val instanceof Date) return val;` → post-fix สร้าง corruption ใหม่ไม่ได้. 3 rows = legacy residue ที่เคย accepted (display ไม่พัง) → 2026-06-04 fix endpoint shipped + applied ตามที่ Migration note เคยระบุไว้.
- [~] **DATA-orphan-cancelled** ×4 — cancelled rows อ้าง orderId ที่หายไป (202604024 "ใบปลิวสาขา", 202604068 "สสส", 202605039 "test", 202605055 "หหหห"). **In progress**: cleanup helper `production-monitoring/_cleanup-orphan-cancelled.gs` เขียนแล้ว, รอ user รัน (2 test rows ลบได้, 2 เก่ารอตัดสิน historical).
- [closed false-positive] **DATA-orphan-order** ×122 — **ยืนยันแล้วว่าไม่ใช่ data bug** (scan v2 run **2026-05-22**). scan v1 check แค่ `jobs` sheet → orders status="sent" ที่ jobs ส่งของหมดแล้ว (อยู่ใน `shipped`) ถูก flag ผิด. scan v2 ([`_scan-phase2.gs`](../production-monitoring/_scan-phase2.gs) §3) cross-ref `jobs∪shipped∪cancelled` → รันแล้ว **ORPHAN_ORDER หายเกลี้ยง** = false-positive 122 ตัวคือ artifact ของ scan v1 ล้วน.

---

## 🔬 Data integrity scan v2 — 2026-05-22 (`runPhase2IntegrityScan`)

Re-run หลังแก้ scan ([`_scan-phase2.gs`](../production-monitoring/_scan-phase2.gs) v2 — §3 cross-ref `jobs∪shipped∪cancelled`, §6 เพิ่ม `INVALID_DATEDUE`). Counts: orders=218 jobs=53 shipped=148 cancelled=30. Result: **0 critical / 0 high / 2 medium / 0 low**.

- ✅ **scan v2 fixes verified** — `ORPHAN_ORDER` หายเกลี้ยง (false-positive 122 ของ v1 = gone) · `INVALID_DATEDUE` จับ orders 202605046/047 (เดิม scan gap)
- [~] **DATA-orphan-cancelled** ×4 — เจอชุดเดิม (202604024/202604068/202605039/202605055). cleanup helper `cleanupOrphanCancelled` push ขึ้น Apps Script editor แล้ว — รอ user รัน (2 test rows ลบได้, 2 historical รอตัดสิน)
- [x] ✅ **DATE_ANOMALY ×7** (closed 2026-06-04 — same fix as DATA-dateIn-double-encoded) — 3 orders × 2 date fields (dateIn + dateDue) normalized via `fix-date-anomaly?apply=1`. `INVALID_DATEDUE` scan check ของ v2 จะ return clean หลังจากนี้

---

## ✅ Closed — Bug Hunt 2026-05-09 (user-reported, found via static analysis)

- [x] **createOrder-cache-bust-missing** — `lib/api.ts:160` PATHS_BY_ACTION map ไม่มี entry สำหรับ `createOrder` action (fast-path สำหรับ POST /api/orders/add ตั้งแต่ commit `a184254` 2026-05-07). ทุก atomic action อื่น (`cancelOrder`, `deleteOrderCascade`, `promoteDraft`, `bulkForward`) อยู่ครบ. **Effect**: หลัง user submit ใบสั่งงานใหม่ — Apps Script atomic write done ใน ~1.5s แต่ /board + /orders ยังโชว์ snapshot เก่า (60s ISR cache + ❌ no revalidatePath). New order appears เมื่อ ISR expire (worst 60s) หรือ auto-sync coincides with expiry (best 15s). Closed `e88f386` — เพิ่ม `createOrder: ['/board', '/orders', '/orders/new', '/calendar', '/analytics']` (union ของ addOrder + addJob path lists). **Lesson** [should add to memory]: audit เวลาเพิ่ม atomic Apps Script action ใหม่ที่ replace multi-call legacy → ตรวจ PATHS_BY_ACTION map ด้วย เสมอ มิฉะนั้น cache invalidation จะหาย.

---

## ✅ Verified clean (2026-05-08 scan)

- Edge runtime `/api/track/lookup` + `/api/auth/{login,logout}` — ไม่มี Node-only imports หลุด, `next/headers`/`next/cache` lazy-import ใน `post()` เท่านั้น (ไม่ถูก reach โดย edge GET)
- `audit=0` default — เฉพาะ `lib/analytics.ts` consume; `app/analytics/page.tsx` ใช้ `loadAllWithAudit` ตรง
- `bulkForward` callers — forward-undo ใช้ `id: 0` ถูก
- `MobileUserMenu` z-index — z-40 ต่ำกว่า toast (z-60) + native `<dialog>` top layer
- Bottom-nav role-stripped — `getMoreMenuGroups` ใช้ `canSee` gate ทั้ง sidebar + sheet
- 6-step timeline happy paths — graphic/print/post map ตรง, cancelled collapse 2-6, shipped mark all done
- Atomic fast-path/legacy fallback — fall back เฉพาะ `Unknown action`; network/lock/validation errors surface ทันที
- Auto-sync passive listeners cleanup — 5 listeners + BroadcastChannel + setTimeout removed ถูก
- JobForm + commit() pattern — closures ถูก, no cross-component state leakage
- Restore admin gate — `requireSession(['admin'])` ตรง Apps Script `ROLE_REQUIREMENTS.restoreJob`

---

## ✅ Closed — Batch 5 (2026-05-08 scan close-out)

Commit `57ca976` — "fix: audit close-out 2026-05-08 — H1+H2+H3 + 5 medium" — 11 files, +213/-57

- [x] ✅ **H1-recover-orphan-double** (`57ca976`) — `app/api/jobs/add/route.ts` ใส่ idempotency check ก่อน addJob: ถ้ามี orderId ใน body, fetch loadAllFresh และ reject 409 ถ้ามี active (non-cancelled) job ผูกอยู่แล้ว. Closes data-audit modal double-tap window.
- [x] ✅ **H2-promotedraft-fallthrough-double-write** (`57ca976`) — `app/api/orders/promote-draft/route.ts` reject `{ok:true}` without jobId ด้วย 502 (Apps Script regression) แทน fall-through ที่จะ double-write
- [x] ✅ **H3-restore-trust-client** (`57ca976`) — `app/api/jobs/restore/route.ts` always read row from Sheet (cached `loadAll` when src provided + fresh fallback), verify `src.name === cj.name` ก่อน restore. ใช้ 409 ถ้า mismatch
- [x] ✅ **M2-jobform-dead-busy** (`57ca976`) — `app/board/job-form.tsx` ใส่ `submittedRef` guard ที่ block re-entry, ลบ dead `busy` state + unused `disabled` props ออกจาก submit/cancel buttons
- [x] ✅ **M4-track-currentdept-null-inconsistent** (`57ca976`) — `app/api/track/lookup/route.ts` เมื่อ currentDept null collapse status เป็น 'received' (no contradictory "overdue red" badge above empty 6-step timeline)
- [x] ✅ **M5-cascade-fallback-no-concurrency-cap** (`57ca976`) — `app/api/orders/{cancel,delete}/route.ts` ใช้ `allSettledLimit(cap=3)` แทน `Promise.allSettled` แบบ unbounded. New `lib/concurrency.ts` zero-dep helper
- [x] ✅ **M6-mobileusermenu-overlap-sticky** (`57ca976`) — `app/orders/page.tsx` sticky header ใช้ `pl-4 pr-12 sm:pl-6 sm:pr-6` reserve space สำหรับ MobileUserMenu บน mobile widths
- [x] ✅ **M7-autosync-settimeout-race** (`57ca976`) — `lib/auto-sync.tsx` ใส่ `unmounted` flag ใน self-rescheduling tick chain. Cleanup เซ็ต flag + clearTimeout
- [x] ✅ **M8-pathsbyaction-stale-comment** (`57ca976`) — `lib/api.ts` แก้ comment `/board uses audit (undo)` ให้สะท้อนว่า audit ถูก drop ใน round 5 (undo flow ใช้ client snapshots)

---

## ✅ Verified clean (no action needed)

- C1 race close-out — forward/bulk-forward/forward-undo/promote-draft ใช้ atomic `getNextId` (เหลือแค่ /api/jobs/add → ดู C1r)
- C2 tracking-card QR — `TRACK_BASE_URL=https://dashboard.penprinting.co/track` ตรงกับ /track + footer
- C4 stuck dragging flag — cleanup ทั้ง onUnmount + handleDragEnd
- C5 promote-draft idempotent — เช็ค `existingJob` skip addJob
- H1 `/api/track/lookup` rate-limit — signed cookie pattern
- M2 lazy raw — `/api/orders/raw/[id]` admin+sales gate
- M5 bulk-forward 25 cap — `BULK_MAX_SELECT=25` + server enforce
- Permission gates ตรง PATTERNS §2 contract
- Cascade-cancel + cascade-rename
- Duplicate detection (409 + force flag)
- Cowork string[] + dept-print enforcement + guest fan-out (violet)
- Drag MIME types separation + onDragOver matching
- Auto-sync guards (visibility + dialog + input-focus + dragging)
- `revalidatePath` หลัง writes
- `displayDate` 3 formats (ISO/DDMM/Date.toString)
- DashboardShell mounts Toast+Confirm providers
- Mobile sticky/z-index stacking (nav z-30, bulk z-40, undo z-50, toast z-[60])
- L7 cancel→restore cowork loss (documented constraint, schema deferred)
- PageSizeBar pure non-'use client' module

---

## ✅ Closed

### Batch 4 — cosmetic cleanup (5 Low)
2026-05-06 PM (1 commit — see git for hash)

- [x] **L-emoji-1** — `app/board/order-form.tsx` "ดึงงานเก่า" button uses `IconRefreshCw` (animate-spin) for loading + `IconArrowLeft` for idle. No more `⏳` / `↩` glyphs.
- [x] **L-emoji-2** — `app/orders/[id]/tracking-card/client.tsx` PIN-warning chip uses `IconAlertTriangle`. No more `⚠`.
- [x] **L-emoji-3** — false positive at the time of audit. `app/board/card.tsx` already uses icon components in the undo toast.
- [x] **L-logout-broadcast** — `app/analytics/logout-button.tsx` calls `broadcastWrite('/api/auth/logout')` before redirect. Other tabs see the channel and clear stale username on next sync tick.
- [x] **L-dead-1** — `app/board/column.tsx` dropped the IIFE + `void list` dead-code. `sourceStaffLabel` is now a plain `const`. Also removed the now-unused `STAFF` import.
- [x] **L-dead-2** — `app/orders/orders-table.tsx` removed the unused `jobDeptStaffLabel?` field from `OrderRow` (declared, never set, never read).

### Batch 3 — perf / security / data integrity (4 Medium)
2026-05-06 PM (1 commit — see git for hash)
⚠️ M-bulk-forward-N-roundtrips ต้อง deploy Apps Script ก่อน — รัน `production-monitoring/apps-script/dashboard/push.sh` แล้ว Apps Script editor → Manage deployments → Edit existing → New version. Vercel side มี backwards-compat fallback (loop getNextId) จนกว่า Apps Script จะ deploy.

- [x] **M-bulk-forward-N-roundtrips** — เพิ่ม `getNextIds(count)` action ใน Apps Script (helpers.ts + google-apps-script.js dispatch + audit-skip). `app/api/jobs/bulk-forward/route.ts` ใช้ batch call แทน loop — 25 items × 1 round-trip แทน 25. Backwards-compat fallback ครอบ catch ที่ Apps Script ยังไม่มี action นี้.
- [x] **M-login-ratelimit-map** — ported `attachRateCookie` pattern (cookie name `pp_login_rl`, path `/api/auth`, 5min/5 attempts) จาก `/api/track/lookup`. State stable across Vercel cold starts. Successful login clears cookie. Rate cookie expires when window does so browser GC's it.
- [x] **M-orders-date-range-tz** — เปรียบเทียบ date เป็น YYYY-MM-DD strings ใน `Asia/Bangkok` zone (Intl.DateTimeFormat 'en-CA') แทน Date object compare. ไม่มี off-by-day boundary bug เพราะ lexical string compare = timezone-free.
- [x] **M-jobByOrderId-last-write-wins** — เก็บ array ของ jobs ต่อ orderId แทน Map<id, job>. แสดง lowest job id เป็นหลัก + "(+N)" suffix เมื่อ order มี job มากกว่า 1.

### Batch 2 — UX / middleware (3 Medium)
2026-05-06 PM (1 commit — see git for hash)

- [x] **M-photobook-tab** — `app/board/order-form.tsx` Photobook segment click now also `setTab('main')`. Switching from "งานหลังพิมพ์" to Photobook no longer leaves the body blank.
- [x] **M-middleware-matcher** — `middleware.ts` matcher now covers `/orders/* /shipped/* /cancelled/*` in addition to the original four. Defence-in-depth — page-level `verifySession()` is preserved.
- [x] **M-cross-dept-gate** — `app/board/card.tsx` drag payload now carries `application/x-job-source-staff`; `app/board/column.tsx` reads it and passes to `computeFromType(sourceDept, sourceStaff)`. False-negative reject (e.g. dragging print:cut → post:bind) is gone — fromType resolves to the correct FW_TARGETS bucket instead of falling through to `any`.

### Batch 1 — regression cleanup (Critical + 5 High)
2026-05-06 PM (1 commit — see git for hash)

- [x] **M14r** — `lib/photobook.ts` `orderFormFromRaw` reads from `r.photobook` fallback, not just `r.photobookItems`. Edit/duplicate of post-M14 photobook orders no longer drops items.
- [x] **H10a** — `app/board/order-form.tsx` reset/saveAsTemplate/deleteTemplate now use `useConfirm()` + `useConfirm().prompt()`. Themed dialogs replace native `confirm()`/`prompt()`.
- [x] **H10b** — `app/board/order-form.tsx` "ไม่พบงานเก่า" + "ดึงข้อมูลล่าสุดไม่สำเร็จ" now use `useToast().error()` instead of native `alert()`.
- [x] **H10c** — `app/orders/[id]/edit/client.tsx` promote-draft confirm now uses `useConfirm().confirm()`.
- [x] **C1r** — `/api/jobs/add` swapped from `loadAllFresh().nextId` (cached) to atomic `post('getNextId', {})` action. Matches forward/bulk-forward/promote-draft pattern. Two concurrent "งานเดี่ยว" submits no longer race.
- [x] **H2r** — `app/track/client.tsx` client gate `< 6` → `< 3`, aligns with H1 server fix (`/api/track/lookup` accepts `id.length >= 3`). Legacy 4-digit ids work again.

---

## 🎯 ปิดครบ — เหลือไว้ track audit รอบถัดไป

ทุก finding จาก audit รอบ 2026-05-06 ปิดหมดแล้ว. ไฟล์นี้ยังคงเป็น running log ของ audit findings ในอนาคต — เมื่อรัน `/audit` รอบใหม่:

1. เพิ่มหมวดใหม่ที่ด้านบน (Critical / High / Medium / Low) ตามรูปแบบเดิม
2. แก้ตามลำดับ batch
3. Tick `[x]` + ย้ายลง Closed section ทันทีหลังแก้
4. อัปเดต `Latest update` date-stamp ที่ header

## 📝 Update protocol

หลังแก้แต่ละข้อ:
1. Tick checkbox `[x]`
2. ใส่ commit hash ในวงเล็บ
3. ย้ายลง "Closed" section
4. อัปเดต date-stamp ด้านบน
