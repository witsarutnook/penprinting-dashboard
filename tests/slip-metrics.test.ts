// tests/slip-metrics.test.ts
// Pins the ?channel= filter of /api/admin/slip-metrics (follow-up 1c —
// slip_checks.channel มี 'messenger' rows แล้ว แต่ endpoint เดิม aggregate รวม).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadSlipMetrics, loadRecentSlipChecks, parseSlipMetricsChannel, recordSlipCheck } from '@/lib/ai-quote/slip-metrics';

describe('parseSlipMetricsChannel', () => {
  it('absent param → ok, no filter (aggregate — พฤติกรรมเดิม)', () => {
    expect(parseSlipMetricsChannel(null)).toEqual({ ok: true, channel: undefined });
  });
  it('line / messenger → ok with that channel', () => {
    expect(parseSlipMetricsChannel('line')).toEqual({ ok: true, channel: 'line' });
    expect(parseSlipMetricsChannel('messenger')).toEqual({ ok: true, channel: 'messenger' });
  });
  it('unknown value → not ok (route ตอบ 400 — กัน typo เงียบเป็นศูนย์)', () => {
    expect(parseSlipMetricsChannel('dashboard')).toEqual({ ok: false });
    expect(parseSlipMetricsChannel('')).toEqual({ ok: false });
    expect(parseSlipMetricsChannel('LINE')).toEqual({ ok: false });
  });
});

describe('loadSlipMetrics', () => {
  beforeEach(() => resetMockPostgres());

  it('no channel → filter disabled via NULL param (ไม่ bind line/messenger)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSlipMetrics(undefined);
    const call = sqlCalls[0];
    expect(call.text).toContain('channel =');
    expect(call.values).toContain(null);
    expect(call.values).not.toContain('line');
    expect(call.values).not.toContain('messenger');
  });

  it('channel=messenger → binds messenger in the WHERE', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSlipMetrics('messenger');
    const call = sqlCalls[0];
    expect(call.text).toContain('channel =');
    expect(call.values).toContain('messenger');
  });

  it('sums totals across day rows + keeps 30-day window shape', async () => {
    queueResult({
      rows: [
        { day: '2026-07-08', images: 5, thunder_calls: 3, filtered_out: 2, slip_ok: 2, duplicates: 1, mismatches: 0, unreadable: 0 },
        { day: '2026-07-07', images: 4, thunder_calls: 2, filtered_out: 2, slip_ok: 1, duplicates: 0, mismatches: 1, unreadable: 0 },
      ],
      rowCount: 2,
    });
    const out = await loadSlipMetrics(undefined);
    expect(out.totals).toEqual({ images: 9, thunder_calls: 5, filtered_out: 4, slip_ok: 3 });
    expect(out.windowDays).toBe(30);
    expect(out.days).toHaveLength(2);
    expect(sqlCalls[0].text).toContain("INTERVAL '30 days'");
  });
});

// Diagnosability columns (2026-07-23 slip incident): the Haiku answer + full
// Thunder response are persisted per event so silent drops and response-contract
// drift are provable from data — Vercel logs retain only a short window.
describe('recordSlipCheck (raw evidence capture)', () => {
  beforeEach(() => resetMockPostgres());

  it('verified slip → stores prefilter answer + full Thunder response as jsonb', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const result = { success: true, data: { isDuplicate: false, isAccountMatched: null, rawSlip: { amount: { amount: 580 } } } };
    await recordSlipCheck({ channel: 'line', looksLikeSlip: true, prefilterAnswer: 'yes', result } as never);
    const call = sqlCalls[0];
    expect(call.text).toContain('prefilter_answer');
    expect(call.text).toContain('raw');
    expect(call.values).toContain('yes');
    expect(call.values).toContain(JSON.stringify(result));
  });

  it('pre-filter drop → refusal answer kept, raw NULL (no Thunder call to record)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await recordSlipCheck({ channel: 'line', looksLikeSlip: false, prefilterAnswer: 'no, artwork', result: null });
    const call = sqlCalls[0];
    expect(call.values).toContain('no, artwork');
    expect(call.values).not.toContain('{}');
  });
});

describe('loadRecentSlipChecks', () => {
  beforeEach(() => resetMockPostgres());

  it('selects newest-first with prefilter_answer + raw, bound LIMIT', async () => {
    queueResult({ rows: [{ id: 1 }], rowCount: 1 });
    const rows = await loadRecentSlipChecks('line', 20);
    const call = sqlCalls[0];
    expect(call.text).toContain('prefilter_answer');
    expect(call.text).toContain('raw');
    expect(call.text).toContain('ORDER BY created_at DESC');
    expect(call.values).toContain('line');
    expect(call.values).toContain(20);
    expect(rows).toHaveLength(1);
  });

  it('no channel → NULL param disables the filter (mirror loadSlipMetrics)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadRecentSlipChecks(undefined, 10);
    expect(sqlCalls[0].values).toContain(null);
    expect(sqlCalls[0].values).not.toContain('line');
  });
});
