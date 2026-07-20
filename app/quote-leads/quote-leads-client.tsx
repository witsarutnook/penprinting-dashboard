'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { displayDateTime } from '@/lib/jobs';
import { useConfirm } from '@/components/confirm-provider';
import { IconTrash } from '@/lib/icons';
import type { LeadRow, LeadStatus } from '@/lib/ai-quote/types';

const STATUSES: LeadStatus[] = ['ใหม่', 'กำลังติดตาม', 'ปิดการขาย', 'ไม่สนใจ', 'escalated', 'abandoned'];

// Thai display labels for the two enum values that are stored in English
// (audit M3 — "escalated" leads need to read as "ต้องประเมินเอง" so the
// sales team can tell hand-off leads apart from fresh ones at a glance).
const STATUS_LABEL: Record<LeadStatus, string> = {
  'ใหม่': 'ใหม่',
  'กำลังติดตาม': 'กำลังติดตาม',
  'ปิดการขาย': 'ปิดการขาย',
  'ไม่สนใจ': 'ไม่สนใจ',
  'escalated': 'ต้องประเมินเอง',
  'abandoned': 'ถูกทิ้ง',
};

// Colour-code the status select by its current value (board-style tints).
const STATUS_CLASS: Record<LeadStatus, string> = {
  'ใหม่': 'bg-sky-50 text-sky-700 border-sky-200',
  'กำลังติดตาม': 'bg-amber-50 text-amber-700 border-amber-200',
  'ปิดการขาย': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'ไม่สนใจ': 'bg-stone-100 text-stone-500 border-stone-200',
  'escalated': 'bg-orange-50 text-orange-700 border-orange-200',
  'abandoned': 'bg-stone-100 text-stone-400 border-stone-200',
};

export function QuoteLeadsClient({ currentUser, currentRole }: { currentUser: string; currentRole: string }) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirm();
  const isAdmin = currentRole === 'admin';
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const colSpan = isAdmin ? 8 : 7;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-quote/leads', { cache: 'no-store' });
      const data = (await res.json()) as { leads?: LeadRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || `โหลดไม่สำเร็จ (${res.status})`);
      setLeads(data.leads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    const res = await fetch(`/api/ai-quote/leads/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error || `อัปเดตไม่สำเร็จ (${res.status})`);
    }
  }

  async function onStatusChange(id: number, leadStatus: LeadStatus) {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, leadStatus } : l)));
    try {
      await patch(id, { leadStatus });
    } catch (err) {
      setLeads(prev); // rollback
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onClaim(id: number) {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, assignedTo: currentUser } : l)));
    try {
      await patch(id, { assignedTo: currentUser });
    } catch (err) {
      setLeads(prev);
      setError(err instanceof Error ? err.message : String(err));
      void load(); // 409 = someone else claimed it — refresh to show the real owner
    }
  }

  async function onRelease(id: number) {
    const ok = await confirm({
      title: 'คืนงานนี้?',
      message: 'lead จะกลับเป็น "ว่าง" ให้คนอื่นหยิบได้',
      okLabel: 'คืนงาน',
      cancelLabel: 'ยกเลิก',
    });
    if (!ok) return;
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, assignedTo: null } : l))); // optimistic
    try {
      await patch(id, { release: true });
    } catch (err) {
      setLeads(prev);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete(id: number) {
    const ok = await confirm({
      title: `ลบ lead #${id}?`,
      message: 'ลบถาวร กู้คืนไม่ได้ — รวมราคาที่คิดไว้ในนี้ทั้งหมด',
      variant: 'danger',
      okLabel: 'ลบ',
      cancelLabel: 'ยกเลิก',
    });
    if (!ok) return;
    const prev = leads;
    setLeads((ls) => ls.filter((l) => l.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/ai-quote/leads/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || `ลบไม่สำเร็จ (${res.status})`);
      }
    } catch (err) {
      setLeads(prev); // rollback
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 text-sm text-stone-400">กำลังโหลด…</div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 text-sm text-stone-400">
          ยังไม่มี lead — บันทึกจากหน้า “ผู้ช่วยตีราคา (AI)” แล้วจะมาแสดงที่นี่
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100 text-left text-[11px] uppercase tracking-wide text-stone-400">
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">ลูกค้า</th>
                  <th className="px-3 py-2.5 font-medium">ข้อความล่าสุด</th>
                  <th className="px-3 py-2.5 font-medium text-center">quote</th>
                  <th className="px-3 py-2.5 font-medium">สถานะ</th>
                  <th className="px-3 py-2.5 font-medium">ผู้ดูแล</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">อัปเดต</th>
                  {isAdmin && <th className="px-3 py-2.5 font-medium" aria-label="ลบ" />}
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <Fragment key={l.id}>
                  <tr className="border-b border-stone-50 last:border-0 hover:bg-stone-50/50">
                    <td className="px-3 py-2.5 tabular-nums text-stone-400">{l.id}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-stone-800">{l.customerName || '—'}</span>
                        {l.leadStatus === 'escalated' && (
                          <span className="inline-flex items-center rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 ring-1 ring-orange-200">
                            ⚠ ต้องประเมินเอง
                          </span>
                        )}
                        {l.channel === 'line' && (
                          <span className="inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                            LINE
                          </span>
                        )}
                        {l.channel === 'messenger' && (
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200">
                            Messenger
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-stone-400">{l.customerContact || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5 max-w-[18rem]">
                      <button
                        type="button"
                        onClick={() => setExpandedId((cur) => (cur === l.id ? null : l.id))}
                        className="text-left text-stone-600 hover:text-accent w-full truncate"
                        title="กดเพื่อดูบทสนทนาทั้งหมด"
                      >
                        {l.conversation.length > 0 ? (expandedId === l.id ? '▾ ' : '▸ ') : ''}
                        {l.lastMessage || '—'}
                      </button>
                      {isAdmin && (
                        <Link
                          href={`/quote-logs/${l.id}`}
                          className="text-[11px] text-stone-400 underline hover:text-stone-600"
                        >
                          ดูบทสนทนาเต็ม →
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-stone-500">{l.quoteCount}</td>
                    <td className="px-3 py-2.5">
                      <select
                        value={l.leadStatus}
                        onChange={(e) => void onStatusChange(l.id, e.target.value as LeadStatus)}
                        className={`px-2 py-1 rounded-lg border text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent/20 ${STATUS_CLASS[l.leadStatus] ?? 'bg-white border-stone-200'}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      {l.assignedTo ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-stone-700">{l.assignedTo}</span>
                          {(isAdmin || l.assignedTo === currentUser) && (
                            <button
                              type="button"
                              onClick={() => void onRelease(l.id)}
                              className="text-[11px] text-stone-400 hover:text-red-600"
                              title="คืนงาน (ปล่อยให้คนอื่นหยิบได้)"
                            >
                              คืน
                            </button>
                          )}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void onClaim(l.id)}
                          className="px-2.5 py-1 rounded-lg bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20"
                        >
                          หยิบงาน
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-stone-400 tabular-nums">
                      {displayDateTime(l.updatedAt)}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void onDelete(l.id)}
                          aria-label={`ลบ lead ${l.id}`}
                          className="p-1.5 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <IconTrash size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                  {expandedId === l.id && (
                    <tr className="bg-stone-50/60">
                      <td colSpan={colSpan} className="px-3 pb-3 pt-0">
                        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 max-h-80 overflow-y-auto">
                          {l.conversation.length === 0 ? (
                            <div className="text-xs text-stone-400">ไม่มีบทสนทนา</div>
                          ) : (
                            l.conversation.map((m, i) => (
                              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div
                                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap break-words ${
                                    m.role === 'user' ? 'bg-accent text-white rounded-br-sm' : 'bg-stone-100 text-stone-800 rounded-bl-sm'
                                  }`}
                                >
                                  {m.text}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
