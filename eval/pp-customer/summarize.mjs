// eval/pp-customer/summarize.mjs — numbers the lite report does not show: per-variant
// pass rates with Wald CIs, per-metric and per-group rates, paired per-case delta
// vs baseline, cost derived from each row's model × usage (+ judge), latency.
//   node eval/pp-customer/summarize.mjs [.claude/hillclimb/pp-customer]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const flow = process.argv[2] ?? '.claude/hillclimb/pp-customer';
// $/MTok — Claude API first-party list prices (claude-api skill, cached 2026-10-06).
// cache read = 0.1× input (Fable: $0.25), cache write = 1.25× input.
const PRICE = {
  'claude-sonnet-5-5': { in: 2, out: 10, cr: 0.2, cw: 2.5 },
  'claude-opus-5-5': { in: 4, out: 20, cr: 0.4, cw: 5 },
  'claude-fable-5-1': { in: 10, out: 50, cr: 0.25, cw: 12.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cr: 0.01, cw: 0.125 },
};
const cost = (m, u) => { const p = PRICE[m]; if (!p || !u) return 0; return ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.cr + (u.cache_creation_input_tokens ?? 0) * p.cw) / 1e6; };
const readRows = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const ci = (rate, n) => { const h = 1.96 * Math.sqrt(Math.max(rate * (1 - rate), 1e-9) / n); return `${pct(Math.max(0, rate - h))}–${pct(Math.min(1, rate + h))}`; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };

const variants = readdirSync(flow).filter((d) => /^(baseline|v\d+)$/.test(d) && existsSync(join(flow, d, 'results.jsonl'))).sort((a, b) => (a === 'baseline' ? -1 : b === 'baseline' ? 1 : a.localeCompare(b, undefined, { numeric: true })));
const state = existsSync(join(flow, '_state.json')) ? JSON.parse(readFileSync(join(flow, '_state.json'), 'utf8')) : {};
const metricIds = (state.metrics ?? []).map((m) => m.id);
const per = {};
for (const v of variants) {
  const rows = readRows(join(flow, v, 'results.jsonl'));
  const errs = readRows(join(flow, v, 'errors.jsonl'));
  const ok = rows.filter((r) => r.status === 'ok');
  const models = [...new Set(rows.map((r) => r.model))];
  const appCost = rows.reduce((s, r) => s + cost(r.model, r.usage), 0);
  const judgeCost = rows.reduce((s, r) => s + cost(r.judge_model, r.judge_usage), 0);
  const byCase = {};
  for (const r of ok) (byCase[r.prompt_id] ??= []).push(r);
  const caseMean = (id, m) => { const rs = byCase[id]; return rs.reduce((s, r) => s + (r.grade?.[m] ?? 0), 0) / rs.length; };
  per[v] = { rows, ok, errs, models, appCost, judgeCost, byCase, caseMean };
  console.log(`\n═══ ${v} — ${models.join(',')} · ${rows.length} rows (${ok.length} ok, ${rows.length - ok.length} truncated) · ${errs.length} errors · cases ${Object.keys(byCase).length}`);
  console.log(`   cost: app $${appCost.toFixed(3)} + judge $${judgeCost.toFixed(3)} = $${(appCost + judgeCost).toFixed(3)} → $${((appCost + judgeCost) / Math.max(1, rows.length)).toFixed(4)}/row · app only $${(appCost / Math.max(1, rows.length)).toFixed(4)}/row`);
  const lat = ok.map((r) => r.latency_s);
  console.log(`   latency: median ${median(lat).toFixed(1)}s · p90 ${q(lat, 0.9).toFixed(1)}s · max ${Math.max(...lat).toFixed(1)}s · tool calls/turn ${(ok.reduce((s, r) => s + (r.tool_calls ?? 0), 0) / ok.length).toFixed(2)} · chars ${median(ok.map((r) => r.out_chars)).toFixed(0)} · lines ${median(ok.map((r) => r.out_lines)).toFixed(1)}`);
  const cacheR = rows.reduce((s, r) => s + (r.usage?.cache_read_input_tokens ?? 0), 0), cacheW = rows.reduce((s, r) => s + (r.usage?.cache_creation_input_tokens ?? 0), 0);
  console.log(`   app cache: read ${cacheR} · write ${cacheW} tokens (${pct(cacheR / Math.max(1, cacheR + cacheW))} read share)`);
  console.log('   metrics (rep-level rate, 95% CI):');
  for (const m of metricIds) { const vals = ok.map((r) => r.grade?.[m]).filter((x) => x != null); if (!vals.length) continue; const rate = vals.reduce((s, x) => s + x, 0) / vals.length; console.log(`     ${m.padEnd(15)} ${pct(rate).padStart(6)}  (${vals.reduce((s, x) => s + x, 0)}/${vals.length})  CI ${ci(rate, vals.length)}`); }
  const groups = {};
  for (const r of ok) (groups[r.tags?.[0] ?? '?'] ??= []).push(r.grade?.pass ?? 0);
  console.log('   pass by group: ' + Object.entries(groups).map(([g, a]) => `${g} ${pct(a.reduce((s, x) => s + x, 0) / a.length)} (${a.length})`).join(' · '));
  const failing = Object.entries(byCase).filter(([, rs]) => rs.some((r) => !r.grade?.pass)).map(([id, rs]) => `${id}${rs.every((r) => !r.grade?.pass) ? '' : '(1/2)'}`);
  console.log(`   cases with any failing rep (${failing.length}): ${failing.join(', ') || 'none'}`);
}
// paired deltas vs baseline
if (variants.length > 1 && per.baseline) {
  for (const v of variants.filter((x) => x !== 'baseline')) {
    const ids = Object.keys(per.baseline.byCase).filter((id) => per[v].byCase[id]);
    console.log(`\n═══ paired ${v} − baseline over ${ids.length} cases (mean of reps per case):`);
    for (const m of metricIds) {
      const d = ids.map((id) => per[v].caseMean(id, m) - per.baseline.caseMean(id, m));
      const mean = d.reduce((s, x) => s + x, 0) / d.length;
      const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, d.length - 1));
      const h = 1.96 * sd / Math.sqrt(d.length);
      const sig = mean - h > 0 || mean + h < 0;
      console.log(`     ${m.padEnd(15)} ${(mean >= 0 ? '+' : '') + (100 * mean).toFixed(1)} pts  CI [${(100 * (mean - h)).toFixed(1)}, ${(100 * (mean + h)).toFixed(1)}] ${sig ? '← significant' : '(within noise)'}`);
    }
    const better = ids.filter((id) => per[v].caseMean(id, 'pass') > per.baseline.caseMean(id, 'pass'));
    const worse = ids.filter((id) => per[v].caseMean(id, 'pass') < per.baseline.caseMean(id, 'pass'));
    console.log(`     pass: ${v} better on ${better.length} [${better.join(', ')}] · worse on ${worse.length} [${worse.join(', ')}]`);
    const costRatio = (per[v].appCost / per[v].rows.length) / (per.baseline.appCost / per.baseline.rows.length);
    const latRatio = median(per[v].ok.map((r) => r.latency_s)) / median(per.baseline.ok.map((r) => r.latency_s));
    console.log(`     app cost ×${costRatio.toFixed(2)} · median latency ×${latRatio.toFixed(2)}`);
  }
}
