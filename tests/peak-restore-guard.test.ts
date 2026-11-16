import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Restore guard (fix-wave residual 1, 2026-11-16).
 *
 * A job cancelled from the board frees its Peak quotation line (the order has
 * a `cancelled` row), so `/order` may open the same line as a NEW work order.
 * Restoring the old job afterwards deletes that `cancelled` row and would
 * bring the old order back to life next to the new one — two live work orders
 * on one Peak line. The guard makes the restore take the line back through
 * the SAME claim the `/order` flow uses, so exactly one of them can win.
 *
 * These tests run the real guard on the in-memory fake that reproduces
 * lib/peak-order/db.ts's link semantics.
 */

const sqlMock = vi.fn();
vi.mock('@/lib/postgres', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));

import { fakeDb, CLAIM_TTL_MS, type FakeDb, type FakeDbSeed } from './helpers/peak-order-fakes';
import {
  PeakLineTakenError,
  claimPeakLinesForRestore,
  peakLineTakenMessage,
  readPeakMarker,
  settlePeakRestore,
  type RestoreGuardDeps,
} from '@/lib/peak-order/restore-guard';

const QO = 'QO-20261100012';
const OLD = 501; // the order whose job is being restored
const NEW = 502; // the order /order opened after the cancel
const JOB = 9001;

let nowMs = 1_800_000_000_000;

function setup(seed: FakeDbSeed): { db: FakeDb; deps: RestoreGuardDeps } {
  const db = fakeDb({ ...seed, nowMs: () => nowMs });
  const deps: RestoreGuardDeps = {
    db,
    readMarker: async (orderId) => {
      const peak = db.orders.get(orderId)?.peak;
      return peak ? { code: peak.code, lineKeys: [...peak.lineKeys] } : null;
    },
  };
  return { db, deps };
}

/** OLD's job was cancelled from the board: status stays 'sent', a `cancelled` row exists. */
const oldOrder = (lineKeys = ['L1']) => ({
  name: 'ไวนิล 1x2 เมตร',
  status: 'sent',
  peak: { code: QO, lineKeys },
  jobCancelled: true,
});
const link = (lineKey: string, orderId: number | null, draftId: string, claimedAtMs = nowMs) => ({
  qoCode: QO,
  lineKey,
  orderId,
  draftId,
  claimedAtMs,
});
const restoreRows = (db: FakeDb) => db.links.filter((l) => l.draftId.startsWith('restore:'));

async function expectTaken(p: Promise<unknown>): Promise<PeakLineTakenError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PeakLineTakenError);
  return err as PeakLineTakenError;
}

beforeEach(() => {
  nowMs = 1_800_000_000_000;
});

describe('claimPeakLinesForRestore', () => {
  it('an order that did not come from a Peak quotation needs no claim', async () => {
    const { db, deps } = setup({ orders: { [OLD]: { name: 'งานทั่วไป', status: 'sent', jobCancelled: true } } });

    expect(await claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps)).toBeNull();
    expect(db.links).toEqual([]);
  });

  it('takes its own line back, and after the restore the line belongs to the order again', async () => {
    const { db, deps } = setup({ orders: { [OLD]: oldOrder() }, links: [link('L1', OLD, 'dOld')] });

    const claim = await claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps);
    expect(claim).toEqual({ qoCode: QO, claimId: `restore:${JOB}`, orderId: OLD });

    db.orders.get(OLD)!.jobCancelled = false; // restoreJobInPostgres deleted the cancelled row
    await settlePeakRestore(claim!, true, deps);

    expect(db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: OLD })]);
    expect(await db.claimLines(QO, ['L1'], 'dNew', 'กิ๊ฟ')).toBe(false); // /order can no longer open it
  });

  it('holds the line while the restore is in flight — an /order claim in that window loses', async () => {
    const { db, deps } = setup({ orders: { [OLD]: oldOrder() }, links: [link('L1', OLD, 'dOld')] });

    await claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps);

    // OLD is still dead here (its cancelled row is not deleted yet).
    expect(await db.claimLines(QO, ['L1'], 'dNew', 'กิ๊ฟ')).toBe(false);
  });

  it('refuses when the line was reopened as another live work order', async () => {
    const { db, deps } = setup({
      orders: { [OLD]: oldOrder(), [NEW]: { name: 'ไวนิล (ใบใหม่)', status: 'sent', peak: { code: QO, lineKeys: ['L1'] } } },
      links: [link('L1', NEW, 'dNew')],
    });

    const err = await expectTaken(claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps));

    expect(err.qoCode).toBe(QO);
    expect(err.otherOrderId).toBe(NEW);
    expect(db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: NEW, draftId: 'dNew' })]);
  });

  it('refuses while someone else holds a fresh /order claim on the line', async () => {
    const { db, deps } = setup({ orders: { [OLD]: oldOrder() }, links: [link('L1', null, 'dNew')] });

    const err = await expectTaken(claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps));

    expect(err.otherOrderId).toBeNull();
    expect(db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: null, draftId: 'dNew' })]);
  });

  it('takes over a claim that went stale (older than 2 minutes)', async () => {
    const { db, deps } = setup({
      orders: { [OLD]: oldOrder() },
      links: [link('L1', null, 'dNew', nowMs - CLAIM_TTL_MS - 1)],
    });

    expect(await claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps)).not.toBeNull();
    expect(restoreRows(db)).toHaveLength(1);
  });

  it('refuses when a live order carries the same line in its marker although its link row is gone', async () => {
    // /order created NEW but died before finalizing the link (the claim has since lapsed and been removed).
    const { db, deps } = setup({
      orders: { [OLD]: oldOrder(), [NEW]: { name: 'ไวนิล (ใบใหม่)', status: 'sent', peak: { code: QO, lineKeys: ['L1'] } } },
      links: [],
    });

    const err = await expectTaken(claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps));

    expect(err.otherOrderId).toBe(NEW);
    expect(restoreRows(db)).toEqual([]); // the restore's own claim is released
  });

  it('merged order: one reopened line blocks the restore and the other line is not left claimed', async () => {
    const { db, deps } = setup({
      orders: {
        [OLD]: oldOrder(['L1', 'L2']),
        [NEW]: { name: 'รายการแรก (ใบใหม่)', status: 'sent', peak: { code: QO, lineKeys: ['L1'] } },
      },
      links: [link('L1', NEW, 'dNew'), link('L2', OLD, 'dOld')],
    });

    const err = await expectTaken(claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps));

    expect(err.otherOrderId).toBe(NEW);
    expect(restoreRows(db)).toEqual([]);
    expect(await db.claimLines(QO, ['L2'], 'dOther', 'กิ๊ฟ')).toBe(true); // still open for /order
  });

  it('allows the restore when the reopened order was itself cancelled', async () => {
    const { db, deps } = setup({
      orders: { [OLD]: oldOrder(), [NEW]: { name: 'ไวนิล (ใบใหม่)', status: 'cancelled', peak: { code: QO, lineKeys: ['L1'] } } },
      links: [link('L1', NEW, 'dNew')],
    });

    const claim = await claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps);
    db.orders.get(OLD)!.jobCancelled = false;
    await settlePeakRestore(claim!, true, deps);

    expect(db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: OLD })]);
  });
});

describe('settlePeakRestore', () => {
  it('a failed restore gives the line back', async () => {
    const { db, deps } = setup({ orders: { [OLD]: oldOrder() }, links: [link('L1', OLD, 'dOld')] });
    const claim = await claimPeakLinesForRestore(OLD, JOB, 'นุ๊ก', deps);

    await settlePeakRestore(claim!, false, deps);

    expect(restoreRows(db)).toEqual([]);
    expect(await db.claimLines(QO, ['L1'], 'dNew', 'กิ๊ฟ')).toBe(true); // OLD is still cancelled → line is free
  });
});

describe('peakLineTakenMessage', () => {
  it('names the quotation and the order that now owns the line, and says what to do', () => {
    const msg = peakLineTakenMessage(new PeakLineTakenError(QO, NEW));

    expect(msg).toContain(QO);
    expect(msg).toContain(`#${NEW}`);
    expect(msg).toContain('ยกเลิก');
  });

  it('asks to wait when the line is only being claimed right now', () => {
    const msg = peakLineTakenMessage(new PeakLineTakenError(QO, null));

    expect(msg).toContain(QO);
    expect(msg).toContain('2 นาที');
    expect(msg).not.toContain('#');
  });
});

describe('readPeakMarker', () => {
  const respond = (rows: unknown[]) => sqlMock.mockImplementation(async () => ({ rows, rowCount: rows.length }));

  it("reads raw_data->'peak' of that order", async () => {
    respond([{ peak: { code: QO, lineKeys: ['L1', 'L2'], draftId: 'dOld' } }]);

    expect(await readPeakMarker(OLD)).toEqual({ code: QO, lineKeys: ['L1', 'L2'] });

    const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?').replace(/\s+/g, ' ')).toContain("raw_data->'peak' AS peak FROM orders WHERE id = ?");
    expect(values).toEqual([OLD]);
  });

  it('accepts the marker as a JSON string (driver-dependent)', async () => {
    respond([{ peak: JSON.stringify({ code: QO, lineKeys: ['L1'] }) }]);

    expect(await readPeakMarker(OLD)).toEqual({ code: QO, lineKeys: ['L1'] });
  });

  it.each([
    ['no such order', []],
    ['an order without a marker', [{ peak: null }]],
    ['a marker without a code', [{ peak: { lineKeys: ['L1'] } }]],
    ['a marker without line keys', [{ peak: { code: QO, lineKeys: [] } }]],
    ['line keys that are not an array', [{ peak: { code: QO, lineKeys: 'L1' } }]],
    ['unparseable JSON', [{ peak: '{not json' }]],
  ])('null for %s', async (_label, rows) => {
    respond(rows);

    expect(await readPeakMarker(OLD)).toBeNull();
  });

  it('drops line keys that are not non-empty strings', async () => {
    respond([{ peak: { code: QO, lineKeys: ['L1', '', 7, null] } }]);

    expect(await readPeakMarker(OLD)).toEqual({ code: QO, lineKeys: ['L1'] });
  });
});
