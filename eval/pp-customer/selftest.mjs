// eval/pp-customer/selftest.mjs — oracle / null / known-bad checks for the hard
// grader (no API calls, free). Run:  node --import tsx --conditions=react-server eval/pp-customer/selftest.mjs
import { gradeHard, outcomeOf } from './impl.mjs';

const mk = (over) => ({ reply: '', quotes: [], priceTables: [], computeCalls: [], toolCalls: 0, rounds: 1, refused: false, ...over });
const r1 = { qty: 100, boxes: 1, cardsPerBox: 100, cardsTotal: 100, pricePerBox: 150, totalPrice: 150, unitPrice: 1.5 };
const r2 = { ...r1, pricePerBox: 300, totalPrice: 300, unitPrice: 3 };
const c1 = { productType: 'namecard', spec: { qty: 100, sides: 1, laminated: false } };
const c2 = { productType: 'namecard', spec: { qty: 100, sides: 2, laminated: false } };
const ncCase = { history: [], message: 'นามบัตร', expected: { outcome: 'quote', calls: [{ productType: 'namecard', spec: { sides: 1, qty: 100 } }, { productType: 'namecard', spec: { sides: 2, qty: 100 } }], mustNotAsk: ['กี่ใบ', 'กี่กล่อง', 'เคลือบ[^\\n]*ไหม'] } };
const ORACLE = '💰 นามบัตร กล่องละ 100 ใบ → หน้าเดียว กล่องละ 150 บาท · หน้า-หลัง กล่องละ 300 บาท (ยังไม่รวม VAT 7%)\n📋 ราคาแบบไม่เคลือบนะคะ ถ้าเคลือบเงา/ด้านบอกได้เลยค่ะ รับแบบไหนดีคะ\nราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ 🙏';
const oracle = mk({ reply: ORACLE, quotes: [{ ...c1, result: r1 }, { ...c2, result: r2 }], computeCalls: [c1, c2], toolCalls: 2, rounds: 2 });

const askCase = { history: [], message: 'หนังสือ 500 เล่ม', expected: { outcome: 'ask', mustAsk: ['หน้า'], mustNotAsk: ['ปก'] } };
const escCase = { history: [], message: 'กล่องกระดาษ 1000 ใบ', expected: { outcome: 'escalate' } };
const tplCase = { history: [], message: 'ขอราคาหน่อย', expected: { outcome: 'template' } };

const checks = [
  ['oracle namecard both prices → all 1', gradeHard(ncCase, oracle).grade, { pass: 1, outcome: 1, tool_spec: 1, prices: 1, format: 1, asks: 1, refused: 0 }],
  ['null (empty reply, no calls) → pass 0, outcome 0', gradeHard(ncCase, mk({})).grade, { pass: 0, outcome: 0 }],
  ['hallucinated price (same text, no tool call) → prices 0', gradeHard(ncCase, mk({ reply: ORACLE })).grade, { prices: 0, outcome: 0, pass: 0 }],
  ['wrong number vs tool (160 instead of 150) → prices 0', gradeHard(ncCase, { ...oracle, reply: ORACLE.replace('150 บาท', '160 บาท') }).grade, { prices: 0, pass: 0 }],
  ['markdown bold → format 0', gradeHard(ncCase, { ...oracle, reply: '**' + ORACLE }).grade, { format: 0, pass: 0 }],
  ['asked quantity anyway → asks 0', gradeHard(ncCase, { ...oracle, reply: ORACLE + '\nต้องการกี่ใบคะ' }).grade, { asks: 0, pass: 0 }],
  ['only one side quoted → tool_spec 0', gradeHard(ncCase, { ...oracle, quotes: [oracle.quotes[0]], computeCalls: [c1], reply: ORACLE.replace(' · หน้า-หลัง กล่องละ 300 บาท', '') }).grade, { tool_spec: 0, pass: 0 }],
  ['missing VAT note → format 0', gradeHard(ncCase, { ...oracle, reply: ORACLE.replace(' (ยังไม่รวม VAT 7%)', '') }).grade, { format: 0, pass: 0 }],
  ['ask turn: good question → pass 1', gradeHard(askCase, mk({ reply: 'หนังสือ 500 เล่ม กี่หน้าคะ เนื้อในกระดาษอะไร พิมพ์กี่สีคะ' })).grade, { pass: 1, outcome: 1, asks: 1 }],
  ['ask turn: asks cover (forbidden) → asks 0', gradeHard(askCase, mk({ reply: 'กี่หน้าคะ ปกพิมพ์กี่สีคะ' })).grade, { asks: 0, pass: 0 }],
  ['ask turn: false hand-off wording → outcome 0 + format 0', gradeHard(askCase, mk({ reply: 'ขอส่งต่อทีมงานประเมินให้นะคะ' })).grade, { outcome: 0, format: 0, pass: 0 }],
  ['ask turn: guessed and called the tool → tool_spec 0', gradeHard(askCase, mk({ reply: 'กี่หน้าคะ', computeCalls: [{ productType: 'book', spec: {} }] })).grade, { tool_spec: 0, pass: 0 }],
  ['escalate turn: correct hand-off → pass 1', gradeHard(escCase, mk({ reply: 'งานแบบนี้ขอส่งต่อทีมงานประเมินราคาให้นะคะ เดี๋ยวทีมงานติดต่อกลับค่ะ 🙏' })).grade, { pass: 1, outcome: 1 }],
  ['escalate turn: quoted instead → outcome 0', gradeHard(escCase, { ...oracle }).grade, { outcome: 0, pass: 0 }],
  ['template turn: verbatim template → outcome 1', gradeHard(tplCase, mk({ reply: 'น้อง PP รบกวนขอรายละเอียดงานหน่อยนะคะ\nว่าเป็นงานอะไร และจำนวนเท่าไหร่ค่ะ' })).grade, { outcome: 1, pass: 1 }],
  ['refusal → refused 1, outcome 0', gradeHard(ncCase, mk({ refused: true, reply: 'ขออภัยค่ะ น้อง PP ตอบคำขอนี้เองไม่ได้ — ส่งต่อให้ทีมงานดูแลต่อนะคะ' })).grade, { refused: 1, outcome: 0 }],
];
let bad = 0;
for (const [name, got, want] of checks) {
  const miss = Object.entries(want).filter(([k, v]) => got[k] !== v);
  console.log(miss.length ? `✗ ${name} — ${miss.map(([k, v]) => `${k}: got ${got[k]} want ${v}`).join(', ')}` : `✓ ${name}`);
  if (miss.length) bad++;
}
console.log('outcomeOf table-only turn:', outcomeOf(mk({ reply: '📊 ตารางราคาบัตร PVC อยู่ด้านบนนะคะ กี่ใบดีคะ', priceTables: ['pvc_card'] })));
if (bad) { console.error(`${bad} grader self-check(s) failed`); process.exit(1); }
console.log('grader self-test: all passed');

// --- round 2: nested spec match · any-of outcome · noTable ---------------------
{
  const bookCase = { history: [], message: 'x', expected: { outcome: 'quote', calls: [{ productType: 'book', spec: { qty: 200, innerA: { paperName: 'Bond 80' } } }] } };
  const call = { productType: 'book', spec: { size: 'A5', qty: 200, cover: { paperName: 'Art 230', color: '4' }, innerA: { paperName: 'Bond 80', color: '1', pages: 36 }, innerB: { paperName: 'Art 120', color: '4', pages: 8 } } };
  const good = mk({ reply: '💰 หนังสือ A5 200 เล่ม → เล่มละ 73.55 บาท · รวม 14,710 บาท (ยังไม่รวม VAT 7%)\nราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ', quotes: [{ ...call, result: { unitPrice: 73.55, totalPrice: 14710 } }], computeCalls: [call], toolCalls: 1 });
  const anyOf = { history: [], message: 'มีขั้นต่ำไหม', expected: { outcome: ['ask', 'template'] } };
  const noTable = { history: [], message: 'สอบถามปฏิทิน', expected: { outcome: 'ask', noTable: true } };
  const more = [
    ['nested spec (innerA.paperName) matches a deeper call → tool_spec 1', gradeHard(bookCase, good).grade, { tool_spec: 1, pass: 1 }],
    ['nested spec mismatch (Bond 70) → tool_spec 0', gradeHard(bookCase, { ...good, computeCalls: [{ ...call, spec: { ...call.spec, innerA: { ...call.spec.innerA, paperName: 'Bond 70' } } }] }).grade, { tool_spec: 0 }],
    ['any-of outcome: template reply accepted for [ask, template]', gradeHard(anyOf, mk({ reply: 'น้อง PP รบกวนขอรายละเอียดงานหน่อยนะคะ' })).grade, { outcome: 1 }],
    ['any-of outcome: plain question also accepted', gradeHard(anyOf, mk({ reply: 'ไม่มีขั้นต่ำค่ะ งานประเภทไหนคะ' })).grade, { outcome: 1 }],
    ['noTable: table sent before the kind is known → tool_spec 0', gradeHard(noTable, mk({ reply: '📊 ตารางราคาปฏิทินตั้งโต๊ะอยู่ด้านบนนะคะ', priceTables: ['calendar_desk'] })).grade, { tool_spec: 0 }],
  ];
  let bad2 = 0;
  for (const [name, got, want] of more) {
    const miss = Object.entries(want).filter(([k, v]) => got[k] !== v);
    console.log(miss.length ? `✗ ${name} — ${miss.map(([k, v]) => `${k}: got ${got[k]} want ${v}`).join(', ')}` : `✓ ${name}`);
    if (miss.length) bad2++;
  }
  if (bad2) { console.error(`${bad2} round-2 self-check(s) failed`); process.exit(1); }
  console.log('grader self-test round 2: all passed');
}

// --- round 3 (2026-11-04): prompt constants bound to context · internal word · dash bullet ---
{
  const askAny = { history: [], message: 'มีขั้นต่ำไหม', expected: { outcome: ['ask', 'template'] } };
  const nbCall = { productType: 'notebook', spec: { size: 'A5', qty: 200, innerA: { paperName: 'Bond 80', color: '1', pages: 100 } } };
  const nbQuote = mk({ reply: '💰 สมุด A5 200 เล่ม → เล่มละ 45.50 บาท · รวม 9,100 บาท (ยังไม่รวม VAT 7%)\n📋 เข้าเล่มสันห่วงเพิ่มเล่มละ 15 บาท (ยังไม่รวมในราคาด้านบน)\nราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ 🙏',
    quotes: [{ ...nbCall, result: { unitPrice: 45.5, totalPrice: 9100 } }], computeCalls: [nbCall], toolCalls: 1 });
  const nbCase = { history: [], message: 'x', expected: { outcome: 'quote', calls: [nbCall] } };
  const more3 = [
    ['ค่าออกแบบ 300 บาท with no tool call → prices 1', gradeHard(askAny, mk({ reply: 'ขั้นต่ำขึ้นอยู่กับชนิดงานค่ะ\n💳 บัตร PVC ต่ำกว่า 30 ใบ มีค่าออกแบบ 300 บาท\nงานประเภทไหนคะ' })).grade, { prices: 1, pass: 1 }],
    ['300 บาท without ค่าออกแบบ keyword → prices 0', gradeHard(askAny, mk({ reply: 'ค่าส่ง 300 บาทค่ะ งานประเภทไหนคะ' })).grade, { prices: 0, pass: 0 }],
    ['สันห่วง surcharge line next to a tool quote → prices 1', gradeHard(nbCase, nbQuote).grade, { prices: 1, pass: 1 }],
    ['bare 15 บาท on a สันห่วง line (price position, no tool) → prices 0', gradeHard(nbCase, mk({ reply: '💰 สมุด A5 สันห่วง 200 เล่ม → เล่มละ 15 บาท (ยังไม่รวม VAT 7%)\nราคาประเมินเบื้องต้นนะคะ' })).grade, { prices: 0, pass: 0 }],
    ['internal word ระบบ → format 0', gradeHard(nbCase, { ...nbQuote, reply: nbQuote.reply + '\nระบบประเมินให้เป็นปกมาตรฐานค่ะ' }).grade, { format: 0, pass: 0 }],
    ['dash bullet at line start → format 0', gradeHard(nbCase, { ...nbQuote, reply: nbQuote.reply + '\n- Bond 70\n- Bond 80' }).grade, { format: 0, pass: 0 }],
    ['oracle namecard unchanged → pass 1', gradeHard(ncCase, oracle).grade, { pass: 1, format: 1, prices: 1 }],
  ];
  let bad3 = 0;
  for (const [name, got, want] of more3) {
    const miss = Object.entries(want).filter(([k, v]) => got[k] !== v);
    console.log(miss.length ? `✗ ${name} — ${miss.map(([k, v]) => `${k}: got ${got[k]} want ${v}`).join(', ')}` : `✓ ${name}`);
    if (miss.length) bad3++;
  }
  if (bad3) { console.error(`${bad3} round-3 self-check(s) failed`); process.exit(1); }
  console.log('grader self-test round 3: all passed');
}

// --- round 4 (2026-11-05, final review I1/M2): PROMPT_CONSTANTS bound to their pinned sentence ---
{
  const askAny = { history: [], message: 'มีขั้นต่ำไหม', expected: { outcome: ['ask', 'template'] } };
  const nbCall = { productType: 'notebook', spec: { size: 'A5', qty: 200, innerA: { paperName: 'Bond 80', color: '1', pages: 100 } } };
  const nbCase = { history: [], message: 'x', expected: { outcome: 'quote', calls: [nbCall] } };
  const nbQ = [{ ...nbCall, result: { unitPrice: 45.5, totalPrice: 9100 } }];
  const PIN = '📋 เข้าเล่มสันห่วงเพิ่มเล่มละ 15 บาท (ยังไม่รวมในราคาด้านบน)';
  const more4 = [
    ['A: pinned สันห่วง line + separate "เล่มละ 15 บาท" price line (not tool-backed) → prices 0', gradeHard(nbCase, mk({ reply: `💰 สมุด A5 200 เล่ม → เล่มละ 15 บาท · รวม 9,100 บาท\n${PIN}\nราคาประเมินเบื้องต้นนะคะ`, quotes: nbQ, computeCalls: [nbCall], toolCalls: 1 })).grade, { prices: 0, pass: 0 }],
    ['C: ค่าออกแบบ 300 บาท line + ค่าส่ง 300 บาท line → prices 0', gradeHard(askAny, mk({ reply: 'ค่าออกแบบ 300 บาท\nค่าส่ง 300 บาท\nงานประเภทไหนคะ' })).grade, { prices: 0, pass: 0 }],
    ['pinned sentence alone + tool-backed prices → prices 1', gradeHard(nbCase, mk({ reply: `💰 สมุด A5 200 เล่ม → เล่มละ 45.50 บาท · รวม 9,100 บาท (ยังไม่รวม VAT 7%)\n${PIN}\nราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ 🙏`, quotes: nbQ, computeCalls: [nbCall], toolCalls: 1 })).grade, { prices: 1, pass: 1 }],
    ['E: ค่าออกแบบ 300บาท (no space) → prices 1', gradeHard(askAny, mk({ reply: 'ขั้นต่ำขึ้นอยู่กับชนิดงานค่ะ\n💳 บัตร PVC ต่ำกว่า 30 ใบ มีค่าออกแบบ 300บาท\nงานประเภทไหนคะ' })).grade, { prices: 1, pass: 1 }],
  ];
  let bad4 = 0;
  for (const [name, got, want] of more4) {
    const miss = Object.entries(want).filter(([k, v]) => got[k] !== v);
    console.log(miss.length ? `✗ ${name} — ${miss.map(([k, v]) => `${k}: got ${got[k]} want ${v}`).join(', ')}` : `✓ ${name}`);
    if (miss.length) bad4++;
  }
  if (bad4) { console.error(`${bad4} round-4 self-check(s) failed`); process.exit(1); }
  console.log('grader self-test round 4: all passed');
}
