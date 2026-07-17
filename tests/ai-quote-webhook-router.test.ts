// tests/ai-quote-webhook-router.test.ts
import { describe, it, expect } from 'vitest';
import { routeInbound, handleInbound, parseTrackCommand } from '@/lib/ai-quote/webhook-router';
import type { InboundMessage } from '@/lib/ai-quote/channels/types';

const base = { channel: 'line' as const, channelUserId: 'U1', replyToken: 'rt' };

describe('routeInbound (Phase 1b-A, aiEnabled=false)', () => {
  it('routes images to slip', () => {
    const m: InboundMessage = { ...base, kind: 'image', imageMessageId: 'i1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('slip');
  });
  it('routes /track text to track', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track 202606110' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track');
  });
  it('ignores non-track text when AI disabled', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: 'ขอราคาใบปลิว' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('ignore');
  });
  it('ignores postback when AI disabled', () => {
    const m: InboundMessage = { ...base, kind: 'postback', postbackData: 'ai_quote_start' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('ignore');
  });
  it('(forward-compat) routes non-track text to ai when enabled', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: 'ขอราคาใบปลิว' };
    expect(routeInbound(m, { aiEnabled: true })).toBe('ai');
  });
  it('routes /groupid to groupid', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/groupid', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('groupid');
  });
  it('ignores non-command text from a group (no slip/track/ai noise in groups)', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: 'สวัสดีครับ', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: true })).toBe('ignore');
  });
  it('routes /track sent from a group to track (customers track in their own group)', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track 202606110', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track');
  });
});

function stubDeps(over: Record<string, unknown> = {}) {
  const replies: unknown[] = [];
  return {
    replies,
    deps: {
      adapter: {
        downloadImage: async () => new Blob(['x']),
        reply: async (_m: unknown, message: string | object) => { replies.push(message); },
        push: async () => {},
      },
      blobToBase64: async () => ({ data: 'AAA', mediaType: 'image/jpeg' }),
      isSlipImage: async () => true,
      verifyBankSlipImage: async () => ({ success: true, data: { isDuplicate: false, isAccountMatched: true, rawSlip: { amount: { amount: 50 } } } }),
      buildSlipFlex: () => ({ type: 'flex', altText: 'SLIP_OK' }),
      loadOrder: async () => ({ order: { name: 'งานเอ' }, job: null, shipped: null, cancelled: null }),
      buildOrderFlex: () => ({ type: 'flex' }),
      anthropic: {} as never,
      visionModel: 'm',
      aiEnabled: false,
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [{ orderId: 100 }],
      buildCustomerJobsFlex: () => ({ type: 'flex', altText: 'LIST' }),
      ...over,
    },
  };
}

describe('handleInbound', () => {
  it('verifies a slip image and replies with a flex card', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, deps as never);
    expect(replies[0]).toMatchObject({ type: 'flex', altText: 'SLIP_OK' });
  });
  it('skips Thunder when the pre-filter says the image is NOT a slip', async () => {
    let thunderCalled = false;
    const { replies, deps } = stubDeps({
      isSlipImage: async () => false,
      verifyBankSlipImage: async () => { thunderCalled = true; return { success: false }; },
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, deps as never);
    expect(thunderCalled).toBe(false);
    expect(replies.length).toBe(0); // เงียบ (ไม่ใช่สลิป → ประหยัด Thunder quota)
  });
  it('records one metric row per image (pass → result, drop → null)', async () => {
    const events: Array<{ looksLikeSlip: boolean; result: unknown }> = [];
    const recordSlipCheck = async (ev: { channel: string; looksLikeSlip: boolean; result: unknown }) => { events.push(ev); };

    const pass = stubDeps({ recordSlipCheck });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, pass.deps as never);

    const drop = stubDeps({ recordSlipCheck, isSlipImage: async () => false });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, drop.deps as never);

    expect(events.length).toBe(2);
    expect(events[0]).toMatchObject({ looksLikeSlip: true });
    expect(events[0].result).not.toBeNull();          // verified → Thunder result attached
    expect(events[1]).toMatchObject({ looksLikeSlip: false, result: null }); // dropped → no Thunder call
  });
  it('answers /track with a flex card', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track 202606110', replyToken: 'rt' }, deps as never);
    expect(replies[0]).toMatchObject({ type: 'flex' }); // flex object sent
  });
  it('replies (not-found bubble) when the order does not exist', async () => {
    const { replies, deps } = stubDeps({ loadOrder: async () => ({ order: null, job: null, shipped: null, cancelled: null }) });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track 999999', replyToken: 'rt' }, deps as never);
    expect(replies.length).toBe(1);
  });
  it('ignores non-track text when AI disabled', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: 'สวัสดี', replyToken: 'rt' }, deps as never);
    expect(replies.length).toBe(0);
  });
  it('answers /track sent from a group with a flex card', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound(
      { channel: 'line', channelUserId: 'U', kind: 'text', text: '/track 202606110', replyToken: 'rt', sourceType: 'group', groupId: 'G1' },
      deps as never,
    );
    expect(replies[0]).toMatchObject({ type: 'flex' });
  });
  it('echoes the group id when /groupid is sent in a group', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound(
      { channel: 'line', channelUserId: 'U', kind: 'text', text: '/groupid', replyToken: 'rt', sourceType: 'group', groupId: 'Gabc123' },
      deps as never,
    );
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('Gabc123');
  });
  it('tells the user /groupid is group-only when sent in a 1-on-1 chat', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/groupid', replyToken: 'rt' }, deps as never);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('เฉพาะในกลุ่ม');
  });
});

describe('parseTrackCommand', () => {
  it('parses an order id (>=6 digits)', () => {
    expect(parseTrackCommand('/track 202606110')).toEqual({ kind: 'order', id: '202606110' });
  });
  it('parses bare /track as a customer command with no keyword', () => {
    expect(parseTrackCommand('/track')).toEqual({ kind: 'customer', keyword: undefined });
  });
  it('parses /track <name> as a customer keyword', () => {
    expect(parseTrackCommand('/track โบรชัวร์')).toEqual({ kind: 'customer', keyword: 'โบรชัวร์' });
  });
  it('returns null for non-track text', () => {
    expect(parseTrackCommand('สวัสดีครับ')).toBeNull();
  });
});

describe('routeInbound — track-customer (group name search)', () => {
  it('routes bare /track from a group to track-customer', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track-customer');
  });
  it('routes /track <name> from a group to track-customer', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track โบรชัวร์', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track-customer');
  });
  it('keeps /track <id> as the order route even in a group', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track 202606110', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track');
  });
  it('ignores bare /track in a 1-on-1 chat (no group binding = no identity)', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('ignore');
  });
});

describe('handleInbound — track-customer', () => {
  it('guides the user when the group is not registered', async () => {
    const { replies, deps } = stubDeps({ loadRegistrationByGroup: async () => null });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'Gx' }, deps as never);
    expect(replies.length).toBe(1);
    expect(String(replies[0])).toContain('ยังไม่ได้ลงทะเบียน');
  });
  it('answers a single active job with the full order card', async () => {
    const { replies, deps } = stubDeps({
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [{ orderId: 100 }],
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'G1' }, deps as never);
    expect(replies[0]).toMatchObject({ type: 'flex' }); // buildOrderFlex stub
  });
  it('answers multiple active jobs with the summary bubble', async () => {
    const { replies, deps } = stubDeps({
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [{ orderId: 100 }, { orderId: 101 }],
      buildCustomerJobsFlex: () => ({ type: 'flex', altText: 'LIST' }),
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'G1' }, deps as never);
    expect(replies[0]).toMatchObject({ altText: 'LIST' });
  });
  it('replies empty-state when the customer has no active jobs', async () => {
    const { replies, deps } = stubDeps({
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [],
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'G1' }, deps as never);
    expect(String(replies[0])).toContain('ไม่มีงาน');
  });
});

describe('routeInbound — 1b-B mode keywords (aiEnabled=true)', () => {
  const on = { aiEnabled: true };
  it.each(['/ขอราคา', '/ตีราคา', '/ขอราคา AI', '/ขอราคาai', ' /ขอราคา '])('enter keyword: %s → enter-ai', (t) => {
    expect(routeInbound({ ...base, kind: 'text', text: t }, on)).toBe('enter-ai');
  });
  // Soft-launch gate reverted 2026-07-17: bare keyword enters the mode; the
  // "/" prefix stays optional so legacy hint quick-reply buttons keep working.
  it.each(['ขอราคา', 'ตีราคา', 'ขอราคา AI', 'ขอราคาai'])('bare keyword: %s → enter-ai', (t) => {
    expect(routeInbound({ ...base, kind: 'text', text: t }, on)).toBe('enter-ai');
  });
  it.each(['จบ', 'ออก', 'ออกจากโหมด AI'])('exit keyword: %s → exit-ai', (t) => {
    expect(routeInbound({ ...base, kind: 'text', text: t }, on)).toBe('exit-ai');
  });
  it('a broader ขอราคา sentence is NOT an enter keyword (goes to ai/hint path)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: 'ขอราคาโบรชัวร์ 1000 ใบ' }, on)).toBe('ai');
  });
  it('คุยกับทีมงาน is no longer an exit keyword — it is an ai turn (trigger ①)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: 'คุยกับทีมงาน' }, on)).toBe('ai');
  });
  it('keywords are inert when AI is disabled (1b-A regression)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: '/ขอราคา' }, { aiEnabled: false })).toBe('ignore');
    expect(routeInbound({ ...base, kind: 'text', text: 'ออก' }, { aiEnabled: false })).toBe('ignore');
  });
  it('enter keyword in a group is still ignored (no AI in shared chats)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: '/ขอราคา', sourceType: 'group', groupId: 'G1' }, on)).toBe('ignore');
  });
  it('/track and slip keep priority over AI inside the mode (router order unchanged)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: '/track 202606110' }, on)).toBe('track');
    expect(routeInbound({ ...base, kind: 'image', imageMessageId: 'i' }, on)).toBe('slip');
  });
});

// ─── 1b-B: customer AI arms ───
import type { CustomerAiDeps } from '@/lib/ai-quote/webhook-router';

const ACTIVE_MODE = { channelUserId: 'U1', enteredAt: 't', lastActivityAt: 't', sessionId: 7, roundsNoQuote: 0, lastHintAt: null, lastStaffReplyAt: null };
const QUOTE = { productType: 'brochure' as const, spec: {}, result: { unitPrice: 5 }, unitPrice: 5 };

function stubAi(over: Partial<Record<keyof CustomerAiDeps, unknown>> = {}) {
  const calls: string[] = [];
  const pushed: unknown[] = [];
  const ai = {
    loadMode: async () => ACTIVE_MODE,
    enterMode: async () => { calls.push('enter'); },
    touchMode: async () => { calls.push('touch'); },
    exitMode: async () => { calls.push('exit'); },
    markHintSent: async () => { calls.push('hint-sent'); },
    modeActive: () => true,
    hintAllowed: () => true,
    hintEnabled: true,
    staffActive: () => false,
    recordStaffReply: async () => { calls.push('staff-reply'); },
    checkRateLimit: async () => true,
    loadSessionForUser: async () => ({ conversation: [], customerName: 'คุณเอ' }),
    createSessionForUser: async () => ({ id: 7, customerName: null }),
    saveConversation: async () => { calls.push('save-conv'); },
    saveQuote: async () => { calls.push('save-quote'); return 1; },
    countQuotes: async () => 0,
    loadLastQuote: async () => null,
    updateLeadStatus: async (_id: number, status: string) => { calls.push('status:' + status); },
    runTurn: async () => ({ reply: 'ราคา ~5.00 บ./ชิ้น ยังไม่รวม VAT 7% — ราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ', quotes: [QUOTE], escalated: false, newHistory: [{ role: 'user' as const, text: 'x' }, { role: 'assistant' as const, text: 'y' }] }),
    buildEscalationFlex: () => ({ type: 'flex', altText: 'ESCALATE' }),
    pushStaff: async (msg: object) => { calls.push('push-staff'); pushed.push(msg); },
    ...over,
  } as unknown as CustomerAiDeps;
  return { ai, calls, pushed };
}

const text1on1 = (text: string): InboundMessage => ({ channel: 'line', channelUserId: 'U1', kind: 'text', text, replyToken: 'rt' });

describe('handleInbound — 1b-B mode lifecycle', () => {
  it('enter-ai keyword enters the mode and sends the intro', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('/ขอราคา AI'), deps as never);
    expect(calls).toContain('enter');
    expect(String(replies[0])).toContain('ประเมินราคาอัตโนมัติ');
  });
  it('exit keyword in-mode exits and confirms', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ออก'), deps as never);
    expect(calls).toContain('exit');
    expect(String(replies[0])).toContain('ออกจากโหมด');
  });
  it('exit keyword out-of-mode is silent (normal chat word — staff answers)', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ออก'), deps as never);
    expect(calls).not.toContain('exit');
    expect(replies.length).toBe(0);
  });
  it('out-of-mode text → hint + quick-reply, gate marked', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, loadMode: async () => null });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ สนใจงานพิมพ์'), deps as never);
    expect(calls).toContain('hint-sent');
    expect(String(replies[0])).toContain('ทีมงาน');
  });
  it('hint is silent inside the 24h gate', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, hintAllowed: () => false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ'), deps as never);
    expect(calls).not.toContain('hint-sent');
    expect(replies.length).toBe(0);
  });
  it('hint is silent when hintEnabled=false (soft launch)', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, hintEnabled: false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ'), deps as never);
    expect(calls).not.toContain('hint-sent');
    expect(replies.length).toBe(0);
  });
  it('in-mode text runs the engine, saves, touches, replies', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000 ใบ'), deps as never);
    expect(calls).toEqual(expect.arrayContaining(['save-quote', 'save-conv', 'touch']));
    expect(String(replies[0])).toContain('5.00');
  });
  it('rate-limited turn declines politely without calling the engine', async () => {
    let engineCalled = false;
    const { ai } = stubAi({ checkRateLimit: async () => false, runTurn: async () => { engineCalled = true; throw new Error('no'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(engineCalled).toBe(false);
    expect(String(replies[0])).toContain('ถี่เกินไป');
  });
  it('engine failure replies the error text (customer never gets silence)', async () => {
    const { ai } = stubAi({ runTurn: async () => { throw new Error('calc 500'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(String(replies[0])).toContain('ขัดข้อง');
  });
  it('owner mismatch on the linked session falls back to a fresh session (M5)', async () => {
    const created: number[] = [];
    const { ai } = stubAi({
      loadSessionForUser: async () => null,   // channel/owner mismatch → null
      createSessionForUser: async () => { created.push(1); return { id: 99, customerName: null }; },
    });
    const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(created.length).toBe(1);
  });
  it('aiEnabled but aiCustomer missing (env not wired) stays silent — 1b-A behaviour', async () => {
    const { replies, deps } = stubDeps({ aiEnabled: true });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(replies.length).toBe(0);
  });
});

describe('handleInbound — 1b-B escalation triggers (spec §4)', () => {
  it('① human request: escalates without an engine call, exits mode', async () => {
    let engineCalled = false;
    const { ai, calls } = stubAi({ runTurn: async () => { engineCalled = true; throw new Error('no'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ขอคุยกับพนักงานค่ะ'), deps as never);
    expect(engineCalled).toBe(false);
    expect(calls).toEqual(expect.arrayContaining(['status:escalated', 'push-staff', 'exit', 'save-conv']));
    expect(String(replies[0])).toContain('ส่งต่อทีมงาน');
  });
  it('④ order intent with an existing quote: Type B → กำลังติดตาม', async () => {
    const { ai, calls } = stubAi({ countQuotes: async () => 1 });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สั่งเลยค่ะ'), deps as never);
    expect(calls).toContain('status:กำลังติดตาม');
    expect(calls).toContain('exit');
    expect(String(replies[0])).toContain('ทีมขาย');
  });
  it('④ order intent WITHOUT a quote goes to the engine instead (must quote first)', async () => {
    let engineCalled = false;
    const { ai, calls } = stubAi({
      countQuotes: async () => 0,
      runTurn: async () => { engineCalled = true; return { reply: 'ขอทราบจำนวนค่ะ', quotes: [], escalated: false, newHistory: [] }; },
    });
    const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สั่งเลยค่ะ'), deps as never);
    expect(engineCalled).toBe(true);
    expect(calls).not.toContain('status:กำลังติดตาม');
  });
  it("② model hand-off (ส่งต่อทีมงาน, no quote): escalates with the model's own reply", async () => {
    const { ai, calls } = stubAi({
      runTurn: async () => ({ reply: 'งานกล่องขอส่งต่อทีมงานประเมินให้นะคะ', quotes: [], escalated: true, newHistory: [] }),
    });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('กล่องใส่สินค้า 500 ใบ'), deps as never);
    expect(calls).toEqual(expect.arrayContaining(['status:escalated', 'push-staff', 'exit']));
    expect(String(replies[0])).toContain('ส่งต่อทีมงาน');
  });
  it('③ 4th no-quote round escalates with the fixed reply', async () => {
    const { ai, calls } = stubAi({
      loadMode: async () => ({ ...ACTIVE_MODE, roundsNoQuote: 3 }),
      runTurn: async () => ({ reply: 'ขอทราบจำนวนหน้าค่ะ', quotes: [], escalated: false, newHistory: [{ role: 'user' as const, text: 'x' }, { role: 'assistant' as const, text: 'ขอทราบจำนวนหน้าค่ะ' }] }),
    });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('หนังสือ'), deps as never);
    expect(calls).toContain('status:escalated');
    expect(String(replies[0])).toContain('ทีมงาน');
  });
  it('a successful quote resets the round counter (no escalation at rounds=3)', async () => {
    const touched: unknown[] = [];
    const { ai, calls } = stubAi({
      loadMode: async () => ({ ...ACTIVE_MODE, roundsNoQuote: 3 }),
      touchMode: async (_uid: string, patch: unknown) => { touched.push(patch); },
    });
    const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000 ใบ'), deps as never);
    expect(calls).not.toContain('status:escalated');
    expect(touched[0]).toMatchObject({ roundsNoQuote: 0 });
  });
  it('missing pushStaff (LINE_STAFF_GROUP_ID unset) still escalates + replies (degraded)', async () => {
    const { ai, calls } = stubAi({ pushStaff: null });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ขอคุยกับพนักงานค่ะ'), deps as never);
    expect(calls).toContain('status:escalated');
    expect(replies.length).toBe(1);
  });
  it('④ passes the last persisted quote to the staff card (ราคา AI ถ้ามี)', async () => {
    const flexInputs: unknown[] = [];
    const { ai, calls } = stubAi({
      countQuotes: async () => 1,
      loadLastQuote: async () => ({ productType: 'brochure', unitPrice: 4.78 }),
      buildEscalationFlex: (input: unknown) => { flexInputs.push(input); return { type: 'flex', altText: 'ESCALATE' }; },
    });
    const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สั่งเลยค่ะ'), deps as never);
    expect(calls).toContain('push-staff');
    expect(flexInputs[0]).toMatchObject({ trigger: 'order_intent', lastQuote: { unitPrice: 4.78 } });
  });
});

describe('routeInbound (Messenger — trackEnabled=false, spec 1c §1)', () => {
  const msgr = { channel: 'messenger' as const, channelUserId: 'PSID1' };
  it('routes images to slip', () => {
    const m: InboundMessage = { ...msgr, kind: 'image', imageMessageId: 'https://cdn.fb/x.jpg' };
    expect(routeInbound(m, { aiEnabled: false, trackEnabled: false })).toBe('slip');
  });
  it('track-shaped text becomes ordinary ai text (no /track on Messenger)', () => {
    const m: InboundMessage = { ...msgr, kind: 'text', text: '/track 202606110' };
    expect(routeInbound(m, { aiEnabled: true, trackEnabled: false })).toBe('ai');
  });
  it('groupid command is ignored when AI off (no /groupid on Messenger)', () => {
    const m: InboundMessage = { ...msgr, kind: 'text', text: '/groupid' };
    expect(routeInbound(m, { aiEnabled: false, trackEnabled: false })).toBe('ignore');
  });
  it('postback ai_quote_start still enters the mode', () => {
    const m: InboundMessage = { ...msgr, kind: 'postback', postbackData: 'ai_quote_start' };
    expect(routeInbound(m, { aiEnabled: true, trackEnabled: false })).toBe('enter-ai');
  });
  it('trackEnabled omitted defaults to true (LINE routing unchanged)', () => {
    const m: InboundMessage = { channel: 'line', channelUserId: 'U1', kind: 'text', text: '/track 202606110' };
    expect(routeInbound(m, { aiEnabled: true })).toBe('track');
  });
  it('staff-echo kind routes to staff-echo regardless of aiEnabled/trackEnabled', () => {
    const m: InboundMessage = { channel: 'messenger', channelUserId: '555', kind: 'staff-echo' };
    expect(routeInbound(m, { aiEnabled: false, trackEnabled: false })).toBe('staff-echo');
    expect(routeInbound(m, { aiEnabled: true })).toBe('staff-echo');
  });
});

describe('handleInbound — HINT-1 staff-echo + hint suppression', () => {
  const staffEcho: InboundMessage = { channel: 'messenger', channelUserId: '555', kind: 'staff-echo' };

  it('staff-echo records the staff reply and stays completely silent', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(staffEcho, deps as never);
    expect(calls).toContain('staff-reply');
    expect(replies.length).toBe(0);
  });
  it('staff-echo without aiCustomer deps is a no-op', async () => {
    const { replies, deps } = stubDeps({ aiEnabled: false });
    await expect(handleInbound(staffEcho, deps as never)).resolves.toBeUndefined();
    expect(replies.length).toBe(0);
  });
  it('staff-echo recordStaffReply failure is swallowed (webhook must never 500)', async () => {
    const { ai } = stubAi({ recordStaffReply: async () => { throw new Error('column missing'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await expect(handleInbound(staffEcho, deps as never)).resolves.toBeUndefined();
    expect(replies.length).toBe(0);
  });
  it('hint is silent while a staff conversation is active — and does NOT burn the 24h quota', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, staffActive: () => true });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ สนใจงานพิมพ์'), deps as never);
    expect(calls).not.toContain('hint-sent');
    expect(replies.length).toBe(0);
  });
  it('hint fires again once the staff window lapses', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, staffActive: () => false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ'), deps as never);
    expect(calls).toContain('hint-sent');
    expect(replies.length).toBe(1);
  });
});
