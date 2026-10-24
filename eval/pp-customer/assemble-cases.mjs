// eval/pp-customer/assemble-cases.mjs — join labels.json (hand-written expected
// labels) with the candidate turns sliced from the one-shot export, write
// cases.json (committed) + cases-review.md (the sign-off doc).
//   node eval/pp-customer/assemble-cases.mjs <candidates.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const candPath = process.argv[2];
if (!candPath) { console.error('usage: assemble-cases.mjs <candidates.json>'); process.exit(2); }
const cands = Object.fromEntries(JSON.parse(readFileSync(candPath, 'utf8')).map((c) => [c.id, c]));
const labels = JSON.parse(readFileSync(join(here, 'labels.json'), 'utf8'));

const cases = [];
for (const [id, l] of Object.entries(labels.cases)) {
  let history, message, meta;
  if (l.history !== undefined) {
    history = l.history; message = l.message; meta = { source: 'synthetic' };
  } else {
    const c = cands[id];
    if (!c) { console.error(`label ${id} has no candidate`); process.exit(2); }
    history = c.history; message = c.message;
    meta = { source: 'prod', sessionId: c.sessionId, turnIndex: c.turnIndex, channel: c.channel, at: c.at, oldReply: (c.replyWas ?? '').slice(0, 400) };
  }
  cases.push({ id, tags: l.tags, history, message, expected: l.expected, meta });
}
writeFileSync(join(here, 'cases.json'), JSON.stringify(cases, null, 1) + '\n');

// --- review doc ------------------------------------------------------------------
const fence = (s) => { const runs = (s.match(/`+/g) ?? []).map((r) => r.length); const n = Math.max(3, ...runs) + 1; return '`'.repeat(n); };
const outcomeOf = (e) => (Array.isArray(e.outcome) ? e.outcome.join(' หรือ ') : e.outcome);
const specOf = (e) => (e.calls ?? []).map((c) => `${c.productType} ${JSON.stringify(c.spec)}`).join(' · ') || (e.priceTable ? `ตาราง ${e.priceTable}` : '—');
const byGroup = {};
for (const c of cases) (byGroup[c.tags[0]] ??= []).push(c);
let md = `# น้อง PP eval — เคสสำหรับ sign-off (${cases.length} เคส)\n\n`;
md += `> ${labels._meta.label_source}\n>\n> วิธีอ่าน: แต่ละเคส = ประวัติแชตจริง (ถ้ามี) + ข้อความลูกค้า 1 ข้อความ → น้อง PP ตอบ 1 เทิร์น แล้ว grader เทียบกับ **expected**. \`outcome\` = quote (ตีราคา) · ask (ถามต่อ) · escalate (ส่งต่อทีมงาน) · template (ข้อความ 6 ประเภทตรงตัว) · table (ส่งรูปตารางราคาแล้วถามต่อ). \`calls\` = สเปกที่ต้องส่งให้ compute_quote (เช็คเฉพาะ field ที่ระบุ). \`mustAsk/mustNotAsk\` = regex บนคำตอบ.\n>\n> **สิ่งที่อยากให้คุณนุ๊กดู**: (1) expected ตรงกับที่ร้านอยากให้ตอบไหม (2) มีเคสที่ไม่สมจริง/ไม่สำคัญไหม (3) มีสถานการณ์ที่ลูกค้าถามบ่อยแต่ยังไม่มีในชุดไหม\n>\n> ตัดออกตั้งใจ: ${labels._meta.excluded_on_purpose}\n\n`;
md += `## สรุป\n\n| กลุ่ม | จำนวน | quote | ask | escalate | template | table |\n|---|---|---|---|---|---|---|\n`;
for (const [g, list] of Object.entries(byGroup)) {
  const n = (o) => list.filter((c) => (Array.isArray(c.expected.outcome) ? c.expected.outcome : [c.expected.outcome]).includes(o)).length;
  md += `| ${g} | ${list.length} | ${n('quote')} | ${n('ask')} | ${n('escalate')} | ${n('template')} | ${n('table')} |\n`;
}
md += `\n## ตารางรวม\n\n| id | tags | expected | สเปก/ตาราง | ข้อความลูกค้า |\n|---|---|---|---|---|\n`;
for (const c of cases) md += `| ${c.id} | ${c.tags.slice(1).join(', ')} | **${outcomeOf(c.expected)}** | ${specOf(c.expected).replace(/\|/g, '\\|')} | ${c.message.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 90)} |\n`;
for (const [g, list] of Object.entries(byGroup)) {
  md += `\n---\n\n# ${g} (${list.length})\n`;
  for (const c of list) {
    md += `\n## ${c.id} · ${c.tags.slice(1).join(' · ')}\n\n`;
    if (c.history.length) {
      md += `**ประวัติก่อนหน้า (${c.history.length} เทิร์น):**\n\n`;
      for (const h of c.history) md += `- ${h.role === 'user' ? '👤 ลูกค้า' : '🤖 น้อง PP'}: ${h.text.replace(/\s+/g, ' ').slice(0, 300)}${h.text.length > 300 ? ' …' : ''}\n`;
      md += '\n';
    }
    const f = fence(c.message);
    md += `**ข้อความลูกค้า (เทิร์นที่วัด):**\n\n${f}\n${c.message}\n${f}\n\n`;
    md += `**expected:** outcome = **${outcomeOf(c.expected)}**`;
    if (c.expected.calls) md += ` · calls = ${specOf(c.expected)}`;
    if (c.expected.priceTable) md += ` · ตาราง = ${c.expected.priceTable}`;
    if (c.expected.noTable) md += ` · ห้ามส่งตาราง`;
    if (c.expected.mustAsk) md += ` · ต้องมี /${c.expected.mustAsk.join('/, /')}/`;
    if (c.expected.mustNotAsk) md += ` · ห้ามถาม /${c.expected.mustNotAsk.join('/, /')}/`;
    md += '\n';
    if (c.expected.note) md += `\n📝 ${c.expected.note}\n`;
    if (c.meta.oldReply) md += `\n<details><summary>คำตอบเดิมของบอทตอนนั้น (อ้างอิง)</summary>\n\n${c.meta.oldReply.replace(/\s+/g, ' ')}\n\n</details>\n`;
  }
}
writeFileSync(join(here, 'cases-review.md'), md);
console.log(`cases.json: ${cases.length} cases · groups ${JSON.stringify(Object.fromEntries(Object.entries(byGroup).map(([g, l]) => [g, l.length])))}`);
// possible personal names left in text (contact details are already masked server-side)
const nameHits = new Set();
for (const c of cases) for (const t of [...c.history.map((h) => h.text), c.message]) for (const m of t.matchAll(/(?:คุณ|พี่|น้อง|ชื่อ)\s?([ก-๙A-Za-z]{2,20})/g)) nameHits.add(m[0]);
console.log('name-like tokens to eyeball:', [...nameHits].join(' | ') || 'none');
