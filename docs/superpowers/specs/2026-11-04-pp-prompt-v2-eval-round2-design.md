---
title: น้อง PP prompt v2 + eval round 2
date: 2026-11-04
status: reviewed (builder check 2026-11-04 → 3 คำถาม ตอบครบใน §2/§8) — รอคุณนุ๊ก approve ฉบับสุดท้าย
related: [[2026-10-19-price-table-products-calendar-pvc-design]], eval/pp-customer/README.md, PATTERNS §11
---

# น้อง PP prompt v2 + eval round 2 — design

## 1. Intent / ทำไมตอนนี้

Eval รอบแรก (2026-10-24, `eval/pp-customer/`) วัด Sonnet 5.5 (prod) บน 68 เคสจาก prod × 2 reps → pass **92.6% (126/136)**.
10 แถวที่ตก (6 เคส) **เป็นช่องว่างของ prompt ไม่ใช่โมเดล**: 3 เคสลูกค้าขอขนาด A6/B5 แล้วน้อง PP "ส่งต่อทีมงาน" ทันที (ปิดโหมด AI) · ปกแข็งถามต่อแทนส่งต่อ · ถามแกรมกระดาษทั้งที่กฎให้ใช้ค่ามาตรฐาน · เลขค่าออกแบบ 300 จาก prompt โดน grader ตีว่าไม่ได้มาจาก tool.
กรรมการยังชี้ปัญหารูปแบบใน 23 แถวที่ผ่าน: ย่อหน้าวิเคราะห์ภายในหลุดมาในคำตอบ · นามบัตร 2 ราคาแตก 5 บรรทัด · เกริ่น/ทวนสเปก · คำว่า "ระบบ" · bullet "-".

รอบนี้ปิดช่องว่างเหล่านั้นด้วย**นโยบายที่คุณนุ๊กตัดสินแล้ว** (§4) + กฎรูปแบบ แล้ววัดด้วย harness เดิมแบบ paired เทียบ baseline.
**เครดิต API $100 หมด 2026-11-09** → ต้องรันให้จบภายในสัปดาห์นี้.

## 2. Goals / Non-goals / Anti-goals

**เกณฑ์ ship (คุณนุ๊กตัดสิน 2026-11-04): ship prompt ตัวที่ดีที่สุดที่มี** เมื่อ (1) 6 เคสเป้าหมายผ่านทั้ง 2 reps และ (2) ไม่มี hard regression แบบ paired — เกณฑ์อื่น (คะแนนกรรมการ, pass rate รวม) เป็นข้อมูลประกอบ ไม่ block; ถ้า v2 ไม่ถึง (1)+(2) ลองได้อีก 1 รอบ (v3) ภายในงบ แล้ว ship ตัวที่ดีที่สุดในสองรอบนั้น (ห้ามถอยไปใช้ prompt เดิมถ้า v2/v3 ผ่าน (1)+(2))

**Goals**
- 6 เคสที่ตกในรอบแรก (s57-t2, s41-t2, s107-t0, s106-t4, s69-t0, s50-t0) ผ่านทั้ง 2 reps ใน v2
- **ไม่มี hard regression แบบ paired**: เคสที่ baseline (หลัง regrade ด้วย grader + label ใหม่) ผ่านทั้ง 2 reps ต้องไม่ตกทั้ง 2 reps ใน v2 — วัดต่อเคสจาก `summarize.mjs` ไม่ใช่ point estimate รวม (noise floor ≈ ±9 จุด) · กลุ่ม calendar / pvccard / scope ที่ baseline 100% ต้องยัง 100% (namecard หลัง regrade จะเหลือ 24/26 เพราะ label s100-t6 เข้มขึ้น — bar ของ v2 คือ 26/26)
- `judge_concise` ≥ baseline (83.1%) แบบ point estimate — กรรมการไม่ deterministic (CI ±6 จุด) จึงเป็นเกณฑ์ **informational** ไม่ใช่ตัว block ship; จดใน `v2/change.md` ว่ากรรมการเกรด v2 ด้วย prompt v2 เป็น `<assistant_rules>` ส่วน baseline ใช้ prompt เดิม (judge metrics เทียบข้าม rule set)
- นโยบายใหม่ทุกข้อมีเคสในชุด (ไม่มีกฎที่ไม่มีเคสวัด)
- ship prompt ขึ้น prod (Vercel) พร้อม tests ที่ pin กฎใหม่ + docs ครบตาม session discipline

**Non-goals (รอบนี้ไม่ทำ)**
- ไม่สลับโมเดล (Sonnet 5.5 คงเดิม)
- ไม่แก้ calculator / `compute_quote` schema (A6/B5 + สันห่วง จัดการใน prompt — ดู follow-up §9)
- ไม่แก้ router / `customer-triggers.ts` / `run.ts`
- ไม่แตะ `eval/pp-customer/run-eval.mjs` (scaffold — กติกาเดิม)

**Anti-goals (ถ้าเกิดถือว่าล้มเหลวแม้ตัวเลขดี)**
- กฎใหม่ทำให้น้อง PP **คำนวณราคาเอง** (คูณ/หาร/บวก) — ทุก "N บาท" ต้องมาจาก tool หรือเป็นเลขคงที่ที่ระบุใน prompt เท่านั้น (§5.2)
- ใช้วลี "ส่งต่อทีมงาน" / "ให้ทีมงานประเมิน" ในเทิร์นที่ไม่ใช่การส่งต่อจริง (ปิดโหมด AI โดยไม่ตั้งใจ)
- ทำให้ grader "ใจดี" จนช่องโหว่เดิมกลับมา (เช่น whitelist เลขแบบไม่ผูกบริบท)

## 3. ของเดิมที่ต้องรู้ (current state)

| อะไร | อยู่ที่ | หมายเหตุ |
|---|---|---|
| prompt ลูกค้า | `lib/ai-quote/prompt-customer.ts` (`buildCustomerSystemPrompt`) 153 บรรทัด | วลี "ส่งต่อทีมงาน" ผูกกับ `detectCustomerEscalation` (regex `/ส่งต่อทีมงาน|ให้ทีมงานประเมิน/` เมื่อ quoteCount = 0) |
| tests ที่ pin prompt | `tests/ai-quote-prompt-customer.test.ts` | `toContain` วลีสำคัญ — เพิ่ม ไม่ลบ |
| tool schema | `lib/ai-quote/tools.ts` | brochure size enum A2/A3/A4/A5/ตัด16 · notebook A4/A5 · qty = positive int (calc `quote-schema.ts`) |
| calc เข้าเล่ม | `print-calculator-next/lib/defaults.ts` `binding: 2.5`/เล่ม flat | ไม่มีตัวเลือกชนิดเข้าเล่ม |
| harness | `eval/pp-customer/impl.mjs` (`gradeHard`, `outcomeOf`, judge) · `cases.json` (68) · `selftest.mjs` (21 เช็ค) · `judge-negatives.mjs` (4) · `regrade.mjs` · `summarize.mjs` · `build-report-lite.mjs` | harness sha gate: `_state.json.harness_paths` = impl.mjs, cases.json, prompt-customer.ts, run.ts, tools.ts, customer-deps.ts — แก้ไฟล์ไหนก็ต้องให้คุณนุ๊ก `--approve-harness` ใหม่ |
| ผลรอบแรก | `.claude/hillclimb/pp-customer/{baseline,v1}/` (gitignored) | baseline = Sonnet · v1 = Opus (ไม่ใช้ต่อ) |
| grader `prices` | ทุก match ของ `/(\d[\d,]*(?:\.\d+)?)\s*บาท/` ต้องเท่ากับเลขใน tool result ของเทิร์นนี้ | ตอนนี้ไม่มี whitelist → "ค่าออกแบบ 300 บาท" จาก prompt ตก |
| `expected` ของเคส | `outcome` (string หรือ any-of array) · `calls[{productType, spec}]` partial match recursive · `allowCalls` · `priceTable` / `noTable` · `mustAsk[regex]` / `mustNotAsk[regex]` (= reply must / must-not match) · `note` | `mustAsk` ใช้เป็น "reply ต้องมีข้อความนี้" ได้ทั่วไป ไม่จำกัดคำถาม |

## 4. นโยบายที่คุณนุ๊กตัดสิน (2026-11-04) — เขียนลง prompt ตามนี้

### 4.1 ขนาดนอกรายการ (ใบปลิว + หนังสือ/สมุด) — ตีราคาทันที ไม่ถาม ไม่ส่งต่อ
- **A6 → เรียก `compute_quote` เป็น A5 ด้วยจำนวน ÷ 2** (A6 = ครึ่งของ A5): ใบปลิว A6 1,000 ใบ = A5 500 ใบ · หนังสือ/สมุด A6 ก็หาร 2 เหมือนกัน (หนังสือ A6 15 เล่ม → A5 *8 เล่ม*)
  - *การตัดสินของ Claude:* จำนวนคี่ **ปัดขึ้น** (15 → 8) · การหารจำนวนเป็นการเตรียมพารามิเตอร์ tool ไม่ใช่การคำนวณราคา — prompt ต้องบอกชัดว่าอนุญาตเฉพาะตรงนี้
  - คำตอบแสดง**ราคารวมอย่างเดียว** (`totalPrice`) — ไม่แสดงราคาต่อใบ/ต่อเล่มของ A6 เพราะ `unitPrice` ที่ tool คืนเป็นของ A5 และห้ามหารเอง
  - บรรทัด 📋 ต้องบอกที่มา เช่น `📋 A6 คิดจาก A5 500 ใบ (ตัดครึ่ง) · ประเมินจาก: 4 สี / 2 หน้า / Art 120 — สเปกต่างจากนี้บอกได้เลยค่ะ` (*ถ้อยคำ = การตัดสินของ Claude*)
- **B5 → เรียกเป็น A4 จำนวนเท่าเดิม** — แสดงรูปแบบปกติ (ใบละ/เล่มละ + รวม ได้ เพราะ 1 B5 = 1 A4) + 📋 `B5 คิดราคาเท่า A4`
- *การตัดสินของ Claude:* ขนาดอื่นที่ไม่ใช่ A6/B5 (A7, ขนาดเป็น ซม. เอง, ฯลฯ) → **ยังส่งต่อทีมงานเหมือนเดิม** — ไม่มีเคสจริง ไม่เดากฎเพิ่ม

### 4.2 การเข้าเล่ม
- **ไสกาว / มุงหลังคา** (รวมที่ลูกค้าเรียก "ขอบกาว") → ตีราคาปกติ ไม่ถาม ไม่ต้องพูดถึง
- **สันห่วง → ตีราคาปกติจาก tool แล้วเพิ่มบรรทัดคงที่** `เข้าเล่มสันห่วงเพิ่มเล่มละ 15 บาท (ยังไม่รวมในราคาด้านบน)` — น้อง PP **ห้ามบวกรวมเอง**; ทีมงานยืนยันยอดจริง (disclaimer เดิมครอบอยู่แล้ว)
- **ปกแข็ง / เย็บกี่ / เข้าเล่มแบบอื่นนอกเหนือจากนี้ → ส่งต่อทีมงาน** — ระบุชื่อในหัวข้อ "เมื่องานเกินขอบเขต" ให้ชัด (เคส s106-t4)

### 4.3 ลูกค้าถามเวลาผลิต / ค่าส่ง — "แล้วแต่งาน"
- ตอบกลาง ๆ **ไม่มีตัวเลข** และ **ไม่ใช้วลีส่งต่อ** (คุยต่อได้): *ถ้อยคำ = การตัดสินของ Claude* เช่น `ระยะเวลาผลิตและค่าส่งขึ้นกับงานค่ะ ทีมงานแจ้งให้ตอนยืนยันราคานะคะ`
- ถ้าข้อความเดียวกันมีสเปกงานครบ → ตีราคาตามปกติแล้วต่อท้ายด้วยประโยคนี้

## 5. กฎรูปแบบคำตอบ + grader (การตัดสินของ Claude ทั้งหมด — คุณนุ๊กเห็นแล้วใน chat "โอเค")

### 5.1 เพิ่ม/เสริมใน prompt
1. **ห้ามคิดดัง ๆ ในคำตอบ** — ข้อความต้องเริ่มที่ประโยคที่พูดกับลูกค้าทันที (💰 / คำถาม / template) ห้ามมีย่อหน้าวิเคราะห์ ("ตอนนี้ลูกค้าไม่ได้บอกว่า…", "สเปกนี้ตรงกับ…") — ใส่ตัวอย่างผิดจาก s33-t0 เป็น ❌
2. **นามบัตร 2 ราคา = บรรทัด 💰 เดียว** ทั้งกรณียังไม่บอกจำนวน (มีอยู่แล้ว) และกรณีบอกจำนวนแล้ว เช่น `💰 นามบัตร 200 ใบ (2 กล่อง) → หน้าเดียว กล่องละ X × 2 = Y บาท · หน้า-หลัง กล่องละ X' × 2 = Y' บาท (ยังไม่รวม VAT 7%)` — **ใช้ placeholder ไม่ใส่เลขจริง** (test เดิม pin ว่า section นามบัตรห้ามมีตัวเลขราคา — บทเรียน SPOT UV) — คำถาม "รับแบบไหนดีคะ" รวมในบรรทัด 📋 (ตาม oracle ใน selftest) ไม่แยกบรรทัด
3. **รู้ชนิดงาน + จำนวนแล้ว ห้ามถามแกรม/สี/หน้า/กระดาษซ้ำอีกชั้น** (โบรชัวร์) — กฎมีแล้วแต่ s69 หลุด → เขียนให้แรงขึ้นด้วยคู่ ❌/✅ จากเคสจริง ("โบรชัวร์อาร์ตมัน A5 หน้าหลัง" → ถามแค่จำนวน; "อาร์ตมัน" ไม่ระบุแกรม = Art 120 เงียบ ๆ)
4. **ห้ามเกริ่น** ("รับทราบค่ะ", "ขอบคุณที่สอบถามนะคะ", "ได้เลยค่ะ 😊" ลอย ๆ) และ**ห้ามทวนสเปกที่ลูกค้าบอกมาแล้ว**ท้ายข้อความ (s107)
5. **นามบัตร: ห้าม soft-ask จำนวนกล่อง** — "บอกจำนวนกล่องที่ต้องการได้เลยค่ะ" ถือเป็นการถามจำนวน (s100-t6)
6. **กระดาษบอกแค่แกรม ไม่บอกชนิด** (เช่น "75 gram", "200 แกรม") → ถือเป็นกระดาษนอกรายการ: เสนอตัวในรายการที่แกรมใกล้เคียง (75 → Bond 70 / Bond 80 / Green Read 75) **ไม่ส่งต่อ** — กฎ "กระดาษนอกรายการ" ข้อ 3 เดิมสั่งส่งต่อเมื่อ "ไม่มีชนิดเดียวกัน" ซึ่งทำให้ s107-t0 rep1 ส่งต่อ · **ลำดับความสำคัญ**: ปกแข็ง/เข้าเล่มพิเศษ → ส่งต่อ ชนะกฎกระดาษใกล้เคียง (s106-t4 มี "200 แกรม" ปนอยู่ ต้องส่งต่อ ไม่ถามกระดาษ)
7. **ศัพท์ภายในเพิ่ม: "ระบบ"** (ใช้ "น้อง PP" แทน: ❌ "ระบบประเมินให้เป็นปกมาตรฐาน" ✅ "น้อง PP ไม่มีขนาดนี้ค่ะ") · **ห้าม bullet "-"** ต้นบรรทัด (markdown list — ใช้อีโมจิ/ขึ้นบรรทัดแทน)

### 5.2 grader (`impl.mjs`) — ทุกข้อต้อง RED→GREEN ใน `selftest.mjs`
- **`prices` whitelist แบบผูกบริบท**: เลขคงที่จาก prompt ผ่านได้**เฉพาะเมื่ออยู่บรรทัดเดียวกับคำสำคัญ**: `300` กับ /ค่าออกแบบ[^\n]*300 บาท/ · `15` กับ /สันห่วง[^\n]*เพิ่มเล่มละ 15 บาท/ (ผูกทั้งคำสำคัญ + รูปประโยค — กัน "💰 สมุด สันห่วง → เล่มละ 15 บาท" หลุด). "ใบละ 15 บาท" โดยไม่มี tool ต้องยังตก (เช็คใน selftest)
- **`format` เพิ่ม 2 เช็ค**: มีคำ "ระบบ" ในคำตอบ → format 0 · มีบรรทัดเริ่มด้วย `- ` → format 0
- หลังแก้ grader **และแก้ label ใน cases.json แล้ว** → **regrade baseline (และ v1 ให้รายงานสอดคล้อง) ด้วย `regrade.mjs <flow> <variant> --write`** (hard metrics ใหม่ใช้กับทุก variant เท่ากัน — ไม่งั้นเทียบไม่แฟร์) และจดใน `v2/change.md` + NEXT-SESSION ว่า baseline ถูก regrade ด้วยกฎอะไร
- `judge-negatives.mjs` ไม่แก้ แต่รันซ้ำยืนยัน 4/4 (ฟรี)

## 6. เคส (`cases.json` + `cases-review.md`)

### 6.1 แก้ label เคสเดิม (ให้ตรงนโยบาย §4)
| เคส | เดิม | ใหม่ |
|---|---|---|
| s57-t2 "ใบปลิว A6 100 ใบ" | ask, mustAsk A5 | **quote** · calls `[{brochure, spec:{size:'A5', qty:50}}]` · mustAsk (=must mention) `['A5']` |
| s41-t2 หนังสือ A6 100 หน้า 15 เล่ม + "เนื้อใน 4 สี Bond 80" | ask, mustAsk A5 | **quote** · calls `[{book, spec:{size:'A5', qty:8, innerA:{paperName:'Bond 80', color:'4', pages:100}}}]` |
| s107-t0 B5 244 หน้า ขาวดำ 5 เล่ม เนื้อใน "75 gram" | ask, mustAsk A4\|A5 | **ask** คงเดิม (กระดาษ 75 gram ไม่รู้ชนิด → กฎกระดาษใกล้เคียง) แต่ mustAsk → `['Green Read 75|Bond 70|Bond 80']` · mustNotAsk → `['ขนาดไหน', 'A4 และ A5']` (B5 → A4 เงียบ ๆ ไม่ถาม) |
| s100-t6 "เคลือบ" (นามบัตร 2 หน้า 2 แบบ) | mustNotAsk กี่ใบ/กี่กล่อง | เพิ่ม `'จำนวนกล่อง'` ใน mustNotAsk (ยก finding ของกรรมการเป็นกฎแข็ง) |
| s106-t4 ปกแข็ง · s69-t0 · s33-t0 · s50-t0 | — | **ไม่แก้ label** (ตกเพราะ prompt/grader ไม่ใช่ label) |

### 6.2 เคสใหม่ (synthetic — id `synth-*`, tags มี `synth` + กลุ่ม) — ~9 เคส
| id | message (history ว่างเว้นแต่ระบุ) | expected |
|---|---|---|
| synth-a6-brochure-first | "ใบปลิว A6 1,000 ใบ" | quote · calls `[{brochure,{size:'A5',qty:500}}]` · mustAsk `['500']` (ต้องบอกที่มาในบรรทัด 📋) |
| synth-a6-book-odd | "หนังสือ A6 100 หน้า เนื้อใน Bond 80 ขาวดำ 15 เล่ม" | quote · calls `[{book,{size:'A5',qty:8,innerA:{paperName:'Bond 80',color:'1',pages:100}}}]` |
| synth-b5-book-full | "หนังสือ B5 200 หน้า เนื้อใน Bond 80 ขาวดำ 100 เล่ม" | quote · calls `[{book,{size:'A4',qty:100,innerA:{paperName:'Bond 80',color:'1',pages:200}}}]` · mustAsk `['A4']` |
| synth-a7-brochure | "ใบปลิว A7 1,000 ใบ" | **escalate** (ยืนยันขอบเขต §4.1 ข้อสุดท้าย) |
| synth-hardcover | "หนังสือ A5 200 หน้า เนื้อใน Bond 80 ขาวดำ ปกแข็ง 100 เล่ม" | **escalate** · mustAsk `['ปกแข็ง']` (บอกเหตุ) |
| synth-ring-binding | "สมุด A5 100 หน้า Bond 80 ขาวดำ 200 เล่ม เข้าเล่มสันห่วง" | quote · calls `[{notebook,{size:'A5',qty:200}}]` · mustAsk `['สันห่วง[^\\n]*15 บาท']` |
| synth-saddle-stitch | "หนังสือ A5 32 หน้า มุงหลังคา เนื้อใน Bond 80 4 สี 300 เล่ม" | quote · calls `[{book,{size:'A5',qty:300}}]` · mustNotAsk `['เข้าเล่ม[^\\n]*(ไหม|แบบไหน)']` |
| synth-leadtime-followup | history: ลูกค้าถามใบปลิว A4 1,000 ใบ + น้อง PP ตอบราคาแล้ว (ใช้ข้อความจริงจากเคส s57 เป็นแม่แบบ) · message "ใช้เวลาผลิตกี่วันคะ" | ask · mustNotAsk `['\\d+\\s*วัน', 'ส่งต่อทีมงาน']` · (format ห้ามวลีส่งต่ออยู่แล้ว) |
| synth-shipping-with-spec | "ใบปลิว A4 500 ใบ ค่าส่งเท่าไหร่คะ" | quote · calls `[{brochure,{size:'A4',qty:500}}]` · mustNotAsk `['ค่าส่ง[^\\n]*\\d+\\s*บาท']` · mustAsk `['ค่าส่ง']` (ต้องตอบคำถามนี้ด้วย) |

- เพิ่มส่วน "Round 2 (2026-11-04)" ใน `cases-review.md` แสดงเคสใหม่เต็ม + label เดิม/ใหม่ของ 4 เคสที่แก้ ให้คุณนุ๊ก sign-off ตามธรรมเนียมรอบแรก (นโยบายอนุมัติใน chat แล้ว — การ sign-off นี้คือตรวจ wording ของเคส)

## 7. ลำดับงาน (สำคัญ — เพื่อให้มี baseline ของเคสใหม่ด้วย prompt เดิม)

1. **grader + selftest** (RED→GREEN) → `judge-negatives.mjs` 4/4 (ฟรี)
2. **cases.json**: แก้ label 4 เคส + เพิ่ม 9 เคส · อัปเดต `cases-review.md` → **แล้วค่อย** `regrade.mjs` baseline + v1 `--write` (regrade ต้องเห็น label ใหม่ ไม่งั้น 4 เคสที่แก้ถูกเกรดด้วย label เก่า) → บันทึกตัวเลข baseline หลัง regrade ไว้เทียบ
3. **เตรียม prompt v2 ไว้นอก working tree ก่อน** (เช่น patch ใน scratchpad) — ยังไม่ apply เพื่อให้ step 4 รันด้วย prompt เดิม
4. ⛔ **คุณนุ๊ก approve #1 = รัน baseline ของเคสใหม่ด้วยตัวเอง** — `--approve-harness` ไม่ได้แค่บันทึก sha แต่**รัน eval ต่อในคำสั่งเดียวกัน**ด้วย flag ที่ส่ง (ตรวจจาก `checkHarness()` ใน run-eval.mjs) → คำสั่งต้องครบ flag: `PP_EVAL_ONLY=<9 id ใหม่> node --env-file=.env.eval.local --import tsx --conditions=react-server eval/pp-customer/run-eval.mjs --flow .claude/hillclimb/pp-customer --variant baseline --model claude-sonnet-5-5 --reps 2 --approve-harness` (≈ 18 แถว < $0.5, resume ข้าม 136 แถวเดิม; `PP_EVAL_ONLY` รับ comma list ✅ ตรวจแล้ว) — Claude ส่งคำสั่งให้ copy ทั้งบรรทัด ห้ามปล่อยให้ใช้ default `--reps 1`/ไม่มี `--model` (จะได้แถวที่ model/reps ไม่ตรง ต้องลบทิ้งแล้วเสียเงินซ้ำ)
5. **apply prompt v2** ใน `prompt-customer.ts` (§4 + §5.1) + เพิ่ม pins ใน `tests/ai-quote-prompt-customer.test.ts` (A6→A5 ÷2 · B5→A4 · สันห่วง 15 · ปกแข็ง ใน hand-off list · เวลาผลิต/ค่าส่ง ไม่มีตัวเลข · ห้ามคิดดัง ๆ · "ระบบ" ต้องห้าม) → `npm test` + `npm run type-check` เขียว
6. ⛔ **คุณนุ๊ก approve #2 = pilot v2 1 เคส** (prompt เปลี่ยน sha): `PP_EVAL_ONLY=synth-a6-brochure-first … --variant v2 --model claude-sonnet-5-5 --reps 2 --approve-harness` (ธรรมเนียมรอบแรก: คุณนุ๊ก approve บน pilot → Claude รันเต็ม) — step 4+6 รวมกันนั่งทีเดียว ≈ 15 นาที
7. **Claude รัน v2 ที่เหลือ**: คำสั่งเดิมไม่มี `--approve-harness` ไม่มี `PP_EVAL_ONLY` → resume ต่อจาก pilot ทั้ง 77 เคส (154 แถว) ≈ 6 นาที · เขียน `v2/change.md` บรรทัดแรก = ชื่อสั้น ๆ ("prompt v2: A6/B5 mapping, binding, lead-time, format") ตามด้วยสรุปสิ่งที่เปลี่ยน
8. **สรุป**: `summarize.mjs` (paired delta vs baseline, per-group, cost) + `build-report-lite.mjs` → เทียบกับเกณฑ์ §2 — ถ้าถอยกลุ่มไหน อ่าน trace ของเคสนั้นก่อนแก้ (ห้ามเดาจากตัวเลขรวม) → v3 ได้ไม่เกิน 1 รอบในงบ
9. **ship**: commit แยก (grader+cases · prompt+tests · docs) → push main → Vercel deploy → post-deploy smoke เขียว pin headSha
10. **docs**: NEXT-SESSION entry + pending · `dashboard-v2.md` version history · `PATTERNS.md` §11 เพิ่ม lessons · AUDIT-BACKLOG (ถ้ามี item เกี่ยว) · memory `project_pp_customer_eval.md` อัปเดตผลรอบ 2

## 8. งบ / เวลา
- **key `pp-eval-local` ยังอยู่ (คุณนุ๊กยืนยัน 2026-11-04)** — `.env.eval.local` ใช้ได้เลย; pilot เป็นตัวพิสูจน์อีกชั้น (401 → errors.jsonl) · เครดิตคงเหลือประมาณ ≈ $89 (ไม่ได้เช็ค Console — ถ้า pilot ตอบ credit error ให้หยุดถาม)
- **คุณนุ๊กนั่ง approve ใน session นี้** (2 คำสั่ง: baseline เคสใหม่ → pilot v2) — Claude เตรียมทุกอย่างให้พร้อมก่อน แล้วส่งคำสั่งให้ copy ทีละบรรทัดครบ flag
- v2 เต็ม 154 แถว Sonnet + กรรมการ Fable (cache อุ่น) ≈ $4.5–5 · baseline เคสใหม่ < $0.5 · v3 (ถ้ามี) อีก ≈ $5 → รวมไม่เกิน $11 จากเครดิตที่เหลือ (หมด 11/9)
- คุณนุ๊กต้องอยู่ 2 จุด (approve ×2) + sign-off `cases-review.md` + smoke LINE จริงหลัง deploy (ใบปลิว A6 · สมุดสันห่วง · ถาม "กี่วัน")

## 9. Follow-ups ที่ไม่ทำรอบนี้ (จดไว้ให้ชัด)
- **calculator รองรับ A6/B5 + `binding: ring` (+15/เล่ม)** โดยตรง → tool คืน unitPrice ของ A6 จริง + totalPrice รวมสันห่วง → prompt ไม่ต้องมี mapping/เลขคงที่ (cross-repo: calc + smoke baselines + tools.ts + prompt) — ค่อยทำเมื่อ v2 พิสูจน์ว่าลูกค้าต้องการราคาต่อใบ A6
- A7 / ขนาด ซม. เอง — รอเคสจริงก่อนตั้งกฎ

## 10. สิ่งที่ปล่อยให้ builder ตัดสิน
- ถ้อยคำภาษาไทยของกฎใหม่ (ให้เข้ากับสไตล์ section เดิม ใช้คู่ ❌/✅ เท่าที่จำเป็น — prompt ยาวขึ้นไม่เกิน ~30 บรรทัด)
- ตำแหน่งใน prompt: ขนาดนอกรายการวางถัดจาก "กระดาษนอกรายการ" · การเข้าเล่มเป็น section ใหม่ใต้กฎหนังสือ/สมุด · เวลาผลิต/ค่าส่ง ใต้ "เมื่อลูกค้าจะสั่งงานจริง"
- regex ที่แน่นอนของเคสใหม่ · history ของ synth-leadtime-followup
- จะเพิ่ม alias `mustMatch` ใน grader เพื่อความชัดเจนหรือใช้ `mustAsk` ต่อ (ถ้าเพิ่ม ต้องมี selftest)
- ลำดับ commit ย่อยภายใน §7
