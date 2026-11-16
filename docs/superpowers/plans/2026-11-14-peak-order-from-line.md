# `/order` — Work Order from Peak Quotation via Staff LINE Group — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff type `/order …` in an allow-listed LINE group; the bot reads a quotation from Peak (MCP, read-only), walks them through unit → graphic → forward-to-print → due date with Flex buttons, then creates the work order on /board or saves it as a dashboard draft.

**Architecture:** A deterministic command bot — no LLM anywhere. `lib/peak/*` owns the Peak connection (OAuth token store with rotating refresh, minimal MCP client, three typed read tools). `lib/peak-order/*` owns the LINE flow (command parser, resolver, draft state machine in Postgres, per-line link table for idempotency, Flex builders). Order creation is extracted from the `orders/add` route into `lib/orders-create.ts` so the form and the LINE flow share one code path.

**Tech Stack:** Next.js 15 App Router (Node runtime), `@vercel/postgres` `sql` tagged template, vitest (node env, DI + `vi.mock`), LINE Messaging API (Flex + postback + datetimepicker), Peak MCP over Streamable HTTP. **No new npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-11-14-peak-order-from-line-design.md` (read it first). Peak facts verified by probe: `../peak-integration/peak-mcp/README.md` (workspace vault, outside this repo) — working reference client: `../peak-integration/peak-mcp/peak-search.mjs`.

## Global Constraints

- Branch `feat/peak-order-line`. The pre-commit hook runs `npm run type-check && npm run lint && npm test` — every commit must be green. If a git/test output looks wrong, re-run through `rtk proxy <cmd>` (the shell hook can distort output).
- No LLM/Anthropic call in any new code path. No new npm dependency.
- Peak tools callable from code: **only** `get_quotation`, `list_quotation`, `search_contacts` (snake_case). OAuth scope requested: **`mcp:read`** only.
- Never log, return, or put in an error message: access token, refresh token, PKCE verifier, encryption key. Log QO codes and timings only.
- Peak data is untrusted text: render as text, truncate before putting in Flex, never interpret.
- `POST /api/orders/add` behaviour and response bodies must not change (Task 1 pins them first).
- Feature is off unless `PEAK_ORDER_ENABLED === 'true'` **and** `PEAK_ORDER_GROUP_IDS` non-empty **and** `PEAK_TOKEN_ENC_KEY` set. Off / other group / room / 1-on-1 ⇒ exactly today's behaviour (group text → `ignore`; group postbacks dropped).
- New server modules start with `import 'server-only';`. Tests live in `tests/<area>-<topic>.test.ts`; DB modules are tested with `vi.mock('@/lib/postgres', () => ({ sql: (...a) => sqlMock(...a) }))` (see `tests/registrations.test.ts`); routes with `vi.mock` of their deps (see `tests/orders-update-locked.test.ts`).
- Dates: Bangkok calendar days via `bangkokTodayISO()` / `toISODate()` from `@/lib/jobs`. Date logic tests must pass under both `TZ=UTC` and `TZ=Asia/Bangkok`.
- User-facing copy is Thai, polite, short. Button labels below are fixed by the spec; other wording is the implementer's.
- Orders are never hard-deleted in v2. "Linked order is dead" means: no `orders` row, or `orders.status = 'cancelled'`.
- Commit style: conventional commits like the repo (`feat(peak): …`, `test(...)`, `refactor(orders): …`), ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

Input classes the spec implies but states no test for — each is pinned by a test in the task that owns the code:

1. **Quotation line with an empty / whitespace-only / very long description** → name falls back to `(ไม่มีชื่อรายการ)`, cards truncate, `notes` keeps the full text (Task 8 mapper, Task 11 flex).
2. **Quantity that is not a plain integer** (`0.125`, `12.5`, `0`, `null`) → `qty` is a clean decimal string with no float noise, or `''` for 0/null; such a unit still walks the unit step and its summary shows no quantity (Task 8, Task 12, Task 13).
3. **Group event with no `userId`** (LINE omits it for some clients) → reply "ระบุตัวผู้ใช้ไม่ได้", nothing created, no draft row (Task 12).
4. **Date from the picker that is in the past or malformed** (client ignored `min`, or a forged postback) → stay on the date step with a short message (Task 13).
5. **Quotation changed in Peak between sessions / zero lines / link rows for line keys that no longer exist** → zero lines is refused; unknown link keys are ignored; "remaining" = current lines without a live link (Task 12).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/order-constants.ts` *(new)* | `ORDERERS`, `QTY_UNITS` — single source for form + LINE |
| `lib/orders-create.ts` *(new)* | `createOrderFromForm()` — validation, PIN, dedupe, id minting, insert, audit, revalidate; returns data, not `NextResponse` |
| `app/api/orders/add/route.ts` *(modify)* | thin wrapper: auth + JSON + result → HTTP |
| `lib/peak/oauth.ts` *(new)* | Peak OAuth HTTP calls: register client, PKCE, authorize URL, code exchange, refresh; typed errors |
| `lib/peak/crypto.ts` *(new)* | AES-256-GCM encrypt/decrypt of token strings |
| `lib/peak/token-store.ts` *(new)* | `peak_oauth` row: client id, encrypted tokens, single-flight refresh, health fields |
| `lib/peak/mcp-client.ts` *(new)* | Streamable-HTTP JSON-RPC: initialize, tools/call, SSE/JSON parse, 404 re-init, 401 refresh |
| `lib/peak/read.ts` *(new)* | Typed readers: `getQuotation`, `listQuotations`, `newestQuotations`, `getContactName` |
| `lib/peak-order/command.ts` *(new)* | Pure parser for `/order …` |
| `lib/peak-order/resolve.ts` *(new)* | Command → one quotation / choices / not-found |
| `lib/peak-order/mapper.ts` *(new)* | Quotation → unit plans → order form body |
| `lib/peak-order/postback.ts` *(new)* | Postback data encode/decode + prefix |
| `lib/peak-order/db.ts` *(new)* | `peak_order_staff`, `peak_order_drafts`, `peak_order_links` access (gates, claims) |
| `lib/peak-order/flex.ts` *(new)* | Pure Flex builders + text fallbacks |
| `lib/peak-order/handler.ts` *(new)* | Orchestration: command entry + postback state machine |
| `lib/peak-order/deps.ts` *(new)* | Env config + real-dependency wiring |
| `lib/ai-quote/channels/{types,line}.ts`, `lib/ai-quote/webhook-router.ts`, `app/api/ai-quote/line/route.ts` *(modify)* | Let `/order` text + its postbacks from allowed groups through; inject handler |
| `app/api/admin/peak/{connect,callback,test,staff}/route.ts`, `app/peak/page.tsx`, `app/peak/peak-client.tsx` *(new)*; `middleware.ts`, `components/nav-config.ts` *(modify)* | Admin connect/test/status/staff-mapping UI |
| `app/api/cron/peak-keepalive/route.ts` *(new)*, `vercel.json` *(modify)* | Daily refresh + health check + alert |
| `app/api/admin/db-migrate/route.ts` *(modify)* | 4 new tables |

---

### Task 1: Extract order creation + shared constants

**Files:**
- Create: `lib/order-constants.ts`, `lib/orders-create.ts`, `tests/orders-add-route.test.ts`, `tests/orders-create.test.ts`
- Modify: `app/api/orders/add/route.ts` (whole file becomes a wrapper), `app/board/order-form.tsx:24` (`ORDERERS`) and `:109` (`QTY_UNITS`) → import from `@/lib/order-constants`

**Interfaces:**
- Produces:
```ts
// lib/order-constants.ts (no 'server-only' — imported by a client component)
export const ORDERERS: readonly string[];   // ['นุ๊ก','กิ๊ฟ','เจี๊ยบ'] — moved verbatim
export const QTY_UNITS: readonly string[];  // ['แผ่น','ชุด','เล่ม','กล่อง','ถุง','ห่อ','ชิ้น','ซอง','แฟ้ม'] — moved verbatim

// lib/orders-create.ts
export type CreateOrderBody = Partial<OrderFormData> & { force?: boolean; price?: string | number; status?: string; [extra: string]: unknown };
export interface OrderActor { role: string; user: string }
export type CreateOrderResult =
  | { ok: true; orderId: number; jobId: number | null; pin: string; orderType: 'normal' | 'photobook'; draft: boolean }
  | { ok: false; kind: 'validation'; status: 400; error: string }
  | { ok: false; kind: 'duplicate'; status: 409; duplicates: DuplicateOrderHit[]; message: string }
  | { ok: false; kind: 'failure'; status: 500 | 502; error: string };
export async function createOrderFromForm(body: CreateOrderBody, actor: OrderActor): Promise<CreateOrderResult>;
```

- [ ] **Step 1: Characterization tests for the route as it is today** — `tests/orders-add-route.test.ts`. Mock `@/lib/route-helpers` (`requireSession` → `{ role: 'sales', user: 'กิ๊ฟ' }`), `@/lib/id-allocation` (`mintOrderId` → `2611001`, `mintJobId` → `9001`), `@/lib/postgres-write` (`createOrderInPostgres`, `findDuplicateOrdersInPostgres` → `[]`, `appendAuditToPostgres`, `PostgresWriteError`), `next/cache`. Base body: `{ name: 'ใบปลิว A5', customer: 'ร้านเอ', dateDue: '2026-11-20', orderer: 'กิ๊ฟ', assignStaff: 'pook' }`. Cases and exact expectations:
  - no `name` → 400, `error` contains `กรุณาระบุชื่องาน`
  - non-draft missing customer/dateDue/orderer/assignment → 400, `error` contains all four messages joined by ` • `
  - `assignStaff: 'zzz'` → 400 `กราฟฟิก "zzz" ไม่ถูกต้อง`; `forwardPrint: 'zzz'` (no graphic) → 400 `ส่งต่อพิมพ์ "zzz" ไม่ถูกต้อง`
  - success → 200 body `{ ok: true, orderId: 2611001, jobId: 9001, orderType: 'normal' }` + `pin` matching `/^\d{4}$/`, and **no `draft` key**; `createOrderInPostgres` got `order.status 'sent'`, `assignDept 'graphic'`, `assignStaff 'pook'`, `job: { name, date: '2026-11-20', staff: 'pook', dept: 'graphic', status: 'pending' }`, `order.details` deep-equals `order.rawData`, snapshot has `pin`, has no `force`/`status`
  - `forwardPrint: 'sm74'` without graphic → `assignDept 'print'`, `assignStaff 'sm74'`
  - both set → graphic wins; snapshot keeps `forwardPrint: 'sm74'`
  - an unknown extra key in the body (`peak: { code: 'QO-1' }`) is preserved in the snapshot
  - `findDuplicateOrdersInPostgres` → `[{ id: 5, … }]` → 409 `{ error: 'duplicate', duplicates: [...] }`, mint not called; same body + `force: true` → 200
  - dedupe scan throws → still 200
  - `status: 'draft'` with only `name` → 200 with `draft: true`, `jobId: null`, `mintJobId` not called, dedupe not called, `order.status 'draft'`, `job: null`
  - `mintOrderId` rejects → 502, `error` starts with `id allocation failed`
  - `createOrderInPostgres` rejects → 500, `error` starts with `createOrder failed`
  - audit called once with `{ action: 'createOrder', role: 'sales', user: 'กิ๊ฟ', targetId: 2611001 }`
- [ ] **Step 2: Run** `npx vitest run tests/orders-add-route.test.ts` — Expected: PASS against the unmodified route (if a case fails, the test is wrong — fix the test, not the route).
- [ ] **Step 3: Write `tests/orders-create.test.ts`** (same mocks, no `route-helpers`): one case per `CreateOrderResult` arm asserting the discriminated shape (`kind`, `status`, and `draft: false` on a normal success / `draft: true` on a draft).
- [ ] **Step 4: Run** `npx vitest run tests/orders-create.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 5: Implement.** Move everything after the JSON parse in the route (header validation through the cache bust) into `createOrderFromForm`, returning `CreateOrderResult` instead of `NextResponse`. The route keeps: `requireSession(['admin','sales'])`, JSON parse (400 `Invalid JSON`), then maps the result: success → `{ ok: true, orderId, jobId, pin, orderType, draft: r.draft || undefined }`; validation → `{ error }`; duplicate → `{ error: 'duplicate', duplicates, message }`; failure → `{ error }`, each with `r.status`. Keep `export const maxDuration = 30`.
- [ ] **Step 6: Move the two constants** to `lib/order-constants.ts`; `order-form.tsx` imports them (delete the local declarations, keep the JSDoc on the new file).
- [ ] **Step 7: Run** `npx vitest run tests/orders-add-route.test.ts tests/orders-create.test.ts && npm run type-check` — Expected: PASS, no type errors.
- [ ] **Step 8: Commit** `refactor(orders): extract createOrderFromForm + shared ORDERERS/QTY_UNITS (no behaviour change)`

---

### Task 2: Peak OAuth HTTP layer

**Files:**
- Create: `lib/peak/oauth.ts`, `tests/peak-oauth.test.ts`

**Interfaces:**
- Produces:
```ts
export const PEAK_MCP_BASE = 'https://mcp.peakaccount.com';
export const PEAK_MCP_URL = 'https://mcp.peakaccount.com/mcp';
export const PEAK_REDIRECT_URI = 'https://dashboard.penprinting.co/api/admin/peak/callback';
export const PEAK_SCOPE = 'mcp:read';
export interface PeakTokenSet { accessToken: string; refreshToken: string; expiresInSec: number; scope: string | null }
export class PeakAuthError extends Error {}         // Peak rejected us — reconnect needed
export class PeakUnavailableError extends Error {}  // network / 5xx / timeout — retry later
type FetchLike = typeof fetch;
export async function registerPeakClient(f?: FetchLike): Promise<{ clientId: string }>;
export function newPkce(): { verifier: string; challenge: string; state: string };
export function buildAuthorizeUrl(p: { clientId: string; challenge: string; state: string }): string;
export async function exchangeCode(p: { clientId: string; code: string; verifier: string }, f?: FetchLike): Promise<PeakTokenSet>;
export async function refreshPeakTokens(p: { clientId: string; refreshToken: string }, f?: FetchLike): Promise<PeakTokenSet>;
```

Fixed wire values (verified): endpoints `/oauth/register`, `/oauth/authorize`, `/oauth/token`. Registration body `{ client_name: 'penprinting-dashboard', redirect_uris: [PEAK_REDIRECT_URI], grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp:read' }` → 201 with `client_id` (no secret). Token calls are `application/x-www-form-urlencoded`; authorize params `response_type=code, client_id, redirect_uri, scope, code_challenge, code_challenge_method=S256, state`.

- [ ] **Step 1: Write failing tests** with a fake fetch:
  - `registerPeakClient` posts the body above and returns `{ clientId }`; a response without `client_id` → `PeakAuthError`
  - `newPkce` → verifier ≥ 43 url-safe chars, `challenge === base64url(sha256(verifier))`, state ≥ 16 chars, two calls differ
  - `buildAuthorizeUrl` → URL on `mcp.peakaccount.com/oauth/authorize` carrying all 7 params with `scope=mcp:read` and the fixed redirect URI
  - `exchangeCode` sends `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`; maps `{ access_token, refresh_token, expires_in: 3600, scope }` → `PeakTokenSet`
  - `refreshPeakTokens` sends `grant_type=refresh_token`; a 200 **without** `refresh_token` → `PeakAuthError`
  - HTTP 400/401 → `PeakAuthError`; HTTP 500 or fetch rejection → `PeakUnavailableError`
  - no thrown message ever contains the token/verifier/code value passed in (assert with a sentinel string)
- [ ] **Step 2: Run** `npx vitest run tests/peak-oauth.test.ts` — FAIL.
- [ ] **Step 3: Implement** with `node:crypto` (`randomBytes`, `createHash`) and a 10 s `AbortSignal.timeout`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(peak): OAuth HTTP layer (DCR, PKCE, exchange, refresh)`

---

### Task 3: Encrypted token store with single-flight refresh

**Files:**
- Create: `lib/peak/crypto.ts`, `lib/peak/token-store.ts`, `tests/peak-crypto.test.ts`, `tests/peak-token-store.test.ts`
- Modify: `app/api/admin/db-migrate/route.ts` (append before the "Quick row counts" block)

**Interfaces:**
- Consumes: `PeakTokenSet`, `refreshPeakTokens`, `PeakAuthError`, `PeakUnavailableError` (Task 2)
- Produces:
```ts
// lib/peak/crypto.ts — key = base64 of exactly 32 bytes, from process.env.PEAK_TOKEN_ENC_KEY unless passed
export class PeakConfigError extends Error {}
export function encryptSecret(plain: string, keyB64?: string): string;  // 'v1.<iv>.<tag>.<ciphertext>' (base64url parts, random 12-byte iv)
export function decryptSecret(blob: string, keyB64?: string): string;   // throws PeakConfigError on bad key/format/tag

// lib/peak/token-store.ts
export class PeakNotConnectedError extends Error {}
export interface PeakConnectionStatus {
  clientRegistered: boolean; connected: boolean; scope: string | null;
  accessExpiresAt: string | null; lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null;
}
export async function getPeakClientId(): Promise<string | null>;
export async function savePeakClient(clientId: string): Promise<void>;          // upsert row id='peak'
export async function savePeakTokens(t: PeakTokenSet): Promise<void>;           // encrypt + store + clear lock + clear last_error
export async function getPeakAccessToken(
  opts?: { forceRefresh?: boolean },
  deps?: { refresh?: typeof refreshPeakTokens; sleep?: (ms: number) => Promise<void>; nowMs?: () => number },
): Promise<string>;
export async function getPeakConnectionStatus(): Promise<PeakConnectionStatus>;
export async function recordPeakOk(): Promise<void>;
export async function recordPeakError(message: string): Promise<void>;
export async function claimDailyAlert(): Promise<boolean>;   // true once per 24h
```

DDL:
```sql
CREATE TABLE IF NOT EXISTS peak_oauth (
  id                 TEXT PRIMARY KEY,           -- always 'peak'
  client_id          TEXT NOT NULL,
  access_token_enc   TEXT,
  refresh_token_enc  TEXT,
  access_expires_at  TIMESTAMPTZ,
  scope              TEXT,
  refresh_lock_until TIMESTAMPTZ,
  last_ok_at         TIMESTAMPTZ,
  last_error         TEXT,
  last_error_at      TIMESTAMPTZ,
  last_alert_at      TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

`getPeakAccessToken` algorithm (the tests do not determine the ordering, so it is fixed here):
1. Read the row. No row or no `refresh_token_enc` → `PeakNotConnectedError`.
2. If `!forceRefresh` and `access_expires_at − now > 5 min` → return decrypted access token.
3. Take the lock: `UPDATE peak_oauth SET refresh_lock_until = NOW() + INTERVAL '30 seconds' WHERE id = 'peak' AND (refresh_lock_until IS NULL OR refresh_lock_until < NOW()) RETURNING client_id, refresh_token_enc`.
4. **Lock won:** call `refresh`. On success `savePeakTokens(newSet)` and return the new access token. If `savePeakTokens` throws → `recordPeakError('token refresh succeeded but persisting the new token failed')` (best effort) and throw `PeakAuthError`. If `refresh` throws `PeakAuthError` → `recordPeakError`, clear the lock, rethrow. If it throws `PeakUnavailableError` → clear the lock, rethrow.
5. **Lock lost:** poll up to 10 × `sleep(500)`: re-read the row; when `access_expires_at − now > 5 min` return that token. Exhausted → `PeakUnavailableError`.

`claimDailyAlert`: `UPDATE peak_oauth SET last_alert_at = NOW() WHERE id = 'peak' AND (last_alert_at IS NULL OR last_alert_at < NOW() - INTERVAL '24 hours') RETURNING id`.

- [ ] **Step 1: Failing crypto tests:** round-trip Thai + ASCII; two encryptions of the same text differ; tampered ciphertext → `PeakConfigError`; key that is not 32 bytes / missing env → `PeakConfigError`; output starts with `v1.`.
- [ ] **Step 2: Failing token-store tests** (sqlMock, injected `refresh`/`sleep`/`nowMs`):
  - no row → `PeakNotConnectedError`
  - fresh token → returns it, `refresh` not called
  - expiring token + lock won → `refresh` called once with the decrypted refresh token; the persisted `refresh_token_enc` decrypts to the **new** refresh token; returns the new access token
  - lock lost → never calls `refresh`; returns the token another holder wrote on the 2nd poll
  - lock lost, never updated → `PeakUnavailableError` after 10 sleeps
  - `refresh` → `PeakAuthError` → `recordPeakError` SQL issued, lock cleared, error rethrown
  - persist failure after a successful refresh → `PeakAuthError` and an error record attempt
  - `forceRefresh: true` with a fresh token still refreshes
  - `claimDailyAlert` true when the UPDATE returns a row, false when it returns none
  - no SQL parameter in any call equals a plaintext token (sentinel check)
- [ ] **Step 3: Run** `npx vitest run tests/peak-crypto.test.ts tests/peak-token-store.test.ts` — FAIL.
- [ ] **Step 4: Implement** both modules + append the DDL and `applied.push('CREATE TABLE peak_oauth')` to db-migrate.
- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `feat(peak): encrypted token store with single-flight rotating refresh`

---

### Task 4: Minimal MCP client

**Files:**
- Create: `lib/peak/mcp-client.ts`, `tests/peak-mcp-client.test.ts`

**Interfaces:**
- Consumes: `getPeakAccessToken` (Task 3), `PEAK_MCP_URL`, `PeakUnavailableError`, `PeakAuthError` (Task 2)
- Produces:
```ts
export type PeakToolName = 'get_quotation' | 'list_quotation' | 'search_contacts';
export class PeakToolError extends Error {}   // tool returned isError, or unparsable content
export interface PeakClient { call(name: PeakToolName, args: Record<string, unknown>): Promise<unknown> }  // parsed JSON of the text content
export function createPeakClient(deps?: {
  fetch?: typeof fetch;
  getToken?: (o?: { forceRefresh?: boolean }) => Promise<string>;
  timeoutMs?: number;   // default 10_000
}): PeakClient;
```

Protocol (verified; mirror `peak-search.mjs`): POST JSON-RPC 2.0 to `PEAK_MCP_URL` with headers `content-type: application/json`, `accept: application/json, text/event-stream`, `authorization: Bearer <token>`, `mcp-protocol-version: 2025-06-18`, and `mcp-session-id` once known. Sequence per client: `initialize` (`{ protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'penprinting-dashboard', version: '1' } }`) → read `mcp-session-id` response header → notification `notifications/initialized` (no `id`) → `tools/call { name, arguments }`. Responses arrive as `text/event-stream` (`data: {json}` lines — pick the message whose `id` matches) or plain JSON. Result text = `result.content[].text` joined; `JSON.parse` it.

- [ ] **Step 1: Failing tests** (scripted fake fetch):
  - SSE response parsed; plain-JSON response parsed
  - first `call` performs initialize + initialized + tools/call; a second `call` on the same client reuses the session (1 initialize total)
  - `tools/call` → HTTP 404 `{"error":{"code":-32001,"message":"Session not found"}}` then success → 2 initializes, result returned
  - 404 three times in a row → `PeakUnavailableError`
  - HTTP 401 → `getToken({ forceRefresh: true })` called once, retried with the new bearer; a second 401 → `PeakAuthError`
  - `result.isError === true` → `PeakToolError`; text that is not JSON → `PeakToolError`
  - HTTP 500 / fetch rejects / timeout → `PeakUnavailableError`
  - a name outside the union (cast) throws before any fetch
- [ ] **Step 2: Run** `npx vitest run tests/peak-mcp-client.test.ts` — FAIL.
- [ ] **Step 3: Implement.** One client object = one lazily-created session; do not share sessions across clients.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(peak): minimal MCP client (SSE/JSON, session re-init, 401 refresh)`

---

### Task 5: Typed Peak readers

**Files:**
- Create: `lib/peak/read.ts`, `tests/peak-read.test.ts`, `tests/fixtures/peak/get-quotation.json`, `get-quotation-multi.json`, `get-quotation-empty.json`, `list-quotation.json`, `search-contacts.json`

**Interfaces:**
- Consumes: `PeakClient` (Task 4)
- Produces:
```ts
export interface PeakLine { key: string; description: string; quantity: number | null; price: number | null }
export interface PeakQuotation {
  code: string; status: string;            // 'Approve' | 'Draft' | 'Voided' | other
  issuedDate: string;                      // ISO yyyy-mm-dd ('' if absent)
  contactCode: string; netAmount: number | null; lines: PeakLine[];
}
export interface PeakQuotationRow { code: string; issuedDate: string; contactCode: string; netAmount: number | null }
export interface PeakReader {
  getQuotation(code: string): Promise<PeakQuotation | null>;                       // null = not found
  listQuotations(q: { searchText?: string; dateStart?: string; dateEnd?: string; page: number }): Promise<{ rows: PeakQuotationRow[]; total: number }>;  // ISO dates in; page size 50
  newestQuotations(q: { searchText?: string; dateStart?: string; dateEnd?: string }, n: number): Promise<PeakQuotationRow[]>;  // newest first
  getContactName(contactCode: string): Promise<string | null>;
}
export function createPeakReader(client: PeakClient): PeakReader;
```

Verified payload shapes (build the fixtures from these; anonymise names):
```jsonc
// get_quotation { code } — found
{ "PeakQuotations": { "quotations": [ { "resCode": "200", "code": "QO-20260900097", "issuedDate": "20260915", "dueDate": "20261015",
    "contactCode": "C01890", "status": "Approve", "preTaxAmount": 3000, "vatAmount": 210, "netAmount": 3210,
    "products": [ { "id": "2cfea6c5-a83e-4ae1-91ae-0df093bb5008", "productCode": null, "description": "ไวนิลขนาด 1x2 เมตร\nเจาะรู 4 มุม", "quantity": 10, "price": 300, "vatType": 3 } ] } ],
  "resCode": "200" }, "eventType": "Retrieve", "apiType": "ApiQuotation" }
// get_quotation — unknown code: { "PeakQuotations": { "quotations": [], "totalQuotation": null, "resCode": "200" } }
// list_quotation { searchText?, dateStart?, dateEnd?, limit, page } — thin rows, OLDEST FIRST:
{ "PeakQuotations": { "quotations": [ { "code": "QO-20260900097", "issuedDate": "20260915", "contactCode": "C01890", "netAmount": 3210, "status": null, "products": [] } ], "totalQuotation": 1, "resCode": "200" } }
// list_quotation — no match: quotations [], totalQuotation 0
// search_contacts { searchText: "C01890", limit: 1 }
{ "PeakContacts": { "contacts": [ { "code": "C01890", "name": "ไทยฟูดส์ อาหารสัตว์", "taxNumber": "…" } ], "totalContact": 1997, "resCode": "200" } }
// search_contacts — no match: contacts [] (totalContact is the count of ALL contacts — ignore it)
```
Rules: dates on the wire are `yyyyMMdd` (convert both ways); `limit` is always 50 (verified to work); `PeakLine.key` = `products[i].id`, or `idx:<i>` when the id is missing; `getContactName` returns the trimmed `name` of the first contact **whose `code` equals the requested code**, else `null`.

`newestQuotations` (Peak has no sort): fetch page 1 → `total`; `last = ceil(total / 50)`; if `last === 1` use page 1; otherwise fetch page `last`, and page `last − 1` too if page `last` has fewer than `n` rows; concatenate in order, reverse, take `n`.

- [ ] **Step 1: Failing tests:**
  - `getQuotation` maps the fixture (`issuedDate: '2026-09-15'`, one line with `key` = the GUID, `quantity: 10`); empty fixture → `null`; a line without `id` → `key: 'idx:0'`
  - `listQuotations({ searchText: 'ไทยฟูดส์', page: 1 })` calls `list_quotation` with `{ searchText: 'ไทยฟูดส์', limit: 50, page: 1 }` and **no** date keys; with ISO dates → wire `20261101`
  - `newestQuotations(…, 5)`: total 120 → requests pages 1 and 3 only when page 3 has ≥ 5 rows; pages 1, 3, 2 when page 3 has 2 rows; result is newest-first; total 0 → `[]` after one call
  - `getContactName('C01890')` → `'ไทยฟูดส์ อาหารสัตว์'`; no contacts → `null`; a contact with a different `code` → `null`
- [ ] **Step 2: Run** `npx vitest run tests/peak-read.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(peak): typed quotation/contact readers + newest-N helper`

---

### Task 6: Admin connect, test, and status page

**Files:**
- Create: `app/api/admin/peak/connect/route.ts`, `app/api/admin/peak/callback/route.ts`, `app/api/admin/peak/test/route.ts`, `app/peak/page.tsx`, `app/peak/peak-client.tsx`, `tests/peak-admin-routes.test.ts`
- Modify: `middleware.ts` (add `'/peak/:path*'` to the matcher), `components/nav-config.ts` (admin-only item `{ href: '/peak', label: 'เชื่อมต่อ Peak', adminOnly: true }` in the same group as `/registrations`, with an existing icon)

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 5.
- Produces: `GET /api/admin/peak/connect`, `GET /api/admin/peak/callback`, `POST /api/admin/peak/test`, page `/peak`.

Behaviour:
- **connect** — `requireSession(['admin'])`; `clientId = (await getPeakClientId()) ?? (await registerPeakClient()).clientId` then `savePeakClient`; `newPkce()`; set cookie `pp_peak_oauth` = JSON `{ state, verifier }` — `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/api/admin/peak'`, `maxAge: 600`; 302 to `buildAuthorizeUrl(...)`.
- **callback** — `requireSession(['admin'])`; read + delete the cookie; missing cookie, `state` mismatch, or missing `code` → 302 `/peak?error=state`; `error` query param from Peak → 302 `/peak?error=denied`; `exchangeCode` → `savePeakTokens` → `recordPeakOk` → 302 `/peak?connected=1`; a thrown `PeakAuthError`/`PeakUnavailableError` → 302 `/peak?error=exchange`.
- **test** — `requireSession(['admin'])`; `createPeakReader(createPeakClient()).newestQuotations({ dateStart: <today−30d> }, 1)`; success → `recordPeakOk()` + `{ ok: true, latestCode, ms }`; failure → `recordPeakError(message)` + `{ ok: false, error: <class name> }` (HTTP 200 — the page shows it).
- **page** — server component, admin-only using the same cookie check as `app/quote-logs/page.tsx` (non-admin → redirect `/board`), inside `DashboardShell`. Shows `getPeakConnectionStatus()` (connected / not, scope, last success, last error + time) and a query-param banner; `peak-client.tsx` holds the "เชื่อมต่อ Peak" link (plain `<a href="/api/admin/peak/connect">`) and the "ทดสอบ" button (POST, shows the JSON result). Postgres not configured → render "ยังไม่ได้ตั้งค่าฐานข้อมูล" instead of throwing.

- [ ] **Step 1: Failing route tests** (`vi.mock` of `@/lib/route-helpers`, `@/lib/peak/oauth`, `@/lib/peak/token-store`, `@/lib/peak/mcp-client`, `@/lib/peak/read`):
  - connect: non-admin → the `NextResponse` from `requireSession`; admin with no client → registers, saves, sets the cookie with the flags above, redirects to the authorize URL; existing client → `registerPeakClient` not called
  - callback: happy path saves tokens and redirects to `/peak?connected=1`; state mismatch → `/peak?error=state` and `exchangeCode` not called; no cookie → same; `?error=access_denied` → `/peak?error=denied`; exchange throws → `/peak?error=exchange`; the cookie is cleared on every path
  - test: success shape; failure records the error and returns `{ ok: false }` with the error class name only
- [ ] **Step 2: Run** `npx vitest run tests/peak-admin-routes.test.ts` — FAIL.
- [ ] **Step 3: Implement** routes, page, middleware + nav entries.
- [ ] **Step 4: Run** the test + `npm run type-check && npm run build` — PASS / build succeeds.
- [ ] **Step 5: Commit** `feat(peak): admin connect/callback/test routes + /peak status page`

---

### Task 7: Daily keep-alive + health alert

**Files:**
- Create: `app/api/cron/peak-keepalive/route.ts`, `tests/peak-keepalive.test.ts`
- Modify: `vercel.json` (add `{ "path": "/api/cron/peak-keepalive", "schedule": "30 0 * * *" }` — 07:30 Bangkok)

**Interfaces:**
- Consumes: `getPeakAccessToken`, `recordPeakOk`, `recordPeakError`, `claimDailyAlert`, `PeakNotConnectedError` (Task 3); `createPeakClient`, `createPeakReader` (Tasks 4–5); `pushLine` from `@/lib/ai-quote/channels/line`.
- Produces: `GET /api/cron/peak-keepalive` → `{ ok, skipped?, alerted? }`.

Behaviour: auth exactly like `app/api/cron/morning-report/route.ts` but cron-only (`Authorization: Bearer ${CRON_SECRET}`, else 401). `PEAK_ORDER_ENABLED !== 'true'` → `{ ok: true, skipped: 'disabled' }`. `getPeakAccessToken({ forceRefresh: true })` then `listQuotations({ dateStart: <today−7d>, page: 1 })`. `PeakNotConnectedError` → `{ ok: true, skipped: 'not-connected' }` (no alert — nothing was ever connected). Any other failure → `recordPeakError`, and if `claimDailyAlert()` → `pushLine(<first id in PEAK_ORDER_GROUP_IDS>, <text>)` where the text says the Peak connection failed and gives `https://dashboard.penprinting.co/peak`; a push failure is caught and logged. Success → `recordPeakOk`.

- [ ] **Step 1: Failing tests:** 401 without the bearer; disabled → skipped; not connected → skipped, no push; success → `recordPeakOk`, no push; failure + `claimDailyAlert` true → one push to the first group id containing `/peak`; failure + claim false → no push; push throws → still 200.
- [ ] **Step 2: Run** `npx vitest run tests/peak-keepalive.test.ts` — FAIL.
- [ ] **Step 3: Implement** + `vercel.json`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(peak): daily keep-alive cron with once-a-day LINE alert`

---

### Task 8: Command parser, resolver, mapper

**Files:**
- Create: `lib/peak-order/command.ts`, `lib/peak-order/resolve.ts`, `lib/peak-order/mapper.ts`, `tests/peak-order-command.test.ts`, `tests/peak-order-resolve.test.ts`, `tests/peak-order-mapper.test.ts`

**Interfaces:**
- Consumes: `PeakReader`, `PeakQuotation`, `PeakLine`, `PeakQuotationRow` (Task 5); `CreateOrderBody` (Task 1); `QTY_UNITS` (Task 1).
- Produces:
```ts
// command.ts (pure)
export type OrderCommand =
  | { kind: 'latest' } | { kind: 'code'; code: string } | { kind: 'digits'; digits: string } | { kind: 'text'; words: string[] };
export function isOrderCommand(text: string): boolean;             // /^\/order(\s|$)/i after trim
export function parseOrderCommand(text: string): OrderCommand | null;
export function orderCommandArgs(text: string): string;            // text after '/order', trimmed

// resolve.ts
export interface QuotationChoice { code: string; issuedDate: string; customerName: string; netAmount: number | null; firstLine: string; opened: boolean }
export type Resolved =
  | { kind: 'quotation'; quotation: PeakQuotation; customerName: string }
  | { kind: 'choices'; heading: string; choices: QuotationChoice[]; note?: string }
  | { kind: 'not-found'; hint: string };
export async function resolveOrderCommand(cmd: OrderCommand, deps: {
  peak: PeakReader; openedCodes: (codes: string[]) => Promise<Set<string>>; todayISO: string;
}): Promise<Resolved>;

// mapper.ts (pure)
export const NO_NAME = '(ไม่มีชื่อรายการ)';
export function bangkokISODate(d: Date): string;                  // calendar day in Asia/Bangkok, 'yyyy-mm-dd', independent of process TZ
export function addDaysISO(iso: string, days: number): string;     // pure calendar arithmetic on a 'yyyy-mm-dd' string
export function firstLine(description: string): string;            // first non-empty line, leading /^[-•*\s]+/ stripped, trimmed, ≤ 120 chars; '' → NO_NAME
export function formatQty(q: number | null): string;               // 10 → '10', 0.125 → '0.125', 12.5 → '12.5', 0/null/NaN → ''
export interface UnitPlan { lineKeys: string[]; name: string; qty: string; notes: string }
export function planUnits(q: PeakQuotation, mode: 'single' | 'merged' | 'split', onlyKeys?: string[]): UnitPlan[];
export interface UnitChoices { qtyUnit?: string; graphic: string; press: string; dateDue: string }   // graphic/press = staff id or ''
export function buildOrderBody(p: {
  unit: UnitPlan; choices: UnitChoices; customerName: string; orderer: string;
  qoCode: string; draftId: string; todayISO: string; asDraft: boolean; force?: boolean;
}): CreateOrderBody;
```

Rules:
- `parseOrderCommand`: not a command → `null`; no args → `latest`; args matching `/^QO-?\d{6,}$/i` → `code` normalised to `QO-<digits>`; `/^\d{3,}$/` → `digits`; otherwise `text` with whitespace-split words (max 6; extra words dropped). Newlines count as whitespace.
- `resolveOrderCommand`:
  - `latest` → `newestQuotations({ dateStart: todayISO − 30 days }, 5)` → choices (heading names "5 ใบล่าสุด"); none → not-found.
  - `code` → `getQuotation`; `null` → retry as `digits` with the numeric part.
  - `digits` → `listQuotations({ searchText: digits, page: 1 })`; total 0 → not-found; total 1 → `getQuotation` of that code → `quotation`; else newest 5 → choices.
  - `text` → for `k = words.length … 1`: `listQuotations({ searchText: words.slice(0, k).join(' '), page: 1 })`; first `k` with `total > 0` wins; none → not-found. Filter words = `words.slice(k)`. No filter words: total 1 → `quotation`, else newest 5 → choices. With filter words: take newest 20, `getQuotation` each, keep those whose lines' descriptions (joined, lower-cased, whitespace collapsed) contain **every** filter word (same normalisation); newest 5 of the survivors → choices; no survivor → newest 5 unfiltered with `note` saying the words were not found.
  - Every choice needs `firstLine` (from `getQuotation`) and `customerName` (`getContactName`, cached per `contactCode` within the call, fallback = the contact code) and `opened` (one `openedCodes` call for all codes). A `quotation` result carries `customerName` the same way.
  - Peak calls run with concurrency ≤ 3 and a hard cap of 40 calls per command (beyond the cap, stop fetching details and return what is resolved).
- `planUnits`: `single` requires exactly one line → one unit `{ lineKeys: [key], name: firstLine(desc), qty: formatQty(quantity), notes: desc + ref }`. `split` → one such unit per line (only lines in `onlyKeys` when given). `merged` → one unit: `lineKeys` = all, `name` = `firstLine(lines[0]) + ' (+N รายการ)'` (N = lines − 1), `qty: ''`, `notes` = blocks `รายการ {i} (จำนวน {formatQty}): {desc}` separated by a blank line, + ref. Ref line (last line of every `notes`, after a blank line): `อ้างอิง Peak: {code}`.
- `buildOrderBody`: start from `emptyOrderForm(orderer)` (`@/lib/photobook`); set `name`, `customer`, `dateIn: todayISO`, `dateDue`, `qty`, `qtyUnit` (only when `choices.qtyUnit` is set; otherwise leave the form default), `notes`, `assignStaff: choices.graphic`, `forwardPrint: choices.press`, `orderer`, `orderType: 'normal'`; add `peak: { code: qoCode, lineKeys: unit.lineKeys, draftId }`; `asDraft` → `status: 'draft'`; `force` → `force: true`. Never set `price`.

- [ ] **Step 1: Failing parser tests:** `'/order'` → latest; `'/ORDER  qo-20260900097 '` → `{ kind: 'code', code: 'QO-20260900097' }`; `'/order QO20260900097'` → same code; `'/order 900097'` → digits; `'/order 97'` → text `['97']`; `'/order ไทยฟูดส์  ไวนิล'` → text 2 words; `'/order\nไทยฟูดส์'` → text; `'order x'`, `'/orders'`, `'สวัสดี /order'` → `null`; 8 words → 6 kept.
- [ ] **Step 2: Failing resolver tests** (fake `PeakReader` recording calls): each branch above, including — code not found falls back to digits; text `['ไทยฟูดส์','อาหารสัตว์','ไวนิล']` where only the 2-word prefix matches → filter `['ไวนิล']`; filter keeps a quotation whose description is `'ไวนิล  ขนาด 1x2'` for words `['ไวนิล','1x2']`; no survivor → 5 unfiltered + `note`; `opened` set from `openedCodes`; contact name fetched once for two quotations of the same customer; call cap respected (reader that would need 60 calls → ≤ 40 made).
- [ ] **Step 3: Failing mapper tests:**
  - `firstLine('- สติกเกอร์ขาวมุกขนาด 14x10 ซม.\n- พิมพ์ 4 สี')` → `'สติกเกอร์ขาวมุกขนาด 14x10 ซม.'`; `'\n  \n'` → `NO_NAME`; 300-char line → 120 chars *(Review Focus 1)*
  - `formatQty`: `10`, `50000`, `0.125`, `12.5` → `'10'`, `'50000'`, `'0.125'`, `'12.5'`; `0`, `null`, `NaN` → `''` *(Review Focus 2)*
  - `bangkokISODate(new Date('2026-11-14T18:30:00Z'))` → `'2026-11-15'`; `(new Date('2026-11-14T16:59:59Z'))` → `'2026-11-14'`; `addDaysISO('2026-11-28', 3)` → `'2026-12-01'`; `addDaysISO('2026-12-31', 1)` → `'2027-01-01'`
  - `planUnits` single / split (with and without `onlyKeys`) / merged of 3 lines: name ends `(+2 รายการ)`, `qty === ''`, notes contain `รายการ 2 (จำนวน 3000):` and end with `อ้างอิง Peak: QO-20261100072`; a line with an empty description still yields a unit named `NO_NAME`
  - `buildOrderBody`: full choices → `assignStaff 'pook'`, `forwardPrint 'inkjet'`, `qtyUnit 'ชิ้น'`, `dateIn` = `todayISO`, `peak.code`, no `price` key, no `status`; `asDraft` → `status: 'draft'`; `graphic: ''` → `assignStaff: ''`; merged unit (no `qtyUnit`) keeps the form default unit
- [ ] **Step 4: Run** `npx vitest run tests/peak-order-command.test.ts tests/peak-order-resolve.test.ts tests/peak-order-mapper.test.ts` — FAIL.
- [ ] **Step 5: Implement** the three modules.
- [ ] **Step 6: Run** the same command, then once more with `TZ=UTC` and `TZ=Asia/Bangkok` prefixes — PASS in all three.
- [ ] **Step 7: Commit** `feat(peak-order): command parser, quotation resolver, order-body mapper`

---

### Task 9: Postback codec + LINE plumbing

**Files:**
- Create: `lib/peak-order/postback.ts`, `tests/peak-order-postback.test.ts`
- Modify: `lib/ai-quote/channels/types.ts` (add field), `lib/ai-quote/channels/line.ts` (`LineEvent.postback.params`, `parseLineEvents` group branch), `lib/ai-quote/webhook-router.ts` (`Route`, `routeInbound`, `HandleDeps`, `handleInbound`), `tests/ai-quote-line-parse.test.ts`, `tests/ai-quote-webhook-router.test.ts`

**Interfaces:**
- Consumes: `isOrderCommand` (Task 8).
- Produces:
```ts
// lib/peak-order/postback.ts (pure, no server-only — imported by line.ts)
export const PEAK_ORDER_POSTBACK_PREFIX = 'po1|';
export type OrderPostback =
  | { a: 'who'; orderer: number; args: string }             // index into ORDERERS, -1 = "ไม่ใช่ฉัน"; args = original command args
  | { a: 'pick'; code: string }                              // choose a quotation from a list
  | { a: 'rest'; code: string }                              // open remaining lines of a partly opened quotation
  | { a: 'mode'; draft: string; v: 'merged' | 'split' }
  | { a: 'unit'; draft: string; u: number; v: number | 'skip' }      // v = index into QTY_UNITS
  | { a: 'gfx';  draft: string; u: number; v: string }               // graphic staff id | 'none' | 'same'
  | { a: 'press'; draft: string; u: number; v: string }              // print staff id | 'none'
  | { a: 'date'; draft: string; u: number; v: string }               // '+1'|'+2'|'+3'|'+5'|'+7'|'pick' (pick → date comes in postbackParams)
  | { a: 'ok';   draft: string; u: number; v: 'create' | 'draft' }
  | { a: 'dup';  draft: string; u: number; v: 'force' }
  | { a: 'x';    draft: string };                                     // cancel
export function encodePostback(p: OrderPostback): string;   // always starts with the prefix, ≤ 300 chars ('who' drops args if it would not fit)
export function decodePostback(data: string): OrderPostback | null;   // null on anything malformed

// lib/ai-quote/channels/types.ts
interface InboundMessage { /* … */ postbackParams?: { date?: string } }

// lib/ai-quote/webhook-router.ts
export type Route = /* existing */ | 'peak-order' | 'peak-order-postback';
export function routeInbound(m: InboundMessage, opts: { aiEnabled: boolean; trackEnabled?: boolean; peakOrderGroupIds?: string[] }): Route;
export interface PeakOrderArm { groupIds: string[]; handleText(m: InboundMessage): Promise<void>; handlePostback(m: InboundMessage): Promise<void> }
interface HandleDeps { /* … */ peakOrder?: PeakOrderArm }
```

Rules:
- `parseLineEvents`, **group** branch only: additionally emit `{ kind: 'postback', postbackData, postbackParams: { date }, replyToken, sourceType: 'group', groupId, channelUserId: src.userId ?? '' }` when `raw.type === 'postback'` and `raw.postback.data` starts with `PEAK_ORDER_POSTBACK_PREFIX`. Rooms unchanged. Other group postbacks and group images stay dropped. 1-on-1 postbacks also carry `postbackParams` (harmless).
- `routeInbound`: right after the `staff-echo` line, with `inGroup = m.sourceType === 'group' && !!m.groupId && (opts.peakOrderGroupIds ?? []).includes(m.groupId)`:
  `inGroup && text && isOrderCommand(text)` → `'peak-order'`; `inGroup && kind === 'postback' && data.startsWith(PREFIX)` → `'peak-order-postback'`. Everything else falls through to the existing lines untouched (a group postback from a non-allowed group reaches the existing "group → ignore").
- `handleInbound`: pass `peakOrderGroupIds: deps.peakOrder?.groupIds` to `routeInbound`; `'peak-order'` → `await deps.peakOrder!.handleText(m)`; `'peak-order-postback'` → `await deps.peakOrder!.handlePostback(m)`; then `return`.

- [ ] **Step 1: Failing codec tests:** every variant round-trips; encoded string starts with `po1|`; `who` with 400-char args encodes to ≤ 300 chars and decodes with `args: ''`; Thai args round-trip; `decodePostback` returns `null` for `'ai_quote_start'`, `'po1|'`, `'po1|nope|x'`, a `unit` with a non-numeric `u`, a `mode` with an unknown `v`.
- [ ] **Step 2: Failing parse tests** (append to `tests/ai-quote-line-parse.test.ts`): group postback with `data: 'po1|x|abc'` → one message `kind: 'postback'`, `groupId`, `sourceType: 'group'`; with `params: { date: '2026-11-20' }` → `postbackParams.date`; group postback `data: 'ai_quote_start'` → dropped; **room** postback with the prefix → dropped; group image → still dropped.
- [ ] **Step 3: Failing router tests** (append to `tests/ai-quote-webhook-router.test.ts`): `/order QO-1` in group `G1` with `peakOrderGroupIds: ['G1']` → `'peak-order'`; same text with `['G2']`, with no option, in a room, and 1-on-1 (`aiEnabled: false`) → the routes they get today (`'ignore'`, `'ignore'`, `'ignore'`, `'ignore'`); 1-on-1 with `aiEnabled: true` → `'ai'`; prefixed postback in `G1` allowed → `'peak-order-postback'`, not allowed → `'ignore'`; `handleInbound` calls `handleText` / `handlePostback` exactly once and sends no reply of its own; `/track 202606110` in `G1` still → `'track'`.
- [ ] **Step 4: Run** `npx vitest run tests/peak-order-postback.test.ts tests/ai-quote-line-parse.test.ts tests/ai-quote-webhook-router.test.ts` — FAIL (new cases only).
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run** the same command — PASS, including every pre-existing case in the two modified test files.
- [ ] **Step 7: Commit** `feat(line): let /order text + postbacks from allow-listed groups reach a peak-order arm`

---

### Task 10: Draft, link, and staff tables

**Files:**
- Create: `lib/peak-order/db.ts`, `tests/peak-order-db.test.ts`
- Modify: `app/api/admin/db-migrate/route.ts`

**Interfaces:**
- Consumes: `PeakQuotation` (Task 5), `UnitPlan`, `UnitChoices` (Task 8).
- Produces:
```ts
export type DraftStep = 'mode' | 'unit' | 'graphic' | 'press' | 'date' | 'confirm' | 'dup' | 'creating' | 'done' | 'cancelled';
export interface DraftUnit extends UnitPlan {
  choices: Partial<UnitChoices>;
  result?: { kind: 'order' | 'draft' | 'skipped' | 'existing'; orderId?: number; jobId?: number | null; pin?: string };
}
export interface DraftRow {
  id: string; groupId: string; lineUserId: string; orderer: string; qoCode: string;
  snapshot: { quotation: PeakQuotation; customerName: string };
  mode: 'single' | 'merged' | 'split' | null; units: DraftUnit[]; unitIdx: number; step: DraftStep;
  creatingKind: 'create' | 'draft' | null;   // what the in-flight 'creating' step is doing
  lastTouchedAt: string;
}
export interface LiveLink { lineKey: string; orderId: number | null; orderName: string | null; orderStatus: string | null }
export interface PeakOrderDb {
  getStaff(lineUserId: string): Promise<{ orderer: string } | null>;
  setStaff(lineUserId: string, orderer: string, displayName: string | null): Promise<void>;
  listStaff(): Promise<Array<{ lineUserId: string; orderer: string; displayName: string | null; createdAt: string }>>;
  deleteStaff(lineUserId: string): Promise<void>;
  createDraft(d: Omit<DraftRow, 'lastTouchedAt' | 'creatingKind'>): Promise<void>;
  loadDraft(id: string): Promise<DraftRow | null>;
  /** Conditional gate: succeeds only if the row is still at (from.unitIdx, from.step). null = lost the race / stale tap. */
  advanceDraft(id: string, from: { unitIdx: number; step: DraftStep },
               to: { unitIdx: number; step: DraftStep; mode?: DraftRow['mode']; units?: DraftUnit[]; creatingKind?: DraftRow['creatingKind'] }): Promise<DraftRow | null>;
  cancelDraft(id: string): Promise<boolean>;                     // false if already done/cancelled/creating
  liveLinks(qoCode: string): Promise<LiveLink[]>;
  openedCodes(codes: string[]): Promise<Set<string>>;            // codes with ≥ 1 live link
  claimLines(qoCode: string, lineKeys: string[], draftId: string, by: string): Promise<boolean>;   // all-or-nothing
  releaseClaim(qoCode: string, draftId: string): Promise<void>;  // deletes this draft's rows that have no order_id
  finalizeLinks(qoCode: string, draftId: string, orderId: number): Promise<void>;
  findOrderByPeakMarker(qoCode: string, lineKeys: string[]): Promise<{ id: number; status: string } | null>;
}
export const peakOrderDb: PeakOrderDb;   // the sql-backed implementation
export function newDraftId(): string;    // randomBytes(9).toString('base64url') → 12 chars
```

DDL:
```sql
CREATE TABLE IF NOT EXISTS peak_order_staff (
  line_user_id TEXT PRIMARY KEY, orderer TEXT NOT NULL, display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS peak_order_drafts (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, line_user_id TEXT NOT NULL, orderer TEXT NOT NULL,
  qo_code TEXT NOT NULL, snapshot JSONB NOT NULL, mode TEXT, units JSONB NOT NULL DEFAULT '[]'::jsonb,
  unit_idx INT NOT NULL DEFAULT 0, step TEXT NOT NULL, creating_kind TEXT,
  last_touched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS peak_order_links (
  qo_code TEXT NOT NULL, line_key TEXT NOT NULL, order_id BIGINT, draft_id TEXT, created_by TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (qo_code, line_key)
);
```

Invariant (spec §6.5): **one Peak line ↔ at most one live work order.** A link row is **live** when `order_id` points at an `orders` row whose `status` is not `'cancelled'`, or when `order_id IS NULL` and `claimed_at` is younger than 2 minutes (an in-flight claim). Anything else is dead and may be taken over.

SQL the tests cannot determine (pin these):
```sql
-- advanceDraft
UPDATE peak_order_drafts
   SET step = $to.step, unit_idx = $to.unitIdx, mode = COALESCE($to.mode, mode),
       units = COALESCE($to.unitsJson::jsonb, units), creating_kind = $to.creatingKind, last_touched_at = NOW()
 WHERE id = $id AND unit_idx = $from.unitIdx AND step = $from.step
RETURNING *;

-- claimLines: keys passed as ONE json parameter (sorted ascending — fixed lock order), one statement
INSERT INTO peak_order_links (qo_code, line_key, draft_id, created_by, order_id, claimed_at)
SELECT $code, k, $draftId, $by, NULL, NOW()
  FROM jsonb_array_elements_text($keysJson::jsonb) AS k
ON CONFLICT (qo_code, line_key) DO UPDATE
   SET draft_id = EXCLUDED.draft_id, created_by = EXCLUDED.created_by, order_id = NULL, claimed_at = NOW()
 WHERE (peak_order_links.order_id IS NULL AND peak_order_links.claimed_at < NOW() - INTERVAL '2 minutes')
    OR (peak_order_links.order_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM orders o WHERE o.id = peak_order_links.order_id AND COALESCE(o.status, '') <> 'cancelled'))
RETURNING line_key;
-- returned row count < keys.length  →  releaseClaim(code, draftId) and return false

-- findOrderByPeakMarker (newest live order carrying the marker written by buildOrderBody)
SELECT id, status FROM orders
 WHERE raw_data->'peak'->>'code' = $code AND COALESCE(status, '') <> 'cancelled'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(raw_data->'peak'->'lineKeys') lk
                WHERE lk IN (SELECT jsonb_array_elements_text($keysJson::jsonb)))
 ORDER BY id DESC LIMIT 1;
```
`liveLinks` = links for the code LEFT JOIN `orders`, filtered to the live definition, returning `orderName`/`orderStatus` from the join. `cancelDraft` = `UPDATE … SET step = 'cancelled' WHERE id = $id AND step NOT IN ('done','cancelled','creating') RETURNING id`.

- [ ] **Step 1: Failing tests** (sqlMock): row mappers (`snake_case` → interface, JSONB already parsed or string — handle both); `advanceDraft` returns `null` on zero rows and the mapped row otherwise, and the SQL text contains `unit_idx =` and `step =` in its `WHERE` *(gate pin)*; `claimLines(code, ['b','a'], …)` passes `'["a","b"]'` (sorted) and returns `true` when 2 rows come back, and on 1 row issues the release `DELETE` and returns `false`; claim SQL text contains `ON CONFLICT (qo_code, line_key) DO UPDATE` and `INTERVAL '2 minutes'` and `<> 'cancelled'`; `releaseClaim` deletes only `order_id IS NULL` rows of that draft; `finalizeLinks` sets `order_id` only on that draft's rows; `openedCodes([])` issues no SQL and returns an empty set; `cancelDraft` true/false; `newDraftId()` is 12 url-safe chars and unique.
- [ ] **Step 2: Run** `npx vitest run tests/peak-order-db.test.ts` — FAIL.
- [ ] **Step 3: Implement** + append the three `CREATE TABLE` statements (each with an `applied.push`) to db-migrate.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(peak-order): draft/link/staff tables with conditional gates and per-line claims`

---

### Task 11: Flex builders

**Files:**
- Create: `lib/peak-order/flex.ts`, `tests/peak-order-flex.test.ts`

**Interfaces:**
- Consumes: `encodePostback` (Task 9), `DraftRow`, `DraftUnit`, `LiveLink` (Task 10), `QuotationChoice` (Task 8), `STAFF` (`@/lib/board`), `ORDERERS`, `QTY_UNITS` (Task 1), `displayDate` (`@/lib/jobs`).
- Produces (all pure; `flex` is a LINE `{ type: 'flex', altText, contents }` message, `text` the plain fallback):
```ts
export interface Card { flex: Record<string, unknown>; text: string }
export const DASHBOARD_BASE = 'https://dashboard.penprinting.co';
export function whoCard(args: string): Card;
export function choicesCard(heading: string, choices: QuotationChoice[], note?: string): Card;
export function statusCard(p: { qoCode: string; customerName: string; opened: Array<{ orderId: number; name: string; isDraft: boolean }>; remaining: Array<{ name: string }> }): Card;
export function modeCard(d: DraftRow): Card;
export function unitCard(d: DraftRow): Card;          // QTY_UNITS buttons (+ 'ข้ามรายการนี้' when mode === 'split') + 'ยกเลิก'
export function graphicCard(d: DraftRow, canCopyPrevious: boolean): Card;
export function pressCard(d: DraftRow): Card;         // omits 'ยังไม่ระบุ' when this unit's graphic is ''
export function dateCard(d: DraftRow, todayISO: string): Card;
export function summaryCard(d: DraftRow): Card;
export function dupCard(d: DraftRow, duplicates: Array<{ id: number; name: string }>): Card;
export function createdCard(p: { orderId: number; name: string; pin: string; isDraft: boolean }): Card;
export const TEXT: { noUser: string; expired: string; notOwner: (orderer: string) => string; cancelled: string;
  peakNotConnected: string; peakUnavailable: string; createFailed: string; voided: string; noLines: string; badDate: string; whoDeclined: string };
```

Fixed labels (spec §4): graphic `ไม่ผ่านกราฟฟิก`, `เหมือนใบก่อน`; press `ยังไม่ระบุ`; date `พรุ่งนี้`, `+2 วัน`, `+3 วัน`, `+5 วัน`, `+7 วัน`, `📅 เลือกวันเอง`; summary `✅ สร้างงาน`, `📝 บันทึกเป็นใบร่างในแดชบอร์ด`, `ยกเลิก`; mode `รวมเป็น 1 งาน`, `แยกเป็น {N} งาน`; unit `ข้ามรายการนี้`; status `เปิดรายการที่เหลือ`; who `ไม่ใช่ฉัน`; dup `สร้างต่อ`. Staff buttons use `STAFF.graphic[].name` / `STAFF.print[].name`, value = `id`.

Layout rules: buttons are Flex `button` components with `postback` actions (never quick replies). `📅 เลือกวันเอง` is a `datetimepicker` action: `{ type: 'datetimepicker', label, data: encodePostback({ a: 'date', …, v: 'pick' }), mode: 'date', initial: <today+1>, min: <today> }`. Created/status cards use `uri` actions: order → `${DASHBOARD_BASE}/orders/{id}/edit` (`เปิดใบสั่งงาน` / `เปิดใบร่างในแดชบอร์ด`) and, for a real order only, `${DASHBOARD_BASE}/orders/{id}/print` (`พิมพ์ใบสั่งงาน`). Cards for a `split` draft show `รายการที่ {unitIdx+1}/{units.length}`. The summary shows name, `qty` + unit when present, customer, graphic name or `ไม่ผ่านกราฟฟิก`, press name or `ยังไม่ระบุ`, `displayDate(dateDue)`, orderer. The first card of a unit and the choices card show the net amount (`toLocaleString('th-TH')` + ` บ.`) and the quotation status. Visual tone: follow `lib/ai-quote/track-flex.ts`.

Limits: before writing the constant `FLEX_LABEL_MAX`, check the LINE Messaging API reference ("Action objects" → `label` limit for Flex buttons) and set it from the doc; if the 📝 label exceeds it, shorten the **label** to `📝 บันทึกเป็นใบร่าง` and keep "ในแดชบอร์ด" in the bubble text. Every text taken from Peak goes through one `clip(s, n)` helper (description lines ≤ 160 chars in cards; at most 8 lines listed, then `…อีก {n} รายการ`). `altText` ≤ 400 chars.

- [ ] **Step 1: Failing tests:** for each card — every postback `data` decodes (via `decodePostback`) to the expected action for that step, with the draft id and `unitIdx`; all labels ≤ `FLEX_LABEL_MAX`; `altText` ≤ 400; `text` is non-empty. Specific: `unitCard` has 9 unit buttons whose `v` are indexes 0–8, has `ข้ามรายการนี้` only for `split`; `graphicCard(d, true)` includes `เหมือนใบก่อน`, `(d, false)` does not; `pressCard` omits `ยังไม่ระบุ` when graphic is `''`; `dateCard(d, '2026-11-14')` picker has `min: '2026-11-14'`, `initial: '2026-11-15'`; `summaryCard` has exactly three buttons with `v` `create`, `draft`, and action `x`; `createdCard` for a draft has one `uri` button to `/orders/{id}/edit` and none to `/print`; `statusCard` with `remaining: []` has no `เปิดรายการที่เหลือ`; a 5,000-char description and a 12-line quotation produce cards whose serialized JSON is < 30,000 bytes and list 8 lines + the "…อีก" line *(Review Focus 1)*.
- [ ] **Step 2: Run** `npx vitest run tests/peak-order-flex.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS under default, `TZ=UTC`, and `TZ=Asia/Bangkok`.
- [ ] **Step 5: Commit** `feat(peak-order): Flex cards for every step with text fallbacks`

---

### Task 12: Handler — command entry

**Files:**
- Create: `lib/peak-order/handler.ts`, `tests/peak-order-handler-entry.test.ts`, `tests/helpers/peak-order-fakes.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 8, 9, 10, 11.
- Produces:
```ts
export interface PeakOrderDeps {
  reply: (m: InboundMessage, card: Card | string | Array<Card | string>) => Promise<void>;   // Flex-or-text fallback lives in the wiring (Task 14)
  peak: PeakReader;
  db: PeakOrderDb;
  createOrder: (body: CreateOrderBody, actor: OrderActor) => Promise<CreateOrderResult>;
  getDisplayName: (lineUserId: string) => Promise<string | null>;
  now: () => Date;
  newDraftId: () => string;
}
export const DRAFT_TTL_MS = 30 * 60_000;
export async function handlePeakOrderText(m: InboundMessage, deps: PeakOrderDeps): Promise<void>;
export async function startFromQuotation(m: InboundMessage, deps: PeakOrderDeps, q: PeakQuotation, customerName: string, orderer: string, opts?: { remainingOnly?: boolean }): Promise<void>;
// tests/helpers/peak-order-fakes.ts
export function fakeDb(seed?: { staff?: Record<string, string>; orders?: Record<number, { name: string; status: string }>; nowMs?: () => number }): PeakOrderDb & { drafts: Map<string, DraftRow>; links: Array<{ qoCode: string; lineKey: string; orderId: number | null; draftId: string; claimedAtMs: number }>; orders: Map<number, { name: string; status: string }> };
export function fakeDeps(over?: Partial<PeakOrderDeps>): { deps: PeakOrderDeps; replies: unknown[]; created: CreateOrderBody[] };
```
`fakeDb` is an in-memory `PeakOrderDb` that enforces the same semantics as the SQL: `advanceDraft` succeeds only at the exact `(unitIdx, step)`; `claimLines` is all-or-nothing and treats rows as live/dead by the Task 10 definition (using `orders` + `claimedAtMs` against a controllable clock).

`handlePeakOrderText` flow:
1. `m.channelUserId === ''` → reply `TEXT.noUser`; stop. *(Review Focus 3)*
2. `staff = db.getStaff(uid)`; none → reply `whoCard(orderCommandArgs(m.text))`; stop.
3. `parseOrderCommand` → `resolveOrderCommand(cmd, { peak, openedCodes: db.openedCodes, todayISO: bangkokISODate(deps.now()) })`.
4. `not-found` → reply the hint. `choices` → reply `choicesCard`. `quotation` → `startFromQuotation`.
5. Errors: `PeakNotConnectedError` / `PeakAuthError` → `TEXT.peakNotConnected`; `PeakUnavailableError` / `PeakToolError` → `TEXT.peakUnavailable`. Nothing else is swallowed.

`startFromQuotation`:
- status `Voided` (case-insensitive) → `TEXT.voided`. Zero lines → `TEXT.noLines`. *(Review Focus 5)*
- `live = db.liveLinks(code)`; `liveKeys` = their line keys **that exist in the current quotation** (unknown keys ignored); `free` = current lines not in `liveKeys`.
- `liveKeys` non-empty and not `remainingOnly` → reply `statusCard` (opened = distinct live `orderId`s with `orderName`, `isDraft` = `orderStatus === 'draft'`; remaining = `free` lines' first lines). Stop.
- Otherwise create a draft over `free` lines: one free line and the quotation has one line → `mode: 'single'`, `units = planUnits(q, 'single')`, step `'unit'` → reply `unitCard`. (The unit step is skipped **only** in merged mode.) `remainingOnly` (or free ≠ all lines) → `mode: 'split'`, `units = planUnits(q, 'split', freeKeys)`, step as above. Several lines, all free → `mode: null`, `units: []`, step `'mode'` → reply `modeCard`.

- [ ] **Step 1: Write the fakes**, then failing tests:
  - no `userId` → `TEXT.noUser`, no draft, no Peak call
  - unknown user → `whoCard` carrying the original args; no Peak call
  - known user, `/order QO-…` single line → draft row `{ mode: 'single', step: 'unit', unitIdx: 0, orderer: 'กิ๊ฟ', groupId, lineUserId }`, one unit, reply is `unitCard`
  - single line with `quantity: null` → unit `qty ''`, step still `'unit'`, reply `unitCard` *(Review Focus 2)*
  - 3-line quotation → step `'mode'`, reply `modeCard`
  - `Voided` → `TEXT.voided`; zero lines → `TEXT.noLines`; no draft either way
  - quotation with a live link on its only line → `statusCard` with that order, no draft
  - 3 lines, one live → `statusCard` with 1 opened + 2 remaining
  - link row for a line key that is not in the quotation any more → treated as absent *(Review Focus 5)*
  - linked order `status: 'cancelled'` → new draft (line is free)
  - `choices` and `not-found` paths reply the card / hint
  - `PeakNotConnectedError` → `TEXT.peakNotConnected`; `PeakUnavailableError` → `TEXT.peakUnavailable`
- [ ] **Step 2: Run** `npx vitest run tests/peak-order-handler-entry.test.ts` — FAIL.
- [ ] **Step 3: Implement** `handlePeakOrderText` + `startFromQuotation`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(peak-order): /order command entry — identity, resolve, status card, draft start`

---

### Task 13: Handler — postback state machine, create, draft, recovery

**Files:**
- Modify: `lib/peak-order/handler.ts`
- Create: `tests/peak-order-handler-steps.test.ts`

**Interfaces:**
- Consumes: everything in Task 12 + `buildOrderBody` (Task 8).
- Produces: `export async function handlePeakOrderPostback(m: InboundMessage, deps: PeakOrderDeps): Promise<void>;`

Dispatch (`decodePostback(m.postbackData)`; `null` → return silently; no `userId` → `TEXT.noUser`):
- `who`: `orderer === -1` → `TEXT.whoDeclined`. Else `db.setStaff(uid, ORDERERS[i], await getDisplayName(uid))` then continue as if the user had typed `/order {args}` (call `handlePeakOrderText` with a copy of `m` whose `text` is `'/order ' + args`). Out-of-range index → silent.
- `pick` / `rest`: requires a staff mapping (none → `whoCard('')`). `peak.getQuotation(code)` (`null` → not-found hint) + contact name → `startFromQuotation(…, { remainingOnly: a === 'rest' })`.
- every draft action: `d = db.loadDraft(id)`; missing → silent. `d.groupId !== m.groupId` → silent. `m.channelUserId !== d.lineUserId` → `TEXT.notOwner(d.orderer)`. Step `done`/`cancelled` → silent. `now − lastTouchedAt > DRAFT_TTL_MS` → `TEXT.expired` (no transition). The action's `u` must equal `d.unitIdx` and the action must belong to `d.step` — otherwise silent. Then one `advanceDraft` gate; `null` → silent.

Transitions (each row is one gate `from (u, step)` → `to`):

| Action at step | To | Reply |
|---|---|---|
| `mode` merged | `units = planUnits(q,'merged')`, `mode 'merged'`, step `graphic`, u 0 | `graphicCard(d, false)` |
| `mode` split | `units = planUnits(q,'split')`, `mode 'split'`, step `unit`, u 0 | `unitCard` |
| `unit` v = index | `choices.qtyUnit = QTY_UNITS[v]`, step `graphic` (invalid index → silent, no gate) | `graphicCard(d, canCopy)` |
| `unit` v = `skip` (split only) | `result = { kind: 'skipped' }`, advance to next unit | next unit's `unitCard`, or the quotation's `statusCard` when it was the last |
| `gfx` staff id / `none` | `choices.graphic = id \| ''`, step `press` (id must be in `STAFF.graphic`) | `pressCard` |
| `gfx` `same` | copy `graphic`, `press`, `dateDue` from the nearest earlier unit whose result is `order` or `draft`; step `confirm` (no such unit → silent) | `summaryCard` |
| `press` staff id / `none` | `choices.press = id \| ''`; `none` is rejected (silent) when `choices.graphic === ''`; step `date` | `dateCard(d, today)` |
| `date` `+N` / `pick` | `dateDue` = today + N days, or `m.postbackParams.date`; must match `/^\d{4}-\d{2}-\d{2}$/` and be ≥ today (Bangkok) else reply `TEXT.badDate` with **no gate** *(Review Focus 4)*; step `confirm` | `summaryCard` |
| `ok` create / draft | step `creating`, `creatingKind` | → create procedure |
| `dup` force (at step `dup`) | step `creating`, `creatingKind 'create'` | → create procedure with `force` |
| `x` | `db.cancelDraft(id)` | `TEXT.cancelled` (only when it returned `true`) |

`canCopy` = `mode === 'split'` and some earlier unit has result `order`/`draft`. "Advance to next unit" = `unitIdx + 1` with step `unit`; past the last unit → step `done`. Today's date everywhere = `bangkokISODate(deps.now())`.

Create procedure (after winning the gate into `creating`):
1. `claimed = db.claimLines(qoCode, unit.lineKeys, d.id, d.orderer)`. `false` → gate back to `confirm`, reply the current `statusCard` for the quotation (someone else opened it).
2. `existing = db.findOrderByPeakMarker(qoCode, unit.lineKeys)` → if found: `finalizeLinks`, record `result { kind: 'existing', orderId }`, advance, reply `createdCard`. (Adopts an order written by an attempt that died before finalizing.)
3. `r = createOrder(buildOrderBody({ …, asDraft: creatingKind === 'draft', force }), { role: 'sales', user: `${d.orderer} (LINE)` })`.
4. `r.ok` → `finalizeLinks(qoCode, d.id, r.orderId)`; `result = { kind: asDraft ? 'draft' : 'order', orderId, jobId, pin }`; advance to the next unit or `done`; reply `createdCard` and, for a split draft with units left, the next unit's first card in the same reply (array).
5. `r.kind === 'duplicate'` → `releaseClaim`; gate `creating → dup`; reply `dupCard`.
6. `r.kind === 'validation'` or `'failure'`, or any throw → `releaseClaim`; gate `creating → confirm`; reply `TEXT.createFailed` (+ the validation message when there is one). A throw from `releaseClaim` is logged, not rethrown.

Recovery: an `ok`/`dup` tap that finds `d.step === 'creating'` with `now − lastTouchedAt > 2 min` → `findOrderByPeakMarker`; found → finalize as in step 2; not found → `releaseClaim`, gate `creating → confirm`, reply `summaryCard` again. A `creating` younger than 2 min → silent.

- [ ] **Step 1: Failing tests** (fakes from Task 12; a helper `tap(deps, postback, { user, group, date })` builds the inbound message):
  - happy path single line: unit(6) → gfx(pook) → press(inkjet) → date(+3) → ok(create): `createOrder` called once with `assignStaff 'pook'`, `forwardPrint 'inkjet'`, `qtyUnit 'ชิ้น'`, `dateDue` = today+3 (Bangkok), `orderer 'กิ๊ฟ'`, actor `{ role: 'sales', user: 'กิ๊ฟ (LINE)' }`; link row has the order id; draft step `done`; last reply is `createdCard`
  - `ok` draft → body `status: 'draft'`; `createdCard.isDraft`; link finalized
  - `gfx none` → `pressCard` without `ยังไม่ระบุ`; a forged `press none` is ignored and the step stays `press`
  - `date pick` with `postbackParams.date` yesterday → `TEXT.badDate`, step still `date`; `'2026-13-40'` and missing params → same; today is accepted *(Review Focus 4)*
  - merged 3-line: no unit step; body `qty ''`, notes contain all three blocks; all three line keys linked to the one order
  - split 3-line: unit 0 create → reply array `[createdCard, unitCard(unit 1)]`; unit 1 `skip` → unit 2; unit 2 `gfx same` → `summaryCard` with unit 0's graphic/press/date but its own unit choice; finishing → `done`; links exist for lines 0 and 2 only
  - `gfx same` on unit 0 → ignored
  - double tap on `ok` → `createOrder` called once *(then delete the gate check in `advanceDraft` of the fake and confirm this test goes red — mutation check; restore)*
  - another user taps → `TEXT.notOwner('กิ๊ฟ')`, no transition; another group → silent
  - tap on an earlier step's card → silent, no transition
  - expired (31 min) → `TEXT.expired`; `x` → step `cancelled`, later taps silent
  - two drafts for the same quotation, both reach `ok` → second gets the status card, `createOrder` called once *(mutation check: make the fake's `claimLines` always return true → test red; restore)*
  - `createOrder` → duplicate → claim released, step `dup`, `dupCard`; `dup force` → created with `force: true`
  - `createOrder` throws → claim released, step `confirm`, `TEXT.createFailed`; tapping `ok` again succeeds
  - crash recovery: draft stuck at `creating` 3 min ago and an order carrying the marker exists → tap `ok` finalizes with that order, `createOrder` not called; no such order → back to `confirm` + `summaryCard`
  - linked order later `cancelled` → a new `/order` for the same quotation starts a fresh draft and `claimLines` succeeds (takeover)
  - `who` → mapping saved with the display name, then the original args are resolved; `who -1` → `TEXT.whoDeclined`, nothing saved
  - `pick` → draft started; `rest` on a partly opened quotation → split draft over the free lines only
  - malformed postback data → silent
- [ ] **Step 2: Run** `npx vitest run tests/peak-order-handler-steps.test.ts` — FAIL.
- [ ] **Step 3: Implement** `handlePeakOrderPostback`.
- [ ] **Step 4: Run** both handler test files under default, `TZ=UTC`, `TZ=Asia/Bangkok` — PASS. Perform the two mutation checks named above and note the result in the commit body.
- [ ] **Step 5: Commit** `feat(peak-order): postback state machine — create, dashboard draft, duplicate confirm, recovery`

---

### Task 14: Wiring, flag, staff-mapping admin

**Files:**
- Create: `lib/peak-order/deps.ts`, `app/api/admin/peak/staff/route.ts`, `tests/peak-order-deps.test.ts`
- Modify: `app/api/ai-quote/line/route.ts`, `app/peak/page.tsx`, `app/peak/peak-client.tsx`, `tests/peak-admin-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–13; `ChannelAdapter` from `@/lib/ai-quote/channels/types`; `getLineProfile`.
- Produces:
```ts
export function peakOrderConfig(env?: NodeJS.ProcessEnv): { enabled: boolean; groupIds: string[] };
// enabled ⇔ PEAK_ORDER_ENABLED === 'true' && groupIds.length > 0 && !!PEAK_TOKEN_ENC_KEY ; groupIds = comma-split, trimmed, empties removed
export function buildPeakOrderArm(adapter: Pick<ChannelAdapter, 'reply'>, env?: NodeJS.ProcessEnv): PeakOrderArm | undefined;   // undefined when disabled
```
`buildPeakOrderArm` builds `PeakOrderDeps` with: `peak = createPeakReader(createPeakClient())` (**a new client per inbound message**), `db = peakOrderDb`, `createOrder = createOrderFromForm`, `getDisplayName = async (uid) => (await getLineProfile(uid))?.displayName ?? null`, `now = () => new Date()`, `newDraftId`, and `reply` = for each card try `adapter.reply(m, flex…)`; if it throws, log and `adapter.reply(m, text…)` (same idea as `replyFlexOrText`; strings pass through; arrays are sent as one reply). The line route passes `peakOrder: buildPeakOrderArm(adapter)` into `handleInbound`'s deps.

Staff route: `POST /api/admin/peak/staff` body `{ lineUserId }`, admin only → `peakOrderDb.deleteStaff` → `{ ok: true }`; missing id → 400. The `/peak` page lists `peakOrderDb.listStaff()` (orderer, display name, date) with a remove button per row, and shows whether the feature flag is on and how many group ids are configured (never the ids' full values — last 4 chars).

- [ ] **Step 1: Failing tests:** `peakOrderConfig` — enabled only with all three env values; `' G1, ,G2 '` → `['G1','G2']`; `buildPeakOrderArm` → `undefined` when disabled, otherwise `{ groupIds, handleText, handlePostback }`; the `reply` wrapper falls back to the text when the adapter throws on the Flex and rethrows when the text send also fails; staff route: non-admin blocked, delete called with the id, 400 without it.
- [ ] **Step 2: Run** `npx vitest run tests/peak-order-deps.test.ts tests/peak-admin-routes.test.ts` — FAIL.
- [ ] **Step 3: Implement** + wire the line route + extend the page.
- [ ] **Step 4: Run** `npm run type-check && npm run lint && npm test && npm run build` — all green.
- [ ] **Step 5: Commit** `feat(peak-order): wire /order arm into the LINE webhook behind PEAK_ORDER_* flags + staff mapping admin`

---

### Task 15: Docs, rollout checklist, and review hand-off

**Files:**
- Modify: `dashboard-v2.md` (version history entry + routes: `/peak`, `/api/admin/peak/*`, `/api/cron/peak-keepalive`; env vars), `design-ai-quoting.md` (§7: new group command `/order`; §10: replace the April-2026 PEAK API cost analysis with the credit system effective 1 Aug 2026 — read/search free, create-document 1 credit, PRO Plus 100 free/month — and note MCP replaced the Open API plan), `PATTERNS.md` (two entries: "rotating refresh token ⇒ DB single-flight + persist-before-use" and "group postback flow: conditional gate per (unit, step) + claim-first idempotency"), `CLAUDE.md` of this repo (routes/env tables), `NEXT-SESSION.md` (session entry + queued user actions below)

- [ ] **Step 1: Write the doc updates.** User actions to queue in `NEXT-SESSION.md`, in order (spec §6.8):
  1. Merge/deploy with the flag off; wait for the post-deploy smoke run of that commit to go green (match the run's `headSha`).
  2. Vercel env: `PEAK_TOKEN_ENC_KEY` = base64 of 32 random bytes, **Sensitive**; redeploy; only after the new deployment is live open `/api/admin/db-migrate` and check the applied list contains `peak_oauth`, `peak_order_staff`, `peak_order_drafts`, `peak_order_links`.
  3. Open `/peak` → "เชื่อมต่อ Peak" → log in at Peak → back on `/peak` press "ทดสอบ".
  4. In the staff group type `/groupid`; set `PEAK_ORDER_GROUP_IDS` to that id and `PEAK_ORDER_ENABLED=true`; redeploy.
  5. Smoke in the real group: `/order` → pick → all steps → ✅ → job on /board, edit + print pages open; `/order` same quotation again → status card; cancel the test order in the dashboard → `/order` again starts a new draft; a second quotation → "บันทึกเป็นใบร่างในแดชบอร์ด" → appears under the ร่าง tab of `/orders`, not on the board, opens in the form with unit/graphic/press/date/orderer pre-selected; a multi-line quotation → split with one skip and one "เหมือนใบก่อน"; double-tap ✅ quickly → one order; `/order` in another group and in 1-on-1 → silence.
  6. After a successful real connect: delete the probe token file in the session scratchpad and remove the probe MCP key in Peak if a separate one was created.
- [ ] **Step 2: Run** `npm run type-check && npm run lint && npm test` — green.
- [ ] **Step 3: Commit** `docs: /order from Peak — routes, env, patterns, PEAK cost section, rollout checklist`
- [ ] **Step 4: Whole-branch review** (per the execution skill) against the spec's anti-goals: duplicate orders, form behaviour change, non-allowed groups, token leakage (grep the branch diff for `console.` lines near token variables), silent Peak failure.
