import { describe, expect, it, vi } from 'vitest';
import type { PeakQuotation } from '@/lib/peak/read';
import { PeakAuthError, PeakUnavailableError } from '@/lib/peak/oauth';
import { PeakNotConnectedError } from '@/lib/peak/token-store';
import { PeakToolError } from '@/lib/peak/mcp-client';
import { PeakConfigError } from '@/lib/peak/crypto';
import { parseOrderCommand } from '@/lib/peak-order/command';
import { NOT_FOUND_EXAMPLE, resolveOrderCommand } from '@/lib/peak-order/resolve';
import { firstLine, planUnits } from '@/lib/peak-order/mapper';
import { TEXT, choicesCard, modeCard, statusCard, unitCard, whoCard } from '@/lib/peak-order/flex';
import { DRAFT_TTL_MS, handlePeakOrderText, startFromQuotation } from '@/lib/peak-order/handler';
import { CLAIM_TTL_MS, fakeClock, fakeDb, fakeDeps, fakePeak, textMsg, type FakeLink, type FakeOrder } from './helpers/peak-order-fakes';

const CUSTOMER = 'ไทยฟูดส์ อาหารสัตว์';
const CONTACTS = { C001: CUSTOMER };

function quot(code: string, lines: Array<{ key: string; description: string; quantity: number | null }>, over: Partial<PeakQuotation> = {}): PeakQuotation {
  return {
    code,
    status: 'Approve',
    issuedDate: '2026-11-10',
    contactCode: 'C001',
    netAmount: 3210,
    lines: lines.map((l) => ({ ...l, price: 100 })),
    ...over,
  };
}

const Q1 = quot('QO-202611000001', [{ key: 'L1', description: 'ไวนิลขนาด 1x2 เมตร', quantity: 10 }]);
const Q3 = quot('QO-202611000003', [
  { key: 'L1', description: 'ไวนิล 2x3 เมตร พับขอบ', quantity: 2 },
  { key: 'L2', description: 'สติ๊กเกอร์ไดคัท', quantity: 500 },
  { key: 'L3', description: 'ค่าจัดส่ง', quantity: 1 },
]);

const STAFF_SEED = { 'U-gift': 'กิ๊ฟ' };

function setup(quotations: PeakQuotation[], seed: { orders?: Record<number, FakeOrder>; links?: FakeLink[]; staff?: Record<string, string> } = {}) {
  const clock = fakeClock();
  return fakeDeps({}, { clock, quotations, contacts: CONTACTS, seed: { staff: STAFF_SEED, ...seed } });
}

const onlyDraft = (drafts: Map<string, unknown>) => {
  expect(drafts.size).toBe(1);
  return [...drafts.values()][0] as Parameters<typeof unitCard>[0];
};

const link = (qoCode: string, lineKey: string, orderId: number | null, claimedAtMs: number, draftId = 'old'): FakeLink => ({
  qoCode,
  lineKey,
  orderId,
  draftId,
  claimedAtMs,
});

describe('handlePeakOrderText — identity checks', () => {
  it('event without a userId → TEXT.noUser, no draft, no Peak call, no staff lookup', async () => {
    const f = setup([Q1]);
    const getStaff = vi.spyOn(f.db, 'getStaff');
    await handlePeakOrderText(textMsg('/order QO-202611000001', { user: '' }), f.deps);
    expect(f.replies).toEqual([TEXT.noUser]);
    expect(f.db.drafts.size).toBe(0);
    expect(f.peak.calls).toEqual([]);
    expect(getStaff).not.toHaveBeenCalled();
  });

  it('unknown user → whoCard carrying the original args, no Peak call, no draft', async () => {
    const f = setup([Q1], { staff: {} });
    await handlePeakOrderText(textMsg('/order  ไทยฟูดส์ ไวนิล '), f.deps);
    expect(f.replies).toEqual([whoCard('ไทยฟูดส์ ไวนิล')]);
    expect(f.peak.calls).toEqual([]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('unknown user typing bare /order → whoCard with empty args', async () => {
    const f = setup([Q1], { staff: {} });
    await handlePeakOrderText(textMsg('/order'), f.deps);
    expect(f.replies).toEqual([whoCard('')]);
    expect(f.peak.calls).toEqual([]);
  });
});

describe('handlePeakOrderText — draft start', () => {
  it('single-line quotation → draft { single, unit, 0, กิ๊ฟ, group, user } + unitCard', async () => {
    const f = setup([Q1]);
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    const d = onlyDraft(f.db.drafts);
    expect(d).toMatchObject({
      id: 'd1',
      mode: 'single',
      step: 'unit',
      unitIdx: 0,
      orderer: 'กิ๊ฟ',
      groupId: 'G-team',
      lineUserId: 'U-gift',
      qoCode: 'QO-202611000001',
      creatingKind: null,
      snapshot: { quotation: Q1, customerName: CUSTOMER },
    });
    expect(d.units).toEqual(planUnits(Q1, 'single').map((u) => ({ ...u, choices: {} })));
    expect(d.units).toHaveLength(1);
    expect(f.replies).toHaveLength(1);
    expect(f.replies.at(-1)).toEqual(unitCard(d));
    // Starting a draft claims nothing.
    expect(f.db.links).toEqual([]);
    expect(f.created).toEqual([]);
  });

  it('single line with quantity null → unit qty "", still the unit step + unitCard (Review Focus 2)', async () => {
    const q = quot('QO-202611000010', [{ key: 'L1', description: 'นามบัตร', quantity: null }]);
    const f = setup([q]);
    await handlePeakOrderText(textMsg('/order QO-202611000010'), f.deps);
    const d = onlyDraft(f.db.drafts);
    expect(d.units[0].qty).toBe('');
    expect(d.step).toBe('unit');
    expect(d.mode).toBe('single');
    expect(f.replies.at(-1)).toEqual(unitCard(d));
  });

  it('single line with a fractional quantity → clean decimal qty, unit step (Review Focus 2)', async () => {
    const q = quot('QO-202611000011', [{ key: 'L1', description: 'กระดาษ', quantity: 0.1 + 0.2 }]);
    const f = setup([q]);
    await handlePeakOrderText(textMsg('/order QO-202611000011'), f.deps);
    const d = onlyDraft(f.db.drafts);
    expect(d.units[0].qty).toBe('0.3');
    expect(d.step).toBe('unit');
    expect(f.replies.at(-1)).toEqual(unitCard(d));
  });

  it('3-line quotation, all free → step mode, mode null, no units, modeCard', async () => {
    const f = setup([Q3]);
    await handlePeakOrderText(textMsg('/order QO-202611000003'), f.deps);
    const d = onlyDraft(f.db.drafts);
    expect(d).toMatchObject({ step: 'mode', mode: null, units: [], unitIdx: 0, orderer: 'กิ๊ฟ' });
    expect(f.replies).toEqual([modeCard(d)]);
  });
});

describe('handlePeakOrderText — refused quotations', () => {
  it.each(['Voided', 'voided', 'VOIDED'])('status %s → TEXT.voided, no draft', async (status) => {
    const q = quot('QO-202611000020', [{ key: 'L1', description: 'x', quantity: 1 }], { status });
    const f = setup([q]);
    await handlePeakOrderText(textMsg('/order QO-202611000020'), f.deps);
    expect(f.replies).toEqual([TEXT.voided]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('zero lines → TEXT.noLines, no draft (Review Focus 5)', async () => {
    const q = quot('QO-202611000021', []);
    const f = setup([q]);
    await handlePeakOrderText(textMsg('/order QO-202611000021'), f.deps);
    expect(f.replies).toEqual([TEXT.noLines]);
    expect(f.db.drafts.size).toBe(0);
  });
});

describe('handlePeakOrderText — already opened (status card)', () => {
  it('live link on the only line → statusCard with that order, no draft', async () => {
    const f = setup([Q1], { orders: { 7001: { name: 'ไวนิลขนาด 1x2 เมตร', status: 'pending' } } });
    f.db.links.push(link(Q1.code, 'L1', 7001, f.clock.ms - 86_400_000));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    expect(f.replies).toEqual([
      statusCard({
        qoCode: Q1.code,
        customerName: CUSTOMER,
        opened: [{ orderId: 7001, name: 'ไวนิลขนาด 1x2 เมตร', isDraft: false }],
        remaining: [],
      }),
    ]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('linked dashboard draft order → statusCard marks it isDraft', async () => {
    const f = setup([Q1], { orders: { 7002: { name: 'ไวนิล', status: 'draft' } } });
    f.db.links.push(link(Q1.code, 'L1', 7002, f.clock.ms));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    expect(f.replies).toEqual([
      statusCard({ qoCode: Q1.code, customerName: CUSTOMER, opened: [{ orderId: 7002, name: 'ไวนิล', isDraft: true }], remaining: [] }),
    ]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('3 lines, one live → statusCard with 1 opened + 2 remaining, no draft', async () => {
    const f = setup([Q3], { orders: { 7003: { name: 'สติ๊กเกอร์ไดคัท', status: 'in_progress' } } });
    f.db.links.push(link(Q3.code, 'L2', 7003, f.clock.ms - 3_600_000));
    await handlePeakOrderText(textMsg('/order QO-202611000003'), f.deps);
    expect(f.replies).toEqual([
      statusCard({
        qoCode: Q3.code,
        customerName: CUSTOMER,
        opened: [{ orderId: 7003, name: 'สติ๊กเกอร์ไดคัท', isDraft: false }],
        remaining: [{ name: firstLine(Q3.lines[0].description) }, { name: firstLine(Q3.lines[2].description) }],
      }),
    ]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('merged order linked on all 3 lines → listed once', async () => {
    const f = setup([Q3], { orders: { 7004: { name: 'ไวนิล (+2 รายการ)', status: 'pending' } } });
    for (const k of ['L1', 'L2', 'L3']) f.db.links.push(link(Q3.code, k, 7004, f.clock.ms));
    await handlePeakOrderText(textMsg('/order QO-202611000003'), f.deps);
    expect(f.replies).toEqual([
      statusCard({ qoCode: Q3.code, customerName: CUSTOMER, opened: [{ orderId: 7004, name: 'ไวนิล (+2 รายการ)', isDraft: false }], remaining: [] }),
    ]);
  });

  it('in-flight claim of another draft (orderId null, 30 s old) → statusCard without an opened entry, no draft (R4)', async () => {
    const f = setup([Q1]);
    f.db.links.push(link(Q1.code, 'L1', null, f.clock.ms - 30_000, 'other'));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    expect(f.replies).toEqual([statusCard({ qoCode: Q1.code, customerName: CUSTOMER, opened: [], remaining: [] })]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('in-flight claim on 1 of 3 lines → statusCard: 0 opened, 2 remaining (R4)', async () => {
    const f = setup([Q3]);
    f.db.links.push(link(Q3.code, 'L3', null, f.clock.ms - 10_000, 'other'));
    await handlePeakOrderText(textMsg('/order QO-202611000003'), f.deps);
    expect(f.replies).toEqual([
      statusCard({
        qoCode: Q3.code,
        customerName: CUSTOMER,
        opened: [],
        remaining: [{ name: firstLine(Q3.lines[0].description) }, { name: firstLine(Q3.lines[1].description) }],
      }),
    ]);
    expect(f.db.drafts.size).toBe(0);
  });
});

describe('handlePeakOrderText — lines that are free again', () => {
  it('live order on a line key no longer in the quotation → status card (that order opened, every current line remaining), no draft (spec §4.5)', async () => {
    const f = setup([Q1], { orders: { 7005: { name: 'เก่า', status: 'pending' } } });
    f.db.links.push(link(Q1.code, 'GONE', 7005, f.clock.ms));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    expect(f.replies).toEqual([
      statusCard({
        qoCode: Q1.code,
        customerName: CUSTOMER,
        opened: [{ orderId: 7005, name: 'เก่า', isDraft: false }],
        remaining: [{ name: firstLine(Q1.lines[0].description) }],
      }),
    ]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('unknown live link key on a 3-line quotation → status card with all 3 current lines remaining, no draft', async () => {
    const f = setup([Q3], { orders: { 7006: { name: 'เก่า', status: 'pending' } } });
    f.db.links.push(link(Q3.code, 'L9', 7006, f.clock.ms));
    await handlePeakOrderText(textMsg('/order QO-202611000003'), f.deps);
    expect(f.replies).toEqual([
      statusCard({
        qoCode: Q3.code,
        customerName: CUSTOMER,
        opened: [{ orderId: 7006, name: 'เก่า', isDraft: false }],
        remaining: Q3.lines.map((l) => ({ name: firstLine(l.description) })),
      }),
    ]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('a gone-key order plus a live order on a current line → both listed once under opened', async () => {
    const f = setup([Q3], { orders: { 7006: { name: 'เก่า', status: 'pending' }, 7007: { name: 'ปัจจุบัน', status: 'draft' } } });
    f.db.links.push(link(Q3.code, 'L9', 7006, f.clock.ms), link(Q3.code, 'L8', 7006, f.clock.ms), link(Q3.code, 'L2', 7007, f.clock.ms));
    await handlePeakOrderText(textMsg('/order QO-202611000003'), f.deps);
    expect(f.replies).toEqual([
      statusCard({
        qoCode: Q3.code,
        customerName: CUSTOMER,
        opened: [
          { orderId: 7007, name: 'ปัจจุบัน', isDraft: true },
          { orderId: 7006, name: 'เก่า', isDraft: false },
        ],
        remaining: [{ name: firstLine(Q3.lines[0].description) }, { name: firstLine(Q3.lines[2].description) }],
      }),
    ]);
  });

  it('an in-flight claim (orderId null) on a key no longer in the quotation is ignored entirely → draft starts', async () => {
    const f = setup([Q1]);
    f.db.links.push(link(Q1.code, 'GONE', null, f.clock.ms - 10_000, 'other'));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    const d = onlyDraft(f.db.drafts);
    expect(d).toMatchObject({ mode: 'single', step: 'unit' });
    expect(f.replies).toEqual([unitCard(d)]);
  });

  it('linked order cancelled → line is free → new draft', async () => {
    const f = setup([Q1], { orders: { 7007: { name: 'ไวนิล', status: 'cancelled' } } });
    f.db.links.push(link(Q1.code, 'L1', 7007, f.clock.ms));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    const d = onlyDraft(f.db.drafts);
    expect(d).toMatchObject({ mode: 'single', step: 'unit' });
    expect(f.replies).toEqual([unitCard(d)]);
  });

  it('linked order row missing → line is free → new draft', async () => {
    const f = setup([Q1]);
    f.db.links.push(link(Q1.code, 'L1', 424242, f.clock.ms));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    expect(onlyDraft(f.db.drafts).step).toBe('unit');
  });

  it('abandoned claim older than 2 minutes → dead → new draft', async () => {
    const f = setup([Q1]);
    f.db.links.push(link(Q1.code, 'L1', null, f.clock.ms - CLAIM_TTL_MS - 1000, 'crashed'));
    await handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps);
    expect(onlyDraft(f.db.drafts).step).toBe('unit');
  });
});

describe('handlePeakOrderText — resolver outcomes', () => {
  const recent = [
    quot('QO-202611000101', [{ key: 'L1', description: 'โปสเตอร์ A3', quantity: 50 }], { issuedDate: '2026-11-12' }),
    quot('QO-202611000102', [{ key: 'L1', description: 'ใบปลิว A5', quantity: 1000 }], { issuedDate: '2026-11-13' }),
  ];

  it('bare /order → choicesCard of the resolver result, no draft', async () => {
    const f = setup(recent);
    f.db.links.push(link('QO-202611000101', 'L1', null, f.clock.ms - 5_000, 'x'));
    await handlePeakOrderText(textMsg('/order'), f.deps);
    const expected = await resolveOrderCommand(parseOrderCommand('/order')!, {
      peak: fakePeak(recent, CONTACTS),
      openedCodes: f.db.openedCodes,
      todayISO: '2026-11-14',
    });
    expect(expected.kind).toBe('choices');
    if (expected.kind !== 'choices') return;
    expect(expected.choices.map((c) => [c.code, c.opened])).toEqual([
      ['QO-202611000102', false],
      ['QO-202611000101', true],
    ]);
    expect(f.replies).toEqual([choicesCard(expected.heading, expected.choices, expected.note)]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('nothing found → the resolver hint as text, no draft', async () => {
    const f = setup(recent);
    await handlePeakOrderText(textMsg('/order QO-999999999'), f.deps);
    const expected = await resolveOrderCommand(parseOrderCommand('/order QO-999999999')!, {
      peak: fakePeak(recent, CONTACTS),
      openedCodes: f.db.openedCodes,
      todayISO: '2026-11-14',
    });
    expect(expected.kind).toBe('not-found');
    if (expected.kind !== 'not-found') return;
    expect(f.replies).toEqual([expected.hint]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('today is the Bangkok calendar day (23:30 UTC = next day in Bangkok)', async () => {
    const clock = fakeClock('2026-11-14T23:30:00.000Z');
    const f = fakeDeps({}, { clock, quotations: recent, contacts: CONTACTS, seed: { staff: STAFF_SEED } });
    await handlePeakOrderText(textMsg('/order'), f.deps);
    const first = f.peak.calls.find((c) => c.m === 'newestQuotations');
    expect(first?.a[0]).toEqual({ dateStart: '2026-10-16' }); // 2026-11-15 − 30 days
  });
});

describe('handlePeakOrderText — not found', () => {
  it('a 500-character search term is clipped in the reply, and the reply ends with the usage example', async () => {
    const f = setup([Q1]);
    const term = 'ข'.repeat(500);
    await handlePeakOrderText(textMsg(`/order ${term}`), f.deps);
    expect(f.replies).toHaveLength(1);
    const r = f.replies[0] as string;
    expect(typeof r).toBe('string');
    expect(r).not.toContain(term);
    expect(r).toContain('ข'.repeat(79) + '…');
    expect(r).not.toContain('ข'.repeat(80));
    expect(r.endsWith(NOT_FOUND_EXAMPLE)).toBe(true);
    expect(Array.from(r).length).toBeLessThan(250);
    expect(f.db.drafts.size).toBe(0);
  });
});

describe('handlePeakOrderText — Peak failures', () => {
  const failing = (err: unknown) => {
    const f = setup([Q1]);
    f.deps.peak = { ...f.peak, getQuotation: async () => Promise.reject(err) };
    return f;
  };

  it.each([
    ['PeakNotConnectedError', new PeakNotConnectedError('not connected'), TEXT.peakNotConnected],
    ['PeakAuthError', new PeakAuthError('rejected'), TEXT.peakNotConnected],
    ['PeakConfigError', new PeakConfigError('bad key'), TEXT.peakNotConnected],
    ['PeakUnavailableError', new PeakUnavailableError('timeout'), TEXT.peakUnavailable],
    ['PeakToolError', new PeakToolError('bad payload'), TEXT.peakUnavailable],
  ])('%s → short text, no draft, does not throw', async (_n, err, text) => {
    const f = failing(err);
    await expect(handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps)).resolves.toBeUndefined();
    expect(f.replies).toEqual([text]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('a command past the 25 s Peak budget → TEXT.peakUnavailable, no draft (real resolver limiter)', async () => {
    const f = setup([Q1]);
    let t = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => t);
    try {
      const slowGet = f.peak.getQuotation;
      f.deps.peak = {
        ...f.peak,
        getQuotation: async (c: string) => {
          t += 26_000; // the quotation read alone takes 26 s
          return slowGet(c);
        },
      };
      await expect(handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps)).resolves.toBeUndefined();
    } finally {
      now.mockRestore();
    }
    expect(f.replies).toEqual([TEXT.peakUnavailable]);
    expect(f.db.drafts.size).toBe(0);
    expect(f.peak.calls.filter((c) => c.m === 'getContactName')).toEqual([]); // never started
  });

  it('any other error is not swallowed', async () => {
    const f = failing(new TypeError('boom'));
    await expect(handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps)).rejects.toThrow('boom');
    expect(f.replies).toEqual([]);
  });

  it('a DB error is not swallowed either', async () => {
    const f = setup([Q1]);
    f.deps.db = { ...f.db, liveLinks: async () => Promise.reject(new Error('db down')) };
    await expect(handlePeakOrderText(textMsg('/order QO-202611000001'), f.deps)).rejects.toThrow('db down');
    expect(f.replies).toEqual([]);
  });
});

describe('startFromQuotation — remainingOnly (rest) and direct entry', () => {
  it('rest on a partly opened 3-line quotation → split draft over the free lines only', async () => {
    const f = setup([Q3], { orders: { 7010: { name: 'สติ๊กเกอร์ไดคัท', status: 'pending' } } });
    f.db.links.push(link(Q3.code, 'L2', 7010, f.clock.ms));
    await startFromQuotation(textMsg(''), f.deps, Q3, CUSTOMER, 'กิ๊ฟ', { remainingOnly: true });
    const d = onlyDraft(f.db.drafts);
    expect(d).toMatchObject({ mode: 'split', step: 'unit', unitIdx: 0, orderer: 'กิ๊ฟ' });
    expect(d.units).toEqual(planUnits(Q3, 'split', ['L1', 'L3']).map((u) => ({ ...u, choices: {} })));
    expect(d.units.map((u) => u.lineKeys)).toEqual([['L1'], ['L3']]);
    expect(f.replies).toEqual([unitCard(d)]);
    expect(f.peak.calls).toEqual([]);
  });

  it('rest with nothing opened → split over every line (no mode step)', async () => {
    const f = setup([Q3]);
    await startFromQuotation(textMsg(''), f.deps, Q3, CUSTOMER, 'นุ๊ก', { remainingOnly: true });
    const d = onlyDraft(f.db.drafts);
    expect(d).toMatchObject({ mode: 'split', step: 'unit', orderer: 'นุ๊ก' });
    expect(d.units).toHaveLength(3);
    expect(f.replies).toEqual([unitCard(d)]);
  });

  it('rest when every line is already taken → statusCard, no draft', async () => {
    const f = setup([Q3], { orders: { 7011: { name: 'ไวนิล (+2 รายการ)', status: 'pending' } } });
    for (const k of ['L1', 'L2', 'L3']) f.db.links.push(link(Q3.code, k, 7011, f.clock.ms));
    await startFromQuotation(textMsg(''), f.deps, Q3, CUSTOMER, 'กิ๊ฟ', { remainingOnly: true });
    expect(f.replies).toEqual([
      statusCard({ qoCode: Q3.code, customerName: CUSTOMER, opened: [{ orderId: 7011, name: 'ไวนิล (+2 รายการ)', isDraft: false }], remaining: [] }),
    ]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('rest on a single-line quotation whose line is free → single mode', async () => {
    const f = setup([Q1]);
    await startFromQuotation(textMsg(''), f.deps, Q1, CUSTOMER, 'กิ๊ฟ', { remainingOnly: true });
    expect(onlyDraft(f.db.drafts)).toMatchObject({ mode: 'single', step: 'unit' });
  });

  it('Voided / zero lines are refused on this entry too', async () => {
    const f = setup([]);
    await startFromQuotation(textMsg(''), f.deps, { ...Q1, status: 'Voided' }, CUSTOMER, 'กิ๊ฟ', { remainingOnly: true });
    await startFromQuotation(textMsg(''), f.deps, { ...Q1, lines: [] }, CUSTOMER, 'กิ๊ฟ');
    expect(f.replies).toEqual([TEXT.voided, TEXT.noLines]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('no userId → TEXT.noUser, no draft', async () => {
    const f = setup([Q1]);
    await startFromQuotation(textMsg('', { user: '' }), f.deps, Q1, CUSTOMER, 'กิ๊ฟ');
    expect(f.replies).toEqual([TEXT.noUser]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('the stored snapshot is not aliased to the caller’s quotation object', async () => {
    const f = setup([]);
    const q = structuredClone(Q1);
    await startFromQuotation(textMsg(''), f.deps, q, CUSTOMER, 'กิ๊ฟ');
    q.lines[0].description = 'changed';
    expect(onlyDraft(f.db.drafts).snapshot.quotation.lines[0].description).toBe('ไวนิลขนาด 1x2 เมตร');
  });

  it('DRAFT_TTL_MS is 30 minutes', () => {
    expect(DRAFT_TTL_MS).toBe(30 * 60_000);
  });
});

// The fake is what Task 13's duplicate-order tests stand on: pin its SQL semantics.
describe('fakeDb reproduces lib/peak-order/db.ts semantics', () => {
  const C = 'QO-1';
  const mk = () => {
    const clock = fakeClock();
    return { clock, db: fakeDb({ nowMs: clock.nowMs, orders: { 1: { name: 'a', status: 'pending' }, 2: { name: 'b', status: 'cancelled' } } }) };
  };
  const baseDraft = {
    id: 'd',
    groupId: 'g',
    lineUserId: 'u',
    orderer: 'กิ๊ฟ',
    qoCode: C,
    snapshot: { quotation: Q1, customerName: CUSTOMER },
    mode: 'single' as const,
    units: [],
    unitIdx: 0,
    step: 'unit' as const,
  };

  it('advanceDraft: exact gate; mode/units kept when omitted; creatingKind always written; touch time; copies', async () => {
    const { db, clock } = mk();
    await db.createDraft(baseDraft);
    expect(await db.advanceDraft('d', { unitIdx: 0, step: 'graphic' }, { unitIdx: 0, step: 'press' })).toBeNull();
    expect(await db.advanceDraft('d', { unitIdx: 1, step: 'unit' }, { unitIdx: 0, step: 'press' })).toBeNull();
    clock.advance(5000);
    const a = await db.advanceDraft('d', { unitIdx: 0, step: 'unit' }, { unitIdx: 0, step: 'creating', creatingKind: 'draft' });
    expect(a).toMatchObject({ step: 'creating', mode: 'single', units: [], creatingKind: 'draft', lastTouchedAt: new Date(clock.ms).toISOString() });
    const b = await db.advanceDraft('d', { unitIdx: 0, step: 'creating' }, { unitIdx: 0, step: 'confirm', mode: null });
    expect(b).toMatchObject({ step: 'confirm', mode: 'single', creatingKind: null });
    b!.step = 'done';
    expect((await db.loadDraft('d'))!.step).toBe('confirm');
    expect(await db.advanceDraft('missing', { unitIdx: 0, step: 'unit' }, { unitIdx: 0, step: 'press' })).toBeNull();
  });

  it('cancelDraft refuses done / cancelled / creating / missing', async () => {
    const { db } = mk();
    expect(await db.cancelDraft('d')).toBe(false);
    for (const step of ['done', 'cancelled', 'creating'] as const) {
      db.drafts.clear();
      await db.createDraft({ ...baseDraft, step });
      expect(await db.cancelDraft('d')).toBe(false);
    }
    db.drafts.clear();
    await db.createDraft(baseDraft);
    expect(await db.cancelDraft('d')).toBe(true);
    expect((await db.loadDraft('d'))!.step).toBe('cancelled');
  });

  it('claimLines: [] → false; dedupes; all-or-nothing with release; takes dead rows only', async () => {
    const { db, clock } = mk();
    expect(await db.claimLines(C, [], 'd1', 'x')).toBe(false);
    expect(await db.claimLines(C, ['A', 'A'], 'd1', 'x')).toBe(true);
    expect(db.links.filter((l) => l.lineKey === 'A')).toHaveLength(1);
    // B free, A live (in-flight for d1) → d2 gets nothing and leaves no row.
    expect(await db.claimLines(C, ['A', 'B'], 'd2', 'y')).toBe(false);
    expect(db.links.map((l) => [l.lineKey, l.draftId])).toEqual([['A', 'd1']]);
    // A live in-flight claim blocks even its own draft, and the failure releases that draft's rows.
    expect(await db.claimLines(C, ['A'], 'd1', 'x')).toBe(false);
    expect(db.links).toEqual([]);
    // Dead rows are taken over: old claim, cancelled order, missing order. Live order is not.
    db.links.push(
      link(C, 'old', null, clock.ms - CLAIM_TTL_MS - 1),
      link(C, 'can', 2, clock.ms),
      link(C, 'gone', 99, clock.ms),
      link(C, 'live', 1, clock.ms),
    );
    expect(await db.claimLines(C, ['old', 'can', 'gone'], 'd3', 'z')).toBe(true);
    expect(db.links.filter((l) => l.draftId === 'd3').map((l) => [l.lineKey, l.orderId])).toEqual([
      ['old', null],
      ['can', null],
      ['gone', null],
    ]);
    expect(await db.claimLines(C, ['live'], 'd4', 'z')).toBe(false);
    // Exactly at 2 minutes the claim is still live; one ms later it is dead.
    db.links.length = 0;
    db.links.push(link(C, 'edge', null, clock.ms - CLAIM_TTL_MS));
    expect(await db.claimLines(C, ['edge'], 'd5', 'z')).toBe(false);
    clock.advance(1);
    expect(await db.claimLines(C, ['edge'], 'd5', 'z')).toBe(true);
  });

  it('releaseClaim / finalizeLinks only touch that draft’s un-finalized rows', async () => {
    const { db, clock } = mk();
    db.links.push(link(C, 'A', 1, clock.ms, 'd1'), link(C, 'B', null, clock.ms, 'd1'), link(C, 'C', null, clock.ms, 'd2'));
    await db.finalizeLinks(C, 'd1', 1234);
    expect(db.links.map((l) => [l.lineKey, l.orderId])).toEqual([
      ['A', 1],
      ['B', 1234],
      ['C', null],
    ]);
    db.links.push(link(C, 'D', null, clock.ms, 'd1'));
    await db.releaseClaim(C, 'd1');
    expect(db.links.map((l) => l.lineKey)).toEqual(['A', 'B', 'C']);
  });

  it('liveLinks / openedCodes / findOrderByPeakMarker', async () => {
    const { db, clock } = mk();
    db.orders.set(5, { name: 'm', status: 'draft', peak: { code: C, lineKeys: ['X', 'Y'] } });
    db.orders.set(6, { name: 'n', status: 'cancelled', peak: { code: C, lineKeys: ['X'] } });
    db.links.push(
      link(C, 'b', 1, clock.ms),
      link(C, 'a', null, clock.ms - 1000),
      link(C, 'c', 2, clock.ms),
      link(C, 'd', null, clock.ms - CLAIM_TTL_MS - 1),
      link('QO-2', 'a', 2, clock.ms),
    );
    expect(await db.liveLinks(C)).toEqual([
      { lineKey: 'a', orderId: null, orderName: null, orderStatus: null },
      { lineKey: 'b', orderId: 1, orderName: 'a', orderStatus: 'pending' },
    ]);
    expect(await db.openedCodes([C, 'QO-2', 'QO-3'])).toEqual(new Set([C]));
    expect(await db.findOrderByPeakMarker(C, ['Z', 'X'])).toEqual({ id: 5, status: 'draft' });
    expect(await db.findOrderByPeakMarker(C, [])).toBeNull();
    expect(await db.findOrderByPeakMarker('QO-2', ['X'])).toBeNull();
  });

  it('a job cancelled on the board (jobCancelled, status still live) makes the order dead for all four', async () => {
    const { db, clock } = mk();
    db.orders.set(7, { name: 'board-cancelled', status: 'sent', jobCancelled: true, peak: { code: C, lineKeys: ['X'] } });
    db.orders.set(8, { name: 'alive', status: 'sent', jobCancelled: false, peak: { code: 'QO-9', lineKeys: ['X'] } });
    db.links.push(link(C, 'X', 7, clock.ms), link('QO-9', 'X', 8, clock.ms));
    expect(await db.liveLinks(C)).toEqual([]);
    expect(await db.openedCodes([C, 'QO-9'])).toEqual(new Set(['QO-9']));
    expect(await db.findOrderByPeakMarker(C, ['X'])).toBeNull();
    expect(await db.findOrderByPeakMarker('QO-9', ['X'])).toEqual({ id: 8, status: 'sent' });
    expect(await db.claimLines('QO-9', ['X'], 'd9', 'z')).toBe(false);
    expect(await db.claimLines(C, ['X'], 'd9', 'z')).toBe(true);
    expect(db.links.find((l) => l.qoCode === C)).toMatchObject({ draftId: 'd9', orderId: null });
  });

  it('fakeDeps default createOrder registers the order with its peak marker', async () => {
    const f = fakeDeps();
    const r = await f.deps.createOrder({ name: 'งาน', status: 'draft', peak: { code: C, lineKeys: ['L1'], draftId: 'd' } }, { role: 'sales', user: 'กิ๊ฟ (LINE)' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.db.orders.get(r.orderId)).toEqual({ name: 'งาน', status: 'draft', peak: { code: C, lineKeys: ['L1'] } });
    expect(await f.db.findOrderByPeakMarker(C, ['L1'])).toEqual({ id: r.orderId, status: 'draft' });
    expect(f.created).toHaveLength(1);
    expect(f.actors).toEqual([{ role: 'sales', user: 'กิ๊ฟ (LINE)' }]);
  });
});
