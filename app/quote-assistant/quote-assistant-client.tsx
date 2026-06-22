'use client';

import { useEffect, useRef, useState } from 'react';
import { IconSparkles, IconCopy, IconCheck } from '@/lib/icons';
import type { AiQuote, AiQuoteResponse, ConversationTurn } from '@/lib/ai-quote/types';

const PRODUCT_LABEL: Record<string, string> = {
  brochure: 'โบรชัวร์/ใบปลิว',
  book: 'หนังสือ',
  notebook: 'สมุด',
};
const MODE_LABEL: Record<string, string> = { offset: 'ออฟเซ็ต', digital: 'ดิจิทัล' };

const PRICE_NOTE = 'ราคานี้ยังไม่รวม VAT 7% · ราคาประเมินเบื้องต้น ทีมขายยืนยันอีกครั้ง';

export function QuoteAssistantClient() {
  const [messages, setMessages] = useState<ConversationTurn[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastQuotes, setLastQuotes] = useState<AiQuote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Lead-save inputs
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [leadSaved, setLeadSaved] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.text ?? '';

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    setCopied(false);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch('/api/ai-quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = (await res.json()) as AiQuoteResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `ผิดพลาด (${res.status})`);
      setSessionId(data.sessionId);
      setMessages((prev) => [...prev, { role: 'assistant', text: data.reply }]);
      setLastQuotes(data.quotes ?? []);
      setLeadSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function copyReply() {
    if (!lastAssistant) return;
    try {
      await navigator.clipboard.writeText(lastAssistant);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('คัดลอกไม่สำเร็จ');
    }
  }

  async function saveLead() {
    if (!sessionId) return;
    setError(null);
    try {
      const res = await fetch(`/api/ai-quote/leads/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leadStatus: 'กำลังติดตาม',
          customerName: customerName.trim() || undefined,
          customerContact: customerContact.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || `บันทึกไม่สำเร็จ (${res.status})`);
      }
      setLeadSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-stone-500">
        <IconSparkles size={16} className="text-accent" />
        วางข้อความที่ลูกค้าถามมา — ระบบช่วยสกัดสเปกและคิดราคา (โบรชัวร์ / หนังสือ / สมุด)
      </p>

      {/* Conversation */}
      <div
        ref={scrollRef}
        className="bg-white rounded-2xl border border-stone-200 p-4 h-[52vh] overflow-y-auto space-y-3"
      >
        {messages.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center text-stone-400 text-sm gap-2">
            <IconSparkles size={28} className="text-stone-300" />
            <p>เริ่มต้นด้วยการวางคำขอราคาของลูกค้า</p>
            <p className="text-xs text-stone-300">เช่น “โบรชัวร์ A4 4 สี 2 หน้า กระดาษ Art 160 จำนวน 1000 ใบ”</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-accent text-white rounded-br-sm'
                  : 'bg-stone-100 text-stone-800 rounded-bl-sm'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-stone-100 text-stone-500 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Price card */}
      {lastQuotes.length > 0 && (
        <div className="bg-white rounded-2xl border border-accent/30 ring-1 ring-accent/10 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-stone-900">ราคาที่คำนวณได้</h2>
          <div className="space-y-2">
            {lastQuotes.map((q, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 border-b border-stone-100 last:border-0 pb-2 last:pb-0">
                <div className="text-sm text-stone-700">
                  {PRODUCT_LABEL[q.productType] ?? q.productType}
                  {q.result?.mode && (
                    <span className="ml-2 text-xs text-stone-400">
                      ({MODE_LABEL[q.result.mode] ?? q.result.mode})
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-accent tabular-nums">
                    ≈ {q.unitPrice.toFixed(2)} <span className="text-xs font-normal text-stone-400">บาท/ชิ้น</span>
                  </div>
                  <div className="text-[11px] text-stone-400 tabular-nums">เต็ม {q.unitPrice} บาท</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-stone-500">{PRICE_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyReply}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200"
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความราคา'}
            </button>
          </div>
        </div>
      )}

      {/* Save as lead */}
      {sessionId && (
        <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-stone-900">บันทึกเป็น lead (ติดตามต่อ)</h3>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="ชื่อลูกค้า"
              className="flex-1 min-w-[8rem] px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <input
              type="text"
              value={customerContact}
              onChange={(e) => setCustomerContact(e.target.value)}
              placeholder="เบอร์ / LINE / ช่องทางติดต่อ"
              className="flex-1 min-w-[8rem] px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              type="button"
              onClick={saveLead}
              disabled={leadSaved}
              className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent-dark disabled:opacity-50"
            >
              {leadSaved ? 'บันทึกแล้ว ✓' : 'บันทึกเป็น lead'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="วางคำขอของลูกค้า… (Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่)"
          disabled={loading}
          className="flex-1 px-3 py-2 border border-stone-200 rounded-xl text-sm resize-none bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-stone-50"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-dark disabled:opacity-50"
        >
          ส่ง
        </button>
      </div>
    </div>
  );
}
