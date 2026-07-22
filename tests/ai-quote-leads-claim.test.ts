import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * L-leadclaim-body-owner (audit 2026-07-21): PATCH /api/ai-quote/leads/[id]
 * used to claim with `body.assignedTo` verbatim — any caller could claim a
 * lead under someone else's name. These tests pin the fix: the body field is
 * only the *intent* signal ("หยิบงาน"); the recorded owner always comes from
 * the verified session (same server-authoritative rule as reassign 38c6593).
 */

const claimMock = vi.fn();
const updateMock = vi.fn();
const releaseMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('@/lib/ai-quote/db', () => ({
  claimLead: (...a: unknown[]) => claimMock(...a),
  updateLead: (...a: unknown[]) => updateMock(...a),
  releaseLead: (...a: unknown[]) => releaseMock(...a),
  deleteLead: (...a: unknown[]) => deleteMock(...a),
}));

const sessionMock = vi.fn();
vi.mock('@/lib/route-helpers', () => ({
  requireSession: (...a: unknown[]) => sessionMock(...a),
}));

import { PATCH } from '@/app/api/ai-quote/leads/[id]/route';

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/ai-quote/leads/7', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: '7' }) };

describe('PATCH /api/ai-quote/leads/[id] — claim owner', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ role: 'sales', user: 'สมชาย' });
    claimMock.mockResolvedValue(true);
    updateMock.mockResolvedValue(undefined);
  });

  it('claims under the session user, never the client-supplied name', async () => {
    const res = await PATCH(mkReq({ assignedTo: 'ปลอม' }) as never, params);

    expect(res.status).toBe(200);
    expect(claimMock).toHaveBeenCalledWith(7, 'สมชาย');
  });

  it('still returns 409 when someone already holds the lead', async () => {
    claimMock.mockResolvedValue(false);

    const res = await PATCH(mkReq({ assignedTo: 'สมชาย' }) as never, params);

    expect(res.status).toBe(409);
  });

  it('does not claim when body has no assignedTo (status-only update)', async () => {
    const res = await PATCH(mkReq({ leadStatus: 'กำลังติดตาม' }) as never, params);

    expect(res.status).toBe(200);
    expect(claimMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(7, expect.objectContaining({ leadStatus: 'กำลังติดตาม' }));
  });
});
