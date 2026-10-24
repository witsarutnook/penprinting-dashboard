// eval/pp-customer/build-candidates.mjs — turn the one-shot export
// (GET /api/admin/quote-log-export) into candidate cases: one per customer
// turn, with the real conversation prefix as history. Labelling (expected) is
// done by hand afterwards; this only slices + annotates for triage.
//   node eval/pp-customer/build-candidates.mjs <export.json> <out-candidates.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: build-candidates.mjs <export.json> <out.json>'); process.exit(2); }
const data = JSON.parse(readFileSync(inPath, 'utf8'));

const PRODUCT = [
  ['namecard', /นามบัตร/],
  ['pvccard', /pvc|พีวีซี|บัตรพลาสติก|บัตรแข็ง/i],
  ['calendar', /ปฏิทิน/],
  ['notebook', /สมุด/],
  ['book', /หนังสือ|เล่ม|วารสาร|รายงาน/],
  ['brochure', /โบรชัวร์|ใบปลิว|แผ่นพับ|โปสเตอร์|แผ่น|a4|a5|a3/i],
  ['out-of-scope', /กล่อง|ถุง|สติกเกอร์|โปสการ์ด|การ์ด|ป้าย|ไวนิล|ซอง|แฟ้ม|เมนู|ฉลาก/],
];
const guess = (text) => (PRODUCT.find(([, re]) => re.test(text)) ?? ['unknown'])[0];

const cands = [];
for (const s of data.sessions) {
  const turns = s.turns;
  const flags = new Map(s.flags.map((f) => [f.turnIndex, f.note ?? '(no note)']));
  turns.forEach((t, i) => {
    if (t.role !== 'user') return;
    const history = turns.slice(0, i).map(({ role, text }) => ({ role, text }));
    const userSoFar = [...history, t].filter((x) => x.role === 'user').map((x) => x.text).join(' ');
    cands.push({
      id: `s${s.id}-t${i}`,
      sessionId: s.id, turnIndex: i, channel: s.channel, leadStatus: s.leadStatus, at: t.ts ?? null,
      position: history.length === 0 ? 'first' : 'follow-up',
      product: guess(userSoFar),
      flagHere: flags.get(i) ?? null,
      flagReply: flags.get(i + 1) ?? null,
      history,
      message: t.text,
      replyWas: turns[i + 1]?.role === 'assistant' ? turns[i + 1].text : null,
      sessionQuotes: s.quotes.map((q) => `${q.productType} ${JSON.stringify(q.spec)} → ${q.unitPrice}`),
    });
  });
}
writeFileSync(outPath, JSON.stringify(cands, null, 1));

const count = (k) => Object.entries(cands.reduce((m, c) => ((m[c[k]] = (m[c[k]] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
const lens = cands.map((c) => c.message.length).sort((a, b) => a - b);
console.log(`sessions ${data.sessions.length} · candidate turns ${cands.length} · flagged ${cands.filter((c) => c.flagHere || c.flagReply).length}`);
console.log('by product   ', JSON.stringify(count('product')));
console.log('by position  ', JSON.stringify(count('position')));
console.log('by channel   ', JSON.stringify(count('channel')));
console.log('by leadStatus', JSON.stringify(count('leadStatus')));
console.log(`message chars: min ${lens[0]} · median ${lens[Math.floor(lens.length / 2)]} · max ${lens.at(-1)}`);
const first = cands.filter((c) => c.position === 'first').length;
console.log(`sessions with ≥2 customer turns: ${new Set(cands.filter((c) => c.position === 'follow-up').map((c) => c.sessionId)).size} of ${first}`);
