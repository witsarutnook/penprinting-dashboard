// lib/registrations.ts
// Bind a customer identity (LINE group id and/or a web token) to a set of
// customer-name strings that match orders.raw->>'customer'. Admin-managed.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/postgres';

export interface Registration {
  id: number;
  customers: string[];
  lineGroupId: string | null;
  webToken: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

function rowToReg(r: Record<string, unknown>): Registration {
  return {
    id: Number(r.id),
    customers: (r.customers as string[]) ?? [],
    lineGroupId: (r.line_group_id as string | null) ?? null,
    webToken: String(r.web_token),
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at),
    createdBy: (r.created_by as string | null) ?? null,
  };
}

/** 144-bit url-safe token (24 base64url chars) — unguessable web link secret. */
export function generateToken(): string {
  return randomBytes(18).toString('base64url');
}

export async function loadRegistrationByGroup(groupId: string): Promise<Registration | null> {
  const { rows } = await sql`SELECT * FROM customer_registrations WHERE line_group_id = ${groupId} LIMIT 1`;
  return rows[0] ? rowToReg(rows[0]) : null;
}

export async function loadRegistrationByToken(token: string): Promise<Registration | null> {
  const { rows } = await sql`SELECT * FROM customer_registrations WHERE web_token = ${token} LIMIT 1`;
  return rows[0] ? rowToReg(rows[0]) : null;
}

export async function listRegistrations(): Promise<Registration[]> {
  const { rows } = await sql`SELECT * FROM customer_registrations ORDER BY created_at DESC`;
  return rows.map(rowToReg);
}

export async function createRegistration(input: {
  customers: string[];
  lineGroupId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}): Promise<Registration> {
  const token = generateToken();
  const customers = input.customers.map((c) => c.trim()).filter(Boolean);
  const { rows } = await sql`
    INSERT INTO customer_registrations (customers, line_group_id, web_token, note, created_by)
    VALUES (${customers as unknown as string}, ${input.lineGroupId || null}, ${token}, ${input.note ?? null}, ${input.createdBy ?? null})
    RETURNING *`;
  return rowToReg(rows[0]);
}

export async function deleteRegistration(id: number): Promise<void> {
  await sql`DELETE FROM customer_registrations WHERE id = ${id}`;
}

export async function listDistinctCustomers(): Promise<string[]> {
  // Read the slim `customer` column, not raw->>'customer' — the JSONB path
  // detoasted every order's full raw blob just to list names (audit L-misc
  // 2026-07-21). Writers keep the column in sync (findDuplicateOrders
  // already depends on it). Same DISTINCT TRIM semantics as before.
  const { rows } = await sql<{ c: string }>`
    SELECT DISTINCT TRIM(customer) AS c
    FROM orders
    WHERE TRIM(COALESCE(customer, '')) <> ''
    ORDER BY c`;
  return rows.map((r) => r.c);
}
