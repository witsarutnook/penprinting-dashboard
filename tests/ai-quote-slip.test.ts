// tests/ai-quote-slip.test.ts
import { describe, it, expect } from 'vitest';
import { formatSlipReply } from '@/lib/ai-quote/slip';

describe('formatSlipReply', () => {
  const EXPECTED = 'อัพเดทผลการตรวจสอบสลิป';
  it('uses the generic altText for a valid slip', () => {
    const msg = formatSlipReply({ success: true, data: {
      isDuplicate: false, isAccountMatched: true,
      rawSlip: { amount: { amount: 1500 }, sender: { account: { name: { th: 'สมชาย ใจดี' } } } },
    } });
    expect(msg).toBe(EXPECTED);
  });
  it('uses the generic altText for a duplicate slip', () => {
    expect(formatSlipReply({ success: true, data: { isDuplicate: true } })).toBe(EXPECTED);
  });
  it('uses the generic altText for an account mismatch', () => {
    expect(formatSlipReply({ success: true, data: { isDuplicate: false, isAccountMatched: false } })).toBe(EXPECTED);
  });
  it('uses the generic altText for an unreadable slip (SLIP_NOT_FOUND)', () => {
    expect(formatSlipReply({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'x' } })).toBe(EXPECTED);
  });
});

import { isSlipImage, SLIP_PREFILTER_PROMPT, slipAccountMatched } from '@/lib/ai-quote/slip';

describe('slipAccountMatched (Thunder v2 + legacy dual-read)', () => {
  it('v2: matchedAccount object → true, null → false', () => {
    expect(slipAccountMatched({ success: true, data: { matchedAccount: { nameTh: 'บริษัท เพ็ญพรินติ้ง จำกัด' } } } as never)).toBe(true);
    expect(slipAccountMatched({ success: true, data: { matchedAccount: null } } as never)).toBe(false);
  });
  it('legacy: isAccountMatched boolean passthrough when matchedAccount absent', () => {
    expect(slipAccountMatched({ success: true, data: { isAccountMatched: true } })).toBe(true);
    expect(slipAccountMatched({ success: true, data: { isAccountMatched: false } })).toBe(false);
  });
  it('neither field / no data → null (check not performed — never a mismatch)', () => {
    expect(slipAccountMatched({ success: true, data: { isDuplicate: false } })).toBeNull();
    expect(slipAccountMatched({ success: false })).toBeNull();
  });
});

describe('SLIP_PREFILTER_PROMPT (2026-07-23 incident pins)', () => {
  it('memo/theme immunity — a slip whose memo says "sticker" must not be judged by it (prod drop, slip_checks id 424)', () => {
    expect(SLIP_PREFILTER_PROMPT).toContain('ข้อความในช่องบันทึกช่วยจำ/memo ของสลิป (เช่นคำว่า sticker หรือชื่อสินค้า) และลายพื้นหลัง/ธีมตกแต่งของธนาคาร ไม่มีผลต่อการตัดสิน');
  });
  it('the no-list says สติกเกอร์ไลน์/รูปการ์ตูน — never the bare word สติกเกอร์ (collides with slip memo text)', () => {
    expect(SLIP_PREFILTER_PROMPT).toContain('สติกเกอร์ไลน์/รูปการ์ตูน');
    expect(SLIP_PREFILTER_PROMPT).not.toMatch(/สติกเกอร์[,)]/);
  });
  it('bill-payment slips stay explicitly in-scope', () => {
    expect(SLIP_PREFILTER_PROMPT).toContain('จ่ายบิลสำเร็จ');
  });
});

function fakeClient(replyText: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: replyText }] }) } } as never;
}

describe('isSlipImage (Haiku vision pre-filter)', () => {
  const b64 = 'iVBORw0KGgo=';
  it('passes when the model answers yes — answer captured for slip_checks', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('yes'), model: 'm' }))
      .toEqual({ pass: true, answer: 'yes' });
  });
  it('drops on an explicit English refusal ("no ...")', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('no, this is food'), model: 'm' }))
      .toEqual({ pass: false, answer: 'no, this is food' });
  });
  it('drops on an explicit Thai refusal ("ไม่ใช่..." / bare "ไม่")', async () => {
    expect((await isSlipImage(b64, 'image/png', { client: fakeClient('ไม่ใช่สลิป'), model: 'm' })).pass).toBe(false);
    expect((await isSlipImage(b64, 'image/png', { client: fakeClient('ไม่'), model: 'm' })).pass).toBe(false);
  });
  it('"ไม่แน่ใจ" (unsure) must fail-safe to PASS — 2026-07-23 incident: startsWith("ไม่") read it as a refusal and silently dropped a real slip', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('ไม่แน่ใจ'), model: 'm' }))
      .toEqual({ pass: true, answer: 'ไม่แน่ใจ' });
  });
  it('"not sure" must fail-safe to PASS — refusal needs the word "no", not the prefix', async () => {
    expect((await isSlipImage(b64, 'image/png', { client: fakeClient('not sure'), model: 'm' })).pass).toBe(true);
  });
  it('fail-safe: passes when the model call throws (better waste 1 quota than miss a slip) — answer null', async () => {
    const throwing = { messages: { create: async () => { throw new Error('boom'); } } } as never;
    expect(await isSlipImage(b64, 'image/png', { client: throwing, model: 'm' }))
      .toEqual({ pass: true, answer: null });
  });
  it('fail-safe: passes when the model returns no text blocks', async () => {
    const noText = { messages: { create: async () => ({ content: [] }) } } as never;
    expect(await isSlipImage(b64, 'image/png', { client: noText, model: 'm' }))
      .toEqual({ pass: true, answer: '' });
  });
});

import { afterEach, beforeEach, vi } from 'vitest';
import { verifyBankSlipImage, slipFailureKind } from '@/lib/ai-quote/slip';

// ── verifyBankSlipImage transport (2026-09-11 SLIP_NOT_FOUND investigation) ──
// Two things the live failure run exposed, pinned here: every reply must carry
// the transport facts (`_meta`) so slip_checks can attribute a failure without
// a repro, and only a failure a second call could answer differently may be
// retried — Thunder bills per request, so a retried SLIP_NOT_FOUND is a quota
// slot spent on a guaranteed identical answer.
describe('verifyBankSlipImage', () => {
  const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  const prevKey = process.env.THUNDER_API_KEY;

  function reply(body: unknown, init: { status?: number; charset?: string } = {}): Response {
    const charset = init.charset ? `; charset=${init.charset}` : '';
    return new Response(new TextEncoder().encode(JSON.stringify(body)), {
      status: init.status ?? 200,
      headers: { 'content-type': `application/json${charset}` },
    });
  }

  beforeEach(() => { process.env.THUNDER_API_KEY = 'test-key'; });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.THUNDER_API_KEY; else process.env.THUNDER_API_KEY = prevKey;
  });

  it('sends the multipart contract Thunder requires: field "image" + matchAccount + checkDuplicate', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => reply({ success: true, data: {} }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await verifyBankSlipImage(image, { matchAccount: true });
    const init = fetchMock.mock.calls[0][1];
    const body = init.body as FormData;
    expect(body.get('image')).toBeInstanceOf(Blob);
    expect(body.get('matchAccount')).toBe('true');
    expect(body.get('checkDuplicate')).toBe('true');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('does NOT retry SLIP_NOT_FOUND — deterministic, and a retry costs a quota slot', async () => {
    const fetchMock = vi.fn(async () => reply({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'x' } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyBankSlipImage(image);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r._meta).toEqual({ status: 200, contentType: 'application/json', attempts: 1 });
  });

  it('does NOT retry 429 — we are already over the line; another call deepens it', async () => {
    const fetchMock = vi.fn(async () => reply({ success: false, error: { code: 'quota_exceeded', message: 'x' } }, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyBankSlipImage(image);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r._meta?.status).toBe(429);
  });

  it('retries ONCE on a 5xx and reports the attempt count', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ success: false, error: { code: 'SERVER_ERROR', message: 'x' } }, { status: 503 }))
      .mockResolvedValueOnce(reply({ success: true, data: { isDuplicate: false } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyBankSlipImage(image);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.success).toBe(true);
    expect(r._meta?.attempts).toBe(2);
  });

  it('retries ONCE on a dead connection, then reports NETWORK with _meta', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNRESET'); });
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyBankSlipImage(image);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.error?.code).toBe('NETWORK');
    expect(r._meta).toEqual({ status: 0, contentType: null, attempts: 2 });
  });

  it('rebuilds the multipart body per attempt — a sent FormData has drained the blob', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ success: false }, { status: 500 }))
      .mockResolvedValueOnce(reply({ success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await verifyBankSlipImage(image);
    const [first, second] = fetchMock.mock.calls.map((c) => c[1].body as FormData);
    expect(first).not.toBe(second);
    expect(second.get('image')).toBeInstanceOf(Blob);
  });

  it('unparseable reply → INVALID_RESPONSE carrying the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 200 })));
    const r = await verifyBankSlipImage(image);
    expect(r.error).toEqual({ code: 'INVALID_RESPONSE', message: 'HTTP 200' });
    expect(r._meta?.attempts).toBe(1);
  });

  it('missing key short-circuits — never spends a request', async () => {
    delete process.env.THUNDER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyBankSlipImage(image);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.error?.code).toBe('NO_KEY');
    expect(slipFailureKind(r)).toBe('system');
  });
});

describe('slipFailureKind', () => {
  it("SLIP_NOT_FOUND is about the image, not the system (the live 2026-09-11 code)", () => {
    expect(slipFailureKind({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'x' } })).toBe('slip');
  });
  it('quota / auth / plan / transport failures are system failures', () => {
    for (const code of ['QUOTA_EXCEEDED', 'UNAUTHORIZED', 'ACCESS_DENIED', 'APPLICATION_EXPIRED', 'NETWORK', 'NO_KEY', 'INVALID_RESPONSE']) {
      expect(slipFailureKind({ success: false, error: { code, message: 'x' } })).toBe('system');
    }
  });
  it('an unknown code defaults to "slip" — conservative: assume Thunder judged the slip', () => {
    expect(slipFailureKind({ success: false, error: { code: 'BRAND_NEW', message: 'x' } })).toBe('slip');
    expect(slipFailureKind({ success: false })).toBe('slip');
  });
});
