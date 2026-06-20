# Migration Plan — Dashboard Next 14 → 15 + React 18 → 19

> **Status:** ✅ DONE + LIVE (shipped 2026-06-20, PR #1 → `2c22301`). Migration `1d9cb6e` + board hydration fix `45d6c77`, squash-merged. Verified on Vercel preview + production. Plan held: ~27 mechanical edits matched the audit; the **one surprise** was a React-19 hydration mismatch (#418) on /board — see "Board #418" note at bottom. Soak: watch Sentry 1-2 days.
> **Audited by:** read-only scan of the whole repo — surface enumerated below, **no re-audit needed**.
> **Context:** Last of 4 Vercel repos to migrate. calc (Phase 1) · web (Phase 2, `a29b38f`) · photobook (Phase 3, `8927e5b`) all done & soaked. Dashboard is the biggest but **well-bounded — no architectural change**.
> **Target versions (match the 3 soaked repos):** next `^15.5.19` · react/react-dom `^19.2.7` · @types/react `^19.2.16` · @types/react-dom `^19.2.3` · eslint-config-next `^15.5.19`. Keep: typescript `^5`, tailwindcss `3.4.x`, @sentry/nextjs `10.56` (already current), recharts `3.8` (React 19 compatible).

---

## TL;DR — effort = Medium

- **~27 mechanical edits** across ~20 files (codemod handles most) + **3 eslint link fixes** + deps bump.
- **The real cost is smoke testing**, not code: 6-7 flows (login / board nav / create-order→board / print / track / analytics / calendar).
- One session is enough. Deploy → smoke → watch Sentry 1-2 days (dashboard HAS a Sentry project, unlike photobook).

---

## ✅ Already safe — DO NOT TOUCH (verified 2026-06-18)

| Area | Why no work |
|---|---|
| **Sentry** | Already on modern pattern: `instrumentation.ts` (server+edge via `NEXT_RUNTIME`) + `onRequestError` (`captureRequestError`) + custom `components/sentry-init.tsx` (client init from layout). Does **not** use `sentry.client.config.ts`. Keep `sentry.server.config.ts` + `sentry.edge.config.ts` (imported by `register()` — standard). |
| **next.config.mjs** | No `swcMinify`, no `images.domains`, no `disableLogger`. `withSentryConfig` options are all Next-15-valid. redirects + headers = stable APIs. **0 changes.** |
| **middleware.ts** | Uses `req.cookies.get()` (NextRequest — synchronous) + `req.nextUrl.searchParams`. These are **NOT** the async `cookies()`/`searchParams` from Next 15. **0 changes.** |
| **React 19** | No `useFormState` / `findDOMNode` / `ReactDOM.render` / `defaultProps=` / `propTypes=` / `forwardRef`. recharts `3.8.1` supports React 19. 46 `'use client'` files have no API breakage (behavioral-only — see smoke). |
| **Server `fetch` in `lib/api.ts` `post()`** | Already sets `next: { revalidate: 0 }` explicit → Next 15's force-cache→no-store default doesn't change it. Only used by `searchArchive` post-§12. |
| **`@next/third-parties`** | Dashboard does NOT depend on it (web/photobook do). No bump. |
| **~25 client `fetch()`** | Browser fetch (board/orders/login/etc.) — unaffected by server caching changes. `order-form.tsx:63` sets `cache:'force-cache'` explicit — fine. |

---

## 🔧 Edit sites — compile-time (run codemod FIRST, then verify these)

> **Codemod:** `npx @next/codemod@latest next-async-request-api .` auto-converts categories 1-3. **Review every hunk** (it can be conservative — wraps in `await` but sometimes leaves `(await cookies())` chains to tidy). Then handle category 4 by hand.

### Cat 1 — async `cookies()` → `await cookies()` (14 sites)
Each is `const cookieStore = cookies()` (server component) → `await cookies()`. Pages are already `async` (or trivially made so).

- `lib/route-helpers.ts:11` — `requireSession()` (already async) — **covers ALL API routes that call it**, single fix
- `lib/api.ts:160` — `currentActor()` — `cookies().get(...)` → `(await cookies()).get(...)`
- 12 page.tsx: `app/page.tsx` · `app/board/page.tsx` · `app/orders/page.tsx` · `app/orders/new/page.tsx` · `app/analytics/page.tsx` · `app/calendar/page.tsx` · `app/archive/page.tsx` · `app/cancelled/page.tsx` · `app/shipped/page.tsx` · `app/orders/[id]/print/page.tsx` · `app/orders/[id]/edit/page.tsx` · `app/orders/[id]/tracking-card/page.tsx`

### Cat 2 — async `params` → `Promise<{...}>` + `await` (4 sites)
All targets are **already `async`** — just change the type + destructure with await, replace `params.id` refs.
```ts
// before
export default async function X({ params }: { params: { id: string } }) {
  ... params.id ...
// after
export default async function X({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  ... id ...
```
- `app/orders/[id]/print/page.tsx:55` (2 refs: redirect next + `Number(params.id)`)
- `app/orders/[id]/edit/page.tsx:16` (refs at :19, :26)
- `app/orders/[id]/tracking-card/page.tsx:20` (refs at :23, :25)
- `app/api/orders/raw/[id]/route.ts:19` — GET handler, 2nd arg `{ params }: { params: Promise<{ id: string }> }` + `await` (ref at :37)

### Cat 3 — async `searchParams` → `Promise<SearchParams>` + `await` (6 pages)
Pages destructure `searchParams` prop + access `.q`/`.view`/`.m` sync. Make the prop type `Promise<...>` + `const sp = await searchParams`. **Update the shared `SearchParams` type alias too** (grep its definition — used by orders/analytics).
- `app/track/page.tsx` · `app/calendar/page.tsx` · `app/archive/page.tsx` · `app/orders/page.tsx` · `app/orders/new/page.tsx` · `app/analytics/page.tsx`
- ⚠️ `app/calendar/page.tsx` also has `const params = new URLSearchParams()` at :165 — **that's a local var, NOT route params. Leave it.** (calendar is not a dynamic route — searchParams only)

### Cat 4 — eslint `<a href="/">` → `next/link <Link>` (3 sites) — BY HAND
`eslint-config-next@15` extends `@next/next/no-html-link-for-pages` to the `app/` dir (was a clean gate on 14). Confirmed errors:
- `app/cancelled/list-client.tsx:228` — `<a href="/cancelled">`
- `app/shipped/list-client.tsx:207` — `<a href="/shipped">`
- `app/orders/page.tsx:161` — `<a href="/orders">`

> ⚠️ **DECISION REQUIRED**: these look like "reset filter / reload" links that intentionally do a **full page reload** to clear client-side filter state. Converting to `<Link>` = client-side nav, which may **leave stale filter state**. Two options — pick per-link:
> - (a) convert to `<Link>` AND verify the filter actually resets (test it), or
> - (b) keep `<a>` + `{/* eslint-disable-next-line @next/next/no-html-link-for-pages */}` with a one-line reason (full-reload intentional).
> Recommend reading each link's surrounding component to judge intent before deciding.

### Cat 5 — deps bump (`package.json`)
```
next               14.2.35  → ^15.5.19
react              ^18      → ^19.2.7
react-dom          ^18      → ^19.2.7
@types/react       ^18.3.30 → ^19.2.16
@types/react-dom   ^18      → ^19.2.3
eslint-config-next 14.2.35  → ^15.5.19
```
Then `npm install` (regen lockfile), confirm `npm ls react react-dom` dedupes to 19.x.

---

## ⚠️ Risk areas — behavioral (compiles fine, behavior changes → SMOKE)

1. **Client Router Cache `staleTimes` default → 0** (Next 15's biggest behavioral change). Next 14 cached page segments on client nav; Next 15 re-fetches. Dashboard leans hard on `delta-sync` + `revalidateTag('load-all')`, so this *might* be fine or *might* cause extra re-fetches/flicker navigating /board ↔ /orders ↔ /calendar. **Mitigation if it regresses:** restore old behavior via
   ```js
   // next.config.mjs
   experimental: { staleTimes: { dynamic: 30, static: 180 } }
   ```
2. **`unstable_cache(loadAllSnapshot, ['load-all-snapshot'])`** (`lib/api.ts:69`) busted by `revalidateTag('load-all')` in 6 API routes (orders add/update/cancel/promote-draft + templates add/delete). API unchanged in Next 15 — **but smoke: create an order → it must appear on /board immediately** (cache bust still works).
3. **Edge runtime routes** (Web Crypto HMAC): `api/auth/login` · `api/auth/logout` · `api/track/lookup`. Next 15 edge is stable — **smoke login + one /track lookup**.
4. **`force-dynamic` pages**: `app/track/page.tsx` + `app/orders/[id]/print/page.tsx` — stable, but print is in the smoke list anyway.

---

## 📋 Execution order (single session)

1. `git switch -c` (optional branch) — or work on main (Vercel auto-deploys main; consider a branch + preview deploy for this bigger change)
2. **Deps bump** `package.json` → `npm install` → verify dedupe
3. **Run codemod** `npx @next/codemod@latest next-async-request-api .` → `git diff` review every hunk (Cat 1-3)
4. **Cat 4 by hand** (3 eslint links — decide convert vs disable per link)
5. **Gates** (Node 22 — `.nvmrc` already pins 22, but shell may default to 18; `nvm use 22` in the SAME bash call as commit because of the vitest pre-commit hook):
   ```
   npm run type-check && npm run lint && npm test && npm run build
   ```
   Expect: 148 vitest pass · build ~39 pages
6. **Commit + push** (or push branch → Vercel preview)
7. **Post-deploy verify** (curl): key routes 200 + chunk hash live + `/track` + `/board`
8. **Smoke (logged-in, real data — drive via Chrome MCP in คุณนุ๊ก's browser per [[feedback_penprinting_chrome_rollout]]):**
   - [ ] Login (edge HMAC)
   - [ ] /board renders + kanban cards + filter chips + nav /board↔/orders↔/calendar (watch for staleTimes flicker — risk #1)
   - [ ] Create order → appears on /board immediately (risk #2, cache bust)
   - [ ] Forward / move-to-shipped / cowork a job (client fetch + revalidate)
   - [ ] Open a print page `/orders/[id]/print` (async params + force-dynamic)
   - [ ] /analytics charts (recharts 3.8 under React 19)
   - [ ] /calendar month grid + ?m= filter (async searchParams)
   - [ ] /track lookup with a real order id + PIN (edge route)
9. **Watch Sentry** (project: dashboard) for error spike 1-2 days. **Soak ~1 week before** considering it stable (same cadence as web/calc).

## Rollback
- If on a branch: don't promote / revert the merge.
- If on main: `git revert <commit>` → Vercel redeploys Next 14. Deps revert via the reverted `package.json` + `npm install`. No DB/schema involved → clean rollback.

## Board #418 — the one thing the audit didn't predict (fixed `45d6c77`)

After the bump, `/board` threw **React #418 (hydration text mismatch)** on every load. Diagnosis (Chrome MCP + a TZ harness):
- **Confirmed real, not extension noise** — reproduced in incognito (extensions off); production React 18 board was console-clean. So React 19 surfaces a mismatch React 18 silently recovered from.
- **Values were always correct** — ruled out the date math by proof (server-UTC vs client-Bangkok `getBangkokToday()`/`daysUntilDue` offsets cancel exactly), plus `displayDate`/`Intl` are all TZ+locale-pinned. The mismatch is the board's data-derived text (KPI counts, "รับ Xว", card order) computed client-side off a live `useDeltaSync` snapshot, where SSR pass and first client render can differ.
- **Root-class fix (not `suppressHydrationWarning`):** `BoardClient` now gates the data-derived tree on a post-mount flag — SSR + first client render emit the SAME `<BoardSkeleton/>` (byte-clean hydration), real board paints one tick later. Removes the whole hydration surface. `BoardSkeleton` extracted to `app/board/board-skeleton.tsx` (shared with the page.tsx Suspense fallback → seamless hand-off).
- **Lesson:** a real-time client-driven view (delta-sync) shouldn't SSR its volatile content under React 19 — the SSR/hydration text WILL race. Check `/board`-like pages on the other repos if they ever add live data. See [[feedback_react19_hydration_realtime_board]].

## Also surfaced
- **`.eslintrc` ignore `next-env.d.ts`** — Next 15.5 adds `/// <reference path="./.next/types/routes.d.ts" />`, a `path` triple-slash ref that trips `next/typescript`'s `no-triple-slash-reference`. Pre-commit lint failed on the auto-gen file; ignoring it is the standard fix.

## Gotchas captured in memory
- [[feedback_port_sibling_repo_framework_drift]] — web/calc/photobook are the proven reference; mirror their migration, and the **eslint `<a href>` gotcha** (Cat 4) is documented there too.
- [[feedback_penprinting_dashboard_node22_commit]] — `nvm use 22` in the same Bash call as `git commit` (vitest/rolldown pre-commit crashes on Node 18).
- [[feedback_audit_before_plan]] — this doc IS the audit; surface enumerated, but **re-grep line numbers before editing** (they drift).
