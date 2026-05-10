'use client';

import { useState } from 'react';

/**
 * Bench harness — fires N requests to each endpoint sequentially,
 * measures wall-clock latency, computes summary stats.
 *
 * Why sequential not parallel: parallel would benchmark Vercel's request
 * concurrency rather than per-call latency. Sequential gives the steady-
 * state per-request cost which is what users actually experience.
 *
 * Warmup: 1 throwaway hit to each endpoint so we don't measure cold-start
 * Apps Script (it spins up after ~5-15 min idle and the first hit pays
 * 1-3s extra). We want sustained-load numbers.
 */

type Sample = { ms: number; ok: boolean; status?: number; error?: string; entries?: number };

interface Result {
  label: string;
  url: string;
  warmup: Sample;
  samples: Sample[];
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  errCount: number;
  entriesAvg: number;
}

function summarize(label: string, url: string, warmup: Sample, samples: Sample[]): Result {
  const goodMs = samples.filter(s => s.ok).map(s => s.ms).sort((a, b) => a - b);
  const goodEntries = samples.filter(s => s.ok && typeof s.entries === 'number').map(s => s.entries as number);
  const sum = goodMs.reduce((a, b) => a + b, 0);
  const avg = goodMs.length > 0 ? sum / goodMs.length : 0;
  const p = (q: number) => goodMs.length > 0 ? goodMs[Math.min(goodMs.length - 1, Math.floor(goodMs.length * q))] : 0;
  return {
    label,
    url,
    warmup,
    samples,
    avg,
    min: goodMs[0] || 0,
    max: goodMs[goodMs.length - 1] || 0,
    p50: p(0.5),
    p95: p(0.95),
    errCount: samples.length - goodMs.length,
    entriesAvg: goodEntries.length > 0 ? goodEntries.reduce((a, b) => a + b, 0) / goodEntries.length : 0,
  };
}

async function timedFetch(url: string): Promise<Sample> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const ms = performance.now() - t0;
    if (!res.ok) return { ms, ok: false, status: res.status };
    const data = (await res.json()) as { entries?: unknown[]; error?: string };
    if (data.error) return { ms, ok: false, status: res.status, error: data.error };
    return { ms, ok: true, status: res.status, entries: Array.isArray(data.entries) ? data.entries.length : 0 };
  } catch (err) {
    return { ms: performance.now() - t0, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function BenchClient({ defaultTargetId }: { defaultTargetId: string }) {
  const [targetIdInput, setTargetIdInput] = useState(defaultTargetId);
  const [paramKind, setParamKind] = useState<'orderId' | 'jobId'>('orderId');
  const [runs, setRuns] = useState(10);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ sheet: Result; postgres: Result } | null>(null);
  const [progress, setProgress] = useState<string>('');

  async function runBench() {
    if (!targetIdInput.trim()) return;
    setRunning(true);
    setResults(null);

    const sheetUrl = `/api/audit?${paramKind}=${encodeURIComponent(targetIdInput.trim())}`;
    const pgUrl = `/api/audit/postgres?${paramKind}=${encodeURIComponent(targetIdInput.trim())}`;

    setProgress('Warmup hits…');
    const sheetWarm = await timedFetch(sheetUrl);
    const pgWarm = await timedFetch(pgUrl);

    const sheetSamples: Sample[] = [];
    const pgSamples: Sample[] = [];

    for (let i = 0; i < runs; i++) {
      setProgress(`Sheet ${i + 1}/${runs}…`);
      sheetSamples.push(await timedFetch(sheetUrl));
    }
    for (let i = 0; i < runs; i++) {
      setProgress(`Postgres ${i + 1}/${runs}…`);
      pgSamples.push(await timedFetch(pgUrl));
    }

    setResults({
      sheet: summarize('Sheet (Apps Script)', sheetUrl, sheetWarm, sheetSamples),
      postgres: summarize('Postgres (Vercel)', pgUrl, pgWarm, pgSamples),
    });
    setProgress('');
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide">การตั้งค่า bench</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm text-stone-700">
            param
            <select
              value={paramKind}
              onChange={e => setParamKind(e.target.value as 'orderId' | 'jobId')}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm bg-white"
            >
              <option value="orderId">orderId</option>
              <option value="jobId">jobId</option>
            </select>
          </label>
          <label className="text-sm text-stone-700 sm:col-span-2">
            target id
            <input
              type="text"
              value={targetIdInput}
              onChange={e => setTargetIdInput(e.target.value)}
              placeholder="ใส่ orderId หรือ jobId ที่มีในระบบ"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="text-sm text-stone-700">
            จำนวน runs ต่อ endpoint
            <input
              type="number"
              min={3}
              max={50}
              value={runs}
              onChange={e => setRuns(Math.max(3, Math.min(50, parseInt(e.target.value) || 10)))}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm tabular-nums"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={runBench}
          disabled={running || !targetIdInput.trim()}
          className="px-4 py-2 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:bg-stone-300 disabled:cursor-not-allowed"
        >
          {running ? 'กำลัง bench…' : 'รัน benchmark'}
        </button>
        {progress && (
          <div className="text-xs text-stone-500 tabular-nums">{progress}</div>
        )}
      </div>

      {results && (
        <>
          <SummaryTable a={results.sheet} b={results.postgres} />
          <DetailGrid a={results.sheet} b={results.postgres} />
          <Verdict a={results.sheet} b={results.postgres} />
        </>
      )}
    </div>
  );
}

function SummaryTable({ a, b }: { a: Result; b: Result }) {
  const rows: { label: string; sheet: string; postgres: string; ratio: string }[] = [
    { label: 'avg', sheet: ms(a.avg), postgres: ms(b.avg), ratio: ratio(a.avg, b.avg) },
    { label: 'min', sheet: ms(a.min), postgres: ms(b.min), ratio: ratio(a.min, b.min) },
    { label: 'p50', sheet: ms(a.p50), postgres: ms(b.p50), ratio: ratio(a.p50, b.p50) },
    { label: 'p95', sheet: ms(a.p95), postgres: ms(b.p95), ratio: ratio(a.p95, b.p95) },
    { label: 'max', sheet: ms(a.max), postgres: ms(b.max), ratio: ratio(a.max, b.max) },
  ];
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-medium text-stone-900">สรุป latency</h2>
        <span className="text-xs text-stone-500 tabular-nums">
          warmup: Sheet {ms(a.warmup.ms)} · Postgres {ms(b.warmup.ms)}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2 font-medium">stat</th>
            <th className="text-right px-4 py-2 font-medium">Sheet</th>
            <th className="text-right px-4 py-2 font-medium">Postgres</th>
            <th className="text-right px-4 py-2 font-medium">×ไวขึ้น</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-t border-stone-100">
              <td className="px-4 py-2 text-stone-700 font-medium">{r.label}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.sheet}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.postgres}</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold text-stone-900">{r.ratio}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
        Errors — Sheet: {a.errCount}/{a.samples.length} · Postgres: {b.errCount}/{b.samples.length} ·
        rows returned avg — Sheet: {a.entriesAvg.toFixed(1)} · Postgres: {b.entriesAvg.toFixed(1)}
      </div>
    </div>
  );
}

function DetailGrid({ a, b }: { a: Result; b: Result }) {
  return (
    <details className="rounded-xl border border-stone-200 bg-white">
      <summary className="px-5 py-3 cursor-pointer text-sm text-stone-700 hover:bg-stone-50">
        ดูทุก sample ({a.samples.length} runs ต่อ endpoint)
      </summary>
      <div className="px-5 pb-4 grid grid-cols-2 gap-4">
        <SamplesCol label={a.label} samples={a.samples} />
        <SamplesCol label={b.label} samples={b.samples} />
      </div>
    </details>
  );
}

function SamplesCol({ label, samples }: { label: string; samples: Sample[] }) {
  return (
    <div className="text-xs">
      <div className="font-medium text-stone-700 mb-2">{label}</div>
      <ol className="space-y-1 tabular-nums">
        {samples.map((s, i) => (
          <li key={i} className={`flex justify-between gap-2 ${s.ok ? 'text-stone-700' : 'text-red-700'}`}>
            <span>{i + 1}.</span>
            <span>{ms(s.ms)}</span>
            <span className="text-stone-400 truncate max-w-[10ch]">{s.ok ? `${s.entries ?? '?'}r` : (s.error || s.status)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Verdict({ a, b }: { a: Result; b: Result }) {
  const speedup = a.p50 > 0 && b.p50 > 0 ? a.p50 / b.p50 : 0;
  let verdict: { color: string; title: string; body: string };
  if (speedup >= 10) {
    verdict = {
      color: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      title: `🟢 Postgres เร็วกว่า ${speedup.toFixed(1)}× — proceed migration`,
      body: 'PoC ผ่าน threshold (>10×). แนะนำเข้า Phase 1 (read mirror) — Vercel Postgres + Drizzle + dual-write, v2 reads ทั้งหมดไปที่ Postgres, Sheet ยังเป็น source of truth. ใช้เวลา ~1 สัปดาห์.',
    };
  } else if (speedup >= 5) {
    verdict = {
      color: 'bg-amber-50 border-amber-200 text-amber-900',
      title: `🟡 Postgres เร็วกว่า ${speedup.toFixed(1)}× — borderline`,
      body: 'PoC ผ่านแบบกลางๆ. Migration จะเห็นผล แต่ ROI ไม่สูงพอที่จะยกเลิก Apps Script ทั้งหมด. แนะนำทำ hybrid (Postgres read mirror สำหรับ /analytics + /track, Sheet สำหรับ /board + /orders) แทน full migrate.',
    };
  } else if (speedup >= 1.5) {
    verdict = {
      color: 'bg-stone-50 border-stone-200 text-stone-900',
      title: `🟠 Postgres เร็วกว่าแค่ ${speedup.toFixed(1)}× — defer`,
      body: 'PoC ไม่คุ้ม. Network bottleneck (Vercel ↔ Postgres region) อาจเป็นตัวจำกัด — ลอง check ว่า Postgres region ตรงกับ Vercel function region. ถ้าจริงๆ แค่ 1-3× ที่นี่, Migration ทั้งหมดจะได้ ~3-5× ในผู้ใช้จริง — ไม่คุ้ม risk + 4-6 weeks.',
    };
  } else {
    verdict = {
      color: 'bg-red-50 border-red-200 text-red-900',
      title: `🔴 Postgres ${speedup < 1 ? 'ช้ากว่า' : 'เท่ากัน'} — abort`,
      body: 'มีอะไรผิด — ปกติ Postgres + index ต้องเร็วกว่า Sheet เยอะ. Check: Postgres region (US? Asia?), Vercel function region, audit_log row count ใน Postgres. ถ้า region ไม่ใช่ปัญหา = ปัญหา network แปลกๆ ที่ต้อง debug ก่อนตัดสินใจ migration.',
    };
  }
  return (
    <div className={`rounded-xl border p-5 ${verdict.color}`}>
      <h3 className="font-semibold mb-2">{verdict.title}</h3>
      <p className="text-sm leading-relaxed">{verdict.body}</p>
    </div>
  );
}

function ms(n: number): string {
  return `${n.toFixed(0)}ms`;
}
function ratio(slow: number, fast: number): string {
  if (fast <= 0 || slow <= 0) return '—';
  const r = slow / fast;
  if (r >= 10) return `${r.toFixed(1)}×`;
  return `${r.toFixed(2)}×`;
}
