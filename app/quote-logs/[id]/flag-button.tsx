'use client';
// ปุ่ม 🚩 tag "AI ตอบผิด" บนบับเบิล assistant — POST/DELETE /api/ai-quote/flags
// low-frequency admin action → ไม่ทำ optimistic UI, refresh หลังสำเร็จพอ
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function FlagButton({
  sessionId,
  turnIndex,
  flagged,
  note,
}: {
  sessionId: number;
  turnIndex: number;
  flagged: boolean;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = (method: 'POST' | 'DELETE') =>
    start(async () => {
      const res = await fetch('/api/ai-quote/flags', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          method === 'POST' ? { sessionId, turnIndex, note: draft } : { sessionId, turnIndex },
        ),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? 'เกิดข้อผิดพลาด');
        return;
      }
      setOpen(false);
      setDraft('');
      router.refresh();
    });

  if (flagged) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`ลบ tag "ตอบผิด" ของข้อความนี้?${note ? `\nโน้ต: ${note}` : ''}`)) submit('DELETE');
        }}
        className="text-red-600 hover:text-red-800 disabled:opacity-50"
        title="ลบ tag ตอบผิด"
      >
        🚩 tag แล้ว — ลบ
      </button>
    );
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-stone-300 hover:text-red-500"
        title="tag ว่า AI ตอบผิด"
      >
        🚩
      </button>
      {open && (
        <div className="absolute right-0 bottom-6 z-30 w-64 rounded-lg border border-stone-200 bg-white p-2 shadow-lg space-y-2 text-left">
          <p className="text-[11px] font-medium text-stone-600">tag ว่า AI ตอบผิด — ผิดยังไง?</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="เช่น ราคาผิด / แปลสเปกผิด / ไม่ควร escalate (ใส่หรือไม่ใส่ก็ได้)"
            className="w-full rounded border border-stone-200 px-2 py-1 text-xs"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-[11px] text-stone-400 hover:text-stone-600">
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => submit('POST')}
              className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? 'กำลังบันทึก…' : '🚩 Tag'}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
