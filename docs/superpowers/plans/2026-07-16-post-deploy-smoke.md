# Post-deploy Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทุก production deploy ของ dashboard + calc ถูกตรวจอัตโนมัติ (health + price baselines) — พังแล้วแจ้งกลุ่ม LINE ทีมงานทันที

**Architecture:** GitHub Actions `on: deployment_status` (event ที่ Vercel ส่งอยู่แล้ว) แยก workflow ตาม repo เจ้าของ — calc ตรวจราคาเทียบ baseline, dashboard ตรวจ routes/webhooks. Checks เป็น Node script ไม่มี dependency (`scripts/smoke.mjs` + shared core twin-file). Fail → LINE push กลุ่มทีมงาน (fail-only), retry 3 ครั้งกัน false positive

**Tech Stack:** Node 20+/22 built-in `fetch` · GitHub Actions · vitest (dashboard — smoke-core unit tests) · LINE Messaging API push

**Spec:** [2026-07-16-post-deploy-smoke-design.md](../specs/2026-07-16-post-deploy-smoke-design.md)

**Facts pinned จาก code จริง (อย่าเดาใหม่):**
- dashboard: `/board` ไม่มี session → **307** → `/login` · LINE webhook GET → 200, POST signature ผิด → **401** ([route.ts:43](../../app/api/ai-quote/line/route.ts)) · Messenger GET token ผิด → **403** ([route.ts:112](../../app/api/ai-quote/messenger/route.ts)) · admin API ไม่มี session → **401** (requireSession, [route-helpers.ts:14](../../lib/route-helpers.ts))
- calc: `POST /api/quote` header `x-quote-token` · response `{ productType, spec, result }` · **ไม่มี test infra** (type-check + lint เท่านั้น) → smoke-core ถูก TDD ฝั่ง dashboard แล้ว copy twin ไป calc
- vitest config dashboard: `include: ['tests/**/*.test.ts']` — **ต้องเพิ่ม `.test.mjs`** (Task 1)
- กระดาษใน list (จาก prompt): **Art 120** ✓ / **Art 130 ✗ นอก list** (เคส Dreamie) · Art 230 ✓ · Bond 80 ✓ · Art Card 350 ✓
- namecard fix rate/กล่อง 100 ใบ: 1หน้า 150 · 1หน้า+เคลือบ 250 · 2หน้า 300 · 2หน้า+เคลือบ 500 · ปัดกล่องขึ้น (250 ใบ → 3 กล่อง)

---

## Task 1 (dashboard): smoke-core — TDD pure functions

**Files:**
- Modify: `vitest.config.ts` (include `.test.mjs`)
- Test: `tests/smoke-core.test.mjs`
- Create: `scripts/smoke-core.mjs`

- [ ] **Step 1.1: เพิ่ม `.test.mjs` ใน vitest include**

ใน `vitest.config.ts` แก้บรรทัด include:

```ts
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
```

- [ ] **Step 1.2: เขียน failing test**

สร้าง `tests/smoke-core.test.mjs`:

```js
// tests/smoke-core.test.mjs — unit tests for the post-deploy smoke shared core.
// scripts/smoke-core.mjs is a TWIN FILE (identical copy in penprinting-calc)
// — dashboard is the tested source of truth for both copies.
import { describe, it, expect, vi } from 'vitest';
import {
  compareFields,
  buildFailMessage,
  withRetry,
  runChecks,
} from '../scripts/smoke-core.mjs';

describe('compareFields', () => {
  it('returns [] when every expected field matches', () => {
    expect(
      compareFields({ unitPrice: 2.4, mode: 'offset' }, { unitPrice: 2.4, mode: 'offset', extra: 1 }),
    ).toEqual([]);
  });

  it('catches a 0.01 price drift (exact compare, no tolerance)', () => {
    expect(compareFields({ unitPrice: 2.4 }, { unitPrice: 2.41 })).toEqual([
      { path: 'unitPrice', expected: 2.4, actual: 2.41 },
    ]);
  });

  it('compares nested objects with dot paths', () => {
    const diffs = compareFields(
      { finishing: { coat: { unit: 0.5 } } },
      { finishing: { coat: { unit: 0.6 } } },
    );
    expect(diffs).toEqual([{ path: 'finishing.coat.unit', expected: 0.5, actual: 0.6 }]);
  });

  it('reports undefined for a missing field', () => {
    expect(compareFields({ boxes: 3 }, {})).toEqual([
      { path: 'boxes', expected: 3, actual: undefined },
    ]);
  });
});

describe('buildFailMessage', () => {
  it('includes repo, every failure, hint, and run url', () => {
    const msg = buildFailMessage({
      repo: 'penprinting-calc',
      failures: [
        { name: 'price:namecard-2s-lam', detail: 'totalPrice: expected 500, got 480' },
        { name: 'auth-fail-closed-401', detail: 'POST → 200 (expected 401)' },
      ],
      runUrl: 'https://github.com/x/y/actions/runs/1',
      hint: 'ถ้าตั้งใจเปลี่ยนราคา → อัปเดต scripts/smoke-baselines.json แล้ว push',
    });
    expect(msg).toContain('penprinting-calc');
    expect(msg).toContain('price:namecard-2s-lam');
    expect(msg).toContain('expected 500, got 480');
    expect(msg).toContain('auth-fail-closed-401');
    expect(msg).toContain('smoke-baselines.json');
    expect(msg).toContain('actions/runs/1');
  });
});

describe('withRetry', () => {
  it('returns the value once an attempt succeeds', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 3) throw new Error('transient');
      return 'ok';
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after attempts are exhausted', async () => {
    const fn = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('runChecks', () => {
  it('collects every failure and never stops early', async () => {
    const failures = await runChecks(
      [
        { name: 'a', run: async () => {} },
        { name: 'b', run: async () => { throw new Error('boom-b'); } },
        { name: 'c', run: async () => { throw new Error('boom-c'); } },
      ],
      { attempts: 1, delayMs: 0 },
    );
    expect(failures).toEqual([
      { name: 'b', detail: 'boom-b' },
      { name: 'c', detail: 'boom-c' },
    ]);
  });
});
```

- [ ] **Step 1.3: รันให้เห็น fail**

Run: `npx vitest run tests/smoke-core.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/smoke-core.mjs'`

- [ ] **Step 1.4: implement `scripts/smoke-core.mjs`**

```js
// scripts/smoke-core.mjs — post-deploy smoke shared core.
// ⚠️ TWIN FILE: an identical copy lives in BOTH repos —
//   penprinting-dashboard/scripts/smoke-core.mjs
//   penprinting-calc/scripts/smoke-core.mjs
// Edit both together (keep byte-identical). Unit tests live in
// penprinting-dashboard/tests/smoke-core.test.mjs only.
// Zero dependencies — plain Node 20+ (global fetch).
// Spec: docs/superpowers/specs/2026-07-16-post-deploy-smoke-design.md

/** Compare expected subset vs actual (recursive, exact ===). → [{path, expected, actual}] */
export function compareFields(expected, actual, prefix = '') {
  const diffs = [];
  for (const [key, want] of Object.entries(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const got = actual == null ? undefined : actual[key];
    if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
      diffs.push(...compareFields(want, got, path));
    } else if (got !== want) {
      diffs.push({ path, expected: want, actual: got });
    }
  }
  return diffs;
}

export function buildFailMessage({ repo, failures, runUrl, hint }) {
  const lines = [`🔥 Post-deploy smoke FAILED — ${repo}`];
  for (const f of failures) lines.push(`❌ ${f.name}: ${f.detail}`);
  if (hint) lines.push(hint);
  if (runUrl) lines.push(`รายละเอียด: ${runUrl}`);
  return lines.join('\n');
}

export async function withRetry(fn, { attempts = 3, delayMs = 5_000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/** Run all checks ({name, run}) — collect every failure, never stop early. */
export async function runChecks(checks, retryOpts = {}) {
  const failures = [];
  for (const check of checks) {
    try {
      await withRetry(check.run, retryOpts);
      console.log(`✅ ${check.name}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${check.name}: ${detail}`);
      failures.push({ name: check.name, detail });
    }
  }
  return failures;
}

/** GET/…: assert HTTP status (no auto-redirect). → Response */
export async function expectStatus(url, expected, init = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    ...init,
  });
  if (res.status !== expected) {
    throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} (expected ${expected})`);
  }
  return res;
}

export async function pushLine(text, { token, groupId }) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
}

/** Shared entry: run checks → on failure LINE-notify (best-effort) + exit 1. */
export async function smokeMain({ repo, checks, hint, retry }) {
  const failures = await runChecks(checks, retry);
  if (failures.length === 0) {
    console.log(`✅ smoke passed (${checks.length} checks)`);
    return;
  }
  const msg = buildFailMessage({ repo, failures, runUrl: process.env.RUN_URL, hint });
  const token = process.env.LINE_CHANNEL_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  if (token && groupId) {
    try {
      await pushLine(msg, { token, groupId });
      console.error('LINE notify sent');
    } catch (err) {
      console.error(String(err)); // workflow-red is the backstop
    }
  } else {
    console.error('LINE_CHANNEL_TOKEN/LINE_GROUP_ID not set — skip notify');
  }
  process.exitCode = 1;
}
```

- [ ] **Step 1.5: รันให้ผ่าน**

Run: `npx vitest run tests/smoke-core.test.mjs`
Expected: PASS ทุก test. แล้วรัน `npx vitest run` ทั้ง suite — 459 เดิมต้องเขียวหมด

- [ ] **Step 1.6: Commit**

```bash
git add vitest.config.ts tests/smoke-core.test.mjs scripts/smoke-core.mjs
git commit -m "feat(smoke): shared smoke core — compare/retry/collect/notify (TDD)"
```

---

## Task 2 (dashboard): smoke runner + workflow

**Files:**
- Create: `scripts/smoke.mjs`
- Create: `.github/workflows/smoke.yml`

- [ ] **Step 2.1: เขียน `scripts/smoke.mjs`**

```js
// scripts/smoke.mjs — post-deploy smoke for dashboard.penprinting.co
// Run:  node scripts/smoke.mjs                       (against prod)
//       BASE_URL=http://localhost:3000 node scripts/smoke.mjs
//       node scripts/smoke.mjs --test-notify         (LINE plumbing test only)
// Env:  LINE_CHANNEL_TOKEN + LINE_GROUP_ID (notify) · RUN_URL (link in message)
// Spec: docs/superpowers/specs/2026-07-16-post-deploy-smoke-design.md
import { smokeMain, expectStatus, pushLine } from './smoke-core.mjs';

const BASE = process.env.BASE_URL ?? 'https://dashboard.penprinting.co';

const CHECKS = [
  { name: 'login-200', run: () => expectStatus(`${BASE}/login`, 200) },
  { name: 'track-200', run: () => expectStatus(`${BASE}/track`, 200) },
  {
    name: 'board-redirects-to-login',
    run: async () => {
      const res = await expectStatus(`${BASE}/board`, 307);
      const loc = res.headers.get('location') ?? '';
      if (!loc.includes('/login')) throw new Error(`redirects to ${loc} (expected /login)`);
    },
  },
  { name: 'line-webhook-health-200', run: () => expectStatus(`${BASE}/api/ai-quote/line`, 200) },
  {
    name: 'line-webhook-fail-closed-401',
    run: () =>
      expectStatus(`${BASE}/api/ai-quote/line`, 401, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-line-signature': 'bogus' },
        body: JSON.stringify({ events: [] }),
      }),
  },
  {
    name: 'messenger-handshake-fail-closed-403',
    run: () =>
      expectStatus(
        `${BASE}/api/ai-quote/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`,
        403,
      ),
  },
  {
    name: 'admin-api-fail-closed-401',
    run: () => expectStatus(`${BASE}/api/admin/slip-metrics`, 401),
  },
];

if (process.argv.includes('--test-notify')) {
  await pushLine('🧪 smoke test-notify — penprinting-dashboard (ทดสอบระบบแจ้งเตือน ไม่ใช่ปัญหาจริง)', {
    token: process.env.LINE_CHANNEL_TOKEN,
    groupId: process.env.LINE_GROUP_ID,
  });
  console.log('test notify sent');
} else {
  await smokeMain({ repo: 'penprinting-dashboard', checks: CHECKS });
}
```

- [ ] **Step 2.2: รัน local ยิง prod จริงทันที (prod live อยู่แล้ว)**

Run: `node scripts/smoke.mjs`
Expected: `✅` ครบ 7 checks + `✅ smoke passed (7 checks)` exit 0.
ถ้า check ไหน fail ด้วย status ไม่ตรง → **อย่าแก้ตัวเลขมั่ว** — เปิด route จริงดู status ที่ระบบคืน (facts pinned ข้างบน) แล้วแก้ expected ให้ตรง reality พร้อม note

- [ ] **Step 2.3: เขียน `.github/workflows/smoke.yml`**

```yaml
name: Post-deploy smoke

on:
  deployment_status:
  workflow_dispatch:
    inputs:
      test_notify:
        description: 'ส่งข้อความทดสอบเข้ากลุ่ม LINE (ไม่รัน checks)'
        type: boolean
        default: false

jobs:
  smoke:
    # deployment_status: เฉพาะ Production + success (ข้าม Preview/failure)
    # หมายเหตุ: ชื่อ environment จริงของ Vercel ต้อง verify จาก log run แรก (spec §1)
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event.deployment_status.state == 'success' &&
       startsWith(github.event.deployment.environment, 'Production'))
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Log deployment event (env-name verification)
        if: github.event_name == 'deployment_status'
        run: |
          echo "environment=${{ github.event.deployment.environment }}"
          echo "state=${{ github.event.deployment_status.state }}"
          echo "target_url=${{ github.event.deployment_status.target_url }}"

      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.deployment.sha || github.ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Run smoke
        env:
          LINE_CHANNEL_TOKEN: ${{ secrets.LINE_CHANNEL_TOKEN }}
          LINE_GROUP_ID: ${{ secrets.LINE_GROUP_ID }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: node scripts/smoke.mjs ${{ github.event.inputs.test_notify == 'true' && '--test-notify' || '' }}
```

- [ ] **Step 2.4: Gates**

Run: `npm run type-check && npx next lint && npx vitest run && npm run build`
Expected: เขียวหมด (scripts/*.mjs อยู่นอก tsconfig include — type-check ต้องไม่บ่น)

- [ ] **Step 2.5: Commit + push**

```bash
git add scripts/smoke.mjs .github/workflows/smoke.yml
git commit -m "feat(smoke): post-deploy smoke — dashboard health checks + deployment_status workflow"
git push origin main
```

- [ ] **Step 2.6: Verify trigger จริง**

Push ข้อ 2.5 ทำให้ Vercel deploy → ต้องเห็น workflow fire เอง:

Run: `gh run list --repo witsarutnook/penprinting-dashboard --workflow=smoke.yml --limit 3`
Expected: run ใหม่ event `deployment_status`, conclusion `success`.
เปิด log step "Log deployment event" → จด **ชื่อ environment จริง** ลง commit/doc — ถ้าไม่ใช่ `Production*` (filter ไม่ match = run ไม่เกิด) ให้แก้ `startsWith(...)` ใน smoke.yml ให้ตรงแล้ว push ใหม่
หมายเหตุ: run นี้ยังไม่มี LINE secrets — ผ่านได้ปกติ (notify ใช้เฉพาะตอน fail)

---

## Task 3 (calc): twin core + baselines + runner

**Files:**
- Create: `print-calculator-next/scripts/smoke-core.mjs` (copy twin)
- Create: `print-calculator-next/scripts/smoke.mjs`
- Create: `print-calculator-next/scripts/smoke-baselines.json`

- [ ] **Step 3.1: copy twin file (byte-identical)**

```bash
cp ../penprinting-dashboard/scripts/smoke-core.mjs scripts/smoke-core.mjs
diff ../penprinting-dashboard/scripts/smoke-core.mjs scripts/smoke-core.mjs && echo IDENTICAL
```

Expected: `IDENTICAL`

- [ ] **Step 3.2: เขียน `scripts/smoke.mjs` (calc)**

```js
// scripts/smoke.mjs — post-deploy smoke for calc.penprinting.co (price baselines)
// Run:      QUOTE_API_TOKEN=... node scripts/smoke.mjs
// Local:    BASE_URL=http://localhost:3000 QUOTE_API_TOKEN=test node scripts/smoke.mjs
// Capture:  BASE_URL=... QUOTE_API_TOKEN=... node scripts/smoke.mjs --capture
// Validate: node scripts/smoke.mjs --validate   (โครงสร้าง baselines เท่านั้น — ใช้ใน CI, ไม่ยิง network)
// Baseline policy: ตั้งใจเปลี่ยนราคา = อัปเดต scripts/smoke-baselines.json ในคอมมิตเดียวกัน
// Spec: penprinting-dashboard/docs/superpowers/specs/2026-07-16-post-deploy-smoke-design.md
import { readFileSync } from 'node:fs';
import { smokeMain, expectStatus, compareFields } from './smoke-core.mjs';

const BASE = process.env.BASE_URL ?? 'https://calc.penprinting.co';
const TOKEN = process.env.QUOTE_API_TOKEN;
const baselines = JSON.parse(
  readFileSync(new URL('./smoke-baselines.json', import.meta.url), 'utf8'),
);

function validateBaselines() {
  if (!Array.isArray(baselines.cases) || baselines.cases.length === 0) {
    throw new Error('smoke-baselines.json: cases ต้องเป็น array ไม่ว่าง');
  }
  for (const c of baselines.cases) {
    for (const field of ['name', 'request', 'expect']) {
      if (!c[field]) throw new Error(`case "${c.name ?? '?'}": ขาด field ${field}`);
    }
    if (!c.request.productType || !c.request.spec) {
      throw new Error(`case "${c.name}": request ต้องมี productType + spec`);
    }
    if (Object.keys(c.expect).length === 0) {
      throw new Error(`case "${c.name}": expect ว่าง — ยังไม่ capture ค่า`);
    }
    // ราคา/จำนวนที่ถูกต้องไม่มีทางเป็น 0 และ "CAPTURE" คือ placeholder ตอนร่าง
    // — เจอ = ลืม capture (step 3.4) ห้ามผ่าน CI
    for (const [k, v] of Object.entries(c.expect)) {
      if (v === 0 || v === 'CAPTURE') {
        throw new Error(`case "${c.name}": expect.${k} = ${JSON.stringify(v)} — ยังไม่ capture ค่าจริง`);
      }
    }
  }
  console.log(`baselines OK (${baselines.cases.length} cases)`);
}

async function quote(request) {
  const res = await fetch(`${BASE}/api/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-quote-token': TOKEN ?? '' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`POST /api/quote → ${res.status}: ${await res.text()}`);
  return res.json();
}

const CHECKS = [
  {
    name: 'auth-fail-closed',
    run: () =>
      expectStatus(`${BASE}/api/quote`, 401, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-quote-token': 'wrong-token' },
        body: JSON.stringify(baselines.cases[0].request),
      }),
  },
  ...baselines.cases.map((c) => ({
    name: `price:${c.name}`,
    run: async () => {
      const body = await quote(c.request);
      const diffs = compareFields(c.expect, body.result);
      if (diffs.length > 0) {
        throw new Error(
          diffs.map((d) => `${d.path}: expected ${d.expected}, got ${d.actual}`).join(' · '),
        );
      }
    },
  })),
];

if (process.argv.includes('--validate')) {
  validateBaselines();
} else if (process.argv.includes('--capture')) {
  for (const c of baselines.cases) {
    const body = await quote(c.request);
    console.log(`--- ${c.name}`);
    console.log(JSON.stringify(body.result, null, 2));
  }
} else {
  validateBaselines();
  if (!TOKEN) {
    console.error('QUOTE_API_TOKEN not set');
    process.exit(1);
  }
  await smokeMain({
    repo: 'penprinting-calc',
    checks: CHECKS,
    hint: 'ถ้าตั้งใจเปลี่ยนราคา → อัปเดต scripts/smoke-baselines.json แล้ว push (ดู /sync-paper-prices)',
  });
}
```

⚠️ ก่อนใช้ 401 ใน `auth-fail-closed`: เปิด `app/api/quote/route.ts` ดู status จริงที่คืนเมื่อ token ผิด — ถ้าเป็น 403 ให้แก้ทั้ง script และ step 3.5 ให้ตรง

- [ ] **Step 3.3: เขียน `scripts/smoke-baselines.json` (namecard = fix rate รู้ค่าแล้ว, ที่เหลือ capture ใน step 3.4)**

```json
{
  "_readme": "Post-deploy smoke price baselines — เทียบเป๊ะทุก field ใน expect. ตั้งใจเปลี่ยนราคา = อัปเดตไฟล์นี้ในคอมมิตเดียวกัน (ดู /sync-paper-prices). ค่า expect มาจากการยิง API จริง (--capture) ห้ามคำนวณมือ",
  "cases": [
    {
      "name": "namecard-1side-plain-100",
      "request": { "productType": "namecard", "spec": { "qty": 100, "sides": 1, "laminated": false } },
      "expect": { "boxes": 1, "pricePerBox": 150, "totalPrice": 150 }
    },
    {
      "name": "namecard-1side-laminated-100",
      "request": { "productType": "namecard", "spec": { "qty": 100, "sides": 1, "laminated": true } },
      "expect": { "boxes": 1, "pricePerBox": 250, "totalPrice": 250 }
    },
    {
      "name": "namecard-2side-plain-100",
      "request": { "productType": "namecard", "spec": { "qty": 100, "sides": 2, "laminated": false } },
      "expect": { "boxes": 1, "pricePerBox": 300, "totalPrice": 300 }
    },
    {
      "name": "namecard-2side-laminated-100",
      "request": { "productType": "namecard", "spec": { "qty": 100, "sides": 2, "laminated": true } },
      "expect": { "boxes": 1, "pricePerBox": 500, "totalPrice": 500 }
    },
    {
      "name": "namecard-box-rounding-250to3",
      "request": { "productType": "namecard", "spec": { "qty": 250, "sides": 2, "laminated": false } },
      "expect": { "boxes": 3, "pricePerBox": 300, "totalPrice": 900 }
    },
    {
      "name": "brochure-a4-offset-2000",
      "request": { "productType": "brochure", "spec": { "size": "A4", "color": "4", "sides": 2, "paperName": "Art 120", "qty": 2000 } },
      "expect": { "mode": "CAPTURE", "unitPrice": 0, "totalPrice": 0 }
    },
    {
      "name": "brochure-a4-digital-100",
      "request": { "productType": "brochure", "spec": { "size": "A4", "color": "4", "sides": 2, "paperName": "Art 120", "qty": 100 } },
      "expect": { "mode": "CAPTURE", "unitPrice": 0, "totalPrice": 0 }
    },
    {
      "name": "book-a4-500",
      "request": { "productType": "book", "spec": { "size": "A4", "qty": 500, "cover": { "paperName": "Art 230", "color": "4" }, "innerA": { "paperName": "Bond 80", "color": "1", "pages": 50 }, "innerB": { "paperName": "Bond 80", "color": "1", "pages": 0 } } },
      "expect": { "unitPrice": 0, "totalPrice": 0 }
    },
    {
      "name": "notebook-a5-1000",
      "request": { "productType": "notebook", "spec": { "size": "A5", "qty": 1000, "cover": { "paperName": "Art 230", "color": "4" }, "innerA": { "paperName": "Bond 80", "color": "1", "pages": 50 }, "innerB": { "paperName": "Bond 80", "color": "1", "pages": 0 } } },
      "expect": { "unitPrice": 0, "totalPrice": 0 }
    },
    {
      "name": "box-tuck-straight-500",
      "request": { "productType": "box", "spec": { "style": "tuck-straight", "width": 8, "length": 8, "height": 12, "qty": 500, "paperName": "Art Card 350", "color": "4" } },
      "expect": { "unitPrice": 0, "totalPrice": 0 }
    },
    {
      "name": "bag-standard-500",
      "request": { "productType": "bag", "spec": { "style": "standard", "width": 20, "depth": 8, "height": 25, "handle": "rope-ribbon", "qty": 500, "paperName": "Art Card 350", "color": "4" } },
      "expect": { "unitPrice": 0, "totalPrice": 0 }
    }
  ]
}
```

หมายเหตุ: ค่า `"CAPTURE"` / `0` = ค่าชั่วคราวก่อน capture — step 3.4 แทนที่ด้วยค่าจริง**ทุกตัว**ก่อน commit (step 3.6 กันไว้อีกชั้น)

- [ ] **Step 3.4: capture ค่าจริงจาก local API**

Start dev server (background — ตาม [[feedback_rtk_git_pull_stale_uptodate]] รันผ่าน `rtk proxy` + อ่าน log ด้วย `/usr/bin/tail`):

```bash
QUOTE_API_TOKEN=test rtk proxy npm run dev   # background
# รอ ready แล้ว:
BASE_URL=http://localhost:3000 QUOTE_API_TOKEN=test node scripts/smoke.mjs --capture
```

- แต่ละ case ได้ `result` เต็ม → คัด field ลง `expect`: ทุก case เอา `unitPrice` + `totalPrice`; brochure เพิ่ม `mode` (ต้องได้ `offset` ที่ 2000 / `digital` ที่ 100 — ถ้า mode ไม่ตรงคาด ปรับ qty จน mode แยกกันชัด); namecard 5 cases ต้องตรงกับ fix rate ที่กรอกไว้แล้ว (ไม่ตรง = หยุด สอบสวนก่อน — อาจมี regression จริง)
- box/bag: spec ใน 3.3 ถ้าโดน 422 (ขนาดไม่พอดีแผ่น/กระดาษไม่อยู่ใน list) → อ่าน error message ปรับ dims/paperName จนได้ 200 แล้วค่อย capture
- ห้ามคำนวณค่าเองทุกกรณี — ค่าทุกตัวมาจาก API

- [ ] **Step 3.5: รัน smoke เต็มกับ local ให้เขียว + เช็ค auth status จริง**

```bash
BASE_URL=http://localhost:3000 QUOTE_API_TOKEN=test node scripts/smoke.mjs
curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/quote \
  -H 'Content-Type: application/json' -H 'x-quote-token: wrong' \
  -d '{"productType":"namecard","spec":{"qty":100,"sides":1,"laminated":false}}'
```

Expected: smoke `✅ smoke passed (12 checks)` · curl พิมพ์ status จริง (คาด 401) — ไม่ตรงกับที่เขียนใน script → แก้ script ให้ตรง reality

- [ ] **Step 3.6: validate + gates**

Run: `node scripts/smoke.mjs --validate && npm run type-check && npm run lint && npm run build`
Expected: `baselines OK (11 cases)` (ห้ามเหลือ expect ที่เป็น 0/"CAPTURE") + gates เขียว

- [ ] **Step 3.7: Commit (ยังไม่ push — รอ workflow ใน Task 5 push ทีเดียว)**

```bash
git add scripts/smoke-core.mjs scripts/smoke.mjs scripts/smoke-baselines.json
git commit -m "feat(smoke): price-baseline smoke — all live product types vs pinned baselines"
```

---

## Task 4 (user — คุณนุ๊ก): ตั้ง GitHub secrets

**Files:** ไม่มี (GitHub secrets — ค่าไม่ผ่านแชต)

- [ ] **Step 4.1: คุณนุ๊กรันในเทอร์มินัลตัวเอง** (แต่ละคำสั่งจะ prompt ให้วางค่า — copy จาก Vercel → Settings → Environment Variables)

```bash
# ค่าจาก Vercel project "penprinting-calc" env QUOTE_API_TOKEN
gh secret set QUOTE_API_TOKEN --repo witsarutnook/penprinting-calc
# ค่าจาก Vercel project "penprinting-dashboard" env LINE_CHANNEL_TOKEN + LINE_GROUP_ID (ชุดเดียวกับ morning report)
gh secret set LINE_CHANNEL_TOKEN --repo witsarutnook/penprinting-calc
gh secret set LINE_GROUP_ID --repo witsarutnook/penprinting-calc
gh secret set LINE_CHANNEL_TOKEN --repo witsarutnook/penprinting-dashboard
gh secret set LINE_GROUP_ID --repo witsarutnook/penprinting-dashboard
```

- [ ] **Step 4.2: Claude verify รายชื่อ secret (ไม่เห็นค่า)**

Run: `gh secret list --repo witsarutnook/penprinting-calc && gh secret list --repo witsarutnook/penprinting-dashboard`
Expected: calc มี 3 ตัว · dashboard มี 2 ตัว

---

## Task 5 (calc): workflow + CI validate + push + verify

**Files:**
- Create: `print-calculator-next/.github/workflows/smoke.yml`
- Modify: `print-calculator-next/.github/workflows/ci.yml`

- [ ] **Step 5.1: เขียน `.github/workflows/smoke.yml` (calc)**

```yaml
name: Post-deploy smoke

on:
  deployment_status:
  workflow_dispatch:

jobs:
  smoke:
    # เฉพาะ Production + success (ข้าม Preview/failure)
    # ชื่อ environment จริง verify แล้วจาก run แรกฝั่ง dashboard (Task 2.6)
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event.deployment_status.state == 'success' &&
       startsWith(github.event.deployment.environment, 'Production'))
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Log deployment event
        if: github.event_name == 'deployment_status'
        run: |
          echo "environment=${{ github.event.deployment.environment }}"
          echo "state=${{ github.event.deployment_status.state }}"

      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.deployment.sha || github.ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run smoke
        env:
          QUOTE_API_TOKEN: ${{ secrets.QUOTE_API_TOKEN }}
          LINE_CHANNEL_TOKEN: ${{ secrets.LINE_CHANNEL_TOKEN }}
          LINE_GROUP_ID: ${{ secrets.LINE_GROUP_ID }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: node scripts/smoke.mjs
```

- [ ] **Step 5.2: เพิ่ม validate step ใน `ci.yml`** (ท้าย job `check` ต่อจาก Lint)

```yaml
      - name: Validate smoke baselines
        run: node scripts/smoke.mjs --validate
```

- [ ] **Step 5.3: Commit + push**

```bash
git add .github/workflows/smoke.yml .github/workflows/ci.yml
git commit -m "ci(smoke): deployment_status workflow + baselines validation in CI"
git push origin main
```

- [ ] **Step 5.4: Verify trigger + เขียวบน prod จริง**

Run: `gh run list --repo witsarutnook/penprinting-calc --workflow=smoke.yml --limit 3`
Expected: run event `deployment_status` conclusion `success` — พิสูจน์ prod ราคาตรง baseline ที่ capture จาก local (**parity local=prod ยืนยันตรงนี้**). ถ้า fail ด้วยราคาไม่ตรง = local กับ prod ไม่ sync — สอบสวนก่อนไปต่อ (deploy ล่าสุดของ calc คือ commit ไหน)

---

## Task 6 (dashboard): verify LINE notify plumbing

- [ ] **Step 6.1: ยิง test-notify ผ่าน workflow_dispatch**

Run: `gh workflow run smoke.yml --repo witsarutnook/penprinting-dashboard -f test_notify=true`
แล้ว: `gh run watch --repo witsarutnook/penprinting-dashboard` (หรือ list ดู conclusion)
Expected: run เขียว + **คุณนุ๊กยืนยันเห็นข้อความ "🧪 smoke test-notify" ในกลุ่ม LINE ทีมงาน**

---

## Task 7 (calc): fail-path proof end-to-end (acceptance ของ spec §6)

- [ ] **Step 7.1: แก้ baseline ให้ผิดโดยตั้งใจ 1 ค่า**

ใน `scripts/smoke-baselines.json` case `namecard-2side-laminated-100`: `"totalPrice": 500` → `"totalPrice": 499`

```bash
git add scripts/smoke-baselines.json
git commit -m "test(smoke): intentionally break one baseline to prove fail-path (will revert)"
git push origin main
```

- [ ] **Step 7.2: ดู workflow แดง + LINE แจ้ง**

Expected: smoke run ใหม่ **fail** · กลุ่ม LINE ได้ข้อความ: repo `penprinting-calc` + `price:namecard-2side-laminated-100: totalPrice: expected 499, got 500` + hint baseline + ลิงก์ run — **คุณนุ๊กยืนยันเห็นในกลุ่ม**

- [ ] **Step 7.3: revert**

```bash
git revert --no-edit HEAD
git push origin main
```

Expected: smoke run ถัดมาเขียวเอง (พิสูจน์ recovery)

---

## Task 8: docs + `/sync-paper-prices` baseline step

**Files:**
- Modify: `.claude/commands/sync-paper-prices.md` (workspace root)
- Modify: `penprinting-dashboard/NEXT-SESSION.md`, `penprinting-dashboard/AUDIT-BACKLOG.md`, `penprinting-dashboard/dashboard-v2.md`

- [ ] **Step 8.1: เพิ่มขั้นตอนใน `/sync-paper-prices`** — ท้าย checklist ของ command เพิ่ม:

```markdown
## ⚠️ Smoke baselines (บังคับ — เพิ่ม 2026-07-16)
ราคา/สูตรเปลี่ยน = ต้องอัปเดต `print-calculator-next/scripts/smoke-baselines.json` ใน**คอมมิตเดียวกัน**
(capture ค่าใหม่: `BASE_URL=http://localhost:3000 QUOTE_API_TOKEN=test node scripts/smoke.mjs --capture`)
ไม่งั้น post-deploy smoke จะ fail + แจ้งกลุ่ม LINE ทันทีที่ push
```

- [ ] **Step 8.2: อัปเดต docs ตาม session-end discipline** — NEXT-SESSION entry (สิ่งที่ทำ + commits + pending) · AUDIT-BACKLOG latest-update note · dashboard-v2.md version history. Commit docs

---

## Verification checklist (ก่อนประกาศเสร็จ)

- [ ] dashboard smoke: run เขียวจาก deployment จริง (ไม่ใช่แค่ dispatch)
- [ ] calc smoke: run เขียวจาก deployment จริง — ราคา prod ตรง baseline ทุก case
- [ ] fail-path: เห็นข้อความ fail ในกลุ่ม LINE จริง + revert แล้วเขียวคืน
- [ ] test-notify dashboard: เห็นข้อความทดสอบในกลุ่ม LINE จริง
- [ ] environment name จริงจาก log ตรงกับ filter ใน workflow ทั้ง 2 repos
- [ ] Preview deploy ไม่ trigger (สังเกตจาก run list — ไม่มี run จาก Preview environment)
- [ ] gates เขียวทั้ง 2 repos + `/sync-paper-prices` มี baseline step
