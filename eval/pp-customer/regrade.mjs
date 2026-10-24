// eval/pp-customer/regrade.mjs — re-score the HARD metrics of existing rows from
// their saved traces after a label/grader fix, without re-running the model
// (judge metrics and usage are kept). Applied identically to every variant so
// a comparison stays fair; note the fix in change.md / NEXT-SESSION.
//   node --import tsx --conditions=react-server eval/pp-customer/regrade.mjs <flow> <variant> [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeHard } from './impl.mjs';

const [,, flow, variant, writeFlag] = process.argv;
if (!flow || !variant) { console.error('usage: regrade.mjs <flow> <variant> [--write]'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const cases = Object.fromEntries(JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).map((c) => [c.id, c]));
const resultsPath = join(flow, variant, 'results.jsonl');
const rows = readFileSync(resultsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const HARD = ['pass', 'outcome', 'tool_spec', 'prices', 'format', 'asks', 'refused'];
let changed = 0, passBefore = 0, passAfter = 0;
const out = rows.map((r) => {
  const c = cases[r.prompt_id]; if (!c) { console.error(`no case for ${r.prompt_id}`); return r; }
  const t = JSON.parse(readFileSync(join(flow, variant, 'traces', `${r.prompt_id}_rep${r.rep}.json`), 'utf8'));
  // Reconstruct the run from the trace: reply = final assistant turn; tool
  // calls/results pair up in order (the recorder wrote result right after call).
  const computeCalls = [], quotes = [], priceTables = [];
  for (let i = 0; i < t.length; i++) {
    const x = t[i]; if (x.role !== 'tool_call') continue;
    const input = JSON.parse(x.content); const res = t[i + 1]?.role === 'tool_result' ? t[i + 1] : null;
    if (x.name === 'compute_quote') {
      computeCalls.push(input);
      if (res && !res.content.endsWith('[is_error]')) { try { quotes.push({ productType: input.productType, spec: input.spec, result: JSON.parse(res.content) }); } catch {} }
    } else if (x.name === 'send_price_table' && res && !res.content.endsWith('[is_error]')) {
      if (!priceTables.includes(input.table)) priceTables.push(input.table);
    }
  }
  const run = { reply: t.at(-1).content, quotes, priceTables, computeCalls, refused: r.stop_reason === 'refusal' };
  const g = gradeHard(c, run);
  const before = r.grade.pass; passBefore += before; passAfter += g.grade.pass;
  const diff = HARD.filter((k) => r.grade[k] !== g.grade[k]);
  if (diff.length) { changed++; console.log(`${r.prompt_id} rep${r.rep}: ${diff.map((k) => `${k} ${r.grade[k]}→${g.grade[k]}`).join(', ')}`); }
  return { ...r, grade: { ...r.grade, ...g.grade }, explanation: { ...(r.explanation ?? {}), ...g.explanation } };
});
console.log(`${variant}: ${changed} row(s) changed · pass ${passBefore}/${rows.length} → ${passAfter}/${rows.length}`);
if (writeFlag === '--write') { writeFileSync(resultsPath, out.map((r) => JSON.stringify(r)).join('\n') + '\n'); console.log(`wrote ${resultsPath}`); }
else console.log('(dry run — pass --write to apply)');
