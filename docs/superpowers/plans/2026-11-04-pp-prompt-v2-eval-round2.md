# น้อง PP prompt v2 + eval round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดช่องว่าง prompt ของน้อง PP ที่ eval รอบแรกชี้ (A6/B5 · การเข้าเล่ม · เวลาผลิต/ค่าส่ง · รูปแบบคำตอบ) แล้ววัดด้วย harness เดิมแบบ paired เทียบ baseline ก่อน ship ขึ้น prod

**Architecture:** แก้ 3 ชั้นเรียงตามลำดับที่ harness sha gate บังคับ — (1) grader `impl.mjs` + `selftest.mjs` (2) เคส `cases.json` + regrade baseline/v1 ด้วยกฎ+label ใหม่ (3) prompt `prompt-customer.ts` + tests — โดย **baseline ของเคสใหม่ต้องรันด้วย prompt เดิมก่อน apply prompt v2** (คุณนุ๊ก approve #1) แล้ว pilot v2 (approve #2) → Claude รันเต็ม → gate → ship + docs. ไม่แตะ `run-eval.mjs`, calculator, router.

**Tech Stack:** Node 22 ESM (`node --import tsx --conditions=react-server` สำหรับไฟล์ที่ import TS ของแอป) · vitest 4 · Anthropic SDK (Sonnet 5.5 ตัววัด / Fable 5.1 กรรมการ) · calc dev server `calc-dev` :3100 (`../.claude/launch.json`, token `test`)

**Spec:** `docs/superpowers/specs/2026-11-04-pp-prompt-v2-eval-round2-design.md` (อ่านคู่กัน — plan อ้าง § ของ spec)

## Global Constraints

- cwd ทุกคำสั่ง = `penprinting-dashboard/` (ยกเว้นที่ระบุ)
- **น้อง PP ห้ามคำนวณราคา** — ทุก "N บาท" ในคำตอบมาจาก tool ของเทิร์นนี้ หรือเป็นเลขคงที่ 2 ตัวใน prompt (`ค่าออกแบบ … 300 บาท`, `สันห่วง … เพิ่มเล่มละ 15 บาท`) เท่านั้น; การหารจำนวน (A6 → qty ÷ 2) เป็นการเตรียมพารามิเตอร์ tool ไม่ใช่ราคา
- วลี `ส่งต่อทีมงาน` / `ให้ทีมงานประเมิน` = ปิดโหมด AI (`detectCustomerEscalation` regex `/ส่งต่อทีมงาน|ให้ทีมงานประเมิน/`) → ใช้เฉพาะเทิร์นส่งต่อจริง; ประโยคใหม่ทุกประโยคต้องไม่ match
- **ห้ามแตะ** `eval/pp-customer/run-eval.mjs`, `print-calculator-next/*`, `lib/ai-quote/customer-triggers.ts`, `lib/ai-quote/run.ts`, `lib/ai-quote/tools.ts`
- harness sha gate ครอบ `impl.mjs`, `cases.json`, `prompt-customer.ts`, `run.ts`, `tools.ts`, `customer-deps.ts`, `run-eval.mjs`, `package-lock.json` → Task 1-2 ต้องเสร็จสมบูรณ์ก่อน approve #1 · Task 4 ก่อน approve #2 · แก้ไฟล์เหล่านี้หลัง approve = ต้อง approve ใหม่
- `--approve-harness` **รัน eval ต่อในคำสั่งเดียวกัน** → คำสั่งที่ส่งคุณนุ๊กต้องมี `--model claude-sonnet-5-5 --reps 2` เสมอ (default `--reps 1` + ไม่มี `--model` = แถวผิด ต้องลบ)
- husky pre-commit รัน `type-check && lint && test` → tests ของ prompt ต้อง commit **พร้อม** prompt (RED commit ไม่ผ่าน hook)
- tests ใน `tests/ai-quote-prompt-customer.test.ts` **เพิ่มได้ ลบไม่ได้**; section `## นามบัตร — กฎเฉพาะ` ห้ามมี `/\d{2,} ?บาท/` (test เดิม) → ตัวอย่างใช้ placeholder X/Y
- prompt ยาวขึ้นไม่เกิน ~30 บรรทัด (ตอนนี้ 153)
- งบ: v2 เต็ม ≈ $5 · baseline เคสใหม่ < $0.5 · v3 ≥ 1 รอบเท่านั้น · เครดิตหมด 2026-11-09
- เอกสาร/commit message ภาษาไทย+อังกฤษตามธรรมเนียม repo; เรียก user ว่า "คุณนุ๊ก"

## Review Focus

1. **ใบปลิว A6 จำนวนคี่** (เช่น 101 ใบ) → ต้องเรียก A5 51 ใบ (ปัดขึ้น) ไม่ใช่ 50.5 — pin ใน Task 4 test `A6 rule rounds odd quantities up`
2. **เขียนขนาดแบบอื่น** ("a6", "เอ6", "บี5") → ต้อง map เหมือน A6/B5 — pin ใน Task 4 test `size aliases`
3. **ประโยคเวลาผลิต/ค่าส่งต้องไม่ปิดโหมด AI** — Task 4 test เรียก `detectCustomerEscalation(0, <ประโยค>)` ต้อง `false`
4. **"15 บาท" ในตำแหน่งราคา** ("💰 สมุด สันห่วง → เล่มละ 15 บาท" ไม่มี tool) ต้องตก `prices` แม้มีคำ "สันห่วง" บรรทัดเดียวกัน — selftest Task 1 `bare 15 บาท on a สันห่วง line → prices 0`
5. **baseline ของเคสใหม่ต้องรันด้วย prompt เดิม** — Task 3 step ตรวจ `git diff --quiet -- lib/ai-quote/prompt-customer.ts` ก่อนส่งคำสั่ง approve #1

---

### Task 1: Grader — เลขคงที่ผูกบริบท + เช็ค format ใหม่ (RED→GREEN)

**Files:**
- Modify: `eval/pp-customer/impl.mjs` (`gradeHard` — บล็อก `prices` ≈ บรรทัด 205-208, บล็อก `problems` ≈ 210-219)
- Modify: `eval/pp-customer/selftest.mjs` (เพิ่มบล็อก round 3 ท้ายไฟล์ รูปแบบเดียวกับ round 2)
- Add (commit แรกของงาน): `docs/superpowers/specs/2026-11-04-pp-prompt-v2-eval-round2-design.md`, `docs/superpowers/plans/2026-11-04-pp-prompt-v2-eval-round2.md`

**Interfaces:**
- Consumes: `gradeHard(input, run)` เดิม — `run.reply`, `run.quotes[].result`, `input.expected`
- Produces: `grade.prices` ยอมรับเลขคงที่ตามบริบท · `grade.format` ตก 2 กรณีใหม่ (explanation มีข้อความ `internal word "ระบบ"` / `dash bullet`) — Task 2 (regrade) และ Task 5 ใช้ผ่าน `regrade.mjs`/`run-eval.mjs` โดยไม่ต้องรู้รายละเอียด

- [ ] **Step 1: เขียน selftest round 3 (ท้าย `selftest.mjs`, บล็อก `{ … }` แยกเหมือน round 2, ตัวแปร `bad3`)**

```js
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
```

- [ ] **Step 2: รันให้เห็น RED**

Run: `node --import tsx --conditions=react-server eval/pp-customer/selftest.mjs`
Expected: round 1-2 ผ่านเหมือนเดิม · round 3 ตก 4 ตัว (`ค่าออกแบบ 300 … prices 1`, `สันห่วง surcharge … prices 1`, `internal word ระบบ`, `dash bullet`) · exit 1

- [ ] **Step 3: แก้ `gradeHard` ใน `impl.mjs`**

ใน `impl.mjs` ประกาศข้าง `PRICE_RE` (≈ บรรทัด 158):
```js
// Fixed numbers the prompt itself states; accepted only inside the sentence shape
// the prompt pins, so a hallucinated unit price that happens to equal them still fails.
const PROMPT_CONSTANTS = [
  { n: 300, re: /ค่าออกแบบ[^\n]*300 บาท/ },        // PVC design fee under 30 cards
  { n: 15,  re: /สันห่วง[^\n]*เพิ่มเล่มละ 15 บาท/ }, // ring-binding surcharge (spec 2026-11-04 §4.2)
];
```
ในบล็อก `prices`: หลังรวมเลขจาก `run.quotes` เพิ่ม `for (const c of PROMPT_CONSTANTS) if (c.re.test(reply)) allowed.add(c.n);`
ในบล็อก `problems` (format): เพิ่ม `if (/ระบบ/.test(reply)) problems.push('internal word "ระบบ"');` และ `if (/^- /m.test(reply)) problems.push('dash bullet');`
อัปเดตคอมเมนต์หัว `gradeHard` ที่อธิบาย format ให้ครอบ 2 เช็คใหม่

- [ ] **Step 4: รันให้เห็น GREEN**

Run: `node --import tsx --conditions=react-server eval/pp-customer/selftest.mjs`
Expected: ทั้ง 3 round ผ่าน · exit 0

- [ ] **Step 5: judge-negatives ยังผ่าน (ฟรี 3 judge calls — ต้องมี key; ถ้าคุณนุ๊กยังไม่ยืนยันเครดิต ข้ามไปทำท้าย Task 3)**

Run: `node --env-file=.env.eval.local --import tsx --conditions=react-server eval/pp-customer/judge-negatives.mjs`
Expected: 4/4 negatives fail as intended (ข้อความสรุปท้ายของสคริปต์)

- [ ] **Step 6: Commit (spec + plan + grader)**

```bash
git add docs/superpowers/specs/2026-11-04-pp-prompt-v2-eval-round2-design.md docs/superpowers/plans/2026-11-04-pp-prompt-v2-eval-round2.md eval/pp-customer/impl.mjs eval/pp-customer/selftest.mjs
git commit -m "feat(eval): grader accepts the two prompt constants only in their pinned sentence shape; 'ระบบ' and dash bullets fail format (round 2 spec + plan)"
```

---

### Task 2: เคส — แก้ label 4 เคส + เพิ่ม 9 เคส + cases-review round 2 + regrade baseline/v1

**Files:**
- Modify: `eval/pp-customer/cases.json` (array ของ case objects — 68 → 77)
- Modify: `eval/pp-customer/cases-review.md` (append section `# Round 2 (2026-11-04)` ท้ายไฟล์)
- Writes (gitignored): `.claude/hillclimb/pp-customer/baseline/results.jsonl`, `.claude/hillclimb/pp-customer/v1/results.jsonl` ผ่าน `regrade.mjs --write`

**Interfaces:**
- Consumes: `expected` schema ของ `impl.mjs` (`outcome` string|array · `calls[{productType,spec}]` partial-match · `mustAsk`/`mustNotAsk` = reply must/must-not match regex) · `regrade.mjs <flow> <variant> [--write]`
- Produces: 9 id ใหม่ที่ Task 3 ใช้ใน `PP_EVAL_ONLY`: `synth-a6-brochure-first,synth-a6-book-odd,synth-b5-book-full,synth-a7-brochure,synth-hardcover,synth-ring-binding,synth-saddle-stitch,synth-leadtime-followup,synth-shipping-with-spec` · ตัวเลข baseline หลัง regrade (pass/136) ที่ Task 5-6 อ้าง

- [ ] **Step 1: แก้ `expected` ของ 4 เคสเดิมใน `cases.json` (ค่าอื่นของเคสคงเดิม)**

```jsonc
// s57-t2 (message "ใบปลิว A6 100 ใบ")
"expected": { "outcome": "quote", "calls": [{ "productType": "brochure", "spec": { "size": "A5", "qty": 50 } }],
  "mustAsk": ["A5"], "mustNotAsk": ["ใบละ"],
  "note": "นโยบาย 2026-11-04: A6 = ครึ่ง A5 → เรียก A5 50 ใบ แสดงราคารวม + 📋 ที่มา ไม่แสดงราคาต่อใบ (label เดิม 10/24: ask ให้เสนอ A5)" }
// s41-t2 (history: หนังสือ A6 100 หน้า 15 เล่ม · message "สีเนื้อใน 4 สี กระดาษ Bond 80")
"expected": { "outcome": "quote", "calls": [{ "productType": "book", "spec": { "size": "A5", "qty": 8, "innerA": { "paperName": "Bond 80", "color": "4", "pages": 100 } } }],
  "mustNotAsk": ["เล่มละ"],
  "note": "นโยบาย 2026-11-04: หนังสือ A6 หาร 2 เหมือนกัน 15 เล่ม → A5 8 เล่ม (ปัดขึ้น) แสดงราคารวมอย่างเดียว (label เดิม: ask ให้เสนอ A4/A5)" }
// s107-t0 (B5 244 หน้า ขาวดำ 5 เล่ม เนื้อใน "75 gram" ปกกระดาษมัน)
"expected": { "outcome": "ask", "mustAsk": ["Green Read 75|Bond 70|Bond 80"], "mustNotAsk": ["ขนาดไหน", "A4 และ A5", "ส่งต่อทีมงาน"],
  "note": "นโยบาย 2026-11-04: B5 → A4 เงียบ ๆ ไม่ถามขนาด · กระดาษบอกแค่แกรม 75 → เสนอ Bond 70 / Bond 80 / Green Read 75 ไม่ส่งต่อ (label เดิม: ถามทั้งขนาดและกระดาษ)" }
// s100-t6 — เพิ่ม "จำนวนกล่อง" เข้า mustNotAsk เดิม
"mustNotAsk": ["กี่ใบ", "กี่กล่อง", "จำนวนกล่อง"]
```
(เติม note เดิมของ s100-t6 ต่อท้ายว่า `· 2026-11-04 เพิ่ม "จำนวนกล่อง" — soft-ask "บอกจำนวนกล่องได้เลยค่ะ" นับเป็นถามจำนวน`)

- [ ] **Step 2: เพิ่ม 9 เคสใหม่ท้าย array (`meta: {"source":"synthetic"}` · tags มี `synth`)**

```jsonc
{ "id": "synth-a6-brochure-first", "tags": ["brochure","first","line","synth","size-unsupported"], "history": [], "message": "ใบปลิว A6 1,000 ใบ",
  "expected": { "outcome": "quote", "calls": [{ "productType": "brochure", "spec": { "size": "A5", "qty": 500 } }], "mustAsk": ["500 ใบ"], "mustNotAsk": ["ใบละ"],
    "note": "A6 = ครึ่ง A5 → A5 500 ใบ · บอกราคารวม + 📋 'A6 คิดจาก A5 500 ใบ' ไม่มีราคาต่อใบ" }, "meta": { "source": "synthetic" } },
{ "id": "synth-a6-book-odd", "tags": ["book","first","line","synth","size-unsupported"], "history": [], "message": "หนังสือ A6 100 หน้า เนื้อใน Bond 80 ขาวดำ 15 เล่ม",
  "expected": { "outcome": "quote", "calls": [{ "productType": "book", "spec": { "size": "A5", "qty": 8, "innerA": { "paperName": "Bond 80", "color": "1", "pages": 100 } } }], "mustAsk": ["8 เล่ม"], "mustNotAsk": ["เล่มละ"],
    "note": "หนังสือ A6 หาร 2 ปัดขึ้น 15 → 8 · ราคารวมอย่างเดียว" }, "meta": { "source": "synthetic" } },
{ "id": "synth-b5-book-full", "tags": ["book","first","line","synth","size-unsupported"], "history": [], "message": "หนังสือ B5 200 หน้า เนื้อใน Bond 80 ขาวดำ 100 เล่ม",
  "expected": { "outcome": "quote", "calls": [{ "productType": "book", "spec": { "size": "A4", "qty": 100, "innerA": { "paperName": "Bond 80", "color": "1", "pages": 200 } } }], "mustAsk": ["A4"],
    "note": "B5 → A4 จำนวนเท่าเดิม · แสดงเล่มละ/รวมได้ปกติ + 📋 'B5 คิดราคาเท่า A4'" }, "meta": { "source": "synthetic" } },
{ "id": "synth-a7-brochure", "tags": ["brochure","first","line","synth","size-unsupported"], "history": [], "message": "ใบปลิว A7 1,000 ใบ",
  "expected": { "outcome": "escalate", "note": "ขนาดอื่นนอกจาก A6/B5 ยังส่งต่อเหมือนเดิม (ขอบเขต §4.1)" }, "meta": { "source": "synthetic" } },
{ "id": "synth-hardcover", "tags": ["book","first","line","synth","special-finish"], "history": [], "message": "หนังสือ A5 200 หน้า เนื้อใน Bond 80 ขาวดำ ปกแข็ง 100 เล่ม",
  "expected": { "outcome": "escalate", "mustAsk": ["ปกแข็ง"], "note": "ปกแข็ง → ส่งต่อ แม้สเปกอื่นครบ (ส่งต่อชนะกฎถาม/ตีราคา)" }, "meta": { "source": "synthetic" } },
{ "id": "synth-ring-binding", "tags": ["notebook","first","line","synth","special-finish"], "history": [], "message": "สมุด A5 100 หน้า เนื้อใน Bond 80 ขาวดำ 200 เล่ม เข้าเล่มสันห่วง",
  "expected": { "outcome": "quote", "calls": [{ "productType": "notebook", "spec": { "size": "A5", "qty": 200, "innerA": { "paperName": "Bond 80", "color": "1", "pages": 100 } } }], "mustAsk": ["สันห่วง[^\\n]*เพิ่มเล่มละ 15 บาท"],
    "note": "สันห่วง = ตีราคาปกติ + บรรทัดคงที่ +15/เล่ม ไม่บวกรวมเอง" }, "meta": { "source": "synthetic" } },
{ "id": "synth-saddle-stitch", "tags": ["book","first","line","synth","special-finish"], "history": [], "message": "หนังสือ A5 32 หน้า มุงหลังคา เนื้อใน Bond 80 4 สี 300 เล่ม",
  "expected": { "outcome": "quote", "calls": [{ "productType": "book", "spec": { "size": "A5", "qty": 300, "innerA": { "paperName": "Bond 80", "color": "4", "pages": 32 } } }], "mustNotAsk": ["เข้าเล่ม[^\\n]*(ไหม|แบบไหน)"],
    "note": "มุงหลังคา = เข้าเล่มมาตรฐาน ไม่ถาม ไม่พูดถึง" }, "meta": { "source": "synthetic" } },
{ "id": "synth-leadtime-followup", "tags": ["brochure","follow-up","line","synth","generic"],
  "history": [ { "role": "user", "text": "ใบปลิว A5 100 ใบ" },
               { "role": "assistant", "text": "💰 ใบปลิว A5 100 ใบ → ใบละ 15 บาท · รวม 1,500 บาท (ยังไม่รวม VAT 7%)\n\n📋 ประเมินจาก: 4 สี / 2 หน้า / Art 120 — สเปกต่างจากนี้บอกได้เลยค่ะ\n\nราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ 🙏" } ],
  "message": "ใช้เวลาผลิตกี่วันคะ",
  "expected": { "outcome": "ask", "mustAsk": ["ขึ้น(อยู่)?กับงาน|แล้วแต่งาน"], "mustNotAsk": ["\\d+\\s*วัน", "ส่งต่อทีมงาน", "ให้ทีมงานประเมิน"],
    "note": "เวลาผลิต = แล้วแต่งาน → ตอบกลาง ๆ ไม่มีตัวเลข ไม่ปิดโหมด AI (นโยบาย 2026-11-04 §4.3)" }, "meta": { "source": "synthetic" } },
{ "id": "synth-shipping-with-spec", "tags": ["brochure","first","line","synth","generic"], "history": [], "message": "ใบปลิว A4 500 ใบ ค่าส่งเท่าไหร่คะ",
  "expected": { "outcome": "quote", "calls": [{ "productType": "brochure", "spec": { "size": "A4", "qty": 500 } }], "mustAsk": ["ค่าส่ง"], "mustNotAsk": ["ค่าส่ง[^\\n]*\\d+\\s*บาท", "ส่งต่อทีมงาน"],
    "note": "สเปกครบ → ตีราคาปกติ แล้วตอบค่าส่งแบบไม่มีตัวเลขต่อท้าย" }, "meta": { "source": "synthetic" } }
```

- [ ] **Step 3: ตรวจไฟล์**

Run:
```bash
node -e 'const c=require("./eval/pp-customer/cases.json");const ids=c.map(x=>x.id);console.log(c.length,new Set(ids).size,c.filter(x=>!x.expected?.outcome).length)'
node --import tsx --conditions=react-server eval/pp-customer/selftest.mjs
```
Expected: `77 77 0` · selftest ทั้ง 3 round ผ่าน

- [ ] **Step 4: เขียน `cases-review.md` section `# Round 2 (2026-11-04) — นโยบายคุณนุ๊ก A6/B5 · เข้าเล่ม · เวลาผลิต`**

ท้ายไฟล์: (a) ตาราง `| id | tags | expected เดิม → ใหม่ | สเปก | ข้อความลูกค้า |` สำหรับ 4 เคสที่แก้ + 9 เคสใหม่ (เดิม = `—` สำหรับเคสใหม่) (b) entry เต็มของ 9 เคสใหม่ตามรูปแบบเดิม (`## <id> · <tags>` · บล็อก ```` ข้อความ ```` · `**expected:** …` · `📝 note`) (c) หนึ่งย่อหน้าอธิบายว่า label 4 เคสเปลี่ยนเพราะนโยบายใน spec §4 และ baseline ถูก regrade ด้วย label+grader ใหม่

- [ ] **Step 5: regrade baseline + v1 (hard metrics เท่านั้น — ไม่เรียก API)**

Run:
```bash
node --import tsx --conditions=react-server eval/pp-customer/regrade.mjs .claude/hillclimb/pp-customer baseline
node --import tsx --conditions=react-server eval/pp-customer/regrade.mjs .claude/hillclimb/pp-customer baseline --write
node --import tsx --conditions=react-server eval/pp-customer/regrade.mjs .claude/hillclimb/pp-customer v1 --write
```
Expected (baseline, dry-run ก่อน): สรุป `pass before 126 → after N` โดย N < 126 — การเปลี่ยนที่ต้องเห็น: `s50-t0` 0→1 (เลข 300 ผ่าน) · `s100-t6` ทั้ง 2 reps 1→0 (`asked: /จำนวนกล่อง/`) · `s107-t0` rep0 1→0 (`ขนาดไหน`) · `s57-t2`/`s41-t2` ยัง 0 (`expected quote, got escalate`) · แถวที่มี `- ` หรือ "ระบบ" (ประมาณ 6) 1→0. จด N (baseline) และตัวเลข v1 ลงไฟล์ `.claude/hillclimb/pp-customer/regrade-2026-11-04.txt` (gitignored) เพื่อใช้ใน Task 5-6

- [ ] **Step 6: Commit**

```bash
git add eval/pp-customer/cases.json eval/pp-customer/cases-review.md
git commit -m "feat(eval): round-2 cases — relabel A6/B5/75g/namecard-softask per 2026-11-04 policy + 9 synthetic cases (sizes, binding, lead-time); baseline+v1 regraded"
```

---

### Task 3: ⛔ Checkpoint คุณนุ๊ก — sign-off เคส + approve #1 = baseline ของ 9 เคสใหม่ด้วย prompt เดิม (orchestrator ทำเอง ไม่ใช่ subagent)

**Files:** ไม่แก้โค้ด · อ่าน `.claude/hillclimb/pp-customer/baseline/{results.jsonl,errors.jsonl}`

**Interfaces:**
- Consumes: 9 id จาก Task 2 · grader จาก Task 1
- Produces: 18 แถว baseline ใหม่ (model `claude-sonnet-5-5`, reps 0-1) ที่ Task 5 เทียบแบบ paired

- [ ] **Step 1: ยืนยัน calc-dev รันอยู่** — `preview_start` ชื่อ `calc-dev` (จาก `../.claude/launch.json`) แล้ว `curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/` → `200`

- [ ] **Step 2: ยืนยัน prompt ยังเป็นของเดิม (Review Focus 5)** — Run: `git diff --quiet -- lib/ai-quote/prompt-customer.ts && git log -1 --format=%h -- lib/ai-quote/prompt-customer.ts` → ไม่มี diff · hash = `7f1825a` (commit ล่าสุดของไฟล์ก่อนรอบนี้)

- [ ] **Step 3: ให้คุณนุ๊ก sign-off เคส** — ส่งตาราง Round 2 จาก `cases-review.md` (13 แถว) ใน chat สั้น ๆ ขอ "โอเค" ก่อน approve

- [ ] **Step 4: ส่งคำสั่ง approve #1 ให้คุณนุ๊ก copy ทั้งบรรทัด (รันใน `penprinting-dashboard/`)**

```bash
PP_EVAL_ONLY=synth-a6-brochure-first,synth-a6-book-odd,synth-b5-book-full,synth-a7-brochure,synth-hardcover,synth-ring-binding,synth-saddle-stitch,synth-leadtime-followup,synth-shipping-with-spec node --env-file=.env.eval.local --import tsx --conditions=react-server eval/pp-customer/run-eval.mjs --flow .claude/hillclimb/pp-customer --variant baseline --model claude-sonnet-5-5 --reps 2 --approve-harness
```
Expected: บรรทัด harness sha recorded · resume ข้าม 136 แถวเดิม · รัน 18 แถว (≈ 1-2 นาที) · `errors.jsonl` ไม่เพิ่มแถว

- [ ] **Step 5: ตรวจแถวใหม่**

Run: `node -e 'const r=require("fs").readFileSync(".claude/hillclimb/pp-customer/baseline/results.jsonl","utf8").trim().split("\n").map(JSON.parse).filter(x=>x.prompt_id.startsWith("synth-")&&!["synth-pvc-20","synth-chinese-100","synth-namecard-3box"].includes(x.prompt_id));console.log(r.length,[...new Set(r.map(x=>x.model))],r.map(x=>`${x.prompt_id}#${x.rep}=${x.grade.pass}`).join(" "))'`
Expected: `18 [ 'claude-sonnet-5-5…' ] …` — คาดว่า A6/B5/สันห่วง/เวลาผลิตส่วนใหญ่ `=0` (prompt เดิมส่งต่อ/ถาม) · `synth-a7-brochure` และ `synth-saddle-stitch` น่าจะ `=1` — จดผลลง `regrade-2026-11-04.txt`

- [ ] **Step 6: (ถ้า Task 1 Step 5 ถูกข้าม) รัน judge-negatives ตอนนี้** → 4/4

---

### Task 4: Prompt v2 + tests (TDD — commit พร้อมกัน)

**Files:**
- Modify: `lib/ai-quote/prompt-customer.ts` (`buildCustomerSystemPrompt`)
- Modify: `tests/ai-quote-prompt-customer.test.ts` (เพิ่ม `describe` ใหม่ท้ายไฟล์; ของเดิมห้ามแก้)

**Interfaces:**
- Consumes: `VALID_PAPER_NAMES`, `CALENDAR_KIND_ASK` (เดิม) · `detectCustomerEscalation(quoteCount, reply)` จาก `customer-triggers.ts` (ใช้ใน test)
- Produces: ข้อความ prompt ที่มีประโยคคงที่ตาม Step 1 (Task 5 ไม่ต้องรู้โครงสร้าง — รันผ่าน `runQuoteTurn` เดิม)

- [ ] **Step 1: เขียน tests (RED) — `describe('customer prompt — round-2 policy: sizes, binding, lead-time, format (2026-11-04)')`**

```ts
describe('customer prompt — round-2 policy: sizes, binding, lead-time, format (2026-11-04)', () => {
  const sizes = p.split('## ขนาดนอกรายการ')[1]?.split('\n## ')[0] ?? '';
  const binding = p.split('## การเข้าเล่ม')[1]?.split('\n## ')[0] ?? '';
  const handoff = p.split('## เมื่องานเกินขอบเขต')[1]?.split('\n## ')[0] ?? '';
  const namecard = p.split('## นามบัตร — กฎเฉพาะ')[1]?.split('\n## ')[0] ?? '';
  const LEAD = 'ระยะเวลาผลิตและค่าส่งขึ้นกับงานค่ะ ทีมงานแจ้งให้ตอนยืนยันราคานะคะ';

  it('A6 maps to A5 with the quantity halved, total only, source disclosed', () => {
    expect(sizes).toMatch(/A6[^\n]*A5[^\n]*(÷ 2|หาร 2)/);
    expect(sizes).toContain('A6 คิดจาก A5');
    expect(sizes).toMatch(/ราคารวม[^\n]*(ไม่แสดง|ห้ามแสดง)[^\n]*(ต่อใบ|ต่อเล่ม)/);
    expect(sizes).toMatch(/ไม่ถาม[^\n]*ไม่ส่งต่อ|ไม่ส่งต่อ[^\n]*ไม่ถาม/);
  });
  it('A6 rule rounds odd quantities up and covers books/notebooks too', () => {
    expect(sizes).toContain('ปัดขึ้น');
    expect(sizes).toMatch(/15 เล่ม[^\n]*8 เล่ม/);
  });
  it('B5 maps to A4 at the same quantity; per-unit price allowed', () => {
    expect(sizes).toMatch(/B5[^\n]*A4[^\n]*จำนวนเท่าเดิม/);
    expect(sizes).toContain('B5 คิดราคาเท่า A4');
  });
  it('size aliases (a6 / เอ6 / บี5) map the same way; other sizes still hand off', () => {
    expect(sizes).toMatch(/เอ6|เอ 6/);
    expect(sizes).toMatch(/บี5|บี 5/);
    expect(sizes).toMatch(/A7[^\n]*ส่งต่อทีมงาน/);
  });
  it('halving the quantity is tool-parameter prep, not price arithmetic', () => {
    expect(sizes).toMatch(/จำนวน[^\n]*ไม่ใช่[^\n]*ราคา|เตรียม[^\n]*เครื่องมือ/);
  });
  it('binding: glue/saddle are standard and never asked; ring adds a fixed line the model must not sum', () => {
    expect(binding).toMatch(/ไสกาว[^\n]*มุงหลังคา[^\n]*ไม่ต้องถาม/);
    expect(binding).toContain('ขอบกาว');
    expect(binding).toContain('เข้าเล่มสันห่วงเพิ่มเล่มละ 15 บาท (ยังไม่รวมในราคาด้านบน)');
    expect(binding).toMatch(/สันห่วง[^\n]*ห้ามบวก/);
  });
  it('hard cover and thread sewing are named in the hand-off list and win over the nearest-paper rule', () => {
    expect(handoff).toContain('ปกแข็ง');
    expect(handoff).toContain('เย็บกี่');
    expect(p).toMatch(/ปกแข็ง[^\n]*ส่งต่อก่อน[^\n]*ไม่ถามกระดาษ/);
  });
  it('gram-only paper (e.g. 75 gram) offers the in-list neighbours instead of handing off', () => {
    expect(p).toMatch(/บอกแค่แกรม[^\n]*Bond 70[^\n]*Bond 80[^\n]*Green Read 75/);
  });
  it('lead-time / shipping: fixed no-number sentence that does not close AI mode', () => {
    expect(p).toContain(LEAD);
    expect(p).toMatch(/เวลาผลิต[^\n]*ค่าส่ง[^\n]*ไม่มีตัวเลข|ไม่มีตัวเลข[^\n]*เวลาผลิต/);
    expect(detectCustomerEscalation(0, LEAD)).toBe(false);
    expect(detectCustomerEscalation(0, `💰 ใบปลิว A4 500 ใบ → ใบละ 1.20 บาท (ยังไม่รวม VAT 7%)\n${LEAD}`)).toBe(false);
  });
  it('no thinking aloud, no preamble, no spec echo', () => {
    expect(p).toMatch(/ห้าม[^\n]*ย่อหน้าวิเคราะห์/);
    expect(p).toContain('ตอนนี้ลูกค้าไม่ได้บอกว่า');   // the ❌ example from s33-t0
    expect(p).toMatch(/ห้ามเกริ่น[^\n]*รับทราบค่ะ/);
  });
  it('namecard: both prices stay on one 💰 line even with a quantity; box-count soft-ask is an ask', () => {
    expect(p).toContain('กล่องละ X × 2 = Y บาท');
    expect(p).toContain('ห้ามแยกบรรทัดต่อแบบ');
    expect(namecard).toContain('บอกจำนวนกล่องได้เลย');
    expect(namecard).toMatch(/ถือเป็นการถามจำนวน/);
    expect(namecard).not.toMatch(/\d{2,} ?บาท/);
  });
  it('brochure with type + qty known never asks gram/colour/sides (worked example from s69)', () => {
    expect(p).toContain('อาร์ตมัน');
    expect(p).toMatch(/อาร์ตมัน[^\n]*Art 120/);
  });
  it('"ระบบ" joins the internal-vocabulary ban; dash bullets are markdown', () => {
    expect(p).toContain('คำว่า "ระบบ"');
    expect(p).toContain('ขีด "-" ต้นบรรทัด');
  });
  it('prompt grew by at most ~30 lines', () => {
    expect(p.split('\n').length).toBeLessThanOrEqual(185);
  });
});
```

- [ ] **Step 2: รันให้เห็น RED**

Run: `npx vitest run tests/ai-quote-prompt-customer.test.ts`
Expected: describe ใหม่ตก (ส่วนใหญ่ `expected '' to match …`) · describe เดิมผ่านหมด

- [ ] **Step 3: แก้ `buildCustomerSystemPrompt()` ใน `prompt-customer.ts`** — ตำแหน่ง/เนื้อหา (ถ้อยคำอื่นเป็นของ implementer ให้เข้ากับสไตล์ section เดิม). ⚠️ regex ใน test ใช้ `[^\n]` = วลีที่ test จับคู่ต้องอยู่**บรรทัดเดียวกัน**; ห้ามเขียน "4 ชนิด"/"4 ประเภท" ที่ไหนเลย (test เดิม `not.toContain`); ตัวอย่างใน section นามบัตรห้ามมีเลข ≥ 2 หลักตามด้วย "บาท":

1. **section ใหม่ `## ขนาดนอกรายการ — A6 / B5 (ใบปลิว + หนังสือ/สมุด) ตีราคาทันที ไม่ถาม ไม่ส่งต่อ`** วางถัดจาก `## กระดาษนอกรายการ …` — บรรทัดที่ต้องมี: A6 (รวมที่เขียน a6/เอ6/เอ 6) → เรียก `compute_quote` เป็น A5 จำนวน ÷ 2 ปัดขึ้น พร้อมตัวอย่าง `ใบปลิว A6 1,000 ใบ = A5 500 ใบ` และ `หนังสือ A6 15 เล่ม = A5 8 เล่ม` · การหารจำนวนเป็นการเตรียมพารามิเตอร์เครื่องมือ ไม่ใช่การคำนวณราคา · แสดงราคารวม (totalPrice) อย่างเดียว ไม่แสดงราคาต่อใบ/ต่อเล่ม · บรรทัด 📋 `A6 คิดจาก A5 {N} ใบ (ตัดครึ่ง)` · B5 (บี5) → A4 จำนวนเท่าเดิม แสดงรูปแบบปกติ + 📋 `B5 คิดราคาเท่า A4` · ขนาดอื่น (A7, ซม.) → ส่งต่อทีมงาน
2. **section ใหม่ `## การเข้าเล่ม (หนังสือ/สมุด)`** ถัดจาก section ขนาด — ไสกาว/มุงหลังคา/ขอบกาว = มาตรฐาน ไม่ต้องถาม ไม่ต้องพูดถึง · สันห่วง = ตีราคาปกติ + บรรทัด `📋 เข้าเล่มสันห่วงเพิ่มเล่มละ 15 บาท (ยังไม่รวมในราคาด้านบน)` ห้ามบวกรวมเอง · ปกแข็ง/เย็บกี่/อื่น → ส่งต่อทีมงาน · `ปกแข็ง/เข้าเล่มพิเศษ → ส่งต่อก่อน ไม่ถามกระดาษ/จำนวนหน้า`
3. **`## กระดาษนอกรายการ`** เพิ่มข้อ: ลูกค้าบอกแค่แกรม ไม่บอกชนิด (เช่น "75 gram", "200 แกรม") → เสนอตัวในรายการแกรมใกล้เคียง (75 → `Bond 70 / Bond 80 / Green Read 75`) ไม่ส่งต่อ
4. **`## เมื่องานเกินขอบเขต`** เพิ่มบรรทัด `- ปกแข็ง / เย็บกี่ / เข้าเล่มแบบอื่นนอกจากไสกาว มุงหลังคา สันห่วง`
5. **section ใหม่ `## ลูกค้าถามเวลาผลิต / ค่าส่ง`** ถัดจาก `## เมื่อลูกค้าจะสั่งงานจริง` — บรรทัดแรกของ body ต้องมี "เวลาผลิต", "ค่าส่ง", "ไม่มีตัวเลข" ในบรรทัดเดียว เช่น `ลูกค้าถามเวลาผลิตหรือค่าส่ง → ตอบประโยคนี้ตรงตัว ไม่มีตัวเลข ไม่ใช้วลีส่งต่อ (ลูกค้าคุยต่อได้): ระยะเวลาผลิตและค่าส่งขึ้นกับงานค่ะ ทีมงานแจ้งให้ตอนยืนยันราคานะคะ` · มีสเปกในข้อความเดียวกัน → ตีราคาแล้วต่อท้ายประโยคนี้
6. **`## นามบัตร — กฎเฉพาะ`** เพิ่ม: ❌ `บอกจำนวนกล่องได้เลยค่ะ` / `กี่กล่องดีคะ` ถือเป็นการถามจำนวน — ห้าม (ไม่ใส่ตัวเลขราคาใน section นี้)
7. **`## รูปแบบคำตอบราคา`** หลังบรรทัด `- นามบัตร บอกจำนวนแล้ว: บรรทัดราคา = ราคาต่อกล่อง × จำนวนกล่อง = ราคารวม …` (คงไว้) เพิ่ม: ยังไม่รู้หน้า → ทั้ง 2 แบบในบรรทัด 💰 เดียว `💰 นามบัตร 200 ใบ (2 กล่อง) → หน้าเดียว กล่องละ X × 2 = Y บาท · หน้า-หลัง กล่องละ X' × 2 = Y' บาท (ยังไม่รวม VAT 7%)` ห้ามแยกบรรทัดต่อแบบ; คำถาม "รับแบบไหนดีคะ" รวมในบรรทัด 📋 · เพิ่มข้อ **ห้ามเกริ่น** ("รับทราบค่ะ" "ขอบคุณที่สอบถามนะคะ" "ได้เลยค่ะ 😊" ลอย ๆ) และ **ห้ามมีย่อหน้าวิเคราะห์** ก่อนคำตอบ — ❌ ตัวอย่าง `ตอนนี้ลูกค้าไม่ได้บอกว่าเป็นงานชนิดไหนตรงๆ แต่สเปกนี้ตรงกับ…` ✅ เริ่มที่ประโยคพูดกับลูกค้าทันที
8. **`## ⭐ เกณฑ์ "ครบพอตีราคา"`** ข้อโบรชัวร์ เพิ่มคู่: ❌ `"โบรชัวร์อาร์ตมัน A5 หน้าหลัง ราคาเท่าไหร่" → ถามแกรม` ✅ ถามแค่จำนวน; "อาร์ตมัน" ไม่ระบุแกรม = Art 120 เงียบ ๆ
9. **บรรทัดแรก (persona)** เพิ่ม `คำว่า "ระบบ"` ในรายการศัพท์ภายในที่ห้าม (ใช้ "น้อง PP" แทน) · **`## รูปแบบข้อความ`** เพิ่ม `ห้ามใช้ขีด "-" ต้นบรรทัด` (ใช้อีโมจิ/ขึ้นบรรทัดแทน)

- [ ] **Step 4: รันให้เห็น GREEN + ทั้ง suite**

Run: `npx vitest run tests/ai-quote-prompt-customer.test.ts` → ผ่านทั้งไฟล์ (รวม `namecard section carries no price number`)
Run: `npm run type-check && npm test` → เขียว (จำนวน tests = 925 + 14)

- [ ] **Step 5: อ่าน prompt ที่ได้ทั้งไฟล์หนึ่งรอบ** — เช็ค: ไม่มี section ไหนขัดกัน (เช่น "ขนาดห้ามเดา" ของปฏิทินยังหมายถึงปฏิทินเท่านั้น), ความยาว ≤ 185 บรรทัด, ประโยคคงที่ตรง test ตัวอักษรต่อตัวอักษร

- [ ] **Step 6: Commit**

```bash
git add lib/ai-quote/prompt-customer.ts tests/ai-quote-prompt-customer.test.ts
git commit -m "feat(ai-quote): น้อง PP prompt v2 — A6→A5 ÷2 / B5→A4 quoted at once, binding rules (ring +15 line, hard cover hands off), lead-time answer stays in mode, no thinking-aloud/preamble (spec 2026-11-04)"
```
(ยัง**ไม่ push** — รอผล eval Task 5)

---

### Task 5: ⛔ approve #2 (pilot v2) → รันเต็ม → gate → change.md (orchestrator + คุณนุ๊ก)

**Files:**
- Create (gitignored): `.claude/hillclimb/pp-customer/v2/change.md`
- Reads: `.claude/hillclimb/pp-customer/{baseline,v2}/results.jsonl`, `regrade-2026-11-04.txt`

**Interfaces:**
- Consumes: prompt v2 (Task 4) · baseline 154 แถว (Task 2+3)
- Produces: ตัวเลข v2 (pass, paired delta, per-group, cost) + คำตัดสิน ship/v3 ที่ Task 6 ใช้เขียน docs

- [ ] **Step 1: ส่งคำสั่ง approve #2 (pilot 1 เคส) ให้คุณนุ๊ก**

```bash
PP_EVAL_ONLY=synth-a6-brochure-first node --env-file=.env.eval.local --import tsx --conditions=react-server eval/pp-customer/run-eval.mjs --flow .claude/hillclimb/pp-customer --variant v2 --model claude-sonnet-5-5 --reps 2 --approve-harness
```
Expected: sha recorded · 2 แถวใน `v2/results.jsonl` · `errors.jsonl` ว่าง

- [ ] **Step 2: ตรวจ pilot** — Run: `node -e 'const r=require("fs").readFileSync(".claude/hillclimb/pp-customer/v2/results.jsonl","utf8").trim().split("\n").map(JSON.parse);for(const x of r)console.log(x.prompt_id,x.rep,x.model,JSON.stringify(x.grade),JSON.stringify(x.explanation).slice(0,300))'`
Expected: ทั้ง 2 reps `pass:1` (calls A5 qty 500 · ไม่มี "ใบละ") — ถ้า 0 อ่าน trace `v2/traces/synth-a6-brochure-first_rep*.json` แก้ prompt (กลับ Task 4 Step 3-6) แล้วขอ approve ใหม่ **ก่อน**รันเต็ม

- [ ] **Step 3: Claude รัน v2 ที่เหลือ (background ≈ 6 นาที)**

```bash
node --env-file=.env.eval.local --import tsx --conditions=react-server eval/pp-customer/run-eval.mjs --flow .claude/hillclimb/pp-customer --variant v2 --model claude-sonnet-5-5 --reps 2
```
Expected: resume ข้าม 2 แถว pilot · เสร็จ 154 แถว · `errors.jsonl` ว่าง (ถ้ามี 429/5xx scaffold retry เอง; แถวที่ค้างรันคำสั่งเดิมซ้ำ = resume)

- [ ] **Step 4: สรุป + report**

Run: `node eval/pp-customer/summarize.mjs .claude/hillclimb/pp-customer` และ `node eval/pp-customer/build-report-lite.mjs .claude/hillclimb/pp-customer/`
Expected: ตาราง baseline vs v2 (pass + CI, per-metric, per-group, paired delta, cost) · `report.html` สร้างใหม่

- [ ] **Step 5: gate ตาม spec §2 (เกณฑ์ ship)**

Run:
```bash
node -e '
const fs=require("fs"),L=v=>fs.readFileSync(`.claude/hillclimb/pp-customer/${v}/results.jsonl`,"utf8").trim().split("\n").map(JSON.parse);
const by=rows=>{const m={};for(const r of rows)(m[r.prompt_id]??=[]).push(r.grade.pass);return m};
const b=by(L("baseline")),v=by(L("v2"));
const T=["s57-t2","s41-t2","s107-t0","s106-t4","s69-t0","s50-t0"];
console.log("targets both reps pass:",T.map(id=>`${id}=${(v[id]||[]).join("")}`).join(" "));
const reg=Object.keys(b).filter(id=>b[id].every(x=>x===1)&&(v[id]||[]).length===2&&v[id].every(x=>x===0));
console.log("paired hard regressions (must be empty):",reg);
const G=(rows,tag)=>{const s=rows.filter(r=>(r.tags||[]).includes(tag));return `${tag} ${s.filter(r=>r.grade.pass).length}/${s.length}`};
for(const t of ["namecard","calendar","pvccard","scope"])console.log("v2",G(L("v2"),t),"| baseline",G(L("baseline"),t));'
```
Expected: 6 targets = `11` ทุกตัว · `paired hard regressions: []` · calendar/pvccard/scope เท่า baseline (100%) · namecard 26/26
→ ผ่าน = ship (Task 6) · ไม่ผ่าน = อ่าน `v2/traces/<case>_rep*.json` ของเคสที่ถอย/ตก, แก้ prompt (+test ถ้าเป็นกฎใหม่) เป็น **v3**: commit → คุณนุ๊ก approve #3 (pilot เคสที่เคยตก) → รันเต็ม `--variant v3` → gate อีกครั้ง → ship ตัวที่ดีที่สุดใน {v2, v3} ตาม spec §2 (ห้ามถอยไป prompt เดิม)

- [ ] **Step 6: เขียน `v2/change.md`** (บรรทัดแรก = ชื่อสั้นที่ report ใช้)

```
prompt v2: A6→A5 ÷2 / B5→A4 quoted at once · binding (ring +15 line, hard cover hands off) · lead-time/shipping no-number · format (no thinking-aloud/preamble, namecard one 💰 line, "ระบบ"/dash banned)
- grader: PROMPT_CONSTANTS (300 ค่าออกแบบ / 15 สันห่วง) context-bound; format fails on "ระบบ" and "- " — baseline + v1 regraded 2026-11-04 with the new grader AND relabelled s57-t2/s41-t2/s107-t0/s100-t6 (baseline pass 126 → <N>)
- cases: +9 synthetic (sizes/binding/lead-time); baseline rows for them run with the pre-v2 prompt (approve #1)
- judge note: v2 judged with prompt v2 as <assistant_rules>, baseline with the 10/24 prompt — judge metrics compare across rule sets
```

---

### Task 6: Ship + docs (session discipline)

**Files:**
- Push: `main` (Vercel auto-deploy)
- Modify: `NEXT-SESSION.md` (entry ใหม่บนสุด + `## ⏳ Pending (2026-11-04)`), `dashboard-v2.md` (version history), `PATTERNS.md` (§11.5), `eval/pp-customer/README.md` (ย่อหน้า "Round 2"), `AUDIT-BACKLOG.md` (บรรทัด "Latest update" ถ้าแตะ item — ไม่มีก็ข้าม)
- Memory: update `/Users/witsarut.p/.claude/projects/-Users-witsarut-p-Desktop-Project-Report-Penprinting/memory/project_pp_customer_eval.md` + เพิ่ม `feedback_approve_harness_runs_eval.md` + บรรทัดใน `MEMORY.md`

**Interfaces:**
- Consumes: ตัวเลขจาก Task 5 Step 4-5, `regrade-2026-11-04.txt`, commit hashes ของ Task 1/2/4

- [ ] **Step 1: push code**

Run: `git push origin main` → Vercel deploy
Expected: push สำเร็จ; จด sha ของ commit prompt (Task 4)

- [ ] **Step 2: post-deploy smoke pin headSha** — Run: `gh run list --limit 15 --json headSha,status,conclusion,url,name,createdAt` แล้วเลือกแถวที่ `headSha` = sha จาก Step 1 (ไม่ใช่ latest) รอจน `conclusion: success` (ถ้า `gh` โดนบล็อก: เปิด `https://dashboard.penprinting.co/` ใน browser pane ตรวจ hash chunk เปลี่ยน + จดว่า smoke ยังไม่ได้ยืนยัน)

- [ ] **Step 3: docs** — เขียนตามรูปแบบ entry เดิม:
  - `NEXT-SESSION.md`: entry `**Session 2026-11-04 (Mac) — 🧪 eval round 2 + น้อง PP prompt v2 …**` (ที่มา · นโยบาย 3 ข้อ · grader/cases · ผล baseline(regraded)→v2 ตัวเลขจาก summarize · gate · ship · lessons) + Pending: smoke LINE จริง 3 เคส (ใบปลิว A6 · สมุดสันห่วง · "กี่วัน") · ลบ key หลัง 11/9 · follow-up calc `binding: ring` + A6/B5 native (spec §9) · ยกรายการเดิม (I4, branch เก่า, smoke /track)
  - `dashboard-v2.md`: version history บรรทัดใหม่ (prompt v2 + eval round 2, commits)
  - `PATTERNS.md` §11.5: `--approve-harness` รัน eval ต่อ → คำสั่งต้องครบ flag · regrade หลังแก้ label · baseline เคสใหม่ก่อน apply prompt · เลขคงที่ใน grader ต้องผูกรูปประโยค · ship criteria แบบ paired ไม่ใช่ point estimate
  - `eval/pp-customer/README.md`: ย่อหน้า Round 2 (77 เคส, ลำดับ approve, ผล)
  - memory: อัปเดต `project_pp_customer_eval.md` (ผลรอบ 2 + ลำดับงาน) · ใหม่ `feedback_approve_harness_runs_eval.md` (type feedback: "--approve-harness ไม่ใช่แค่ record sha — รัน eval ต่อด้วย flag ที่ส่ง; คำสั่งที่ให้ user ต้องครบ --model/--reps") · `MEMORY.md` เพิ่ม 1 บรรทัด

- [ ] **Step 4: Commit + push docs**

```bash
git add NEXT-SESSION.md dashboard-v2.md PATTERNS.md eval/pp-customer/README.md
git commit -m "docs(session-end): 2026-11-04 — น้อง PP prompt v2 shipped after eval round 2 (baseline <N>/154 → v2 <M>/154 paired), policy A6/B5/binding/lead-time, lessons §11.5"
git push origin main
```

- [ ] **Step 5: แจ้งคุณนุ๊ก pending actions** (LINE smoke 3 เคส เปิด session ใหม่ก่อน · ลบ key หลัง 11/9 · เลือกว่าจะทำ follow-up calc binding/A6 เมื่อไร)
