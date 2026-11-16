/**
 * Test-only fakes for the LINE /order handler (Tasks 12–13).
 *
 * fakeDb reproduces the REAL semantics of lib/peak-order/db.ts's SQL (not a
 * simplification) — the duplicate-order tests run on it:
 *   - advanceDraft: conditional gate on the exact (unitIdx, step); omitted
 *     mode/units are left unchanged; creatingKind is always written (omitted →
 *     null); lastTouchedAt = now.
 *   - claimLines: keys de-duplicated; [] → false; all-or-nothing; a key is
 *     takeable when no link row exists or the row is dead. Failure (and partial
 *     success) runs releaseClaim(code, draftId), like the SQL.
 *   - live link = (orderId null AND claimed ≤ 2 min ago) OR (orderId set AND
 *     the order is alive).
 *   - an order is alive = it exists AND its status is not 'cancelled' AND it
 *     has no `cancelled` row (jobCancelled — a job cancelled from the board).
 *     ONE helper (orderAlive) decides this for claimLines, liveLinks,
 *     openedCodes and findOrderByPeakMarker, like the SQL's shared predicate.
 * All time comparisons use the controllable clock; rows are copied in and out.
 */
import type { InboundMessage } from '@/lib/ai-quote/channels/types';
import type { PeakQuotation, PeakQuotationRow, PeakReader, PeakListQuery } from '@/lib/peak/read';
import type { DraftRow, LiveLink, PeakOrderDb } from '@/lib/peak-order/db';
import type { CreateOrderBody, CreateOrderResult, OrderActor } from '@/lib/orders-create';
import type { PeakOrderDeps } from '@/lib/peak-order/handler';

export const CLAIM_TTL_MS = 2 * 60_000;

export interface FakeOrder {
  name: string;
  status: string;
  /** The raw_data.peak marker findOrderByPeakMarker reads. */
  peak?: { code: string; lineKeys: string[] };
  /** A `cancelled` row exists for this order (job cancelled from the board card). */
  jobCancelled?: boolean;
}

export interface FakeLink {
  qoCode: string;
  lineKey: string;
  orderId: number | null;
  draftId: string;
  claimedAtMs: number;
  createdBy?: string;
}

export interface FakeDbSeed {
  staff?: Record<string, string>;
  orders?: Record<number, FakeOrder>;
  links?: FakeLink[];
  nowMs?: () => number;
}

export type FakeDb = PeakOrderDb & {
  drafts: Map<string, DraftRow>;
  links: FakeLink[];
  orders: Map<number, FakeOrder>;
  staff: Map<string, { orderer: string; displayName: string | null; createdAt: string }>;
};

const clone = <T>(v: T): T => structuredClone(v);

export function fakeDb(seed: FakeDbSeed = {}): FakeDb {
  const nowMs = seed.nowMs ?? (() => Date.now());
  const nowIso = () => new Date(nowMs()).toISOString();
  const drafts = new Map<string, DraftRow>();
  const links: FakeLink[] = (seed.links ?? []).map(clone);
  const orders = new Map<number, FakeOrder>(
    Object.entries(seed.orders ?? {}).map(([id, o]) => [Number(id), clone(o)] as [number, FakeOrder]),
  );
  const staff = new Map<string, { orderer: string; displayName: string | null; createdAt: string }>(
    Object.entries(seed.staff ?? {}).map(([uid, orderer]) => [uid, { orderer, displayName: null, createdAt: nowIso() }]),
  );

  const orderAlive = (o: FakeOrder | undefined): o is FakeOrder =>
    o !== undefined && o.status !== 'cancelled' && !o.jobCancelled;

  const isLive = (l: FakeLink): boolean => {
    if (l.orderId === null) return nowMs() - l.claimedAtMs <= CLAIM_TTL_MS;
    return orderAlive(orders.get(l.orderId));
  };

  const db: FakeDb = {
    drafts,
    links,
    orders,
    staff,

    async getStaff(lineUserId) {
      const s = staff.get(lineUserId);
      return s ? { orderer: s.orderer } : null;
    },
    async setStaff(lineUserId, orderer, displayName) {
      const prev = staff.get(lineUserId);
      staff.set(lineUserId, { orderer, displayName, createdAt: prev?.createdAt ?? nowIso() });
    },
    async listStaff() {
      return [...staff.entries()]
        .map(([lineUserId, s]) => ({ lineUserId, ...s }))
        .sort((a, b) => (a.createdAt === b.createdAt ? a.lineUserId.localeCompare(b.lineUserId) : a.createdAt.localeCompare(b.createdAt)));
    },
    async deleteStaff(lineUserId) {
      staff.delete(lineUserId);
    },

    async createDraft(d) {
      if (drafts.has(d.id)) throw new Error(`duplicate key: draft ${d.id}`);
      drafts.set(d.id, clone({ ...d, creatingKind: null, lastTouchedAt: nowIso() }));
    },
    async loadDraft(id) {
      const d = drafts.get(id);
      return d ? clone(d) : null;
    },
    async advanceDraft(id, from, to) {
      const d = drafts.get(id);
      if (!d || d.unitIdx !== from.unitIdx || d.step !== from.step) return null;
      const next: DraftRow = {
        ...d,
        step: to.step,
        unitIdx: to.unitIdx,
        mode: to.mode ?? d.mode, // COALESCE(param, mode)
        units: to.units === undefined ? d.units : clone(to.units),
        creatingKind: to.creatingKind ?? null,
        lastTouchedAt: nowIso(),
      };
      drafts.set(id, next);
      return clone(next);
    },
    async cancelDraft(id) {
      const d = drafts.get(id);
      if (!d || d.step === 'done' || d.step === 'cancelled' || d.step === 'creating') return false;
      drafts.set(id, { ...d, step: 'cancelled', lastTouchedAt: nowIso() });
      return true;
    },

    async liveLinks(qoCode) {
      return links
        .filter((l) => l.qoCode === qoCode && isLive(l))
        .sort((a, b) => (a.lineKey < b.lineKey ? -1 : a.lineKey > b.lineKey ? 1 : 0))
        .map((l): LiveLink => {
          const o = l.orderId === null ? undefined : orders.get(l.orderId);
          return { lineKey: l.lineKey, orderId: l.orderId, orderName: o?.name ?? null, orderStatus: o?.status ?? null };
        });
    },
    async openedCodes(codes) {
      const want = new Set(codes);
      return new Set(links.filter((l) => want.has(l.qoCode) && isLive(l)).map((l) => l.qoCode));
    },

    async claimLines(qoCode, lineKeys, draftId, by) {
      const keys = [...new Set(lineKeys)].sort();
      if (keys.length === 0) return false;
      let taken = 0;
      for (const key of keys) {
        const row = links.find((l) => l.qoCode === qoCode && l.lineKey === key);
        if (!row) {
          links.push({ qoCode, lineKey: key, orderId: null, draftId, claimedAtMs: nowMs(), createdBy: by });
          taken++;
        } else if (!isLive(row)) {
          row.draftId = draftId;
          row.createdBy = by;
          row.orderId = null;
          row.claimedAtMs = nowMs();
          taken++;
        }
      }
      if (taken < keys.length) {
        await db.releaseClaim(qoCode, draftId);
        return false;
      }
      return true;
    },
    async releaseClaim(qoCode, draftId) {
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i];
        if (l.qoCode === qoCode && l.draftId === draftId && l.orderId === null) links.splice(i, 1);
      }
    },
    async finalizeLinks(qoCode, draftId, orderId) {
      for (const l of links) {
        if (l.qoCode === qoCode && l.draftId === draftId && l.orderId === null) l.orderId = orderId;
      }
    },
    async findOrderByPeakMarker(qoCode, lineKeys) {
      if (lineKeys.length === 0) return null;
      const want = new Set(lineKeys);
      const hit = [...orders.entries()]
        .sort((a, b) => b[0] - a[0])
        .find(([, o]) => orderAlive(o) && o.peak?.code === qoCode && o.peak.lineKeys.some((k) => want.has(k)));
      return hit ? { id: hit[0], status: hit[1].status } : null;
    },
  };
  return db;
}

// ─── Peak ───────────────────────────────────────────────────────────

export type FakePeak = PeakReader & { calls: Array<{ m: string; a: unknown[] }> };

/**
 * In-memory PeakReader. Search matches a quotation when searchText is a
 * substring of its code or of its contact's name; dateStart/dateEnd filter on
 * issuedDate. "Newest" = issuedDate desc, then code desc.
 */
export function fakePeak(quotations: PeakQuotation[] = [], contacts: Record<string, string> = {}): FakePeak {
  const calls: Array<{ m: string; a: unknown[] }> = [];
  const toRow = (q: PeakQuotation): PeakQuotationRow => ({
    code: q.code,
    issuedDate: q.issuedDate,
    contactCode: q.contactCode,
    netAmount: q.netAmount,
  });
  const match = (q: PeakListQuery) =>
    quotations
      .filter((x) => {
        if (q.searchText && !x.code.includes(q.searchText) && !(contacts[x.contactCode] ?? '').includes(q.searchText)) return false;
        if (q.dateStart && x.issuedDate < q.dateStart) return false;
        if (q.dateEnd && x.issuedDate > q.dateEnd) return false;
        return true;
      })
      .sort((a, b) => (a.issuedDate === b.issuedDate ? b.code.localeCompare(a.code) : b.issuedDate.localeCompare(a.issuedDate)));
  return {
    calls,
    async getQuotation(code) {
      calls.push({ m: 'getQuotation', a: [code] });
      const q = quotations.find((x) => x.code.toLowerCase() === code.trim().toLowerCase());
      return q ? clone(q) : null;
    },
    async listQuotations(q) {
      calls.push({ m: 'listQuotations', a: [q] });
      const all = match(q);
      return { rows: all.slice((q.page - 1) * 50, q.page * 50).map(toRow), total: all.length };
    },
    async newestQuotations(q, n) {
      calls.push({ m: 'newestQuotations', a: [q, n] });
      return match(q).slice(0, n).map(toRow);
    },
    async getContactName(contactCode) {
      calls.push({ m: 'getContactName', a: [contactCode] });
      return contacts[contactCode] ?? null;
    },
  };
}

// ─── clock + deps ───────────────────────────────────────────────────

export interface FakeClock {
  ms: number;
  now: () => Date;
  nowMs: () => number;
  advance: (ms: number) => void;
}

/** Default: 2026-11-14 10:00 Bangkok (03:00 UTC). */
export function fakeClock(startIso = '2026-11-14T03:00:00.000Z'): FakeClock {
  const c: FakeClock = {
    ms: Date.parse(startIso),
    now: () => new Date(c.ms),
    nowMs: () => c.ms,
    advance: (ms) => {
      c.ms += ms;
    },
  };
  return c;
}

export interface FakeDepsOptions {
  clock?: FakeClock;
  /** Seed for the default fakeDb (its clock is the shared one). */
  seed?: Omit<FakeDbSeed, 'nowMs'>;
  quotations?: PeakQuotation[];
  contacts?: Record<string, string>;
}

/**
 * Wires fake deps around one shared clock. `replies` gets one entry per reply
 * call (an array reply stays one entry). `created` / `actors` record every
 * createOrder call, also when `over.createOrder` replaces the default. The
 * default createOrder registers the order in the fake orders map (with the
 * body's `peak` marker), so the DB sees real consequences.
 */
export function fakeDeps(
  over: Partial<PeakOrderDeps> = {},
  opts: FakeDepsOptions = {},
): {
  deps: PeakOrderDeps;
  replies: unknown[];
  created: CreateOrderBody[];
  actors: OrderActor[];
  db: FakeDb;
  peak: FakePeak;
  clock: FakeClock;
} {
  const clock = opts.clock ?? fakeClock();
  const db = (over.db as FakeDb | undefined) ?? fakeDb({ ...opts.seed, nowMs: clock.nowMs });
  const peak = (over.peak as FakePeak | undefined) ?? fakePeak(opts.quotations ?? [], opts.contacts ?? {});
  const replies: unknown[] = [];
  const created: CreateOrderBody[] = [];
  const actors: OrderActor[] = [];
  let nextDraft = 0;

  const defaultCreate = async (body: CreateOrderBody): Promise<CreateOrderResult> => {
    // From the CURRENT orders map on every call (orders added after setup count too).
    const orderId = Math.max(9000, ...[...db.orders.keys()].map((k) => k + 1));
    const draft = body.status === 'draft';
    const marker = body.peak as { code?: unknown; lineKeys?: unknown } | undefined;
    db.orders.set(orderId, {
      name: String(body.name ?? ''),
      status: draft ? 'draft' : 'pending',
      ...(marker && typeof marker.code === 'string' && Array.isArray(marker.lineKeys)
        ? { peak: { code: marker.code, lineKeys: marker.lineKeys.map(String) } }
        : {}),
    });
    return { ok: true, orderId, jobId: draft ? null : orderId * 10, pin: '4821', orderType: 'normal', draft };
  };
  const create = over.createOrder ?? defaultCreate;

  const deps: PeakOrderDeps = {
    reply: async (_m: InboundMessage, card) => {
      replies.push(card);
    },
    peak,
    db,
    getDisplayName: async () => 'LINE Display',
    now: clock.now,
    newDraftId: () => `d${++nextDraft}`,
    ...over,
    createOrder: async (body, actor) => {
      created.push(clone(body));
      actors.push(clone(actor));
      return create(body, actor);
    },
  };
  return { deps, replies, created, actors, db, peak, clock };
}

/** Inbound group text message (user '' = LINE omitted the userId). */
export function textMsg(text: string, o: { user?: string; group?: string } = {}): InboundMessage {
  return {
    channel: 'line',
    channelUserId: o.user ?? 'U-gift',
    kind: 'text',
    text,
    replyToken: 'rt',
    sourceType: 'group',
    groupId: o.group ?? 'G-team',
  };
}
