'use client';
import { useEffect, useState } from 'react';

interface Registration {
  id: number;
  customers: string[];
  lineGroupId: string | null;
  webToken: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export default function RegistrationsClient() {
  const [regs, setRegs] = useState<Registration[]>([]);
  const [allCustomers, setAllCustomers] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetch('/api/registrations');
    if (r.ok) setRegs((await r.json()).registrations);
  }
  useEffect(() => {
    refresh();
    fetch('/api/registrations/customers').then(async (r) => {
      if (r.ok) setAllCustomers((await r.json()).customers);
    });
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webLink = (t: string) => `${origin}/track/c/${t}`;

  function togglePick(name: string) {
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  }

  async function create() {
    setError('');
    if (picked.length === 0) { setError('เลือกลูกค้าอย่างน้อย 1 ราย'); return; }
    setBusy(true);
    const r = await fetch('/api/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customers: picked, lineGroupId: groupId || null, note: note || null }),
    });
    setBusy(false);
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || 'บันทึกไม่สำเร็จ'); return; }
    setPicked([]); setGroupId(''); setNote(''); setSearch('');
    refresh();
  }

  async function remove(id: number) {
    if (!confirm('ลบการลงทะเบียนนี้? ลิงก์ web เดิมจะใช้ไม่ได้ทันที')) return;
    const r = await fetch(`/api/registrations/${id}`, { method: 'DELETE' });
    if (r.ok) refresh();
  }

  const filtered = allCustomers.filter((c) => c.toLowerCase().includes(search.toLowerCase())).slice(0, 50);

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="text-xl font-bold mb-4">ลงทะเบียนลูกค้า (Track)</h1>

      <section className="rounded-lg border border-gray-200 p-4 mb-6">
        <h2 className="font-semibold mb-2">เพิ่มการลงทะเบียน</h2>

        <label className="block text-sm text-gray-500 mb-1">Group ID (จาก /groupid ในกลุ่ม — เว้นว่างได้ถ้าใช้แค่ลิงก์ web)</label>
        <input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="C1234abcd..." className="w-full border rounded px-2 py-1 mb-3" />

        <label className="block text-sm text-gray-500 mb-1">เลือกชื่อลูกค้า (เลือกได้หลายชื่อที่เป็นลูกค้าเดียวกัน)</label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นชื่อลูกค้า..." className="w-full border rounded px-2 py-1 mb-2" />
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {picked.map((c) => (
              <button key={c} onClick={() => togglePick(c)} className="text-xs bg-[#c8553d] text-white rounded-full px-2 py-1">{c} ✕</button>
            ))}
          </div>
        )}
        <div className="max-h-48 overflow-y-auto border rounded mb-3">
          {filtered.map((c) => (
            <button key={c} onClick={() => togglePick(c)} className={`block w-full text-left px-2 py-1 text-sm hover:bg-gray-50 ${picked.includes(c) ? 'bg-orange-50' : ''}`}>
              {picked.includes(c) ? '✓ ' : ''}{c}
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-gray-400 p-2">ไม่พบชื่อลูกค้า</p>}
        </div>

        <label className="block text-sm text-gray-500 mb-1">โน้ต (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded px-2 py-1 mb-3" />

        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <button onClick={create} disabled={busy} className="bg-[#c8553d] text-white rounded px-4 py-2 disabled:opacity-50">
          {busy ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </section>

      <section>
        <h2 className="font-semibold mb-2">รายการที่ลงทะเบียน ({regs.length})</h2>
        <div className="space-y-2">
          {regs.map((r) => (
            <div key={r.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{r.customers.join(', ')}</div>
                  <div className="text-xs text-gray-500">Group: {r.lineGroupId || '—'}</div>
                  <button onClick={() => navigator.clipboard.writeText(webLink(r.webToken))} className="text-xs text-blue-600 underline mt-1 break-all text-left">
                    คัดลอกลิงก์: {webLink(r.webToken)}
                  </button>
                </div>
                <button onClick={() => remove(r.id)} className="text-sm text-red-600 shrink-0">ลบ</button>
              </div>
            </div>
          ))}
          {regs.length === 0 && <p className="text-sm text-gray-400">ยังไม่มีการลงทะเบียน</p>}
        </div>
      </section>
    </main>
  );
}
