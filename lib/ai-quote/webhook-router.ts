// lib/ai-quote/webhook-router.ts
import type { InboundMessage, ChannelAdapter, OutboundMessage, QuickReply } from './channels/types';
import { extractOrderId } from './track-flex';
import { OrderNotFoundError } from '@/lib/postgres-errors';
import type { ThunderVerifyResponse } from './slip';
import type { ConversationTurn } from './types';
import type { RunQuoteTurnOutput, ProducedQuote } from './run';
import { mkTurn } from './run';
import { priceTableImageMessage } from './price-tables';
import type { LineModeRow } from './line-mode';
import type { EscalationFlexInput } from './escalation-flex';
import {
  detectHumanRequest, detectOrderIntent, detectCustomerEscalation,
  ROUNDS_NO_QUOTE_LIMIT, CUSTOMER_REPLY, CALENDAR_KIND_ASK, EXIT_TEXT, HINT_TEXT,
  RATE_LIMIT_TEXT, ERROR_TEXT, SEEDED_EXIT_HINT, detectPriceTableTopic, hintQuickReply,
  type TriggerType,
} from './customer-triggers';
import {
  buildIntroFlex, INTRO_TEXT_SHORT, INTRO_QUICK_REPLIES,
  buildCalendarKindFlex, CALENDAR_KIND_QUICK_REPLIES, isCalendarKindAsk, isCalendarButtonText,
} from './intro-flex';

/** Customer-AI turn reply: price-table images FIRST (so they sit above the text in
 *  the chat), the text LAST. No tables → the plain string, unchanged.
 *  Used ONLY by the final in-mode reply — hand-off (escalate) replies never carry images.
 *  `text` is passed in (not read from out.reply) so a seeded entry can append its exit hint. */
function withPriceTables(out: RunQuoteTurnOutput, text: string, channel: InboundMessage['channel']): OutboundMessage | OutboundMessage[] {
  if (out.priceTables.length === 0) return text;
  return [...out.priceTables.map((id) => priceTableImageMessage(id, channel)), text];
}

/** Send a LINE Flex; if LINE rejects it (invalid / over-limit → HTTP 400 on the reply AND on the
 *  adapter's push fallback, so adapter.reply throws) log and send the text equivalent instead of
 *  leaving the customer in silence. Only the Flex send is wrapped — a failing text fallback still
 *  propagates. (The adapter's push fallback drops quick replies; the chips are best-effort.) */
async function replyFlexOrText(
  deps: HandleDeps, m: InboundMessage, flex: OutboundMessage, text: string, quickReplies: QuickReply[],
): Promise<void> {
  try {
    await deps.adapter.reply(m, flex);
  } catch (err) {
    console.error(`[ai-quote/${m.channel}] flex send failed:`, err instanceof Error ? err.message : err);
    await deps.adapter.reply(m, text, quickReplies);
  }
}

/** Welcome: LINE → Flex bubble with the 6 product buttons · Messenger (no Flex) → short text + 6 chips. */
async function replyIntro(deps: HandleDeps, m: InboundMessage): Promise<void> {
  if (m.channel === 'line') await replyFlexOrText(deps, m, buildIntroFlex(), INTRO_TEXT_SHORT, INTRO_QUICK_REPLIES);
  else await deps.adapter.reply(m, INTRO_TEXT_SHORT, INTRO_QUICK_REPLIES);
}

/** "Which calendar kind?" question as a tappable UI: LINE → small Flex bubble with the 3 kind
 *  buttons · Messenger (no Flex) → the same text + 3 quick-reply chips. `text` may carry the
 *  seeded exit hint — it is exactly what gets persisted (and what the text fallback sends). */
async function replyCalendarKind(deps: HandleDeps, m: InboundMessage, text: string): Promise<void> {
  if (m.channel === 'line') await replyFlexOrText(deps, m, buildCalendarKindFlex(text), text, CALENDAR_KIND_QUICK_REPLIES);
  else await deps.adapter.reply(m, text, CALENDAR_KIND_QUICK_REPLIES);
}

export type Route = 'slip' | 'track' | 'track-customer' | 'groupid' | 'ai' | 'enter-ai' | 'exit-ai' | 'staff-echo' | 'ignore';

/** Match the group-id command — e.g. `/groupid`, `/group-id`, `/id` (leading slash
 *  required, case-insensitive). Echoes the LINE group/room id so staff can register
 *  a customer group for order tracking. */
export function isGroupIdCommand(text: string): boolean {
  return /^\/(group-?id|id)\s*$/i.test(text.trim());
}

/** Parse a /track command. Order form (>=6 digits) is unchanged from Phase 1b-A;
 *  the customer form (bare /track, or /track <keyword>) is new — it only does
 *  anything inside a registered group (see routeInbound). Leading slash optional. */
export function parseTrackCommand(text: string):
  | { kind: 'order'; id: string }
  | { kind: 'customer'; keyword?: string }
  | null {
  const t = text.trim();
  const orderM = t.match(/^\/?track\s+(\d{6,})/i);
  if (orderM) return { kind: 'order', id: orderM[1] };
  const custM = t.match(/^\/?track(?:\s+(.*\S))?\s*$/i);
  if (custM) return { kind: 'customer', keyword: custM[1]?.trim() || undefined };
  return null;
}

/** Mode entry keywords (spec §1 — exact-ish; a broad "ราคา..." sentence must
 *  NOT enter the mode, it collides with normal staff conversation).
 *
 *  Soft-launch "/" gate reverted 2026-07-17 (rich menu + hint live, entry via
 *  postback ai_quote_start ครอบอยู่แล้ว): bare "ขอราคา"/"ตีราคา" enters. The
 *  "/" prefix stays OPTIONAL — hint quick-reply buttons already delivered to
 *  customer chats carry the old "/ขอราคา AI" text and must keep working.
 *  2026-10-19: also accepts the seeded form "ขอราคา AI <product>" (topic buttons) —
 *  see parseEnterAiSeed; the `ai` token stays mandatory there. */
export function isEnterAiKeyword(text: string): boolean {
  return /^\/?(ขอราคา|ตีราคา)(\s*ai)?$/i.test(text.trim()) || parseEnterAiSeed(text) !== null;
}

/** Seeded entry — `ขอราคา AI <product>` (the topic-aware hint buttons, e.g.
 *  "ขอราคา AI บัตร PVC") enters the mode AND runs the first turn on <product>.
 *  The literal `ai` token is REQUIRED: enter-ai bypasses the 24h/48h hint gates, so a
 *  natural sentence ("ขอราคา ปฏิทิน 500 ชุด") must keep routing to the plain `ai` arm.
 *  Returns the trimmed trailing phrase, or null (bare keyword / no `ai` token). */
export function parseEnterAiSeed(text: string): string | null {
  const m = text.trim().match(/^\/?(?:ขอราคา|ตีราคา)\s*ai\s+(\S.*)$/i);
  return m ? m[1].trim() : null;
}

/** Mode exit keywords (spec §1). "คุยกับทีมงาน" is deliberately NOT here —
 *  in-mode it is escalation trigger ① (hand-off with a staff push), not a
 *  silent exit. */
export function isExitAiKeyword(text: string): boolean {
  return /^(จบ|ออก|ออกจากโหมด\s*ai)$/i.test(text.trim());
}

/** Pure routing decision. Phase 1b-A passes aiEnabled=false (AI off): images→slip,
 *  /track→track, /groupid→groupid, everything else→ignore. The 'ai'/'enter-ai'/'exit-ai'
 *  arms are exercised once Phase 1b-B turns aiEnabled on (kept here so the table is total).
 *  trackEnabled (default true = LINE) gates the command arms — Messenger (1c D1)
 *  passes false: track/groupid text falls through as ordinary text (ai arm / ignore). */
export function routeInbound(m: InboundMessage, opts: { aiEnabled: boolean; trackEnabled?: boolean }): Route {
  // Staff echo (Messenger message_echoes — HINT-1): pure signal, classified
  // before every other arm; independent of aiEnabled/trackEnabled.
  if (m.kind === 'staff-echo') return 'staff-echo';
  const trackEnabled = opts.trackEnabled ?? true;
  // Explicit commands work anywhere (1-on-1 and groups/rooms):
  //   /groupid → echo the group id · /track <id> → status card (customers can track in their own group)
  if (trackEnabled && m.kind === 'text' && m.text && isGroupIdCommand(m.text)) return 'groupid';
  if (trackEnabled && m.kind === 'text' && m.text) {
    const cmd = parseTrackCommand(m.text);
    if (cmd?.kind === 'order') return 'track';                                  // /track <id> — anywhere
    if (cmd?.kind === 'customer' && (m.sourceType === 'group' || m.sourceType === 'room')) return 'track-customer';
  }
  // Beyond commands, group/room sources are ignored — no slip/ai noise in shared chats
  if (m.sourceType === 'group' || m.sourceType === 'room') return 'ignore';
  if (m.kind === 'image') return 'slip';
  if (!opts.aiEnabled) return 'ignore';
  if (m.kind === 'postback' && m.postbackData === 'ai_quote_start') return 'enter-ai';
  if (m.kind === 'text' && m.text) {
    if (isEnterAiKeyword(m.text)) return 'enter-ai';
    if (isExitAiKeyword(m.text)) return 'exit-ai';
    return 'ai';
  }
  return 'ignore';
}

export interface HandleDeps {
  adapter: Pick<ChannelAdapter, 'downloadImage' | 'reply' | 'push'>;
  blobToBase64: (b: Blob) => Promise<{ data: string; mediaType: string }>;
  isSlipImage: (b64: string, mediaType: string, d: { client: unknown; model: string }) => Promise<{ pass: boolean; answer: string | null }>;
  verifyBankSlipImage: (image: Blob, opts?: { matchAccount?: boolean }) => Promise<ThunderVerifyResponse>;
  buildSlipFlex: (r: ThunderVerifyResponse) => Record<string, unknown>;
  loadOrder: (id: number) => Promise<{ order: unknown } & Record<string, unknown>>;
  buildOrderFlex: (orderId: string, state: unknown) => Record<string, unknown>;
  loadRegistrationByGroup: (groupId: string) => Promise<({ customers: string[] } & Record<string, unknown>) | null>;
  loadActiveJobsByCustomer: (names: string[], opts?: { keyword?: string }) => Promise<Array<{ orderId: number } & Record<string, unknown>>>;
  buildCustomerJobsFlex: (jobs: Array<{ orderId: number } & Record<string, unknown>>) => Record<string, unknown>;
  anthropic: unknown;
  visionModel: string;
  aiEnabled: boolean;
  /** false = ปิด track/groupid command arms (Messenger — spec 1c D1). Default true (LINE). */
  trackEnabled?: boolean;
  // Optional best-effort metrics sink (one row per inbound slip image). Omitted
  // in tests; wired to Postgres in the LINE route. Must never throw.
  recordSlipCheck?: (ev: { channel: string; looksLikeSlip: boolean; prefilterAnswer: string | null; result: ThunderVerifyResponse | null }) => Promise<void>;
  // 1b-B customer AI arms — absent = flag off / env missing (1b-A behaviour).
  aiCustomer?: CustomerAiDeps;
}

/** AI-mode lifecycle + hint/suppression gates (table ai_quote_line_modes). */
export interface CustomerModeDeps {
  loadMode: (uid: string) => Promise<LineModeRow | null>;
  enterMode: (uid: string) => Promise<void>;
  touchMode: (uid: string, patch: { sessionId?: number | null; roundsNoQuote?: number | null }) => Promise<void>;
  exitMode: (uid: string) => Promise<void>;
  markHintSent: (uid: string) => Promise<void>;
  modeActive: (lastActivityAt: string | null, nowMs: number) => boolean;
  hintAllowed: (lastHintAt: string | null, nowMs: number) => boolean;
  hintEnabled: boolean;
  /** true = staff replied to this customer within the 48h suppression window (HINT-1). */
  staffActive: (lastStaffReplyAt: string | null, nowMs: number) => boolean;
  /** Staff replied (Messenger echo): stamp last_staff_reply_at + clear the mode (takeover). */
  recordStaffReply: (uid: string) => Promise<void>;
}

/** Session + quote persistence (tables ai_quote_sessions / ai_quotes). */
export interface CustomerSessionDeps {
  /** Owner-checked load (M5): null on mismatch — caller starts fresh. */
  loadSessionForUser: (id: number, uid: string) => Promise<{ conversation: ConversationTurn[]; customerName: string | null } | null>;
  createSessionForUser: (uid: string) => Promise<{ id: number; customerName: string | null }>;
  saveConversation: (id: number, conversation: ConversationTurn[]) => Promise<void>;
  saveQuote: (sessionId: number, q: ProducedQuote) => Promise<number>;
  countQuotes: (sessionId: number) => Promise<number>;
  /** Latest persisted quote for the escalation Flex ("ราคา AI ถ้ามี") — null when none. */
  loadLastQuote: (sessionId: number) => Promise<{ productType: string; unitPrice: number } | null>;
}

/** Quote engine + throughput guard. */
export interface CustomerEngineDeps {
  /** true = ผ่าน (30 msg/hr per channel user id — spec §6). */
  checkRateLimit: (uid: string) => Promise<boolean>;
  runTurn: (history: ConversationTurn[], userMessage: string) => Promise<RunQuoteTurnOutput>;
}

/** Staff hand-off: lead status + push to the staff LINE group. */
export interface CustomerEscalationDeps {
  updateLeadStatus: (sessionId: number, status: 'escalated' | 'กำลังติดตาม') => Promise<void>;
  buildEscalationFlex: (input: EscalationFlexInput) => Record<string, unknown>;
  /** null = LINE_STAFF_GROUP_ID unset → escalation continues, push skipped (logged). */
  pushStaff: ((message: object) => Promise<void>) | null;
}

/** Side-effecting deps for the 1b-B customer AI arms — everything injectable
 *  so handleInbound stays pure-testable. Pure helpers (trigger detectors,
 *  canned copy) are imported directly, not injected. Absent (undefined) when
 *  the channel flag is off or QUOTE_API env is missing → 1b-A behaviour.
 *  Grouped by concern (follow-up 7/10) — the flat shape is unchanged, so
 *  call sites and tests are untouched; wire via buildCustomerAiDeps
 *  (customer-deps.ts). */
export interface CustomerAiDeps extends CustomerModeDeps, CustomerSessionDeps, CustomerEngineDeps, CustomerEscalationDeps {}

/** Orchestrate one inbound message → side-effecting reply. Phase 1b-A handles
 *  slip + track; 1b-B wires the customer AI arms via deps.aiCustomer (absent = 1b-A behaviour). */
export async function handleInbound(m: InboundMessage, deps: HandleDeps): Promise<void> {
  const route = routeInbound(m, { aiEnabled: deps.aiEnabled, trackEnabled: deps.trackEnabled });
  if (route === 'staff-echo') {
    // Silent by design: record the takeover, never reply, never touch the engine.
    // Errors are swallowed locally (e.g. webhook fires before the column
    // migration) so they log under this specific prefix instead of the routes'
    // generic handleInbound catch — the 200 ack itself is never at risk (both
    // routes ack before after() runs).
    try {
      await deps.aiCustomer?.recordStaffReply(m.channelUserId);
    } catch (err) {
      console.error(`[ai-quote/${m.channel}] recordStaffReply failed:`, err instanceof Error ? err.message : err);
    }
    return;
  }
  if (route === 'slip') {
    const blob = await deps.adapter.downloadImage(m);
    // Cheap Haiku pre-filter to spare Thunder quota (customers send many non-slip
    // images). Tuned to err toward "yes": only an explicit "no"/"ไม่" drops the
    // image, and the prompt explicitly counts bill-payment/QR/top-up slips as slips.
    const { data, mediaType } = await deps.blobToBase64(blob);
    const pre = await deps.isSlipImage(data, mediaType, { client: deps.anthropic, model: deps.visionModel });
    let result: ThunderVerifyResponse | null = null;
    if (pre.pass) result = await deps.verifyBankSlipImage(blob, { matchAccount: true });
    // record one metric row per image (pass or drop) BEFORE the reply — the
    // sink never throws, and a failed send must not lose the evidence row
    // (2026-07-23 incident: record-after-reply left silent failures unprovable)
    await deps.recordSlipCheck?.({ channel: m.channel, looksLikeSlip: pre.pass, prefilterAnswer: pre.answer, result });
    if (result) await deps.adapter.reply(m, deps.buildSlipFlex(result));
    return;
  }
  if (route === 'track') {
    const id = extractOrderId(m.text!);
    if (!id) return;
    // loadOrder THROWS OrderNotFoundError for an unknown id — it never
    // resolves `{ order: null }`. Pre audit H1 (2026-10-08) the throw
    // escaped to the route's catch and the customer got no reply at all
    // (the bot looked dead); a real read failure still propagates.
    let state: Awaited<ReturnType<typeof deps.loadOrder>> | null;
    try {
      state = await deps.loadOrder(Number(id));
    } catch (err) {
      if (!(err instanceof OrderNotFoundError)) throw err;
      state = null;
    }
    const flex = deps.buildOrderFlex(id, state);
    await deps.adapter.reply(m, flex);
    return;
  }
  if (route === 'track-customer') {
    const cmd = parseTrackCommand(m.text!);
    const keyword = cmd && cmd.kind === 'customer' ? cmd.keyword : undefined;
    const groupId = m.groupId || m.roomId || '';
    const reg = await deps.loadRegistrationByGroup(groupId);
    if (!reg) {
      await deps.adapter.reply(m, 'กลุ่มนี้ยังไม่ได้ลงทะเบียนกับโรงพิมพ์ กรุณาติดต่อเจ้าหน้าที่ครับ');
      return;
    }
    const jobs = await deps.loadActiveJobsByCustomer(reg.customers, { keyword });
    if (jobs.length === 0) {
      await deps.adapter.reply(m, keyword
        ? `ไม่พบงานที่กำลังดำเนินการซึ่งตรงกับ "${keyword}" ครับ`
        : 'ตอนนี้ไม่มีงานที่กำลังดำเนินการครับ');
      return;
    }
    if (jobs.length === 1) {
      const state = await deps.loadOrder(jobs[0].orderId);
      await deps.adapter.reply(m, deps.buildOrderFlex(String(jobs[0].orderId), state.order ? state : null));
      return;
    }
    await deps.adapter.reply(m, deps.buildCustomerJobsFlex(jobs));
    return;
  }
  if (route === 'groupid') {
    const id = m.groupId || m.roomId;
    const reply = id
      ? `LINE Group ID:\n${id}`
      : 'คำสั่ง /groupid ใช้ได้เฉพาะในกลุ่ม LINE เท่านั้นครับ\nกรุณาเชิญบอทเข้ากลุ่มแล้วพิมพ์ /groupid ในกลุ่มอีกครั้ง';
    await deps.adapter.reply(m, reply);
    return;
  }
  // ── Phase 1b-B: customer AI arms (LINE 1-1 only — groups never reach here) ──
  if (route !== 'enter-ai' && route !== 'exit-ai' && route !== 'ai') return;
  const ai = deps.aiCustomer;
  if (!ai) return;   // flag ON but deps not wired (missing env) → 1b-A behaviour
  const uid = m.channelUserId;
  const now = Date.now();

  // Only three things enter the mode: the bare keyword, `ขอราคา AI <product>` (seeded),
  // and the ai_quote_start postback (routeInbound). Bare/postback → the intro (LINE: Flex
  // bubble with 6 product buttons · Messenger: short text + 6 chips) and stop;
  // seeded → fall through and run the first turn on the seed.
  let seed: string | null = null;
  if (route === 'enter-ai') {
    seed = m.kind === 'text' && m.text ? parseEnterAiSeed(m.text) : null;
    await ai.enterMode(uid);
    if (seed === null) {
      await replyIntro(deps, m);
      return;
    }
  }

  // Loaded AFTER enterMode on purpose: a seeded turn must read the fresh row
  // (rounds_no_quote = 0, last_activity = now), not the pre-entry one.
  const mode = await ai.loadMode(uid);
  const active = seed !== null || (mode !== null && ai.modeActive(mode.lastActivityAt, now));

  if (route === 'exit-ai') {
    if (active) {
      await ai.exitMode(uid);
      await deps.adapter.reply(m, EXIT_TEXT);
    }
    // นอกโหมด "จบ"/"ออก" เป็นคำคุยปกติ — เงียบ (พนักงานตอบเอง, ห้ามแทรก)
    return;
  }

  // route === 'ai'
  if (!active) {
    // นอกโหมด (spec §2): hint ≤1/user/24h + ปุ่มเข้าโหมด 1 แตะ. Sub-flag ปิดได้
    // ช่วง soft launch. Gate เก็บใน DB (ไม่ใช้ KV — fail-open จะ spam แชตพนักงาน).
    if (!ai.hintEnabled) return;
    // HINT-1: staff talked to this customer within 48h → never interject.
    // Checked BEFORE the 24h gate so a suppressed hint doesn't burn the quota.
    if (mode && ai.staffActive(mode.lastStaffReplyAt, now)) return;
    if (mode && !ai.hintAllowed(mode.lastHintAt, now)) return;
    await ai.markHintSent(uid);
    await deps.adapter.reply(m, HINT_TEXT, [hintQuickReply(detectPriceTableTopic(m.text!))]);
    return;
  }

  if (!(await ai.checkRateLimit(uid))) {
    await ai.touchMode(uid, {});
    // Seeded entry: the customer never saw the intro, so even a declined first turn
    // must say how to leave the mode (same reason replyText appends it below).
    await deps.adapter.reply(m, seed !== null ? `${RATE_LIMIT_TEXT}\n\n${SEEDED_EXIT_HINT}` : RATE_LIMIT_TEXT);
    return;
  }

  // Load (owner-checked, M5) or create the LINE-channel session. A mismatch
  // returns null and we start fresh — indistinguishable from not-found.
  let sessionId = mode?.sessionId ?? null;
  let conversation: ConversationTurn[] = [];
  let customerName: string | null = null;
  if (sessionId) {
    const sess = await ai.loadSessionForUser(sessionId, uid);
    if (sess) { conversation = sess.conversation; customerName = sess.customerName; }
    else sessionId = null;
  }
  if (!sessionId) {
    const created = await ai.createSessionForUser(uid);
    sessionId = created.id;
    customerName = created.customerName;
  }

  const text = seed ?? m.text!;
  const sid = sessionId;

  // Persist append-only: FULL stored conversation + this turn's pair — never
  // out.newHistory, which is built from the engine-trimmed(40) replay input
  // (M-quotelogs-flag-index-collision, audit 2026-07-21: persisting the
  // trimmed view shifted turn indexes ~2/round past 40 turns, breaking the
  // absolute turn_index that ai_quote_turn_flags and the /quote-logs UI key
  // on). Trim lives ONLY at replay (sanitizeHistory inside runTurn).
  const persistedConv = (assistantText: string): ConversationTurn[] =>
    [...conversation, mkTurn('user', text), mkTurn('assistant', assistantText)];

  const escalate = async (trigger: TriggerType, conv: ConversationTurn[], replyText: string) => {
    // Parallel persists (perf M-webhook 2026-07-23): the three DB ops are
    // independent (different tables / read-only), so they run concurrently —
    // the customer is waiting on this chain on top of the LLM latency.
    // ราคา AI ถ้ามี (spec §4) — best-effort จาก DB: quotes ของ turn นี้ถูก save
    // ก่อนถึง trigger ②③ แล้ว ส่วน ①④ ใช้ของ turn ก่อนหน้า. Fail = การ์ดไม่มีราคา.
    const [, , lastQuote] = await Promise.all([
      ai.saveConversation(sid, conv),
      ai.updateLeadStatus(sid, trigger === 'order_intent' ? 'กำลังติดตาม' : 'escalated'),
      ai.loadLastQuote(sid).catch((): null => null),
    ]);
    // Staff push + mode exit are independent of each other; both must still
    // COMPLETE before the customer reply (evidence/side-effects before reply).
    await Promise.all([
      (async () => {
        if (ai.pushStaff) {
          try {
            await ai.pushStaff(ai.buildEscalationFlex({ trigger, customerName, channel: m.channel, channelUserId: uid, lastUserText: text, lastQuote, sessionId: sid }));
          } catch (err) {
            console.error(`[ai-quote/${m.channel}] escalation push failed:`, err instanceof Error ? err.message : err);
          }
        } else {
          console.error(`[ai-quote/${m.channel}] LINE_STAFF_GROUP_ID unset — escalation NOT pushed (lead #${sid})`);
        }
      })(),
      ai.exitMode(uid),
    ]);
    await deps.adapter.reply(m, replyText);
  };

  // 📅 ปุ่ม "ปฏิทิน" จาก intro — คำเดี่ยวๆ แค่ถามต่อว่าแบบไหน: ตอบสคริปต์ CALENDAR_KIND_ASK
  // ทันทีโดยไม่เรียก engine (ไม่เผา token/latency กับคำตอบที่ตายตัว). อยู่หลัง rate limit +
  // load/create session (กดปุ่ม = 1 เทิร์นที่นับ + เก็บ history) และก่อน trigger ①④ (คำนี้
  // ไม่มีทางแตะ). Persist ก่อน reply เหมือนปลายทาง happy path; seeded → ต่อ exit hint
  // (ลูกค้าไม่เคยเห็น intro) และสิ่งที่ persist = ข้อความที่ลูกค้าเห็น
  if (isCalendarButtonText(text)) {
    const askText = seed !== null ? `${CALENDAR_KIND_ASK}\n\n${SEEDED_EXIT_HINT}` : CALENDAR_KIND_ASK;
    await Promise.all([
      ai.saveConversation(sid, persistedConv(askText)),
      ai.touchMode(uid, { sessionId: sid, roundsNoQuote: (mode?.roundsNoQuote ?? 0) + 1 }),
    ]);
    await replyCalendarKind(deps, m, askText);
    return;
  }

  // ① ขอคุยกับคน — ไม่เรียก engine (ไม่เผา token กับข้อความที่ขอ hand-off)
  if (detectHumanRequest(text)) {
    await escalate('human',
      [...conversation, mkTurn('user', text), mkTurn('assistant', CUSTOMER_REPLY.human)],
      CUSTOMER_REPLY.human);
    return;
  }
  // ④ ลูกค้ายืนยันจะสั่ง (Type B) — ต้องมีราคาแล้วเท่านั้น ไม่งั้นปล่อยให้ engine ตีราคาก่อน
  if (detectOrderIntent(text) && (await ai.countQuotes(sid)) > 0) {
    await escalate('order_intent',
      [...conversation, mkTurn('user', text), mkTurn('assistant', CUSTOMER_REPLY.order_intent)],
      CUSTOMER_REPLY.order_intent);
    return;
  }

  let out: RunQuoteTurnOutput;
  try {
    out = await ai.runTurn(conversation, text);
  } catch (err) {
    console.error(`[ai-quote/${m.channel}] engine turn failed:`, err instanceof Error ? err.message : err);
    await ai.touchMode(uid, { sessionId: sid });
    await deps.adapter.reply(m, seed !== null ? `${ERROR_TEXT}\n\n${SEEDED_EXIT_HINT}` : ERROR_TEXT);
    return;
  }
  // Note: not idempotent under LINE redelivery — a mid-loop throw persists the
  // earlier quotes and a retried webhook can double-insert. Accepted (same
  // soft-state posture as roundsNoQuote; quotes are display-only history).
  for (const q of out.quotes) await ai.saveQuote(sid, q);

  // ② model hand-off (นอกขอบเขต/กระดาษพิเศษ/ขอส่วนลด) — ใช้ข้อความ model เอง.
  // ใช้ detector วลี pin ของ customer flow ไม่ใช่ out.escalated (heuristic ฝั่ง
  // staff กว้างเกิน — disclaimer ลูกค้ามีคำ "ทีมงาน" ทุกใบราคา).
  if (detectCustomerEscalation(out.quotes.length, out.reply)) {
    await escalate('out_of_scope', persistedConv(out.reply), out.reply);
    return;
  }
  // ③ วนหลายรอบไม่ได้ราคา — แทน reply ของ model ด้วยข้อความส่งต่อ
  const rounds = out.quotes.length > 0 ? 0 : (mode?.roundsNoQuote ?? 0) + 1;
  if (out.quotes.length === 0 && rounds >= ROUNDS_NO_QUOTE_LIMIT) {
    await escalate('rounds', persistedConv(CUSTOMER_REPLY.rounds), CUSTOMER_REPLY.rounds);
    return;
  }

  // Seeded entry: the customer never saw the intro's exit instructions, so the
  // first reply carries them. What we persist = what the customer sees.
  const replyText = seed !== null ? `${out.reply}\n\n${SEEDED_EXIT_HINT}` : out.reply;

  // Parallel persists (perf M-webhook 2026-07-23): conversation and mode live
  // in different tables with no ordering dependency — run concurrently, but
  // both must land BEFORE the reply (persist-before-reply, 7/23 incident rule).
  await Promise.all([
    ai.saveConversation(sid, persistedConv(replyText)),
    ai.touchMode(uid, { sessionId: sid, roundsNoQuote: rounds }),
  ]);
  if (out.priceTables.length === 0) {
    // The model asked "which calendar kind?" (the pinned popular-3 sentence) → show it as
    // tappable buttons/chips. Display-only: replyText was persisted above as plain text.
    if (isCalendarKindAsk(replyText)) {
      await replyCalendarKind(deps, m, replyText);
    } else {
      await deps.adapter.reply(m, replyText);
    }
    return;
  }
  // Price-table images are a bonus, the text is the answer: Messenger sends array
  // items one by one and throws on the first failed Send API call, so a bad image
  // (CDN hiccup, Meta can't fetch the URL) would otherwise swallow the text and
  // leave the customer in silence. Degrade to the plain text — history is already
  // persisted with that exact text (its 📊 line tells the customer about the table),
  // so we neither re-persist nor rewrite it. A failing text-only retry propagates.
  try {
    await deps.adapter.reply(m, withPriceTables(out, replyText, m.channel));
  } catch (err) {
    console.error(`[ai-quote/${m.channel}] price-table image send failed:`, err instanceof Error ? err.message : err);
    await deps.adapter.reply(m, replyText);
  }
}
