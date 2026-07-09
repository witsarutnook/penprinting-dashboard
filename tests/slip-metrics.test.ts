// tests/slip-metrics.test.ts
// Pins the ?channel= filter of /api/admin/slip-metrics (follow-up 1c —
// slip_checks.channel มี 'messenger' rows แล้ว แต่ endpoint เดิม aggregate รวม).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadSlipMetrics, parseSlipMetricsChannel } from '@/lib/ai-quote/slip-metrics';

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
