# Penprinting Dashboard v2

`dashboard.penprinting.co` — Next.js 14 App Router dashboard ที่ค่อยๆ ย้าย feature มาจาก WordPress dashboard เดิม (`app.penprinting.co/production-monitoring`) แบบ **strangler pattern**

## ★ ก่อนแก้อะไร — อ่านไฟล์นี้ก่อน

1. **[dashboard-v2.md](dashboard-v2.md)** 📚 — comprehensive source of truth (stack, routes, auth, features, version history, deploy, lessons learned). Mirror ของ `monitoring.md` แต่สำหรับฝั่ง v2
2. **[NEXT-SESSION.md](NEXT-SESSION.md)** ⭐ — pick-up-here doc สำหรับ session ใหม่ (เสร็จแล้วอะไร/เหลืออะไร/decisions ที่ผ่านมา)
3. **[PATTERNS.md](PATTERNS.md)** — Reusable patterns ที่ค้นพบใน v2 (Apps Script, permissions, URL state, icons, forms, auto-sync, things-not-to-do)
4. **[AUDIT-BACKLOG.md](AUDIT-BACKLOG.md)** — running audit findings tracker (rounds + closed batches)
5. **[migration-plan-vercel-postgres.md](migration-plan-vercel-postgres.md)** — DB migration roadmap (planned, not started)
6. **[Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md)** ใน workspace root — สถานะ migration phases ภาพรวม
7. **[../production-monitoring/monitoring.md](../production-monitoring/monitoring.md)** — WP source of truth + **shared infrastructure** (Sheet schema, security model, recurring lessons)

## Stack
- **Next.js 14** (App Router) + TypeScript + Tailwind 3
- **Hosting**: Vercel auto-deploy ทุก `git push origin main`
- **GitHub**: `witsarutnook/penprinting-dashboard` (private)
- **Font**: Anuphan (Thai) + Inter (numerals) ผ่าน next/font/google
- **Brand**: accent `#c8553d`

## Auth & sessions
- Cookie name: `pp_dashboard_v6` (separate from WP `pp_dashboard_auth_v5`)
- HMAC-SHA256 via Web Crypto API (Edge-compatible, works in middleware)
- 4 passwords mapped to roles via `DASHBOARD_AUTH_USERS` env (JSON map)
- Service token `APPS_SCRIPT_TOKEN` (signed `api:admin:dashboard:<exp>:<hmac>`, 5y) — talks to Apps Script
- Limitation: audit actor = `admin:dashboard` for all v2 mutations (per-user signing is tech debt)

## Routes (post Phase 3.5.8)
| Route | Auth | Notes |
|---|---|---|
| `/` | open | Home with feature links |
| `/login` | open | HMAC cookie auth, rate-limit 5/5min |
| `/board` | any role | Kanban + URL filters (`?dept=` `?u=` `?q=`) + bulk-mode + auto-sync |
| `/analytics` | any role | KPIs + 4 charts (recharts), 60s ISR |
| `/calendar` | admin | Month grid + Bangkok TZ + mobile vertical list |
| `/archive` | admin | Search archived sheets |

## API routes
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/{login,logout}` | POST | open / cookie | Session management |
| `/api/jobs/add` | POST | admin+sales | Add standalone job (allocates nextId) |
| `/api/jobs/update` | POST | admin | Edit job fields |
| `/api/jobs/delete` | POST | admin | Hard delete |
| `/api/jobs/cancel` | POST | admin | Move to cancelled with reason |
| `/api/jobs/move-to-shipped` | POST | any | Mark shipped |
| `/api/jobs/forward` | POST | any | Atomic single forward (uses bulkForward(items=1)) |
| `/api/jobs/bulk-forward` | POST | any | 1-25 jobs/batch atomic |
| `/api/jobs/reassign` | POST | any | Same-dept staff swap |
| `/api/jobs/cowork` | POST | any | Set co-work list |
| `/api/orders/add` | POST | admin+sales | Create order + initial job + PIN |

## Roadmap (current)
- Phase 3.1 ✅ — scaffold
- Phase 3.2 ✅ — Analytics port
- Phase 3.3 ✅ — Calendar port
- Phase 3.4 ✅ — Archive port
- Phase 3.5.1-3.5.8 ✅ + 3.5.5b/3.5.7b deferred — Kanban + write actions
- Phase 2.3 — WP UI parity (sidebar + KPI bar + dept icon-headers + filter chips + inline bulk-mode) — Stage A+B+C ✅, Stage D in progress

## Dev
```bash
npm install
npm run dev              # localhost:3000
npm run type-check       # tsc --noEmit
npm run build            # before push
```

## Env vars (Vercel project)
- `APPS_SCRIPT_URL` — Dashboard Apps Script web app URL
- `APPS_SCRIPT_TOKEN` — service token (5y)
- `DASHBOARD_AUTH_SECRET` — random ≥32 chars (cookie HMAC)
- `DASHBOARD_AUTH_USERS` — JSON map password → {role, user}
- `NEXT_PUBLIC_SENTRY_DSN` (optional) — error tracking

## Source-of-truth files
| File | Owns |
|---|---|
| [lib/icons.tsx](lib/icons.tsx) | All outline SVG icons (no emoji) |
| [lib/staff-icons.tsx](lib/staff-icons.tsx) | Per-staff icon + color theming |
| [lib/board.ts](lib/board.ts) | STAFF map + computeBoard + filter logic |
| [lib/forward.ts](lib/forward.ts) | FW_TARGETS + RESTRICTED_TARGETS + validateForwardTarget |
| [lib/auto-sync.tsx](lib/auto-sync.tsx) | `broadcastWrite` (cross-tab BroadcastChannel) — useAutoSync retired 2026-06-03 |
| [lib/delta-sync.tsx](lib/delta-sync.tsx) | `useDeltaSync` + `mergeDelta` + `applyFullList` (sole auto-sync) |
| [lib/board-delta.ts](lib/board-delta.ts) | `loadBoardDelta` server loader (lists / fullLists modes) |
| [components/nav-config.ts](components/nav-config.ts) | Sidebar + bottom-nav source of truth |
| [components/dashboard-shell.tsx](components/dashboard-shell.tsx) | Layout wrapper |

## Subagent ที่ใช้กับ project นี้
- `penprinting-deployer` — ที่ push เพราะ Vercel auto-deploys, แต่ผ่าน slash command `/deploy` ก็ได้
- `penprinting-auditor` — ตรวจบักหลังแก้ feature
- ไม่ใช้ `penprinting-data-doctor` (Sheet ตัวเดียวกับ WP — ใช้กับ production-monitoring แทน)
