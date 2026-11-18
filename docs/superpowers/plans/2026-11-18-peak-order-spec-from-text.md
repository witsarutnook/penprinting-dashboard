# /order — fill spec fields from quotation line text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/order` creates an order (or a dashboard draft) from one Peak quotation line, the order form's spec fields (size, paper, colours, coating, binding) are filled from the line text by keyword rules, and the LINE summary card shows what was read.

**Architecture:** One pure module `lib/peak-order/spec-from-text.ts` turns a description into `{ fields, summary }`. The handler passes `fields` into `buildOrderBody`; `summaryCard` prints `summary`. Both read the quotation snapshot already stored in the draft — no new Peak call, no schema change.

**Tech Stack:** TypeScript, Next.js 15 route handlers, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-18-peak-order-spec-from-text-design.md` (approved by คุณนุ๊ก 2026-11-18; §7 answers: `spine` = กระดูกงู, die-cut is never ticked).

## Global Constraints

- No AI, no network, no DB in the parser. Same input → same output.
- **Uncertain = blank.** A field with two different candidate values stays out of `fields`.
- `notes` is never changed. `name`, `customer`, `qty`, `qtyUnit`, `dateIn`, `dateDue`, `assignStaff`, `forwardPrint`, `orderer`, `orderType`, `peak` can never come from the parser.
- Merged units (more than one line key) get no spec.
- `specFromText` never throws, for any input.
- Every rule has an example from the 2026-11-18 census; no rule for wording never seen.
- Nothing reaches order creation on production until คุณนุ๊ก has seen the parser's output on the real 109 lines (Task 2 gate).

## Review Focus

1. **Hostile / odd text** — `null`, a number, `''`, CRLF, tabs, 20,000 characters of `ขนาด 1x1 ` repeated: no throw, returns promptly (input is cut to 4,000 characters; no regex with nested quantifiers). → Task 1 test "never throws".
2. **Look-alike words** — `ปรุ๊ฟ` / `ปรับปรุง` are not perforation; `รองปก` / `รวมปก` / `หน้าปก` / `ปกอ่อน` / `ปกติ` do not open a cover section; `เนื้อหา` / `เนื้อ KA` do not open an inner section; `สติกเกอร์ขาวด้าน` is not matte coating; `กระดาษหัวจดหมาย` / `กระดาษคำตอบ` / `ถุงกระดาษ` are not paper. → Task 1 table rows.
3. **Spec overriding a human choice** — a parser result must not replace the unit chosen in LINE or any identity field. → Task 3 test "spec cannot override".
4. **Unit whose line key is not in the snapshot / snapshot missing** (old or damaged draft) → empty spec, card and creation still work. → Task 3 + Task 4 tests.
5. **Empty summary on the card** — Flex text must never be `''`; no "สเปกที่อ่านได้" line at all when nothing was read. → Task 4 test.

---

### Task 1: `specFromText` — the keyword parser

**Files:**
- Create: `lib/peak-order/spec-from-text.ts`
- Test: `tests/peak-order-spec-from-text.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SpecFields = Partial<Pick<OrderFormData,
    'size' | 'sizeUnit' | 'paperCover' | 'paperInner' | 'coverColor' | 'innerColor' |
    'coverColorNote' | 'innerColorNote' | 'coatGloss' | 'coatMatte' | 'coatUV' | 'coatSpotUV' |
    'glue' | 'saddle' | 'spine' | 'perf' | 'digital'>>;
  export interface SpecFromText { fields: SpecFields; summary: string }
  export const EMPTY_SPEC: SpecFromText;            // { fields: {}, summary: '' }
  export function specFromText(description: unknown): SpecFromText;
  export function specForUnit(q: PeakQuotation | null | undefined, lineKeys: readonly string[] | null | undefined): SpecFromText;
  ```
  No `'server-only'` (same as `mapper.ts`). Boolean fields appear only as `true`. `sizeUnit` appears only with a dimension size (`A4` leaves the form default).

**Rules** (spec §5.1–5.3, made exact):

- Input: non-string → `EMPTY_SPEC`. Cut to 4,000 chars, split on `\r\n|\r|\n`.
- **Sections.** Markers: `เนื้อใน`, and `ปก` not preceded by a Thai letter (U+0E00–0E7F) and not followed by `ติ`. A marker switches the section from its position on; the section carries to following lines. Text before the first marker is "general". No marker in the whole text → general candidates go to the **inner** fields. Any marker present → general paper/colour candidates are dropped.
- **Paper** (per section): candidate starts after `กระดาษ`, or directly after a marker when the text there starts with a paper word. Body runs to end of line, cut at the first of `พิมพ์|ปริ้น|เคลือบ|ขนาด|จำนวน|เข้าเล่ม|ไดคัท`, then cut at the end of the first weight `\d{2,3}\s*(แกรม|กรัม|gsm|g)` if there is one. Valid when it has a weight or starts with a paper word (`อาร์ต|อาร์ท|art|ปอนด์|การ์ด|ถนอมสายตา|น้ำตาล|คาร์บอน|กล่องแป้ง|ปรู๊ฟ|ปรุ๊ฟ`), and is 1–60 chars after trimming. Copied verbatim (inner whitespace collapsed).
- **Colour** (per section): `[1-4]` + optional spaces + `สี` (digit not preceded by a digit or `.`; `สี` not followed by `่`) → `'Nสี'`; `สีเดียว` → `'1สี'`; `ขาวดำ` / `ขาว-ดำ` → `'1สี'`.
- **Colour note** (only for 1–2 colours): colour words `น้ำเงิน|น้ำตาล|ดำ|แดง|เขียว|ฟ้า|ชมพู|เหลือง|ส้ม|ม่วง|ทอง|เงิน`. Right after the colour match: `-word` → word; `(…)` of ≤ 20 chars containing a colour word → the trimmed content; space + word → word. Otherwise `สี` + word later on the same line → word, unless `กระดาษ` stands between the colour match and it (that is the paper's colour).
- **Size** (whole text): tokens are `A3`–`A6` (Latin, any case, not glued to other letters/digits) and `เอ 3`–`เอ 6` → `'A4'`; and `N x N [x N]` with `x × * X`, optional `สูง` before the second number, numbers may have decimals → `'9x5.5'`, with unit `ซม.|cm` → `'ซม.'`, `นิ้ว|inch|"` → `'นิ้ว'`, `มม.|mm` → `'มม.'`. A token is *anchored* when `ขนาด` precedes it on the same line with no digit in between (≤ 15 chars). A token is *qualified* when `ครึ่ง|กางออก|1/3|1/2` directly precedes it. Pool = anchored tokens if any, else all. Any qualified token in the pool → no size. More than one distinct value → no size. A dimension without a unit → no size.
- **Coating** (whole text): for each `เคลือบ`, look at the next 20 chars on the line; contains `หรือ` → skip; starts with optional `ลามิเนต|pvc|opp` then `ด้าน` → `coatMatte`; … `เงา` → `coatGloss`; starts with `uv|ยูวี` → `coatUV`. `spot uv` / `สปอตยูวี` anywhere → `coatSpotUV` (and that occurrence is not `coatUV`).
- **Binding etc.** (whole text): `ไสกาว` → `glue`; `มุงหลังคา` → `saddle`; `กระดูกงู|เข้าห่วง|ห่วงลวด` → `spine`; `ปรุ` not followed by a Thai character → `perf`; `ดิจิตอล|ดิจิทัล|digital` → `digital`. Die-cut: nothing.
- **Conflict**: two different candidates for one field → field omitted (a colour note conflict drops only the note).
- **Summary**: parts joined with ` · `, in this order: `ขนาด <size>[ <unit>]`; with markers: `ปก <paper> <colour>[ (<note>)]`, `เนื้อใน <paper> <colour>[ (<note>)]`; without markers: `<paper> <colour>[ (<note>)]`; then `เคลือบเงา`, `เคลือบด้าน`, `เคลือบ UV`, `Spot UV`, `ไสกาว`, `มุงหลังคา`, `กระดูกงู`, `ปรุ`, `Digital`. Empty parts are skipped. Nothing read → `''`.
- `specForUnit`: exactly one line key and a line with that key in `q.lines` → `specFromText(line.description)`; anything else → `EMPTY_SPEC`.

- [ ] **Step 1: Write the failing tests** — `tests/peak-order-spec-from-text.test.ts`, one `it.each` over `[description, expectedFields]` asserting `expect(specFromText(d).fields).toEqual(expected)` (exact — an extra field fails). `⏎` below = `\n`. All rows are real lines from the census.

| # | description | expected `fields` |
|---|---|---|
| 1 | `นามบัตรขนาด 9x5.5 ซม.⏎พิมพ์ 4 สี 1 หน้า⏎กระดาษอาร์ตมัน 260 แกรม` | size `9x5.5`, sizeUnit `ซม.`, paperInner `อาร์ตมัน 260 แกรม`, innerColor `4สี` |
| 2 | `voucher ขนาด 6.25x15 cm⏎พิมพ์หน้าเดียว กระดาษอาร์ต 230g` | size `6.25x15`, sizeUnit `ซม.`, paperInner `อาร์ต 230g` |
| 3 | `แผ่นพับขนาด A4⏎พิมพ์ 4 สี หน้าหลัง⏎กระดาษอาร์ตมัน 120 แกรม` | size `A4`, paperInner `อาร์ตมัน 120 แกรม`, innerColor `4สี` |
| 4 | `ตั๋วขนาด 6x12 ซม.⏎พิมพ์ 4 สี 1 หน้า⏎กระดาษอาร์ต 260 แกรม⏎เคลือบด้าน` | size `6x12`, sizeUnit `ซม.`, paperInner `อาร์ต 260 แกรม`, innerColor `4สี`, coatMatte |
| 5 | `สมุดบันทึก ขนาดเอ 5⏎เนื้อใน 80 แผ่น(160หน้า)⏎กระดาษถนอมสายตา(จริงใจ AA) 75 แกรม พิมพ์ 1 สี-น้ำเงิน⏎ปก อาร์ทการ์ดหน้าเดียว 350 แกรม พิมพ์ 4 สี⏎ปกนอกเคลือบลามิเนตด้าน⏎เข้าเล่มแบบห่วงลวดกระดูกงู ไดคัทมุม 2 ด้านนอก` | size `A5`, paperInner `ถนอมสายตา(จริงใจ AA) 75 แกรม`, innerColor `1สี`, innerColorNote `น้ำเงิน`, paperCover `อาร์ทการ์ดหน้าเดียว 350 แกรม`, coverColor `4สี`, coatMatte, spine |
| 6 | `สมุดขนาด A5 ปกหุ้มจั่วปัง เข้าห่วง⏎ปกอาร์ต 230 แกรม พิมพ์ 4 สี⏎เนื้อใน 200 หน้า 100 แผ่น⏎กระดาษ ถนอมสายตา 75 แกรม⏎พิมพ์ 1 สี (ดำ)⏎ปั๊มฟอยล์ทอง 2 จุด (โลโก้ และ ตัวอักษร)` | size `A5`, paperCover `อาร์ต 230 แกรม`, coverColor `4สี`, paperInner `ถนอมสายตา 75 แกรม`, innerColor `1สี`, innerColorNote `ดำ`, spine |
| 7 | `หนังสือขนาด A4⏎ปกอาร์ต 230 แกรม เคลือบด้าน พิมพ์ 4 สี⏎เนื้อในปอนด์ 80 แกรม พิมพ์ 1 สี 32 หน้า⏎เข้าเล่มไสกาวปกอ่อน⏎` | size `A4`, paperCover `อาร์ต 230 แกรม`, coverColor `4สี`, coatMatte, paperInner `ปอนด์ 80 แกรม`, innerColor `1สี`, glue |
| 8 | `แคตตาล็อคขนาด 19x26 cm⏎16 หน้ารวมปก⏎ปกกระดาษอาร์ต 230g⏎เนื้อในกระดาษปอนด์ 80g⏎มุงหลังคา` | size `19x26`, sizeUnit `ซม.`, paperCover `อาร์ต 230g`, paperInner `ปอนด์ 80g`, saddle |
| 9 | `สมุดประจำตัวผู้ป่วย⏎ขนาดครึ่งเอ 4 ปก 4 สี 230 แกรม⏎เนื้อใน 4 สีทั้งเล่ม 20 หน้า กระดาษปอนด์ 70g⏎เข้าเล่มเย็มมุงหลังคา` | coverColor `4สี`, innerColor `4สี`, paperInner `ปอนด์ 70g`, saddle |
| 10 | `สมุด Passport ⏎ขนาด 13x9.5 ซม.⏎ปกกระดาษอาร์ตมัน 230 แกรมเคลือบด้าน⏎เนื้อในกระดาษปอนด์ 100⏎จำนวน 8 หน้า⏎กระดาษเปล่า 70g รองปก 1 แผ่น` | size `13x9.5`, sizeUnit `ซม.`, paperCover `อาร์ตมัน 230 แกรม`, coatMatte *(inner paper: two candidates → blank)* |
| 11 | `ปฏิทินแขวน⏎ขนาดป้าย 15x21 นิ้ว พิมพ์ 4 สี⏎กระดาษอาร์ต 230 แกรม เคลือบเงา⏎ภู่ปฏิทิน ขนาด 7x15 นิ้ว⏎พิมพ์ 4สี กระดาษปอนด์⏎เข้าหัวเหล็กปฏิทิน` | innerColor `4สี`, coatGloss *(two sizes, two papers → blank)* |
| 12 | `ปฏิทินแขวน ตัด 4 ขนาด 15x21 นิ้ว⏎พิมพ์ 4 สี หน้าเดียว กระดาษอาร์ต 230g⏎เคลือบเงา เข้าหัวเหล็ก⏎ไส้ 7x15 นิ้ว พิมพ์ 4 สี กระดาษปอนด์⏎หน้าปกแบบโฆษณาของร้าน` | size `15x21`, sizeUnit `นิ้ว`, innerColor `4สี`, coatGloss |
| 13 | `หนังสือพับ 11.11 Midmonth⏎- ขนาดกางออก 63 x 29.7 cm.⏎- ขนาดสำเร็จ A4 พับ 3 ทบ⏎- กระดาษอาร์ต 230 แกรม⏎- เคลือบด้าน⏎- พิมพ์หน้า-หลัง` | paperInner `อาร์ต 230 แกรม`, coatMatte |
| 14 | `แผ่นพับ ขนาดกางออก A5⏎พิมพ์ 4 สี หน้าหลัง⏎กระดาษอาร์ตมัน 120g⏎พับครึ่ง` | innerColor `4สี`, paperInner `อาร์ตมัน 120g` |
| 15 | `ป้ายแขวนประตู ขนาด 24x9.5 cm⏎พิมพ์ 4 สี 2 หน้า⏎กระดาษอาร์ต 350g เคลือบเงาหรือด้าน` | size `24x9.5`, sizeUnit `ซม.`, innerColor `4สี`, paperInner `อาร์ต 350g` |
| 16 | `ซองใส่คีย์การ์ด⏎กระดาษการ์ด 240 แกรม⏎พิมพ์ 2 สี (แดง ดำ)⏎ไดคัทติดกาวตามรูปแบบ` | paperInner `การ์ด 240 แกรม`, innerColor `2สี`, innerColorNote `แดง ดำ` |
| 17 | `งานขนาด 6x22.5cm⏎พิมพ์ 4 สี หน้าเดียว⏎กระดาษอาร์ต 190g⏎ปรุ 5 ตอน 50 ใบต่อเล่ม⏎(ทั้งหมด 500,000 ดวง)` | size `6x22.5`, sizeUnit `ซม.`, innerColor `4สี`, paperInner `อาร์ต 190g`, perf |
| 18 | `ใบเสร็จรับเงิน⏎ขนาด A5 พิมพ์สีเดียว-น้ำเงิน⏎2 ใบ/ชุด 50 ชุด/เล่ม (ขาว ปรุ๊ฟ)` | size `A5`, innerColor `1สี`, innerColorNote `น้ำเงิน` |
| 19 | `เมนู ขนาด 29.7*42 ซม. พิมพ์ 4 สี 2 หน้า⏎กระดาษอาร์ต 260 - 300 แกรม⏎เคลือบด้าน ปริ้น Digital ไดคัทมุม 4 มุม` | size `29.7x42`, sizeUnit `ซม.`, innerColor `4สี`, paperInner `อาร์ต 260 - 300 แกรม`, coatMatte, digital |
| 20 | `สติ๊กเกอร์ A3⏎สติ๊กเกอร์ A3 พิมพ์ 4 สี ดิจิตอล พร้อมไดคัท⏎- โดนัทหมูหยองน้ำสลัด 50 แผ่น` | size `A3`, innerColor `4สี`, digital |
| 21 | `ใบสื่อการสอนขนาด 4x4 นิ้ว⏎กระดาษอาร์ตมัน 300 แกรม⏎พิมพ์ 1 หน้า 4 สี⏎จำนวนพิมพ์ 9 แผ่น A3` | size `4x4`, sizeUnit `นิ้ว`, paperInner `อาร์ตมัน 300 แกรม`, innerColor `4สี` |
| 22 | `ป้ายไวนิลกองโจรกรอบไม้ ขนาด 120 x สูง 240 ซม.` | size `120x240`, sizeUnit `ซม.` |
| 23 | `กล่องกาแฟ First ขนาด 11.5 x 15.5 x 5 ซม.⏎พิมพ์ 4 สี กระดาษการ์ดอาร์ตหน้าเดียว 270g⏎เคลือบเงา ไดคัท ติดกาว` | size `11.5x15.5x5`, sizeUnit `ซม.`, innerColor `4สี`, paperInner `การ์ดอาร์ตหน้าเดียว 270g`, coatGloss |
| 24 | `ถุงขนาด สูง12" ยาว15" กว้าง6"⏎กระดาษอาร์ต 230 แกรม⏎เคลือบด้าน ร้อยริบบิ้นสีดำ` | paperInner `อาร์ต 230 แกรม`, coatMatte |
| 25 | `ถุงกระดาษ ขนาด กว้าง 9 ซม. ยาว 9 ซม. สูง 18 ซม.⏎พิมพ์สีเดียว-ชมพู กระดาษน้ำตาล KI 185g⏎ไดคัท หูถุงเชือกกลมสีขาว` | innerColor `1สี`, innerColorNote `ชมพู`, paperInner `น้ำตาล KI 185g` |
| 26 | `ใบเสร็จรับเงิน ขนาด 6.5x7 นิ้ว⏎กระดาษคาร์บอน 2 ชั้น (ขาวบน, ขาวล่าง)⏎พิมพ์ สีเดียว (ฟ้า)⏎กล่องละ 1,000 ชุด` | size `6.5x7`, sizeUnit `นิ้ว`, paperInner `คาร์บอน 2 ชั้น (ขาวบน, ขาวล่าง)`, innerColor `1สี`, innerColorNote `ฟ้า` |
| 27 | `นามบัตรขนาด 9x5.5 ซม.⏎พิมพ์ 4 สี หน้าหลัง⏎กระดาษ Echo Green หนา 300 แกรม⏎เคลือบด้าน` | size `9x5.5`, sizeUnit `ซม.`, innerColor `4สี`, paperInner `Echo Green หนา 300 แกรม`, coatMatte |
| 28 | `ปฏิทินแขวนขนาด 15x21 นิ้ว⏎ปกอาร์ต 230 แกรม เคลือบ UV⏎ติดไส้ปฏิทินสำเร็จ` | size `15x21`, sizeUnit `นิ้ว`, paperCover `อาร์ต 230 แกรม`, coatUV |
| 29 | `คู่มือการใช้งาน ขนาด A4⏎ปกพิมพ์ 1 สี-ดำ กระดาษการ์ดฟ้า 150g⏎เนื้อใน พิมพ์สีเดียว-ดำ 25 หน้า พิมพ์หน้าเดียว⏎กระดาษปอนด์ 70g⏎เข้าเล่มไสกาว` | size `A4`, coverColor `1สี`, coverColorNote `ดำ`, paperCover `การ์ดฟ้า 150g`, innerColor `1สี`, innerColorNote `ดำ`, paperInner `ปอนด์ 70g`, glue |
| 30 | `สมุดขนาด A5⏎ปก พิมพ์ 4 สี 4 หน้า⏎เนื้อในพิมพ์สีเดียว น้ำเงิน 32 หน้า (เนื้อหา 8-10 หน้า ที่เหลือ note)⏎เย็บมุงหลังคา` | size `A5`, coverColor `4สี`, innerColor `1สี`, innerColorNote `น้ำเงิน`, saddle |
| 31 | `photobook ขนาด 26x26 ซม.⏎พิมพ์ 4 สี ทั้งเล่ม⏎เนื้อใน 40 หน้า กระดาษอาร์ต 160 แกรม⏎ปกแข็ง เคลือบด้าน⏎เข้าเล่มไสกาว` | size `26x26`, sizeUnit `ซม.`, paperInner `อาร์ต 160 แกรม`, coatMatte, glue |
| 32 | `ซองตะเกียบ ขนาดกางออก 20.5x8 cm⏎พิมพ์ 1 สี (แดง)⏎กระดาษปอนด์ 100⏎ไดคัทติดกาวขึ้นซอง` | innerColor `1สี`, innerColorNote `แดง`, paperInner `ปอนด์ 100` |
| 33 | `กระดาษหัวจดหมาย ขนาด เอ 4⏎กระดาษปอนด์ 80 แกรม พิมพ์ 1 สี 1 หน้า สีทอง⏎` | size `A4`, paperInner `ปอนด์ 80 แกรม`, innerColor `1สี`, innerColorNote `ทอง` |
| 34 | `กระดาษหัวจดหมาย ขนาด 10*14 ซม.⏎กระดาษปอนด์ 80 แกรม พิมพ์ 4 สี 1 หน้า` | size `10x14`, sizeUnit `ซม.`, paperInner `ปอนด์ 80 แกรม`, innerColor `4สี` |
| 35 | `กระดาษไดคัทมุมโค้ง 1 มุม⏎ขนาด 10.5x15.5 ซม.⏎กระดาษปอนด์ 80 แกรม⏎พิมพ์ 2 สี (แดง ดำ) 1 หน้า` | size `10.5x15.5`, sizeUnit `ซม.`, paperInner `ปอนด์ 80 แกรม`, innerColor `2สี`, innerColorNote `แดง ดำ` |
| 36 | `ปฏิทินตั้งโต๊ะ แนวนอน⏎ขนาด กว้าง 10x7 นิ้ว⏎จำนวน 7 แผ่น 14 หน้า⏎พิมพ์ 4 สี หน้าหลัง⏎เข้าห่วงบน` | size `10x7`, sizeUnit `นิ้ว`, innerColor `4สี`, spine |
| 37 | `ปฏิทินตั้งโต๊ะขนาด 6x8 นิ้ว⏎กระดาษอาร์ต 230 แกรม⏎พิมพ์ 4 สี 8 แผ่น 16 หน้า⏎เข้ากระดูกงู ติดฐานปฏิทินพิมพ์ตีพื้น` | size `6x8`, sizeUnit `นิ้ว`, paperInner `อาร์ต 230 แกรม`, innerColor `4สี`, spine |
| 38 | `ซองเอกสาร⏎ขนาด 11x17 นิ้ว ซองขยายข้าง⏎เนื้อ KA` | size `11x17`, sizeUnit `นิ้ว` |
| 39 | `สติกเกอร์ขาวด้านไดคัท⏎ขนาด A5 พิมพ์ 4 สีี` | size `A5`, innerColor `4สี` |
| 40 | `A5 หน้าหลัง⏎กระดาษอาร์ตมัน 120g` | size `A5`, paperInner `อาร์ตมัน 120g` |
| 41 | `ป้ายกองโจร 120 x สูง 240 ซม.` | size `120x240`, sizeUnit `ซม.` |
| 42 | `โปสเตอร์ เอ 3 บัตรฟรี 4eve + ไดคัท` | size `A3` |
| 43 | `ใบติ๊กเมนูเตี๋ยว X7 ,เมนูยำ⏎พิมพ์ 1 สี หน้า หลัง` | innerColor `1สี` |
| 44 | `การประเมิน NT ป.3⏎- ภาษาไทย จำนวน 18 หน้า⏎กระดาษคำตอบ 1 หน้า (7 บาท)` | *(empty)* |
| 45 | `ค่าจัดส่ง` · `สติ๊กเกอร์` · `ขออนุญาติติดตั้ง 2 เดือน` · `''` | *(empty, each)* |

  Plus these named tests:
  - `"never throws"`: `specFromText(null)`, `(undefined)`, `(42)`, `({})` → `EMPTY_SPEC`; `'ขนาด A4\r\nพิมพ์ 4 สี\r\nกระดาษปอนด์ 80g'` → size `A4`, innerColor `4สี`, paperInner `ปอนด์ 80g`; `'ขนาด 1x1 '.repeat(2500)` and `'ก'.repeat(20000)` return without throwing.
  - `"look-alikes"`: `'หนังสือปรับปรุงครั้งที่ 2'` → no `perf`; `'เส้นใหญ่ ปกติ กระดาษปอนด์ 70g พิมพ์ 1 สี'` → paperInner `ปอนด์ 70g`, innerColor `1สี` (no cover section opened); `'ขนาด 15x21'` (no unit) → `{}`; `'พิมพ์ 5 สี'` → `{}`; `'พิมพ์ 4 สี 12 หน้า ขาวดำ 128 หน้า'` → `{}`; `'ขนาด a4'` → size `A4`; `'ขนาด 10.5X15 นิ้ว'` → size `10.5x15`, sizeUnit `นิ้ว`; `'ขนาด 100x200 มม.'` → sizeUnit `มม.`; `'เคลือบ Spot UV'` → `coatSpotUV` only; `'พิมพ์ 1 สี กระดาษการ์ดสีชมพู 150g'` → innerColor `1สี`, paperInner `การ์ดสีชมพู 150g`, no note.
  - `"summary"`: row 5 → `'ขนาด A5 · ปก อาร์ทการ์ดหน้าเดียว 350 แกรม 4สี · เนื้อใน ถนอมสายตา(จริงใจ AA) 75 แกรม 1สี (น้ำเงิน) · เคลือบด้าน · กระดูกงู'`; row 1 → `'ขนาด 9x5.5 ซม. · อาร์ตมัน 260 แกรม 4สี'`; `'ค่าจัดส่ง'` → `''`.
  - `"specForUnit"`: one key matching a line → same as `specFromText(line.description)`; two keys → `EMPTY_SPEC`; unknown key → `EMPTY_SPEC`; `q` null / `lineKeys` null → `EMPTY_SPEC`.

- [ ] **Step 2: Run** `npx vitest run tests/peak-order-spec-from-text.test.ts` — expected: FAIL (module not found).
- [ ] **Step 3: Implement** `lib/peak-order/spec-from-text.ts` per the Rules block.
- [ ] **Step 4: Run** the same command — expected: all pass. Then `npx tsc --noEmit` and `npx eslint lib/peak-order/spec-from-text.ts tests/peak-order-spec-from-text.test.ts` — expected: exit 0.
- [ ] **Step 5: Commit** `feat(peak-order): keyword parser — spec fields from a quotation line (not wired yet)`

### Task 2: Run the parser over the real lines (gate for คุณนุ๊ก)

**Files:**
- Modify: `app/api/admin/peak/line-text-census/route.ts` (temporary route)
- Modify: `tests/peak-line-text-census.test.ts`

**Interfaces:**
- Consumes: `specFromText` (Task 1).
- Produces: each returned line gains `f` (the parser's `fields`) and `s` (its `summary`); `peak.coverage` = `{ lines, anyField, perField: Record<string, number> }`.

- [ ] **Step 1: Test** — extend the "line text" test: the QO-3 flyer line carries `f: { size: 'A4', paperInner: 'อาร์ตมัน 130 แกรม', innerColor: '4สี' }` and a non-empty `s`; `body.peak.coverage.lines === 2`, `anyField === 1`, `perField.size === 1`. Run → FAIL.
- [ ] **Step 2: Implement**, run → PASS; tsc + eslint exit 0.
- [ ] **Step 3: Commit + push** (with Task 1). Wait for the route to answer the new shape on production.
- [ ] **Step 4: Read it** through the logged-in admin browser; write the per-line table (text → what was filled) to the session scratchpad and show คุณนุ๊ก the coverage numbers, every line where a field was left blank on purpose, and anything that looks wrong.
- [ ] **Step 5: Gate** — wrong output → fix the rule in Task 1 style (failing test from the real line first), redeploy, re-read. Proceed to Task 3 only when คุณนุ๊ก says the table is right.

### Task 3: Fill the order body

**Files:**
- Modify: `lib/peak-order/mapper.ts` (`buildOrderBody`)
- Modify: `lib/peak-order/handler.ts` (the `buildOrderBody` call, ~line 600)
- Test: `tests/peak-order-mapper.test.ts`, `tests/peak-order-handler-steps.test.ts`

**Interfaces:**
- Consumes: `SpecFields`, `specForUnit` (Task 1).
- Produces: `buildOrderBody(p: { …existing; spec?: SpecFields })`. The spec is spread right after `emptyOrderForm(...)` and before every explicit field, so explicit fields always win.

- [ ] **Step 1: Mapper tests** (RED):
  - `"spec fields land in the body"`: `buildOrderBody({ ...base, spec: { size: 'A4', paperInner: 'อาร์ตมัน 120 แกรม', innerColor: '4สี', coatMatte: true } })` → `toMatchObject` those four, and `sizeUnit` stays `emptyOrderForm().sizeUnit`.
  - `"spec cannot override"`: pass `spec` cast from `{ name: 'x', customer: 'x', qty: '9', qtyUnit: 'ถุง', notes: 'x', orderer: 'x', assignStaff: 'x', forwardPrint: 'x', dateDue: 'x', dateIn: 'x', orderType: 'photobook', peak: 'x' }` → every one of those equals the value from `base`.
  - `"no spec = today's body"`: `buildOrderBody(base)` deep-equals `buildOrderBody({ ...base, spec: {} })`.
- [ ] **Step 2: Handler tests** (RED), in the existing create-step describe, using its fixtures: a single-line quotation whose description is plan row 1 → `createOrder` is called with a body containing `size: '9x5.5'`, `sizeUnit: 'ซม.'`, `paperInner: 'อาร์ตมัน 260 แกรม'`, `innerColor: '4สี'`, and `notes` still starting with the full original description; the same through "บันทึกเป็นใบร่าง" (`status: 'draft'`); a merged draft of two such lines → body has `size: ''` and `paperInner: ''`; a unit whose line key is absent from the snapshot → created, spec fields at form defaults.
- [ ] **Step 3: Implement** both edits. Run both test files → PASS. Full `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 4: Commit** `feat(peak-order): /order fills size, paper, colours, coating and binding from the line text`

### Task 4: Show it on the LINE summary card

**Files:**
- Modify: `lib/peak-order/flex.ts` (`summaryCard`)
- Test: `tests/peak-order-flex.test.ts`

**Interfaces:**
- Consumes: `specForUnit` (Task 1).

- [ ] **Step 1: Tests** (RED): summary card of a single-line draft with plan row 5 as description → both the Flex body texts and `card.text` contain `สเปกที่อ่านได้: ขนาด A5 · ปก อาร์ทการ์ดหน้าเดียว 350 แกรม 4สี · เนื้อใน ถนอมสายตา(จริงใจ AA) 75 แกรม 1สี (น้ำเงิน) · เคลือบด้าน · กระดูกงู`, placed after the `ผู้สั่งงาน` line; description `ค่าจัดส่ง` → no text containing `สเปกที่อ่านได้`; merged draft → none; draft with `snapshot` undefined → card still builds, none; no Flex text component is `''`.
- [ ] **Step 2: Implement** — one `add(p, …)` with the summary clipped to 300 code points by the file's `clip`, `{ size: 'sm', color: C.muted }`.
- [ ] **Step 3:** run file → PASS; full suite + tsc + lint clean.
- [ ] **Step 4: Commit** `feat(peak-order): summary card shows the spec that was read`

### Task 5: Labels, independent review, ship, retire the census

**Files:**
- Modify: `lib/spec-format.ts:80` (`spine: 'กระดูกงู'`), `app/board/order-form.tsx:1206` (`label="เย็บกี่"`)
- Test: `tests/spec-format.test.ts`
- Delete: `app/api/admin/peak/line-text-census/route.ts`, `tests/peak-line-text-census.test.ts`
- Modify: `dashboard-v2.md` (version history), `PATTERNS.md` (§12 — rules that read free text: census both sides first, uncertain = blank, run on real lines before wiring), the spec's `status`, `NEXT-SESSION.md`

- [ ] **Step 1:** test `specLabel('spine') === 'กระดูกงู'` and `specLabel('sew') === 'เย็บกี่'` → RED → edit both labels → GREEN. Commit `fix(labels): binding box 4 is กระดูกงู everywhere; form says เย็บกี่`.
- [ ] **Step 2: Independent review** of Tasks 1, 3, 4 by a fresh reviewer given the spec, this plan and the diff (not the implementer's conclusions). Fix what it finds, test-first.
- [ ] **Step 3: Push.** Wait for the post-deploy smoke run whose `headSha` is this push.
- [ ] **Step 4: Production check with คุณนุ๊ก** — `/order` one real quotation in the team group: the summary card shows "สเปกที่อ่านได้"; create; open the order form and compare each filled field with the quotation text; confirm from `/api/orders/raw/<id>`.
- [ ] **Step 5: Retire** the census route + test; confirm the URL answers 404 on production; docs; commit + push.
