import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '@/lib/ai-quote/channels/types';
import type { PeakQuotation } from '@/lib/peak/read';
import type { CreateOrderBody, CreateOrderResult, OrderActor } from '@/lib/orders-create';
import type { DraftRow } from '@/lib/peak-order/db';
import { PeakAuthError, PeakUnavailableError } from '@/lib/peak/oauth';
import { PeakNotConnectedError } from '@/lib/peak/token-store';
import { encodePostback, type OrderPostback } from '@/lib/peak-order/postback';
import { addDaysISO, buildOrderBody, firstLine, planUnits } from '@/lib/peak-order/mapper';
import {
  TEXT,
  createdCard,
  dateCard,
  dupCard,
  graphicCard,
  pressCard,
  statusCard,
  summaryCard,
  unitCard,
  whoCard,
  type Card,
} from '@/lib/peak-order/flex';
import { handlePeakOrderPostback, handlePeakOrderText } from '@/lib/peak-order/handler';
import { NOT_FOUND_EXAMPLE } from '@/lib/peak-order/resolve';
import { CLAIM_TTL_MS, fakeClock, fakeDeps, textMsg, type FakeLink, type FakeOrder } from './helpers/peak-order-fakes';

const CUSTOMER = 'ไทยฟูดส์ อาหารสัตว์';
const CONTACTS = { C001: CUSTOMER };
const TODAY = '2026-11-14'; // fakeClock default = 10:00 Bangkok

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
  { key: 'L2', description: 'ค่าจัดส่ง', quantity: 1 },
  { key: 'L3', description: 'สติ๊กเกอร์ไดคัท', quantity: 500 },
]);

const STAFF_SEED = { 'U-gift': 'กิ๊ฟ', 'U-nook': 'นุ๊ก' };

type F = ReturnType<typeof fakeDeps>;

function setup(
  quotations: PeakQuotation[] = [Q1, Q3],
  seed: { orders?: Record<number, FakeOrder>; links?: FakeLink[]; staff?: Record<string, string> } = {},
  over: Parameters<typeof fakeDeps>[0] = {},
  clockIso?: string,
): F {
  const clock = fakeClock(clockIso);
  return fakeDeps(over, { clock, quotations, contacts: CONTACTS, seed: { staff: STAFF_SEED, ...seed } });
}

interface TapOpts {
  user?: string;
  /** null = no groupId on the event (1-on-1). */
  group?: string | null;
  date?: string;
  noParams?: boolean;
}

function msg(p: OrderPostback | string, o: TapOpts = {}): InboundMessage {
  return {
    channel: 'line',
    channelUserId: o.user ?? 'U-gift',
    kind: 'postback',
    postbackData: typeof p === 'string' ? p : encodePostback(p),
    ...(o.date !== undefined ? { postbackParams: { date: o.date } } : {}),
    replyToken: 'rt',
    sourceType: 'group',
    ...(o.group === null ? {} : { groupId: o.group ?? 'G-team' }),
  };
}

const tap = (f: F, p: OrderPostback | string, o: TapOpts = {}) => handlePeakOrderPostback(msg(p, o), f.deps);
const draft = (f: F, id = 'd1'): DraftRow => structuredClone(f.db.drafts.get(id)!);
const last = (f: F) => f.replies.at(-1);

async function start(f: F, code: string, user = 'U-gift') {
  await handlePeakOrderText(textMsg(`/order ${code}`, { user }), f.deps);
}

/** Single-line draft walked to the summary: ชิ้น / ปุ๊ก / Inkjet / +3. */
async function toConfirm(f: F, id = 'd1', o: TapOpts = {}) {
  await tap(f, { a: 'unit', draft: id, u: 0, v: 6 }, o);
  await tap(f, { a: 'gfx', draft: id, u: 0, v: 'pook' }, o);
  await tap(f, { a: 'press', draft: id, u: 0, v: 'inkjet' }, o);
  await tap(f, { a: 'date', draft: id, u: 0, v: '+3' }, o);
}

const okCreate = (id = 'd1', u = 0): OrderPostback => ({ a: 'ok', draft: id, u, v: 'create' });

/** Snapshot of everything a silent no-op must leave untouched. */
function state(f: F) {
  return JSON.stringify({ d: [...f.db.drafts.entries()], l: f.db.links, o: [...f.db.orders.entries()], r: f.replies.length, c: f.created.length });
}

function deferred() {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
}

// ─── happy paths ───────────────────────────────────────────────────

describe('handlePeakOrderPostback — single line, create', () => {
  it('unit → gfx → press → date(+3) → ok: one createOrder with the chosen fields, link finalized, done, createdCard', async () => {
    const f = setup();
    await start(f, Q1.code);

    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 6 });
    expect(draft(f)).toMatchObject({ step: 'graphic', unitIdx: 0 });
    expect(draft(f).units[0].choices).toEqual({ qtyUnit: 'ชิ้น' });
    expect(last(f)).toEqual(graphicCard(draft(f), false));

    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'pook' });
    expect(draft(f).step).toBe('press');
    expect(last(f)).toEqual(pressCard(draft(f)));

    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'inkjet' });
    expect(draft(f).step).toBe('date');
    expect(last(f)).toEqual(dateCard(draft(f), TODAY));

    await tap(f, { a: 'date', draft: 'd1', u: 0, v: '+3' });
    expect(draft(f).step).toBe('confirm');
    expect(draft(f).units[0].choices).toEqual({ qtyUnit: 'ชิ้น', graphic: 'pook', press: 'inkjet', dateDue: '2026-11-17' });
    expect(last(f)).toEqual(summaryCard(draft(f)));
    expect(f.created).toEqual([]);
    expect(f.db.links).toEqual([]);

    await tap(f, okCreate());
    expect(f.created).toHaveLength(1);
    const unit = planUnits(Q1, 'single')[0];
    expect(f.created[0]).toEqual(
      buildOrderBody({
        unit,
        choices: { qtyUnit: 'ชิ้น', graphic: 'pook', press: 'inkjet', dateDue: '2026-11-17' },
        customerName: CUSTOMER,
        orderer: 'กิ๊ฟ',
        qoCode: Q1.code,
        draftId: 'd1',
        todayISO: TODAY,
        asDraft: false,
      }),
    );
    expect(f.created[0]).toMatchObject({ assignStaff: 'pook', forwardPrint: 'inkjet', qtyUnit: 'ชิ้น', dateDue: '2026-11-17', orderer: 'กิ๊ฟ' });
    expect(f.created[0].status).toBeUndefined();
    expect(f.created[0].force).toBeUndefined();
    expect(f.actors).toEqual([{ role: 'sales', user: 'กิ๊ฟ (LINE)' }]);
    expect(f.db.links.map((l) => [l.qoCode, l.lineKey, l.orderId, l.draftId])).toEqual([[Q1.code, 'L1', 9000, 'd1']]);
    const d = draft(f);
    expect(d.step).toBe('done');
    expect(d.units[0].result).toEqual({ kind: 'order', orderId: 9000, jobId: 90000, pin: '4821' });
    expect(last(f)).toEqual(createdCard({ orderId: 9000, name: unit.name, pin: '4821', isDraft: false }));
  });

  it('ok draft → body status "draft", createdCard isDraft, link finalized, counts as opened', async () => {
    const f = setup();
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, { a: 'ok', draft: 'd1', u: 0, v: 'draft' });
    expect(f.created).toHaveLength(1);
    expect(f.created[0].status).toBe('draft');
    expect(f.db.orders.get(9000)?.status).toBe('draft');
    expect(f.db.links[0]).toMatchObject({ lineKey: 'L1', orderId: 9000 });
    expect(draft(f).units[0].result).toEqual({ kind: 'draft', orderId: 9000, jobId: null, pin: '4821' });
    expect(last(f)).toEqual(createdCard({ orderId: 9000, name: firstLine(Q1.lines[0].description), pin: '4821', isDraft: true }));
    // A later /order sees it as opened (dashboard draft) — no second draft row.
    await start(f, Q1.code);
    expect(last(f)).toEqual(
      statusCard({ qoCode: Q1.code, customerName: CUSTOMER, opened: [{ orderId: 9000, name: firstLine(Q1.lines[0].description), isDraft: true }], remaining: [] }),
    );
    expect(f.db.drafts.size).toBe(1);
  });

  it('quantity null still walks the unit step; the summary shows no quantity (Review Focus 2)', async () => {
    const q = quot('QO-202611000010', [{ key: 'L1', description: 'นามบัตร', quantity: null }]);
    const f = setup([q]);
    await start(f, q.code);
    expect(draft(f).step).toBe('unit');
    await toConfirm(f);
    const s = last(f) as Card;
    expect(s).toEqual(summaryCard(draft(f)));
    expect(s.text).not.toContain('จำนวน');
    await tap(f, okCreate());
    expect(f.created[0].qty).toBe('');
    expect(f.created[0].qtyUnit).toBe('ชิ้น');
  });
});

describe('handlePeakOrderPostback — graphic / press rules', () => {
  it('gfx none → pressCard without ยังไม่ระบุ; a forged press none is ignored (step stays press)', async () => {
    const f = setup();
    await start(f, Q1.code);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'none' });
    expect(draft(f).units[0].choices.graphic).toBe('');
    const card = last(f) as Card;
    expect(card).toEqual(pressCard(draft(f)));
    expect(card.text).not.toContain('ยังไม่ระบุ');
    expect(JSON.stringify(card.flex)).not.toContain('ยังไม่ระบุ');

    const before = state(f);
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'none' });
    expect(state(f)).toBe(before);
    expect(draft(f).step).toBe('press');

    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'sm74' });
    expect(draft(f)).toMatchObject({ step: 'date' });
    expect(draft(f).units[0].choices).toMatchObject({ graphic: '', press: 'sm74' });
  });

  it('press none after a real graphic → press ""', async () => {
    const f = setup();
    await start(f, Q1.code);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'aed' });
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'none' });
    expect(draft(f).step).toBe('date');
    expect(draft(f).units[0].choices).toMatchObject({ graphic: 'aed', press: '' });
  });

  it.each([
    ['gfx: unknown staff id', { a: 'gfx', draft: 'd1', u: 0, v: 'nobody' }, 'graphic'],
    ['gfx: a print id', { a: 'gfx', draft: 'd1', u: 0, v: 'inkjet' }, 'graphic'],
    ['gfx: same on unit 0 (no earlier unit)', { a: 'gfx', draft: 'd1', u: 0, v: 'same' }, 'graphic'],
  ] as const)('%s → silent, no transition', async (_n, p, step) => {
    const f = setup();
    await start(f, Q1.code);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    const before = state(f);
    await tap(f, p as OrderPostback);
    expect(state(f)).toBe(before);
    expect(draft(f).step).toBe(step);
  });

  it('press: unknown id / a graphic id → silent', async () => {
    const f = setup();
    await start(f, Q1.code);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'pook' });
    const before = state(f);
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'pook' });
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'cut' });
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'x' });
    expect(state(f)).toBe(before);
  });
});

describe('handlePeakOrderPostback — due date (Review Focus 4)', () => {
  async function toDate(f: F) {
    await start(f, Q1.code);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'pook' });
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'sm74' });
    expect(draft(f).step).toBe('date');
  }

  it.each([
    ['yesterday', { date: '2026-11-13' }],
    ['month 13', { date: '2026-13-40' }],
    ['30 Feb', { date: '2026-02-30' }],
    ['not a date', { date: 'tomorrow' }],
    ['with time', { date: '2026-11-20T10:00' }],
    ['empty', { date: '' }],
    ['missing params', {}],
  ])('pick %s → TEXT.badDate, no transition', async (_n, o) => {
    const f = setup();
    await toDate(f);
    const touched = draft(f).lastTouchedAt;
    f.clock.advance(1000);
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: 'pick' }, o);
    expect(last(f)).toBe(TEXT.badDate);
    expect(draft(f)).toMatchObject({ step: 'date', lastTouchedAt: touched });
    expect(draft(f).units[0].choices.dateDue).toBeUndefined();
  });

  it('pick today → accepted', async () => {
    const f = setup();
    await toDate(f);
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: 'pick' }, { date: TODAY });
    expect(draft(f).step).toBe('confirm');
    expect(draft(f).units[0].choices.dateDue).toBe(TODAY);
    expect(last(f)).toEqual(summaryCard(draft(f)));
  });

  it('pick a later date → accepted as given', async () => {
    const f = setup();
    await toDate(f);
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: 'pick' }, { date: '2026-11-20' });
    expect(draft(f).units[0].choices.dateDue).toBe('2026-11-20');
  });

  it('"today" is the Bangkok day: 20:00 UTC on the 14th = the 15th in Bangkok → the 14th is past; +1 = the 16th', async () => {
    const f = setup([Q1], {}, {}, '2026-11-14T20:00:00.000Z');
    await toDate(f);
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: 'pick' }, { date: '2026-11-14' });
    expect(last(f)).toBe(TEXT.badDate);
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: '+1' });
    expect(draft(f).units[0].choices.dateDue).toBe('2026-11-16');
  });

  it.each([
    ['+1', '2026-11-15'],
    ['+2', '2026-11-16'],
    ['+5', '2026-11-19'],
    ['+7', '2026-11-21'],
  ])('%s → %s', async (v, iso) => {
    const f = setup();
    await toDate(f);
    await tap(f, { a: 'date', draft: 'd1', u: 0, v });
    expect(draft(f).units[0].choices.dateDue).toBe(iso);
  });

  it('a forged date value the codec does not know → dropped by decode (silent)', async () => {
    const f = setup();
    await toDate(f);
    const before = state(f);
    await tap(f, 'po1|date|d1|0|+30');
    await tap(f, 'po1|date|d1|0|2026-11-20');
    expect(state(f)).toBe(before);
  });
});

describe('handlePeakOrderPostback — merged', () => {
  it('3 lines merged: no unit step; body qty ""; notes hold all three blocks; all three keys linked to one order', async () => {
    const f = setup();
    await start(f, Q3.code);
    expect(draft(f).step).toBe('mode');
    await tap(f, { a: 'mode', draft: 'd1', v: 'merged' });
    const d = draft(f);
    expect(d).toMatchObject({ mode: 'merged', step: 'graphic', unitIdx: 0 });
    expect(d.units).toEqual(planUnits(Q3, 'merged').map((u) => ({ ...u, choices: {} })));
    expect(last(f)).toEqual(graphicCard(d, false));

    // The unit step does not exist here.
    const before = state(f);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    expect(state(f)).toBe(before);

    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'pook' });
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'sm74' });
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: '+1' });
    await tap(f, okCreate());
    expect(f.created).toHaveLength(1);
    const body = f.created[0];
    expect(body.qty).toBe('');
    expect(body.qtyUnit).toBe('แผ่น'); // form default (Peak has no unit; merged skips the step)
    for (let i = 0; i < 3; i++) expect(body.notes).toContain(`รายการ ${i + 1} (จำนวน `);
    expect(body.notes).toContain(`อ้างอิง Peak: ${Q3.code}`);
    expect(body.name).toBe(`${firstLine(Q3.lines[0].description)} (+2 รายการ)`);
    expect(body.peak).toEqual({ code: Q3.code, lineKeys: ['L1', 'L2', 'L3'], draftId: 'd1' });
    expect(f.db.links.map((l) => [l.lineKey, l.orderId]).sort()).toEqual([
      ['L1', 9000],
      ['L2', 9000],
      ['L3', 9000],
    ]);
    expect(draft(f).step).toBe('done');
  });

  it('mode tapped twice / mode on a draft past the mode step → silent', async () => {
    const f = setup();
    await start(f, Q3.code);
    await tap(f, { a: 'mode', draft: 'd1', v: 'split' });
    const before = state(f);
    await tap(f, { a: 'mode', draft: 'd1', v: 'merged' });
    await tap(f, { a: 'mode', draft: 'd1', v: 'split' });
    expect(state(f)).toBe(before);
    expect(draft(f).mode).toBe('split');
  });

  it('mode on a single-line draft (step unit) → silent', async () => {
    const f = setup();
    await start(f, Q1.code);
    const before = state(f);
    await tap(f, { a: 'mode', draft: 'd1', v: 'merged' });
    expect(state(f)).toBe(before);
  });
});

describe('handlePeakOrderPostback — split', () => {
  it('unit 0 create → [createdCard, unitCard(1)]; unit 1 skip → unit 2; gfx same copies graphic/press/date not the unit; done; links for lines 0 and 2 only', async () => {
    const f = setup();
    await start(f, Q3.code);
    await tap(f, { a: 'mode', draft: 'd1', v: 'split' });
    let d = draft(f);
    expect(d).toMatchObject({ mode: 'split', step: 'unit', unitIdx: 0 });
    expect(d.units).toEqual(planUnits(Q3, 'split').map((u) => ({ ...u, choices: {} })));
    expect(last(f)).toEqual(unitCard(d));

    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    expect(last(f)).toEqual(graphicCard(draft(f), false));
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'perl' });
    await tap(f, { a: 'press', draft: 'd1', u: 0, v: 'mo' });
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: '+2' });
    await tap(f, okCreate('d1', 0));
    d = draft(f);
    expect(d).toMatchObject({ step: 'unit', unitIdx: 1 });
    expect(f.created).toHaveLength(1);
    expect(f.created[0].peak).toEqual({ code: Q3.code, lineKeys: ['L1'], draftId: 'd1' });
    expect(last(f)).toEqual([createdCard({ orderId: 9000, name: d.units[0].name, pin: '4821', isDraft: false }), unitCard(d)]);

    await tap(f, { a: 'unit', draft: 'd1', u: 1, v: 'skip' });
    d = draft(f);
    expect(d).toMatchObject({ step: 'unit', unitIdx: 2 });
    expect(d.units[1].result).toEqual({ kind: 'skipped' });
    expect(last(f)).toEqual(unitCard(d));

    await tap(f, { a: 'unit', draft: 'd1', u: 2, v: 1 });
    expect(last(f)).toEqual(graphicCard(draft(f), true));
    await tap(f, { a: 'gfx', draft: 'd1', u: 2, v: 'same' });
    d = draft(f);
    expect(d).toMatchObject({ step: 'confirm', unitIdx: 2 });
    expect(d.units[2].choices).toEqual({ qtyUnit: 'ชุด', graphic: 'perl', press: 'mo', dateDue: '2026-11-16' });
    expect(last(f)).toEqual(summaryCard(d));

    await tap(f, { a: 'ok', draft: 'd1', u: 2, v: 'draft' });
    d = draft(f);
    expect(d.step).toBe('done');
    expect(f.created).toHaveLength(2);
    expect(f.created[1]).toMatchObject({ status: 'draft', qtyUnit: 'ชุด', assignStaff: 'perl', forwardPrint: 'mo', dateDue: '2026-11-16' });
    expect(last(f)).toEqual(createdCard({ orderId: 9001, name: d.units[2].name, pin: '4821', isDraft: true }));
    expect(d.units.map((u) => u.result?.kind)).toEqual(['order', 'skipped', 'draft']);
    expect(f.db.links.map((l) => [l.lineKey, l.orderId]).sort()).toEqual([
      ['L1', 9000],
      ['L3', 9001],
    ]);

    // Stopped part-way: a later /order shows the remaining line + [เปิดรายการที่เหลือ]; rest opens only L2.
    await start(f, Q3.code);
    expect(last(f)).toEqual(
      statusCard({
        qoCode: Q3.code,
        customerName: CUSTOMER,
        opened: [
          { orderId: 9000, name: d.units[0].name, isDraft: false },
          { orderId: 9001, name: d.units[2].name, isDraft: true },
        ],
        remaining: [{ name: firstLine(Q3.lines[1].description) }],
      }),
    );
    await tap(f, { a: 'rest', code: Q3.code });
    const d2 = draft(f, 'd2');
    expect(d2).toMatchObject({ mode: 'split', step: 'unit', unitIdx: 0 });
    expect(d2.units.map((u) => u.lineKeys)).toEqual([['L2']]);
  });

  it('skipping the last unit → done + the quotation status card', async () => {
    const f = setup();
    await start(f, Q3.code);
    await tap(f, { a: 'mode', draft: 'd1', v: 'split' });
    for (const u of [0, 1, 2]) await tap(f, { a: 'unit', draft: 'd1', u, v: 'skip' });
    expect(draft(f).step).toBe('done');
    expect(f.created).toEqual([]);
    expect(f.db.links).toEqual([]);
    expect(last(f)).toEqual(
      statusCard({ qoCode: Q3.code, customerName: CUSTOMER, opened: [], remaining: Q3.lines.map((l) => ({ name: firstLine(l.description) })) }),
    );
  });

  it('gfx same is offered/accepted only with an earlier created unit; a copied due date already in the past → date step', async () => {
    const f = setup([Q3], {}, {}, '2026-11-14T16:30:00.000Z'); // 23:30 Bangkok, still the 14th
    await start(f, Q3.code);
    await tap(f, { a: 'mode', draft: 'd1', v: 'split' });
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 'skip' });
    await tap(f, { a: 'unit', draft: 'd1', u: 1, v: 0 });
    expect(last(f)).toEqual(graphicCard(draft(f), false)); // unit 0 skipped → nothing to copy
    const before = state(f);
    await tap(f, { a: 'gfx', draft: 'd1', u: 1, v: 'same' });
    expect(state(f)).toBe(before);

    await tap(f, { a: 'gfx', draft: 'd1', u: 1, v: 'aed' });
    await tap(f, { a: 'press', draft: 'd1', u: 1, v: 'hamada' });
    await tap(f, { a: 'date', draft: 'd1', u: 1, v: 'pick' }, { date: TODAY });
    await tap(f, okCreate('d1', 1));
    expect(draft(f).unitIdx).toBe(2);
    // Cross midnight (Bangkok) while staying within the 30-min TTL between taps.
    f.clock.ms = Date.parse('2026-11-14T16:50:00.000Z'); // 23:50 Bangkok
    await tap(f, { a: 'unit', draft: 'd1', u: 2, v: 2 }); // keeps the draft fresh
    f.clock.ms = Date.parse('2026-11-14T17:10:00.000Z'); // 00:10 Bangkok, 15th
    await tap(f, { a: 'gfx', draft: 'd1', u: 2, v: 'same' });
    const d = draft(f);
    expect(d.step).toBe('date');
    expect(d.units[2].choices).toEqual({ qtyUnit: 'เล่ม', graphic: 'aed', press: 'hamada' });
    expect(last(f)).toEqual(dateCard(d, '2026-11-15'));
  });

  it('unit skip on a non-split draft → silent', async () => {
    const f = setup();
    await start(f, Q1.code);
    const before = state(f);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 'skip' });
    expect(state(f)).toBe(before);
  });
});

// ─── stale / forged / foreign taps ──────────────────────────────────

describe('handlePeakOrderPostback — refused taps', () => {
  it('another user → TEXT.notOwner(กิ๊ฟ), no transition; another group / no group → silent', async () => {
    const f = setup();
    await start(f, Q1.code);
    const before = draft(f);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 }, { user: 'U-nook' });
    expect(last(f)).toBe(TEXT.notOwner('กิ๊ฟ'));
    expect(draft(f)).toEqual(before);
    const n = f.replies.length;
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 }, { group: 'G-other' });
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 }, { group: null });
    await tap(f, { a: 'x', draft: 'd1' }, { group: 'G-other' });
    expect(f.replies).toHaveLength(n);
    expect(draft(f)).toEqual(before);
  });

  it('unknown draft id → silent', async () => {
    const f = setup();
    await tap(f, { a: 'unit', draft: 'nope', u: 0, v: 0 });
    await tap(f, { a: 'x', draft: 'nope' });
    expect(f.replies).toEqual([]);
  });

  it('tap on an earlier step’s card / wrong unit index / out-of-range unit → silent, no transition', async () => {
    const f = setup();
    await start(f, Q1.code);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'pook' });
    const before = state(f);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 3 }); // earlier step
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'perl' }); // earlier step
    await tap(f, { a: 'press', draft: 'd1', u: 1, v: 'sm74' }); // wrong unit
    await tap(f, { a: 'date', draft: 'd1', u: 0, v: '+1' }); // later step
    await tap(f, okCreate()); // later step
    await tap(f, { a: 'dup', draft: 'd1', u: 0, v: 'force' }); // not at dup
    expect(state(f)).toBe(before);
    expect(draft(f).step).toBe('press');
  });

  it('unit index ≥ QTY_UNITS.length → silent', async () => {
    const f = setup();
    await start(f, Q1.code);
    const before = state(f);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 9 });
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 999 });
    expect(state(f)).toBe(before);
  });

  it('dup force at confirm → silent (no create)', async () => {
    const f = setup();
    await start(f, Q1.code);
    await toConfirm(f);
    const before = state(f);
    await tap(f, { a: 'dup', draft: 'd1', u: 0, v: 'force' });
    expect(state(f)).toBe(before);
  });

  it('expired (31 min) → TEXT.expired, no transition; 30 min exactly still works', async () => {
    const f = setup();
    await start(f, Q1.code);
    f.clock.advance(30 * 60_000);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    expect(draft(f).step).toBe('graphic');
    f.clock.advance(31 * 60_000);
    const before = draft(f);
    await tap(f, { a: 'gfx', draft: 'd1', u: 0, v: 'pook' });
    expect(last(f)).toBe(TEXT.expired);
    expect(draft(f)).toEqual(before);
    await tap(f, { a: 'x', draft: 'd1' });
    expect(last(f)).toBe(TEXT.expired);
    expect(draft(f)).toEqual(before);
  });

  it('x → cancelled + TEXT.cancelled; later taps (incl. x) silent', async () => {
    const f = setup();
    await start(f, Q1.code);
    await tap(f, { a: 'x', draft: 'd1' });
    expect(draft(f).step).toBe('cancelled');
    expect(last(f)).toBe(TEXT.cancelled);
    const n = f.replies.length;
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 });
    await tap(f, { a: 'x', draft: 'd1' });
    expect(f.replies).toHaveLength(n);
    expect(draft(f).step).toBe('cancelled');
  });

  it('taps on a done draft → silent', async () => {
    const f = setup();
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, okCreate());
    const before = state(f);
    await tap(f, okCreate());
    await tap(f, { a: 'x', draft: 'd1' });
    expect(state(f)).toBe(before);
  });

  it('malformed postback data → silent; no userId → TEXT.noUser', async () => {
    const f = setup();
    await start(f, Q1.code);
    const before = state(f);
    for (const data of ['', 'po1|', 'po1|unit|d1|0', 'po1|unit|d1|00|1', 'po2|unit|d1|0|1', 'po1|ok|d1|0|yes', 'po1|who|x|', 'hello']) {
      await tap(f, data);
    }
    expect(state(f)).toBe(before);
    await tap(f, { a: 'unit', draft: 'd1', u: 0, v: 0 }, { user: '' });
    expect(last(f)).toBe(TEXT.noUser);
    expect(draft(f).step).toBe('unit');
  });
});

// ─── duplicate guard ────────────────────────────────────────────────

describe('handlePeakOrderPostback — never two orders', () => {
  it('double tap on ok (concurrent) → createOrder once, one reply, link finalized (mutation check 1)', async () => {
    const f = setup();
    await start(f, Q1.code);
    await toConfirm(f);
    const n = f.replies.length;
    await Promise.all([tap(f, okCreate()), tap(f, okCreate())]);
    expect(f.created).toHaveLength(1);
    expect(f.replies.slice(n)).toEqual([createdCard({ orderId: 9000, name: firstLine(Q1.lines[0].description), pin: '4821', isDraft: false })]);
    expect(f.db.links.map((l) => [l.lineKey, l.orderId])).toEqual([['L1', 9000]]);
    expect(draft(f).step).toBe('done');
  });

  it('ok create and ok draft tapped together → one order', async () => {
    const f = setup();
    await start(f, Q1.code);
    await toConfirm(f);
    await Promise.all([tap(f, okCreate()), tap(f, { a: 'ok', draft: 'd1', u: 0, v: 'draft' })]);
    expect(f.created).toHaveLength(1);
    expect(f.db.orders.size).toBe(1);
  });

  it('two drafts for the same quotation both reach ok → the second gets the status card (mutation check 2)', async () => {
    const f = setup();
    await start(f, Q1.code, 'U-gift');
    await start(f, Q1.code, 'U-nook');
    expect(f.db.drafts.size).toBe(2);
    await toConfirm(f, 'd1', { user: 'U-gift' });
    await toConfirm(f, 'd2', { user: 'U-nook' });
    await tap(f, okCreate('d1'), { user: 'U-gift' });
    await tap(f, okCreate('d2'), { user: 'U-nook' });
    expect(f.created).toHaveLength(1);
    const name = firstLine(Q1.lines[0].description);
    expect(last(f)).toEqual(statusCard({ qoCode: Q1.code, customerName: CUSTOMER, opened: [{ orderId: 9000, name, isDraft: false }], remaining: [] }));
    expect(draft(f, 'd2')).toMatchObject({ step: 'confirm', creatingKind: null });
    expect(draft(f, 'd2').units[0].result).toBeUndefined();
    expect(f.db.links.map((l) => [l.lineKey, l.orderId, l.draftId])).toEqual([['L1', 9000, 'd1']]);
  });

  it('two drafts racing: the second ok lands while the first createOrder is in flight → still one order', async () => {
    const gate = deferred();
    const f = setup();
    const inner = f.deps.createOrder;
    f.deps.createOrder = async (body, actor) => {
      if ((body.peak as { draftId?: string }).draftId === 'd1') await gate.p;
      return inner(body, actor);
    };
    await start(f, Q1.code, 'U-gift');
    await start(f, Q1.code, 'U-nook');
    await toConfirm(f, 'd1', { user: 'U-gift' });
    await toConfirm(f, 'd2', { user: 'U-nook' });
    const first = tap(f, okCreate('d1'), { user: 'U-gift' });
    await vi.waitFor(() => expect(f.db.links).toHaveLength(1)); // d1 holds the claim
    await tap(f, okCreate('d2'), { user: 'U-nook' });
    expect(last(f)).toEqual(statusCard({ qoCode: Q1.code, customerName: CUSTOMER, opened: [], remaining: [] }));
    gate.resolve();
    await first;
    expect(f.created).toHaveLength(1);
    expect(f.db.orders.size).toBe(1);
    expect(draft(f, 'd1').step).toBe('done');
    expect(draft(f, 'd2').step).toBe('confirm');
  });

  it('createOrder → duplicate: claim released, step dup, dupCard; dup force → created with force: true', async () => {
    const dupResult: CreateOrderResult = {
      ok: false,
      kind: 'duplicate',
      status: 409,
      duplicates: [{ id: 812, name: 'ไวนิลขนาด 1x2 เมตร', customer: CUSTOMER, dateIn: '2026-11-01', kind: 'active' }],
      message: 'dup',
    };
    const f = setup();
    const inner = f.deps.createOrder;
    f.deps.createOrder = async (body, actor) => (body.force ? inner(body, actor) : (f.created.push(structuredClone(body)), dupResult));
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, okCreate());
    let d = draft(f);
    expect(d).toMatchObject({ step: 'dup', creatingKind: null });
    expect(f.db.links).toEqual([]);
    expect(last(f)).toEqual(dupCard(d, [{ id: 812, name: 'ไวนิลขนาด 1x2 เมตร' }]));
    expect(f.db.orders.size).toBe(0);

    await tap(f, { a: 'dup', draft: 'd1', u: 0, v: 'force' });
    expect(f.created).toHaveLength(2);
    expect(f.created[1].force).toBe(true);
    expect(f.created[1].status).toBeUndefined();
    d = draft(f);
    expect(d.step).toBe('done');
    expect(f.db.links.map((l) => [l.lineKey, l.orderId])).toEqual([['L1', 9000]]);
    expect(last(f)).toEqual(createdCard({ orderId: 9000, name: d.units[0].name, pin: '4821', isDraft: false }));
  });

  it('ok after dup (dashboard draft from the dup card is not offered) → silent; x from dup cancels', async () => {
    const f = setup();
    f.deps.createOrder = async () => ({ ok: false, kind: 'duplicate', status: 409, duplicates: [], message: 'dup' });
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, okCreate());
    expect(draft(f).step).toBe('dup');
    const before = state(f);
    await tap(f, okCreate());
    expect(state(f)).toBe(before);
    await tap(f, { a: 'x', draft: 'd1' });
    expect(draft(f).step).toBe('cancelled');
  });

  it('createOrder throws → claim released, step confirm, TEXT.createFailed; ok again succeeds', async () => {
    const f = setup();
    const inner = f.deps.createOrder;
    let calls = 0;
    f.deps.createOrder = async (body, actor) => {
      if (calls++ === 0) throw new Error('db exploded with secrets');
      return inner(body, actor);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, okCreate());
    expect(last(f)).toBe(TEXT.createFailed);
    expect(draft(f)).toMatchObject({ step: 'confirm', creatingKind: null });
    expect(f.db.links).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secrets');
    await tap(f, okCreate());
    expect(calls).toBe(2);
    expect(f.db.orders.size).toBe(1);
    expect(draft(f).step).toBe('done');
    expect(f.db.links.map((l) => [l.lineKey, l.orderId])).toEqual([['L1', 9000]]);
    warn.mockRestore();
  });

  it.each([
    ['validation', { ok: false, kind: 'validation', status: 400, error: 'กรุณาเลือก มอบหมายกราฟฟิก' } as CreateOrderResult, `${TEXT.createFailed}\nกรุณาเลือก มอบหมายกราฟฟิก`],
    ['failure', { ok: false, kind: 'failure', status: 500, error: 'createOrder failed — boom' } as CreateOrderResult, TEXT.createFailed],
  ])('createOrder → %s: claim released, confirm, createFailed', async (_n, res, text) => {
    const f = setup();
    f.deps.createOrder = async () => res;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, okCreate());
    expect(last(f)).toBe(text);
    expect(draft(f).step).toBe('confirm');
    expect(f.db.links).toEqual([]);
    vi.restoreAllMocks();
  });

  it('releaseClaim throws on the failure path → logged, reply still goes out', async () => {
    const f = setup();
    f.deps.createOrder = async () => {
      throw new Error('x');
    };
    f.db.releaseClaim = async () => {
      throw new Error('release down');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start(f, Q1.code);
    await toConfirm(f);
    await expect(tap(f, okCreate())).resolves.toBeUndefined();
    expect(last(f)).toBe(TEXT.createFailed);
    expect(draft(f).step).toBe('confirm');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('release down');
    warn.mockRestore();
  });

  it('finalizeLinks throws once after a successful create → createFailed; ok again adopts the SAME order (mutation check 3)', async () => {
    const f = setup();
    const fin = f.db.finalizeLinks;
    let n = 0;
    f.db.finalizeLinks = async (...a) => {
      if (n++ === 0) throw new Error('finalize down');
      return fin(...a);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, okCreate());
    expect(last(f)).toBe(TEXT.createFailed);
    expect(draft(f).step).toBe('confirm');
    expect(f.db.orders.size).toBe(1);
    await tap(f, okCreate());
    expect(f.created).toHaveLength(1);
    expect(f.db.orders.size).toBe(1);
    const d = draft(f);
    expect(d.step).toBe('done');
    expect(d.units[0].result).toEqual({ kind: 'existing', orderId: 9000 });
    expect(f.db.links.map((l) => [l.lineKey, l.orderId])).toEqual([['L1', 9000]]);
    const [card, note] = last(f) as [Card, string];
    expect(last(f)).toHaveLength(2);
    expect(card).toEqual(createdCard({ orderId: 9000, name: d.units[0].name, pin: '', isDraft: false }));
    expect(note).toBe(TEXT.adopted);
    expect(card.text).not.toContain('PIN');
    expect(card.text.trim()).not.toBe('');
    vi.restoreAllMocks();
  });

  it('an orphan order carrying the marker (no link row) is adopted by a fresh draft, not created again (mutation check 3)', async () => {
    const f = setup([Q1], { orders: { 9100: { name: 'ไวนิลขนาด 1x2 เมตร', status: 'draft', peak: { code: Q1.code, lineKeys: ['L1'] } } } });
    await start(f, Q1.code);
    expect(draft(f).step).toBe('unit'); // no link row → free
    await toConfirm(f);
    await tap(f, okCreate());
    expect(f.created).toEqual([]);
    expect(draft(f).units[0].result).toEqual({ kind: 'existing', orderId: 9100 });
    expect(f.db.links.map((l) => [l.lineKey, l.orderId])).toEqual([['L1', 9100]]);
    expect(last(f)).toEqual([createdCard({ orderId: 9100, name: 'ไวนิลขนาด 1x2 เมตร', pin: '', isDraft: true }), TEXT.adopted]);
  });

  it('split draft with units left: an adopted unit replies [createdCard, TEXT.adopted, next unitCard]', async () => {
    const f = setup([Q3], { orders: { 9200: { name: 'ไวนิล 2x3 เมตร พับขอบ', status: 'pending', peak: { code: Q3.code, lineKeys: ['L1'] } } } });
    await start(f, Q3.code);
    await tap(f, { a: 'mode', draft: 'd1', v: 'split' });
    await toConfirm(f);
    await tap(f, okCreate());
    expect(f.created).toEqual([]);
    const d = draft(f);
    expect(d).toMatchObject({ step: 'unit', unitIdx: 1 });
    expect(d.units[0].result).toEqual({ kind: 'existing', orderId: 9200 });
    const r = last(f) as unknown[];
    expect(r).toEqual([createdCard({ orderId: 9200, name: d.units[0].name, pin: '', isDraft: false }), TEXT.adopted, unitCard(d)]);
    expect(r.length).toBeLessThanOrEqual(5);
  });

  it('linked order later cancelled → a new /order starts a fresh draft and claimLines takes the line over', async () => {
    const f = setup();
    await start(f, Q1.code);
    await toConfirm(f);
    await tap(f, okCreate());
    f.db.orders.get(9000)!.status = 'cancelled';
    await start(f, Q1.code);
    expect(draft(f, 'd2')).toMatchObject({ step: 'unit', mode: 'single' });
    await toConfirm(f, 'd2');
    const claim = vi.spyOn(f.db, 'claimLines');
    await tap(f, okCreate('d2'));
    expect(await claim.mock.results[0].value).toBe(true);
    expect(f.created).toHaveLength(2);
    expect(f.db.links.map((l) => [l.lineKey, l.orderId, l.draftId])).toEqual([['L1', 9001, 'd2']]);
    expect(draft(f, 'd2').step).toBe('done');
  });
});

describe('handlePeakOrderPostback — crash recovery', () => {
  async function stuck(f: F, withOrder: boolean) {
    await start(f, Q1.code);
    await toConfirm(f);
    // An attempt won the gate + claim and died (before / after createOrder).
    await f.db.advanceDraft('d1', { unitIdx: 0, step: 'confirm' }, { unitIdx: 0, step: 'creating', creatingKind: 'create' });
    expect(await f.db.claimLines(Q1.code, ['L1'], 'd1', 'กิ๊ฟ')).toBe(true);
    if (withOrder) f.db.orders.set(9050, { name: 'ไวนิลขนาด 1x2 เมตร', status: 'pending', peak: { code: Q1.code, lineKeys: ['L1'] } });
  }

  it('stuck at creating 3 min with the order created → ok finalizes with that order, createOrder not called', async () => {
    const f = setup();
    await stuck(f, true);
    f.clock.advance(3 * 60_000);
    await tap(f, okCreate());
    expect(f.created).toEqual([]);
    const d = draft(f);
    expect(d.step).toBe('done');
    expect(d.units[0].result).toEqual({ kind: 'existing', orderId: 9050 });
    expect(f.db.links.map((l) => [l.lineKey, l.orderId])).toEqual([['L1', 9050]]);
    expect(last(f)).toEqual([createdCard({ orderId: 9050, name: d.units[0].name, pin: '', isDraft: false }), TEXT.adopted]);
  });

  it('stuck at creating 3 min, no order → claim released, back to confirm + summaryCard; then ok creates once', async () => {
    const f = setup();
    await stuck(f, false);
    f.clock.advance(3 * 60_000);
    await tap(f, okCreate());
    expect(f.created).toEqual([]);
    expect(draft(f)).toMatchObject({ step: 'confirm', creatingKind: null });
    expect(f.db.links).toEqual([]);
    expect(last(f)).toEqual(summaryCard(draft(f)));
    await tap(f, okCreate());
    expect(f.created).toHaveLength(1);
    expect(draft(f).step).toBe('done');
  });

  it('a dup tap also triggers recovery', async () => {
    const f = setup();
    await stuck(f, true);
    f.clock.advance(CLAIM_TTL_MS + 1);
    await tap(f, { a: 'dup', draft: 'd1', u: 0, v: 'force' });
    expect(draft(f).step).toBe('done');
    expect(f.created).toEqual([]);
  });

  it('creating tapped at 119 s → silent, state unchanged; at 121 s → recovers', async () => {
    const f = setup();
    await stuck(f, true);
    f.clock.advance(119_000);
    const before = state(f);
    await tap(f, okCreate());
    expect(state(f)).toBe(before);
    expect(draft(f).step).toBe('creating');
    f.clock.advance(2_000);
    await tap(f, okCreate());
    expect(f.created).toEqual([]);
    expect(draft(f)).toMatchObject({ step: 'done', units: [expect.objectContaining({ result: { kind: 'existing', orderId: 9050 } })] });
  });

  it('creating younger than 2 min → silent; x on creating → silent; wrong u → silent', async () => {
    const f = setup();
    await stuck(f, true);
    f.clock.advance(60_000);
    const before = state(f);
    await tap(f, okCreate());
    await tap(f, { a: 'x', draft: 'd1' });
    f.clock.advance(2 * 60_000);
    await tap(f, okCreate('d1', 1));
    expect(state(f)).toBe(before);
  });
});

// ─── who / pick / rest ──────────────────────────────────────────────

describe('handlePeakOrderPostback — who', () => {
  it('who → mapping saved with the display name, then the original args are resolved', async () => {
    const f = setup([Q1], { staff: {} });
    await tap(f, { a: 'who', orderer: 1, args: Q1.code }, { user: 'U-new' });
    expect(f.db.staff.get('U-new')).toMatchObject({ orderer: 'กิ๊ฟ', displayName: 'LINE Display' });
    expect(draft(f)).toMatchObject({ orderer: 'กิ๊ฟ', lineUserId: 'U-new', step: 'unit', qoCode: Q1.code });
    expect(last(f)).toEqual(unitCard(draft(f)));
  });

  it('who with empty args → the latest-quotations list (bare /order)', async () => {
    const f = setup([Q1], { staff: {} });
    await tap(f, { a: 'who', orderer: 0, args: '' }, { user: 'U-new' });
    expect(f.db.staff.get('U-new')?.orderer).toBe('นุ๊ก');
    expect(f.peak.calls[0].m).toBe('newestQuotations');
  });

  it('who -1 → TEXT.whoDeclined, nothing saved', async () => {
    const f = setup([Q1], { staff: {} });
    await tap(f, { a: 'who', orderer: -1, args: Q1.code }, { user: 'U-new' });
    expect(f.replies).toEqual([TEXT.whoDeclined]);
    expect(f.db.staff.size).toBe(0);
    expect(f.peak.calls).toEqual([]);
  });

  it('who from an already-mapped user → silent: mapping not overwritten, command not re-run (R3)', async () => {
    const f = setup([Q1]);
    const setStaff = vi.spyOn(f.db, 'setStaff');
    await tap(f, { a: 'who', orderer: 0, args: Q1.code }, { user: 'U-gift' });
    await tap(f, { a: 'who', orderer: -1, args: Q1.code }, { user: 'U-gift' });
    expect(setStaff).not.toHaveBeenCalled();
    expect(f.db.staff.get('U-gift')?.orderer).toBe('กิ๊ฟ');
    expect(f.replies).toEqual([]);
    expect(f.peak.calls).toEqual([]);
    expect(f.db.drafts.size).toBe(0);
  });

  it('getDisplayName throws → registered with display name null, flow continues (R4)', async () => {
    const f = setup([Q1], { staff: {} }, { getDisplayName: async () => Promise.reject(new Error('profile api down')) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await tap(f, { a: 'who', orderer: 2, args: Q1.code }, { user: 'U-new' });
    expect(f.db.staff.get('U-new')).toMatchObject({ orderer: 'เจี๊ยบ', displayName: null });
    expect(draft(f).orderer).toBe('เจี๊ยบ');
    vi.restoreAllMocks();
  });

  it('out-of-range orderer index → silent', async () => {
    const f = setup([Q1], { staff: {} });
    await tap(f, { a: 'who', orderer: 3, args: '' }, { user: 'U-new' });
    await tap(f, 'po1|who|999|', { user: 'U-new' });
    expect(f.replies).toEqual([]);
    expect(f.db.staff.size).toBe(0);
  });
});

describe('handlePeakOrderPostback — pick / rest', () => {
  it('pick → draft started for that quotation with the contact name', async () => {
    const f = setup();
    await tap(f, { a: 'pick', code: Q3.code });
    expect(draft(f)).toMatchObject({ qoCode: Q3.code, step: 'mode', orderer: 'กิ๊ฟ', snapshot: { customerName: CUSTOMER } });
  });

  it('pick: contact name unknown → contactCode', async () => {
    const q = quot('QO-202611000050', [{ key: 'L1', description: 'x', quantity: 1 }], { contactCode: 'C999' });
    const f = setup([q]);
    await tap(f, { a: 'pick', code: q.code });
    expect(draft(f).snapshot.customerName).toBe('C999');
  });

  it('pick an opened quotation → status card, no draft', async () => {
    const f = setup([Q1], { orders: { 7001: { name: 'ไวนิล', status: 'pending' } } });
    f.db.links.push({ qoCode: Q1.code, lineKey: 'L1', orderId: 7001, draftId: 'old', claimedAtMs: 0 });
    await tap(f, { a: 'pick', code: Q1.code });
    expect(last(f)).toEqual(statusCard({ qoCode: Q1.code, customerName: CUSTOMER, opened: [{ orderId: 7001, name: 'ไวนิล', isDraft: false }], remaining: [] }));
    expect(f.db.drafts.size).toBe(0);
  });

  it('rest on a partly opened quotation → split draft over the free lines only', async () => {
    const f = setup([Q3], { orders: { 7010: { name: 'ค่าจัดส่ง', status: 'pending' } } });
    f.db.links.push({ qoCode: Q3.code, lineKey: 'L2', orderId: 7010, draftId: 'old', claimedAtMs: 0 });
    await tap(f, { a: 'rest', code: Q3.code });
    const d = draft(f);
    expect(d).toMatchObject({ mode: 'split', step: 'unit' });
    expect(d.units.map((u) => u.lineKeys)).toEqual([['L1'], ['L3']]);
    expect(last(f)).toEqual(unitCard(d));
  });

  it('status card for a vanished (re-keyed) line → rest → split draft over every current line → an order is created; the gone key row is untouched', async () => {
    const f = setup([Q3], { orders: { 7020: { name: 'เก่า', status: 'pending' } } });
    const gone = { qoCode: Q3.code, lineKey: 'OLD-KEY', orderId: 7020, draftId: 'old', claimedAtMs: 0 };
    f.db.links.push(structuredClone(gone));
    await start(f, Q3.code);
    expect(f.db.drafts.size).toBe(0);
    expect(last(f)).toEqual(
      statusCard({
        qoCode: Q3.code,
        customerName: CUSTOMER,
        opened: [{ orderId: 7020, name: 'เก่า', isDraft: false }],
        remaining: Q3.lines.map((l) => ({ name: firstLine(l.description) })),
      }),
    );
    await tap(f, { a: 'rest', code: Q3.code });
    const d = draft(f);
    expect(d).toMatchObject({ mode: 'split', step: 'unit', unitIdx: 0 });
    expect(d.units.map((u) => u.lineKeys)).toEqual([['L1'], ['L2'], ['L3']]);
    await toConfirm(f);
    await tap(f, okCreate());
    expect(f.created).toHaveLength(1);
    const orderId = Math.max(...f.db.orders.keys());
    expect(f.db.links.find((l) => l.lineKey === 'L1')).toMatchObject({ orderId, draftId: 'd1' });
    expect(f.db.links.find((l) => l.lineKey === 'OLD-KEY')).toEqual(gone);
    expect(draft(f)).toMatchObject({ step: 'unit', unitIdx: 1 });
  });

  it('pick an unknown code → not-found text, no draft', async () => {
    const f = setup();
    await tap(f, { a: 'pick', code: 'QO-000000000000' });
    expect(last(f)).toBe(`ไม่พบใบเสนอราคา QO-000000000000\n${NOT_FOUND_EXAMPLE}`);
    expect(f.db.drafts.size).toBe(0);
  });

  it('pick a 200-character code (postback data max 300) → not-found text with the code clipped to 80 characters', async () => {
    const f = setup();
    const code = 'QO-' + '7'.repeat(197);
    await tap(f, { a: 'pick', code });
    const r = last(f) as string;
    expect(r).not.toContain(code);
    expect(r.split('\n')[0]).toBe(`ไม่พบใบเสนอราคา ${code.slice(0, 79)}…`);
    expect(r.endsWith(NOT_FOUND_EXAMPLE)).toBe(true);
  });

  it('pick from an unmapped user → whoCard(""), no Peak call', async () => {
    const f = setup([Q1], { staff: {} });
    await tap(f, { a: 'pick', code: Q1.code }, { user: 'U-new' });
    expect(f.replies).toEqual([whoCard('')]);
    expect(f.peak.calls).toEqual([]);
  });

  it.each([
    ['PeakNotConnectedError', new PeakNotConnectedError('x'), TEXT.peakNotConnected],
    ['PeakAuthError', new PeakAuthError('x'), TEXT.peakNotConnected],
    ['PeakUnavailableError', new PeakUnavailableError('x'), TEXT.peakUnavailable],
  ])('pick: %s → short text, no draft (R5)', async (_n, err, text) => {
    const f = setup();
    f.deps.peak = { ...f.peak, getQuotation: async () => Promise.reject(err) };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await tap(f, { a: 'rest', code: Q1.code });
    expect(f.replies).toEqual([text]);
    expect(f.db.drafts.size).toBe(0);
    vi.restoreAllMocks();
  });

  it('pick: an unknown error is not swallowed', async () => {
    const f = setup();
    f.deps.peak = { ...f.peak, getContactName: async () => Promise.reject(new TypeError('boom')) };
    await expect(tap(f, { a: 'pick', code: Q1.code })).rejects.toThrow('boom');
  });
});

describe('a job cancelled on the board frees the quotation line (dashboard definition of cancelled)', () => {
  it('order pending + a cancelled row → /order starts a fresh draft, the claim takes the line over, the cancelled order is not adopted, exactly one new order', async () => {
    const f = setup([Q1], {
      orders: { 7030: { name: 'ไวนิลขนาด 1x2 เมตร', status: 'pending', jobCancelled: true, peak: { code: Q1.code, lineKeys: ['L1'] } } },
      links: [{ qoCode: Q1.code, lineKey: 'L1', orderId: 7030, draftId: 'old', claimedAtMs: 0 }],
    });
    const marker = vi.spyOn(f.db, 'findOrderByPeakMarker');
    await start(f, Q1.code);
    expect(draft(f)).toMatchObject({ mode: 'single', step: 'unit' });
    await toConfirm(f);
    await tap(f, okCreate());
    expect(marker).toHaveBeenCalledTimes(1);
    await expect(marker.mock.results[0].value).resolves.toBeNull();
    expect(f.created).toHaveLength(1);
    const newId = Math.max(...f.db.orders.keys());
    expect(newId).not.toBe(7030);
    expect(f.db.links).toEqual([expect.objectContaining({ qoCode: Q1.code, lineKey: 'L1', orderId: newId, draftId: 'd1' })]);
    expect(draft(f).step).toBe('done');
    expect(last(f)).toEqual(createdCard({ orderId: newId, name: draft(f).units[0].name, pin: '4821', isDraft: false }));
  });
});

describe('fakeDeps default createOrder', () => {
  it('order ids follow the current orders map (orders added after setup count)', async () => {
    const f = setup();
    f.db.orders.set(9500, { name: 'x', status: 'pending' });
    const r = await f.deps.createOrder({ name: 'a' } as CreateOrderBody, { role: 'sales', user: 'x' } as OrderActor);
    expect(r.ok && r.orderId).toBe(9501);
  });

  it('sanity: addDaysISO used for +N is the mapper’s', () => {
    expect(addDaysISO(TODAY, 3)).toBe('2026-11-17');
  });
});
