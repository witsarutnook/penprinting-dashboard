# Migration Plan — Google Sheet → Vercel Postgres

> Decision logged 2026-05-09: **Vercel Postgres** (Powered by Neon) เลือกแทน Supabase. ดูเหตุผลใน "Decision rationale" ด้านล่าง.
>
> Status: **Planned, not started**. Trigger conditions ใน "When to start" — รอ pain point จริง ไม่ migrate proactively.

---

## Decision rationale (Vercel Postgres > Supabase)

| Criterion | Vercel Postgres | Supabase | Winner |
|---|---|---|---|
| Cost ที่ Pro tier ปัจจุบัน | $0 extra (รวมใน Pro plan) | $25/mo Pro หลัง free tier | Vercel ✅ |
| Single dashboard / single bill | ✅ | ❌ extra account | Vercel ✅ |
| Realtime subscriptions | ❌ ต้อง roll own | ✅ native | Supabase |
| Built-in Auth | ❌ keep HMAC | ✅ Auth + RLS | Supabase |
| Admin UI | 🟡 SQL editor only | ⭐ Studio table editor | Supabase |
| Branching DB | ✅ Neon branches | ❌ | Vercel ✅ |
| Speed (raw query) | เท่ากัน (ทั้งคู่ Postgres 15) | เท่ากัน | tie |
| Lock-in | ต่ำ (Postgres mainline) | ต่ำ (Postgres mainline) | tie |

**Decision drivers:**
1. ใช้ Pro plan อยู่แล้ว → "already paid for"
2. Realtime ไม่ใช่ pain point ตอนนี้ (auto-sync polling smart backoff ทำงานดี)
3. Simpler stack — ไม่เพิ่ม vendor
4. Schema portable → ถ้าวันหนึ่งต้องการ realtime → migrate Vercel Postgres → Supabase ใช้เวลา 3-5 วัน (export pg_dump + import)

---

## When to start

**ไม่ migrate proactively.** รอ trigger ข้อใดข้อหนึ่ง:

| Trigger | Threshold | Why |
|---|---|---|
| Order volume | 400+ active orders | Sheet API จะช้าจน user รู้สึก (TextFinder + getDisplayValues N+1) |
| Apps Script daily script time | > 4 hr/day approaching 6 hr cap | Workspace plan limit |
| UrlFetchApp daily | > 50K calls (50% of 100K cap) | Approaching quota |
| Multi-user concurrent edit | 2+ staff editing same order/board pretty | Apps Script LockService bottleneck (30 concurrent max) |
| Need real-time KPI / TV display | When TV kiosk demand returns | Polling won't scale |
| Need cohort/funnel analytics | Year-over-year comparisons | Sheet aggregation in JS becomes infeasible |

**ระยะปัจจุบัน (2026-05): 123 orders, 42 jobs, 4-6 staff** — ใช้ <5% ของ Sheet API capacity. Runway 1-3 ปี.

---

## Migration phases (4-6 weeks part-time / 2-3 weeks focused)

### Phase 0 — Setup + Schema (1-2 days)
- Create Vercel Postgres database via Vercel dashboard
- Auto-injected env vars: `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`
- Choose ORM: **Drizzle** (recommended — TS-native, lightweight, Vercel Postgres official adapter) or Prisma (heavier, more familiar)
- Design schema (see "Schema design" below)
- Run migrations on Neon branch first

### Phase 1 — Dual-write parallel (2-3 days)
- Apps Script trigger: every Sheet write → mirror to Postgres via webhook
- Or: scheduled sync every 5 min for low-write tolerance
- Verify data parity for 1 week (row counts + sample diffs)
- **No reads from Postgres yet** — Sheet still source of truth

### Phase 2 — Read migration (1-2 weeks, gradual)
Order of migration (ground-up risk):
1. `/api/track/lookup` (public, low-risk) — fall back to Apps Script if Postgres errors
2. `/analytics` (heavy aggregation, big perf win) — measure speed delta
3. `/api/audit` + history tab (server-side filter cheap)
4. `/board` page-level loadAll → Postgres
5. `/orders` page-level loadAll → Postgres
6. `/calendar`, `/shipped`, `/cancelled` (depend on jobs/shipped/cancelled tables)

Each step: keep Sheet as fallback (try Postgres → catch error → fall through to Apps Script). Add monitoring.

### Phase 3 — Write migration (1 week)
- v2 API routes write Postgres directly (drop Apps Script for writes)
- Apps Script becomes read-only mirror — sync FROM Postgres TO Sheet for admin UI
- Or: Sheet becomes pure archive (admin uses Vercel Postgres browser tools or NocoDB read-only view)

### Phase 4 — Cleanup (3-5 days)
- LINE webhook: Cloudflare Worker → Vercel API (drop Apps Script LINE webhook)
- ✅ **Morning report — DONE 2026-05-18** (pulled forward, read-only so no dependency on 4.2). Ported the standalone "Morning Report V2" Apps Script project entirely into `lib/morning-report.ts` + `app/api/cron/morning-report/route.ts` — reads jobs+orders via `loadAll()`, builds the LINE Flex carousel, pushes to LINE. Morning Report Apps Script project retired (single scheduler = no more double-fire).
- Audit cron: write directly to Postgres trigger or Vercel Cron
- Drop Apps Script as primary backend (keep as historical / disaster recovery)
- R2 backup → use Postgres pg_dump → R2 instead of Sheet → R2

---

## Schema design

```sql
-- Orders — source of truth for order entry
CREATE TABLE orders (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  customer    TEXT,
  date_in     DATE,
  date_due    DATE,
  price       NUMERIC(12, 2),
  orderer     TEXT,
  pin         CHAR(4),
  status      TEXT NOT NULL CHECK (status IN ('draft','sent','cancelled','deleted')),
  details     JSONB,           -- WP-shape form snapshot
  raw_data    JSONB,           -- mirror of details (kept for backward compat)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs — production queue (one job per dept stage)
CREATE TABLE jobs (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  date        DATE,             -- due date snapshot
  date_in     DATE,
  staff       TEXT,
  dept        TEXT NOT NULL CHECK (dept IN ('graphic','print','post')),
  status      TEXT NOT NULL,
  cowork      JSONB,            -- array of staff ids
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Shipped — completed jobs
CREATE TABLE shipped (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  shipped_date  DATE,
  shipped_by    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Cancelled — cancelled jobs (with restore option)
CREATE TABLE cancelled (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  cancelled_date  DATE,
  cancelled_by    TEXT,
  reason          TEXT,
  src_dept        TEXT,
  src_staff       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log — append-only, archived to Postgres partition or S3 after 180 days
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ DEFAULT NOW(),
  role        TEXT,
  user_name   TEXT,
  action      TEXT NOT NULL,
  target_id   BIGINT,         -- jobId or orderId
  summary     TEXT
);

-- Templates — order entry templates
CREATE TABLE templates (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  raw_data    JSONB NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for hot queries
CREATE INDEX idx_jobs_dept_status ON jobs(dept, status) WHERE status NOT IN ('done','cancelled');
CREATE INDEX idx_jobs_order_id ON jobs(order_id);
CREATE INDEX idx_jobs_date ON jobs(date);
CREATE INDEX idx_orders_status_due ON orders(status, date_due) WHERE status='sent';
CREATE INDEX idx_orders_customer ON orders(LOWER(customer));  -- /track customer search
CREATE INDEX idx_audit_target ON audit_log(target_id, timestamp DESC);
CREATE INDEX idx_audit_action ON audit_log(action, timestamp DESC);
CREATE INDEX idx_shipped_order ON shipped(order_id);
CREATE INDEX idx_cancelled_order ON cancelled(order_id);

-- nextId / config — replace Sheet config tab with Postgres sequence
-- Use Postgres SEQUENCE for atomic id allocation (no LockService needed)
CREATE SEQUENCE order_id_seq START 1000 INCREMENT 1;
CREATE SEQUENCE job_id_seq START 100 INCREMENT 1;
```

---

## Speed comparison (expected)

| Operation | Sheet (now) | Postgres (after) | Improvement |
|---|---|---|---|
| `loadAll` (4 sheets) | 1.5-3s | 50-300ms | **5-30x** |
| `loadOrder` single | ~2s | 30-100ms | **20-60x** |
| Order create | ~1.5s | 50-150ms | **10-30x** |
| Audit timeline (filtered) | ~500ms | 10-30ms | **15-50x** |
| Order edit (write) | ~1-2s | 50-100ms | **10-20x** |
| Search archive | ~800ms-2s | 20-100ms | **8-100x** |

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Lose Sheet UI for admin (user opens Sheet to bulk-edit, fix data drift) | Replace with **NocoDB self-hosted** read-only view connected to Postgres. Or use Vercel Postgres browser. Or build minimal admin panel. |
| Apps Script integrations break (audit_log writes, R2 backup, archive cron) | Phase 4 ports each: audit → Postgres trigger / Vercel Cron. R2 backup → pg_dump cron. Archive → Postgres partitioning. |
| LINE webhook + Cloudflare Worker still call Apps Script | Keep Apps Script as LINE webhook proxy initially. Migrate webhook to Vercel API in Phase 4. |
| Data loss during cutover | Dual-write 1 week + diff scripts + Sheet stays as backup ≥30 days post-cutover |
| Postgres connection pool exhaustion at scale | Use `@vercel/postgres` HTTP driver (no pool) or Neon serverless driver |
| Cost surprise on growth | Spend Cap $200 already set 2026-05-09. Vercel Postgres scales linearly with usage. |

---

## Quick-win starter (option B from earlier discussion)

ก่อน commit migration เต็ม — **2-hour PoC ทดสอบ pattern + measure speed delta:**

1. Create Vercel Postgres database (5 min)
2. Mirror **เฉพาะ audit_log** Sheet → Postgres (manual import via clasp + SQL)
3. Add shadow endpoint `/api/audit/postgres` query Postgres
4. Compare timing vs `/api/audit` (current Apps Script)
5. ได้ data point จริง: "Postgres = X ms vs Sheet = Y ms"
6. Decide: commit เต็ม / ทำ hybrid / defer

Low risk (audit_log is append-only, low traffic). High signal value.

---

## Alternatives if Vercel Postgres doesn't work out

1. **Supabase** (Postgres + Realtime + Auth + Studio) — cleaner if realtime becomes need
2. **NocoDB** self-hosted on HostAtom (Postgres backend + Airtable-like UI) — preserves Sheet workflow
3. **Hybrid** — Sheet stays as source of truth, Postgres is read mirror for analytics + /track. Less disruption, gets 60% of speed benefit.

---

## References

- [Vercel Postgres docs](https://vercel.com/docs/storage/vercel-postgres)
- [Drizzle ORM](https://orm.drizzle.team/) — recommended TS ORM
- [Neon branching](https://neon.tech/docs/introduction/branching) — test schema migrations safely
