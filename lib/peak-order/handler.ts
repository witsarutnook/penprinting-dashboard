import 'server-only';
import type { InboundMessage } from '@/lib/ai-quote/channels/types';
import type { CreateOrderBody, CreateOrderResult, OrderActor } from '@/lib/orders-create';
import type { PeakQuotation, PeakReader } from '@/lib/peak/read';
import { PeakAuthError, PeakUnavailableError } from '@/lib/peak/oauth';
import { PeakNotConnectedError } from '@/lib/peak/token-store';
import { PeakToolError } from '@/lib/peak/mcp-client';
import { PeakConfigError } from '@/lib/peak/crypto';
import type { DraftRow, DraftStep, DraftUnit, LiveLink, PeakOrderDb } from '@/lib/peak-order/db';
import { orderCommandArgs, parseOrderCommand } from '@/lib/peak-order/command';
import { clipEcho, notFoundHint, resolveOrderCommand } from '@/lib/peak-order/resolve';
import { addDaysISO, bangkokISODate, buildOrderBody, firstLine, planUnits } from '@/lib/peak-order/mapper';
import { decodePostback, type OrderPostback } from '@/lib/peak-order/postback';
import {
  TEXT,
  choicesCard,
  createdCard,
  dateCard,
  dupCard,
  graphicCard,
  modeCard,
  pressCard,
  statusCard,
  summaryCard,
  unitCard,
  whoCard,
  type Card,
} from '@/lib/peak-order/flex';
import { ORDERERS, QTY_UNITS } from '@/lib/order-constants';
import { STAFF } from '@/lib/board';

/**
 * Orchestration of the LINE /order flow (spec §4, §6.5).
 * Task 12: command entry — identity, resolve, status card, draft start.
 * Task 13: postback state machine — draft steps, create, dashboard draft,
 * duplicate confirm, crash recovery.
 *
 * Every refused path (no userId, unknown user, Voided, zero lines, status
 * card) replies without creating a draft row. Peak is only called after the
 * identity checks pass. Known Peak failures are answered with short text and
 * never thrown; anything else propagates.
 *
 * Never two orders for one quotation line: createOrder is reached only after
 * (1) winning the conditional advanceDraft gate into 'creating', (2) a true
 * from claimLines, and (3) a null from findOrderByPeakMarker — in that order,
 * on every attempt. (3) is what makes a retry after a half-finished attempt
 * (order written, link not finalized) adopt that order instead of minting a
 * second one.
 */

export interface PeakOrderDeps {
  /** Flex-or-text fallback lives in the wiring (Task 14). */
  reply: (m: InboundMessage, card: Card | string | Array<Card | string>) => Promise<void>;
  peak: PeakReader;
  db: PeakOrderDb;
  createOrder: (body: CreateOrderBody, actor: OrderActor) => Promise<CreateOrderResult>;
  getDisplayName: (lineUserId: string) => Promise<string | null>;
  now: () => Date;
  newDraftId: () => string;
}

export const DRAFT_TTL_MS = 30 * 60_000;

/**
 * Short reply text for a known Peak failure, or null when `e` is not one.
 * PeakConfigError = stored token cannot be decrypted (bad/missing key) → treated
 * as "not connected" so the connection never dies silently (ruling R2).
 */
export function peakFailureText(e: unknown): string | null {
  if (e instanceof PeakNotConnectedError || e instanceof PeakAuthError || e instanceof PeakConfigError) {
    return TEXT.peakNotConnected;
  }
  if (e instanceof PeakUnavailableError || e instanceof PeakToolError) return TEXT.peakUnavailable;
  return null;
}

function logPeakFailure(where: string, e: unknown): void {
  // Error class name only — never the message (keeps any upstream detail out of logs).
  console.warn(`[peak-order] ${where}: ${e instanceof Error ? e.name : 'unknown error'}`);
}

export async function handlePeakOrderText(m: InboundMessage, deps: PeakOrderDeps): Promise<void> {
  const uid = m.channelUserId;
  if (!uid) {
    await deps.reply(m, TEXT.noUser);
    return;
  }
  const text = m.text ?? '';
  const staff = await deps.db.getStaff(uid);
  if (!staff) {
    await deps.reply(m, whoCard(orderCommandArgs(text)));
    return;
  }
  const cmd = parseOrderCommand(text);
  if (!cmd) return; // not an /order command — the router never sends these

  let resolved: Awaited<ReturnType<typeof resolveOrderCommand>>;
  try {
    resolved = await resolveOrderCommand(cmd, {
      peak: deps.peak,
      openedCodes: (codes) => deps.db.openedCodes(codes),
      todayISO: bangkokISODate(deps.now()),
    });
  } catch (e) {
    const msg = peakFailureText(e);
    if (msg === null) throw e;
    logPeakFailure('resolve', e);
    await deps.reply(m, msg);
    return;
  }

  switch (resolved.kind) {
    case 'not-found':
      await deps.reply(m, resolved.hint);
      return;
    case 'choices':
      await deps.reply(m, choicesCard(resolved.heading, resolved.choices, resolved.note));
      return;
    case 'quotation':
      await startFromQuotation(m, deps, resolved.quotation, resolved.customerName, staff.orderer);
      return;
  }
}

/**
 * Start a draft for one quotation (also the entry for the `pick` / `rest`
 * postbacks). Lines with a live link to a line key that still exists in the
 * quotation are taken; link rows for keys no longer in the quotation never
 * block a current line. Without `remainingOnly`, a quotation that has any
 * live link to an order — on a current line OR on a key that vanished from
 * the quotation (lines re-keyed in Peak) — answers with the status card and
 * starts no draft (spec §4.5: an opened quotation never starts a new draft);
 * the card's "เปิดรายการที่เหลือ" (`rest`) opens the current free lines.
 */
export async function startFromQuotation(
  m: InboundMessage,
  deps: PeakOrderDeps,
  q: PeakQuotation,
  customerName: string,
  orderer: string,
  opts: { remainingOnly?: boolean } = {},
): Promise<void> {
  const uid = m.channelUserId;
  if (!uid) {
    await deps.reply(m, TEXT.noUser);
    return;
  }
  if (q.status.trim().toLowerCase() === 'voided') {
    await deps.reply(m, TEXT.voided);
    return;
  }
  if (q.lines.length === 0) {
    await deps.reply(m, TEXT.noLines);
    return;
  }

  const s = await lineState(deps, q);
  const free = s.free;

  // Already (partly) opened and not asked for the rest — or nothing left to open.
  if (((s.liveHere.length > 0 || s.liveGone.length > 0) && !opts.remainingOnly) || free.length === 0) {
    await deps.reply(m, statusFor(q, customerName, s));
    return;
  }

  let mode: DraftRow['mode'];
  let units: DraftRow['units'];
  let step: DraftStep;
  if (free.length === 1 && q.lines.length === 1) {
    mode = 'single';
    units = planUnits(q, 'single').map((u) => ({ ...u, choices: {} }));
    step = 'unit';
  } else if (opts.remainingOnly || free.length !== q.lines.length) {
    mode = 'split';
    units = planUnits(
      q,
      'split',
      free.map((l) => l.key),
    ).map((u) => ({ ...u, choices: {} }));
    step = 'unit';
  } else {
    mode = null;
    units = [];
    step = 'mode';
  }

  const row: Omit<DraftRow, 'lastTouchedAt' | 'creatingKind'> = {
    id: deps.newDraftId(),
    groupId: m.groupId ?? '',
    lineUserId: uid,
    orderer,
    qoCode: q.code,
    snapshot: { quotation: structuredClone(q), customerName },
    mode,
    units,
    unitIdx: 0,
    step,
  };
  await deps.db.createDraft(row);
  const draft: DraftRow = { ...row, creatingKind: null, lastTouchedAt: deps.now().toISOString() };
  await deps.reply(m, step === 'mode' ? modeCard(draft) : unitCard(draft));
}

// ─── line state / status card ──────────────────────────────────────

interface LineState {
  /** Live links whose line key still exists in the quotation. */
  liveHere: LiveLink[];
  /**
   * Live links to an order (orderId set) whose line key is no longer in the
   * quotation. An in-flight claim (orderId null) on such a key is ignored.
   */
  liveGone: LiveLink[];
  /** Current lines without a live link. */
  free: PeakQuotation['lines'];
}

async function lineState(deps: PeakOrderDeps, q: PeakQuotation): Promise<LineState> {
  const live = await deps.db.liveLinks(q.code);
  const currentKeys = new Set(q.lines.map((l) => l.key));
  const liveHere = live.filter((l) => currentKeys.has(l.lineKey));
  const liveGone = live.filter((l) => !currentKeys.has(l.lineKey) && l.orderId !== null);
  const liveKeys = new Set(liveHere.map((l) => l.lineKey));
  return { liveHere, liveGone, free: q.lines.filter((l) => !liveKeys.has(l.key)) };
}

function statusFor(q: PeakQuotation, customerName: string, s: LineState): Card {
  const opened: Array<{ orderId: number; name: string; isDraft: boolean }> = [];
  const seen = new Set<number>();
  for (const l of [...s.liveHere, ...s.liveGone]) {
    // An in-flight claim (orderId null) makes its line "not free" but is not an opened order (R4).
    if (l.orderId === null || seen.has(l.orderId)) continue;
    seen.add(l.orderId);
    opened.push({ orderId: l.orderId, name: l.orderName ?? '', isDraft: l.orderStatus === 'draft' });
  }
  return statusCard({
    qoCode: q.code,
    customerName,
    opened,
    remaining: s.free.map((l) => ({ name: firstLine(l.description) })),
  });
}

async function quotationStatusCard(deps: PeakOrderDeps, d: DraftRow): Promise<Card> {
  const q = d.snapshot.quotation;
  return statusFor(q, d.snapshot.customerName, await lineState(deps, q));
}

// ─── postback entry ────────────────────────────────────────────────

/** A crashed 'creating' attempt is presumed dead after this (= the claim TTL). */
export const CREATING_STALE_MS = 2 * 60_000;

type DraftAction = Exclude<OrderPostback, { a: 'who' } | { a: 'pick' } | { a: 'rest' }>;
type StepAction = Exclude<DraftAction, { a: 'x' }>;

/** The step each draft action belongs to. */
const STEP_OF: Record<StepAction['a'], DraftStep> = {
  mode: 'mode',
  unit: 'unit',
  gfx: 'graphic',
  press: 'press',
  date: 'date',
  ok: 'confirm',
  dup: 'dup',
};

type Reply = Card | string | Array<Card | string>;

function logClass(where: string, e: unknown): void {
  // Error class name only — never the message.
  console.warn(`[peak-order] ${where}: ${e instanceof Error ? e.name : 'unknown error'}`);
}

export async function handlePeakOrderPostback(m: InboundMessage, deps: PeakOrderDeps): Promise<void> {
  const p = decodePostback(m.postbackData ?? '');
  if (!p) return;
  const uid = m.channelUserId;
  if (!uid) {
    await deps.reply(m, TEXT.noUser);
    return;
  }
  switch (p.a) {
    case 'who':
      return onWho(m, deps, uid, p);
    case 'pick':
    case 'rest':
      return onPick(m, deps, uid, p.code, p.a === 'rest');
    default:
      return onDraftAction(m, deps, uid, p);
  }
}

async function onWho(
  m: InboundMessage,
  deps: PeakOrderDeps,
  uid: string,
  p: Extract<OrderPostback, { a: 'who' }>,
): Promise<void> {
  if (p.orderer >= ORDERERS.length) return; // forged index
  // R3: the choice is permanent (corrected from the admin page) — a stale /
  // repeated who card from a mapped user does nothing.
  if (await deps.db.getStaff(uid)) return;
  if (p.orderer === -1) {
    await deps.reply(m, TEXT.whoDeclined);
    return;
  }
  let displayName: string | null = null;
  try {
    displayName = await deps.getDisplayName(uid);
  } catch (e) {
    logClass('display name', e); // R4: never blocks registration
  }
  await deps.db.setStaff(uid, ORDERERS[p.orderer], displayName);
  await handlePeakOrderText({ ...m, kind: 'text', text: `/order ${p.args}` }, deps);
}

/** One line, at most n code points (… on cut). */
function clipText(s: string, n: number): string {
  const one = String(s).replace(/\s+/g, ' ').trim();
  const cps = Array.from(one);
  return cps.length <= n ? one : cps.slice(0, n - 1).join('') + '…';
}

async function onPick(m: InboundMessage, deps: PeakOrderDeps, uid: string, code: string, rest: boolean): Promise<void> {
  const staff = await deps.db.getStaff(uid);
  if (!staff) {
    await deps.reply(m, whoCard(''));
    return;
  }
  let q: PeakQuotation | null;
  let customerName: string;
  try {
    q = await deps.peak.getQuotation(code);
    if (!q) {
      await deps.reply(m, notFoundHint(`ไม่พบใบเสนอราคา ${clipEcho(code)}`));
      return;
    }
    customerName = (await deps.peak.getContactName(q.contactCode)) || q.contactCode;
  } catch (e) {
    const msg = peakFailureText(e);
    if (msg === null) throw e;
    logPeakFailure(rest ? 'rest' : 'pick', e);
    await deps.reply(m, msg);
    return;
  }
  await startFromQuotation(m, deps, q, customerName, staff.orderer, { remainingOnly: rest });
}

// ─── draft actions ─────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day 'yyyy-mm-dd' that is not before `today`, else null. */
function validDue(s: unknown, today: string): string | null {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return null;
  let canon: string;
  try {
    canon = addDaysISO(s, 0);
  } catch {
    return null;
  }
  if (canon !== s) return null; // 2026-13-40, 2026-02-30 …
  return s >= today ? s : null;
}

/** Nearest earlier unit whose result is an order or a dashboard draft. */
function copySource(d: DraftRow): DraftUnit | null {
  for (let i = d.unitIdx - 1; i >= 0; i--) {
    const k = d.units[i]?.result?.kind;
    if (k === 'order' || k === 'draft') return d.units[i];
  }
  return null;
}

const canCopy = (d: DraftRow): boolean => d.mode === 'split' && copySource(d) !== null;

/** Units with the current unit's choices / result patched (deep copy). */
function patchUnit(d: DraftRow, patch: Partial<Pick<DraftUnit, 'choices' | 'result'>>): DraftUnit[] {
  const units = structuredClone(d.units);
  units[d.unitIdx] = { ...units[d.unitIdx], ...patch };
  return units;
}

/** Next unit at step 'unit', or 'done' past the last one (unitIdx kept). */
function nextPos(d: DraftRow): { unitIdx: number; step: DraftStep } {
  return d.unitIdx + 1 < d.units.length ? { unitIdx: d.unitIdx + 1, step: 'unit' } : { unitIdx: d.unitIdx, step: 'done' };
}

/** The one conditional gate from the draft's exact current (unitIdx, step). */
function gate(deps: PeakOrderDeps, d: DraftRow, to: Parameters<PeakOrderDb['advanceDraft']>[2]): Promise<DraftRow | null> {
  return deps.db.advanceDraft(d.id, { unitIdx: d.unitIdx, step: d.step }, to);
}

async function onDraftAction(m: InboundMessage, deps: PeakOrderDeps, uid: string, p: DraftAction): Promise<void> {
  const d = await deps.db.loadDraft(p.draft);
  if (!d) return;
  if (d.groupId !== (m.groupId ?? '')) return; // R6
  if (uid !== d.lineUserId) {
    await deps.reply(m, TEXT.notOwner(d.orderer));
    return;
  }
  if (d.step === 'done' || d.step === 'cancelled') return;
  const now = deps.now();
  const age = now.getTime() - Date.parse(d.lastTouchedAt);
  if (!(age <= DRAFT_TTL_MS)) {
    // Also an unparsable lastTouchedAt (NaN) → expired.
    await deps.reply(m, TEXT.expired);
    return;
  }

  if (p.a === 'x') {
    if (await deps.db.cancelDraft(d.id)) await deps.reply(m, TEXT.cancelled);
    return;
  }

  // R1: recovery of a stuck 'creating' runs before the generic step check.
  if ((p.a === 'ok' || p.a === 'dup') && d.step === 'creating') {
    if (p.u !== d.unitIdx || age <= CREATING_STALE_MS) return;
    const out = await recover(deps, d);
    if (out !== null) await deps.reply(m, out);
    return;
  }

  if (d.step !== STEP_OF[p.a]) return;
  if (p.a !== 'mode' && p.u !== d.unitIdx) return;
  const unit = d.units[d.unitIdx];
  if (p.a !== 'mode' && !unit) return;

  const today = bangkokISODate(now);
  const out = await transition(deps, d, p, unit, today, m);
  if (out !== null) await deps.reply(m, out);
}

async function transition(
  deps: PeakOrderDeps,
  d: DraftRow,
  p: StepAction,
  unit: DraftUnit,
  today: string,
  m: InboundMessage,
): Promise<Reply | null> {
  const q = d.snapshot.quotation;
  switch (p.a) {
    case 'mode': {
      const mode = p.v;
      const units = planUnits(q, mode).map((u) => ({ ...u, choices: {} }));
      if (units.length === 0) return null;
      const n = await gate(deps, d, { unitIdx: 0, step: mode === 'merged' ? 'graphic' : 'unit', mode, units });
      if (!n) return null;
      return mode === 'merged' ? graphicCard(n, false) : unitCard(n);
    }

    case 'unit': {
      if (p.v === 'skip') {
        if (d.mode !== 'split') return null;
        const n = await gate(deps, d, { ...nextPos(d), units: patchUnit(d, { result: { kind: 'skipped' } }) });
        if (!n) return null;
        return n.step === 'unit' ? unitCard(n) : quotationStatusCard(deps, n);
      }
      const qtyUnit = QTY_UNITS[p.v];
      if (qtyUnit === undefined) return null;
      const n = await gate(deps, d, {
        unitIdx: d.unitIdx,
        step: 'graphic',
        units: patchUnit(d, { choices: { ...unit.choices, qtyUnit } }),
      });
      return n ? graphicCard(n, canCopy(n)) : null;
    }

    case 'gfx': {
      if (p.v === 'same') {
        const src = canCopy(d) ? copySource(d) : null;
        if (!src) return null;
        const graphic = src.choices.graphic ?? '';
        const press = src.choices.press ?? '';
        const due = validDue(src.choices.dateDue, today);
        // A copied due date that has gone past (draft crossed midnight) is not
        // copied: the unit goes to the date step instead (Review Focus 4).
        // The unit (qtyUnit) is this unit's own and never copied.
        const choices = {
          ...(unit.choices.qtyUnit === undefined ? {} : { qtyUnit: unit.choices.qtyUnit }),
          graphic,
          press,
          ...(due ? { dateDue: due } : {}),
        };
        const n = await gate(deps, d, { unitIdx: d.unitIdx, step: due ? 'confirm' : 'date', units: patchUnit(d, { choices }) });
        if (!n) return null;
        return due ? summaryCard(n) : dateCard(n, today);
      }
      let graphic: string;
      if (p.v === 'none') graphic = '';
      else if (STAFF.graphic.some((s) => s.id === p.v)) graphic = p.v;
      else return null;
      const n = await gate(deps, d, { unitIdx: d.unitIdx, step: 'press', units: patchUnit(d, { choices: { ...unit.choices, graphic } }) });
      return n ? pressCard(n) : null;
    }

    case 'press': {
      let press: string;
      if (p.v === 'none') {
        if (!unit.choices.graphic) return null; // the form needs graphic or press
        press = '';
      } else if (STAFF.print.some((s) => s.id === p.v)) {
        press = p.v;
      } else {
        return null;
      }
      const n = await gate(deps, d, { unitIdx: d.unitIdx, step: 'date', units: patchUnit(d, { choices: { ...unit.choices, press } }) });
      return n ? dateCard(n, today) : null;
    }

    case 'date': {
      const raw = p.v === 'pick' ? m.postbackParams?.date : addDaysISO(today, Number(p.v.slice(1)));
      const dateDue = validDue(raw, today);
      if (dateDue === null) return TEXT.badDate; // no gate
      const n = await gate(deps, d, { unitIdx: d.unitIdx, step: 'confirm', units: patchUnit(d, { choices: { ...unit.choices, dateDue } }) });
      return n ? summaryCard(n) : null;
    }

    case 'ok':
    case 'dup': {
      const kind = p.a === 'ok' ? p.v : 'create';
      const g = await gate(deps, d, { unitIdx: d.unitIdx, step: 'creating', creatingKind: kind });
      if (!g) return null; // double tap / lost the race
      return createUnit(deps, g, kind === 'draft', p.a === 'dup');
    }
  }
}

// ─── create procedure ──────────────────────────────────────────────

async function releaseSafe(deps: PeakOrderDeps, d: DraftRow): Promise<void> {
  try {
    await deps.db.releaseClaim(d.qoCode, d.id);
  } catch (e) {
    logClass(`release claim ${d.qoCode} draft ${d.id}`, e);
  }
}

/** creating → confirm after a failed attempt; a throw here is logged only. */
async function backToConfirm(deps: PeakOrderDeps, g: DraftRow): Promise<DraftRow | null> {
  try {
    return await deps.db.advanceDraft(g.id, { unitIdx: g.unitIdx, step: 'creating' }, { unitIdx: g.unitIdx, step: 'confirm' });
  } catch (e) {
    logClass(`back to confirm ${g.qoCode} draft ${g.id}`, e);
    return null;
  }
}

/** Record the unit's result and leave 'creating' (next unit or done). */
async function finishUnit(
  deps: PeakOrderDeps,
  g: DraftRow,
  result: NonNullable<DraftUnit['result']>,
  card: { orderId: number; pin: string; isDraft: boolean },
): Promise<Reply> {
  const unit = g.units[g.unitIdx];
  const n = await deps.db.advanceDraft(
    g.id,
    { unitIdx: g.unitIdx, step: 'creating' },
    { ...nextPos(g), units: patchUnit(g, { result }) },
  );
  const created = createdCard({ orderId: card.orderId, name: unit.name, pin: card.pin, isDraft: card.isDraft });
  // An adopted order (written by an earlier, half-finished attempt) may lack its
  // job — createOrderInPostgres is not transactional — so ask staff to check it.
  const head: Array<Card | string> = result.kind === 'existing' ? [created, TEXT.adopted] : [created];
  // The order exists either way; a lost gate only means another tap moved the draft.
  if (n && n.step === 'unit') return [...head, unitCard(n)];
  return head.length === 1 ? created : head;
}

/**
 * Runs after winning the gate into 'creating'. Guards before createOrder, in
 * order: claimLines === true, findOrderByPeakMarker === null.
 */
async function createUnit(deps: PeakOrderDeps, g: DraftRow, asDraft: boolean, force: boolean): Promise<Reply | null> {
  const unit = g.units[g.unitIdx];
  const tag = `${g.qoCode} draft ${g.id}`;
  try {
    // 1. Claim the lines (all-or-nothing).
    const claimed = await deps.db.claimLines(g.qoCode, unit.lineKeys, g.id, g.orderer);
    if (!claimed) {
      await backToConfirm(deps, g);
      return await quotationStatusCard(deps, g);
    }
    // 2. Adopt an order an earlier, half-finished attempt already wrote.
    const existing = await deps.db.findOrderByPeakMarker(g.qoCode, unit.lineKeys);
    if (existing) {
      await deps.db.finalizeLinks(g.qoCode, g.id, existing.id);
      console.warn(`[peak-order] ${tag}: adopted order ${existing.id}`);
      return await finishUnit(deps, g, { kind: 'existing', orderId: existing.id }, {
        orderId: existing.id,
        pin: '',
        isDraft: existing.status === 'draft',
      });
    }
    // 3. Create.
    const c = unit.choices;
    const body = buildOrderBody({
      unit,
      choices: { qtyUnit: c.qtyUnit, graphic: c.graphic ?? '', press: c.press ?? '', dateDue: c.dateDue ?? '' },
      customerName: g.snapshot.customerName,
      orderer: g.orderer,
      qoCode: g.qoCode,
      draftId: g.id,
      todayISO: bangkokISODate(deps.now()),
      asDraft,
      force,
    });
    const r = await deps.createOrder(body, { role: 'sales', user: `${g.orderer} (LINE)` });
    // 4. Success → finalize links, record, advance.
    if (r.ok) {
      await deps.db.finalizeLinks(g.qoCode, g.id, r.orderId);
      return await finishUnit(
        deps,
        g,
        { kind: asDraft ? 'draft' : 'order', orderId: r.orderId, jobId: r.jobId, pin: r.pin },
        { orderId: r.orderId, pin: r.pin, isDraft: r.draft },
      );
    }
    await releaseSafe(deps, g);
    // 5. Name + customer duplicate → ask.
    if (r.kind === 'duplicate') {
      const n = await deps.db.advanceDraft(g.id, { unitIdx: g.unitIdx, step: 'creating' }, { unitIdx: g.unitIdx, step: 'dup' });
      return n ? dupCard(n, r.duplicates.map((x) => ({ id: x.id, name: x.name }))) : null;
    }
    // 6. Validation / failure.
    console.warn(`[peak-order] ${tag}: create ${r.kind}`);
    await backToConfirm(deps, g);
    return r.kind === 'validation' && r.error ? `${TEXT.createFailed}\n${clipText(r.error, 300)}` : TEXT.createFailed;
  } catch (e) {
    // 6. Any throw (also after a successful createOrder: the order carries the
    // marker, so the next ok adopts it in step 2).
    logClass(`create ${tag}`, e);
    await releaseSafe(deps, g);
    await backToConfirm(deps, g);
    return TEXT.createFailed;
  }
}

/** ok/dup on a 'creating' older than CREATING_STALE_MS: the attempt died. */
async function recover(deps: PeakOrderDeps, d: DraftRow): Promise<Reply | null> {
  const unit = d.units[d.unitIdx];
  if (!unit) return null;
  const existing = await deps.db.findOrderByPeakMarker(d.qoCode, unit.lineKeys);
  if (existing) {
    await deps.db.finalizeLinks(d.qoCode, d.id, existing.id);
    console.warn(`[peak-order] ${d.qoCode} draft ${d.id}: recovered order ${existing.id}`);
    return finishUnit(deps, d, { kind: 'existing', orderId: existing.id }, {
      orderId: existing.id,
      pin: '',
      isDraft: existing.status === 'draft',
    });
  }
  await releaseSafe(deps, d);
  const n = await deps.db.advanceDraft(d.id, { unitIdx: d.unitIdx, step: 'creating' }, { unitIdx: d.unitIdx, step: 'confirm' });
  return n ? summaryCard(n) : null;
}
