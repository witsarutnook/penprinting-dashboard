// eval/pp-customer/judge-negatives.mjs — known-negative check for the LLM judge
// (eval-audit §4): an empty reply, "I don't know", and a confident answer to the
// wrong question must all fail. Costs 3 judge calls (Fable 5.1). Run:
//   node --env-file=.env.eval.local --import tsx --conditions=react-server eval/pp-customer/judge-negatives.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeCase } from './impl.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
const c = cases.find((x) => x.id === 's27-t0');   // book, first turn, expected: ask pages/paper/colour
const mk = (reply) => ({ reply, quotes: [], priceTables: [], computeCalls: [], toolCalls: 0, rounds: 1, refused: false });
const negatives = [
  ['empty reply', ''],
  ['"I don\'t know"', 'ไม่ทราบค่ะ'],
  ['confident wrong-type answer (quotes namecards)', '💰 นามบัตร กล่องละ 100 ใบ → หน้าเดียว กล่องละ 150 บาท · หน้า-หลัง กล่องละ 300 บาท (ยังไม่รวม VAT 7%)\nราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ 🙏'],
  ['asks what the customer already said (qty)', 'ได้เลยค่ะ หนังสือธรรมะต้องการกี่เล่มคะ และเนื้อในกี่หน้าคะ'],
];
let bad = 0; let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
for (const [name, reply] of negatives) {
  const g = await gradeCase(c, mk(reply), null, { model: 'n/a', state: {} });
  for (const k of Object.keys(usage)) usage[k] += Number(g.judge_usage?.[k] ?? 0);
  const j = { missing: g.grade.judge_missing, concise: g.grade.judge_concise, register: g.grade.judge_register };
  const failedSomething = j.missing === 0 || j.concise === 0 || j.register === 0;
  const expectMissingFail = name.startsWith('asks what') || name.startsWith('confident');
  const ok = failedSomething && (!expectMissingFail || j.missing === 0);
  console.log(`${ok ? '✓' : '✗'} ${name} → ${JSON.stringify(j)} — ${g.explanation.judge_missing}`);
  if (!ok) bad++;
}
console.log('judge model:', (await gradeCase(c, mk('x'), null, { model: 'n/a', state: { judge: 'off' } })).judge_model ?? '(from rows above)');
console.log('judge usage total:', JSON.stringify(usage));
if (bad) { console.error(`${bad} judge negative(s) passed when they should fail`); process.exit(1); }
console.log('judge known-negatives: all failed as they should');
