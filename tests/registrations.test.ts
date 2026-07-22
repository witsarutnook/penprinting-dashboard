import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/postgres', () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

import {
  generateToken, loadRegistrationByGroup, loadRegistrationByToken,
  listRegistrations, createRegistration, deleteRegistration, listDistinctCustomers,
} from '@/lib/registrations';

beforeEach(() => sqlMock.mockReset());

const dbRow = {
  id: 5, customers: ['บ.เอ', 'เอ จำกัด'], line_group_id: 'G1',
  web_token: 'tok_abc', note: null, created_at: '2026-07-01T00:00:00Z', created_by: 'admin:dashboard',
};

describe('registrations', () => {
  it('generateToken returns a url-safe ~24-char string', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(generateToken()).not.toBe(t); // random
  });

  it('loadRegistrationByGroup maps a row', async () => {
    sqlMock.mockResolvedValue({ rows: [dbRow] });
    expect(await loadRegistrationByGroup('G1')).toMatchObject({ id: 5, customers: ['บ.เอ', 'เอ จำกัด'], lineGroupId: 'G1', webToken: 'tok_abc' });
  });

  it('loadRegistrationByGroup returns null when not found', async () => {
    sqlMock.mockResolvedValue({ rows: [] });
    expect(await loadRegistrationByGroup('Gx')).toBeNull();
  });

  it('loadRegistrationByToken maps a row', async () => {
    sqlMock.mockResolvedValue({ rows: [dbRow] });
    expect(await loadRegistrationByToken('tok_abc')).toMatchObject({ webToken: 'tok_abc' });
  });

  it('createRegistration trims/filters customers and returns the mapped row', async () => {
    sqlMock.mockResolvedValue({ rows: [dbRow] });
    const reg = await createRegistration({ customers: ['  บ.เอ ', '', 'เอ จำกัด'], lineGroupId: 'G1', createdBy: 'admin:dashboard' });
    expect(reg).toMatchObject({ id: 5, lineGroupId: 'G1' });
    // the customers array passed to sql was trimmed + empty-filtered
    const callArgs = sqlMock.mock.calls[0];
    expect(callArgs).toContainEqual(['บ.เอ', 'เอ จำกัด']);
  });

  it('listRegistrations maps all rows', async () => {
    sqlMock.mockResolvedValue({ rows: [dbRow, { ...dbRow, id: 6 }] });
    expect((await listRegistrations()).map((r) => r.id)).toEqual([5, 6]);
  });

  it('deleteRegistration issues a delete', async () => {
    sqlMock.mockResolvedValue({ rows: [] });
    await deleteRegistration(5);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('listDistinctCustomers returns the customer column', async () => {
    sqlMock.mockResolvedValue({ rows: [{ c: 'บ.เอ' }, { c: 'บ.บี' }] });
    expect(await listDistinctCustomers()).toEqual(['บ.เอ', 'บ.บี']);
  });

  it('listDistinctCustomers reads the plain customer column, never the raw JSONB', async () => {
    // L-misc (audit 2026-07-21): raw->>'customer' detoasts every order's
    // full JSONB just to list names — the slim `customer` column carries
    // the same value (writers keep it in sync; findDuplicateOrders already
    // relies on it).
    sqlMock.mockResolvedValue({ rows: [] });
    await listDistinctCustomers();
    const text = (sqlMock.mock.calls[0][0] as string[]).join('?');
    expect(text).not.toContain('raw');
    expect(text).toContain('customer');
  });
});
