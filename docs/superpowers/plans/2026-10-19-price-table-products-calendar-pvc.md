# น้อง PP — ปฏิทิน 3 แบบ + บัตร PVC (price-table products) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** น้อง PP ตีราคาปฏิทินจีน/ตั้งโต๊ะ/แขวน + บัตร PVC จากตารางขั้นราคา (เกลี่ยเชิงเส้น) และส่งรูปตารางราคาให้ลูกค้าในแชต LINE/Messenger ภายในโหมด AI

**Architecture:** ราคาอยู่ใน calc API (`print-calculator-next`, productType `calendar` + `pvccard`, helper เกลี่ยขั้นตัวเดียว) เหมือนนามบัตร. ฝั่ง dashboard เพิ่ม tool ที่สอง `send_price_table` (ไม่มี I/O — แค่บันทึก id ตาราง) → `runQuoteTurn` คืน `priceTables` → router ส่ง `[รูป…, ข้อความ]` ผ่าน adapter ที่รับ array ได้. นอกโหมด (Messenger เท่านั้น) ปุ่ม hint พกชื่อสินค้า → เข้าโหมดแล้วรันเทิร์นแรกทันที.

**Tech Stack:** Next.js 15 / TypeScript / zod (calc) · vitest 4 (dashboard) · LINE Messaging API (reply ≤5 messages, image message) · Messenger Send API (attachment image) · Anthropic tool use (Sonnet 5.5)

**Spec:** [docs/superpowers/specs/2026-10-19-price-table-products-calendar-pvc-design.md](../specs/2026-10-19-price-table-products-calendar-pvc-design.md)

## Global Constraints

- สองรีโป: Part A = `print-calculator-next` (deploy ก่อน) · Part B = `penprinting-dashboard`. commit แยกรีโป, task ละ ≥1 commit, ข้อความ commit ลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- TDD RED-first ทุก task. dashboard: `npx vitest run tests/<file>` · calc ไม่มี unit test → ใช้ `scripts/smoke-baselines.json` + dev server local เป็น RED→GREEN (`BASE_URL=http://localhost:3100 QUOTE_API_TOKEN=test node scripts/smoke.mjs`; dev server = preview `calc-dev` ใน `.claude/launch.json` หรือ `cd print-calculator-next && QUOTE_API_TOKEN=test npx next dev -p 3100`)
- vitest 4 + `restoreMocks` ใน config: **ห้าม** เรียก `mockReset()` เอง (memory feedback_vitest4_mockreset_restoremocks)
- ราคาทุกตัว **ก่อน VAT** · เกลี่ยเชิงเส้นระหว่างขั้น · **ปัดขึ้นขั้น 0.25** (`Math.ceil(x * 4 - 1e-9) / 4`) · เกินขั้นสูงสุด = 422 `above_max` · ต่ำกว่าขั้นต่ำ = 422 `below_min`
- ตารางราคา = spec §5.1 ตรงตัว (ตรวจกับรูป 4 ใบแล้ว) · ค่าออกแบบ PVC: `qty < 30` → +300 · ก่อน VAT
- วลี **"ส่งต่อทีมงาน"** load-bearing (`detectCustomerEscalation`) — ใช้เฉพาะตอนส่งต่อจริง; เคส `below_min` ห้ามใช้
- LINE quick reply label **≤20 code points** · LINE reply **≤5 messages** · image message ต้องมี `originalContentUrl` + `previewImageUrl` HTTPS (ไฟล์ ≤400 KB → ใช้ URL เดียวกัน)
- รูปตาราง: `public/price-tables/<id>.jpg` ของ dashboard, URL base `https://dashboard.penprinting.co/price-tables/` (public/ เสิร์ฟสาธารณะ — verify แล้ว)
- ห้ามแตะ `isEnterAiKeyword` ฟอร์มเปล่าเดิม (`^\/?(ขอราคา|ตีราคา)(\s*ai)?$`) · ฟอร์ม seed ต้องมี token `ai`
- Prompt: ไม่มี markdown ในข้อความลูกค้า · staff prompt (`prompt.ts`) และ customer prompt (`prompt-customer.ts`) duplicate โดยตั้งใจ — แก้ทั้งคู่
- Gates ก่อน push (dashboard): `npm run type-check && npm run lint && npm test && npm run build` · (calc): `npm run type-check && npm run lint && npm run build` + smoke local เขียว

## Review Focus

1. **PVC 29 vs 30 ใบ** — 29 ใบ = 90×29+300 = 2,910 แต่ 30 ใบ = 2,700 (ถูกกว่า): ราคารวมต้องเป็นไปตามนี้ตรงๆ และ `designFee` ต้องเป็น 300/0 ตามขอบ `< 30` → baseline `pvc-29` + `pvc-30` (Task 3)
2. **PVC 99 vs 100 ใบ** — ช่วง 10-99 คงที่ 90 แล้วกระโดดเป็น 75 ที่ 100 (ห้ามเกลี่ยระหว่าง 9→99) → baseline `pvc-50`=90, `pvc-99`=90, `pvc-100`=75 (Task 3)
3. **ปฏิทินขอบช่วง 1-100 → 101** — 100 = ราคาคงที่, 101 เริ่มเกลี่ย (แขวน 10.5x15: 101 → 39.95 → ปัดขึ้น 40.00; 150 → 37.50) → baseline `calendar-hanging-s-100/101/150` (Task 2)
4. **model เรียก `send_price_table` ซ้ำ/ส่ง id ที่ไม่รู้จัก** — dedupe ภายในเทิร์น, id ไม่รู้จัก → `tool_result is_error` ไม่ throw ไม่ส่งรูป (Task 5)
5. **reply เกิน 5 messages** — model เรียก 4 ตาราง + ข้อความ = 5 พอดี; ตัวที่เกิน 5 ต้องถูกตัดทิ้งไม่ให้ LINE 400 (ข้อความตัวสุดท้ายต้องรอด) (Task 6)

---

## Part A — calc (`print-calculator-next`)

### Task 1: smoke runner รองรับเคส 422 (`expectStatus`)

**Files:**
- Modify: `scripts/smoke.mjs` (`quote()` + CHECKS mapping + `--capture`)
- Modify: `scripts/smoke-baselines.json` (`_readme` บรรทัดเดียว)

**Interfaces:**
- Produces: baseline case รูปแบบใหม่ `{ name, request, expectStatus?: number, expect }` — ไม่มี `expectStatus` = 200 เทียบ `expect` กับ `body.result` (เดิม); มี `expectStatus` ≠ 200 = เทียบ status แล้วเทียบ `expect` กับ **body ทั้งก้อน** (subset)

- [ ] **Step 1: เพิ่ม baseline เคสแดงชั่วคราวเพื่อพิสูจน์ runner** — ต่อท้าย `cases`:
```json
{ "name": "runner-422-probe", "request": { "productType": "brochure", "spec": { "qty": 1 } },
  "expectStatus": 422, "expect": { "error": "invalid spec" } }
```
- [ ] **Step 2: รัน smoke local → ต้องล้มที่เคสนี้ด้วยข้อความ `POST /api/quote → 422`** (runner เดิม throw เมื่อ `!res.ok`)
Run: `BASE_URL=http://localhost:3100 QUOTE_API_TOKEN=test node scripts/smoke.mjs`
Expected: `❌ price:runner-422-probe: POST /api/quote → 422: …` และ exit code 1
- [ ] **Step 3: แก้ `quote(request)` ให้คืน `{ status, body }` ไม่ throw บน non-2xx**; ใน CHECKS: `const want = c.expectStatus ?? 200; if (status !== want) throw …; const target = want === 200 ? body.result : body; diffs = compareFields(c.expect, target)`. `--capture`: พิมพ์ `status` + body ทั้งก้อนเมื่อ non-200
- [ ] **Step 4: รัน smoke local → เคส probe เขียว + 20 เคสเดิมเขียว**
Expected: `✅ smoke passed (22 checks)` (auth-fail-closed + 20 เคสเดิม + probe)
- [ ] **Step 5: ลบเคส probe · เติม `_readme`: "เคส 422: ใส่ `expectStatus` แล้ว `expect` เทียบกับ body ทั้งก้อน" · รัน `node scripts/smoke.mjs --validate` → `baselines OK (20 cases)`**
- [ ] **Step 6: Commit**
```bash
git add scripts/smoke.mjs scripts/smoke-baselines.json
git commit -m "test(smoke): baseline cases can pin a 422 status + error body"
```

### Task 2: ปฏิทิน 3 แบบ — tier-table helper + `calendar` product

**Files:**
- Modify: `lib/types.ts` (ต่อจาก `NamecardResult`, + field ใน `CalcConfig`)
- Modify: `lib/defaults.ts` (ต่อจาก `namecard` block ก่อน `};` บรรทัด ~112)
- Modify: `lib/calc.ts` (ต่อจาก `computeNamecard`, ก่อน `fmt`)
- Modify: `lib/quote-schema.ts` (schema + union)
- Modify: `app/api/quote/route.ts` (`compute()` switch + 422 guard)
- Modify: `lib/storage.ts:mergeWithDefaults` — `calendar: DEFAULT_CONFIG.calendar` (ไม่ใช่ field ที่ user แก้บน UI → เอาจาก default เสมอ แบบ `printsPerOriginal`)
- Test: `scripts/smoke-baselines.json`

**Interfaces (Produces — Task 3 และ dashboard พึ่ง):**
```ts
// lib/types.ts
export interface PriceTier { upTo: number; price: number; flat: boolean }
//   flat=true  → price ใช้กับทุก qty ใน (prev.upTo, upTo]
//   flat=false → เกลี่ยเชิงเส้นระหว่าง (prev.upTo, prev.price) กับ (upTo, price)
export interface TierTable { minQty: number; tiers: PriceTier[] }   // tiers เรียง upTo น้อย→มาก
export type TierRangeError = { outOfRange: 'below_min' | 'above_max'; bound: number };
export type CalendarKind = 'chinese' | 'desk' | 'hanging';
export interface CalendarKindConfig { sheetsPerSet: Record<string, number>; tables: Record<string, TierTable> }  // key = variant
export type CalendarConfig = Record<CalendarKind, CalendarKindConfig>;
export interface CalendarInput { kind: CalendarKind; variant: string; qty: number }
export interface CalendarResult { kind: CalendarKind; variant: string; qty: number; sheetsPerSet: number; unitPrice: number; totalPrice: number; unitPriceVat: number; totalPriceVat: number }
// CalcConfig += calendar: CalendarConfig
// lib/calc.ts
export function ceilTo025(n: number): number
export function tierUnitPrice(table: TierTable, qty: number): { ok: true; unitPrice: number } | ({ ok: false } & TierRangeError)
export function computeCalendar(config: CalcConfig, input: CalendarInput): CalendarResult | TierRangeError
```
- variants: chinese/hanging = `'10.5x15' | '15x21'` · desk = `'8' | '14'` · sheetsPerSet: chinese 13 ทั้งสองขนาด · hanging 14 (หัว 1 + เดือน 13) · desk 8/14
- `tierUnitPrice`: qty < minQty → `below_min` bound=minQty · qty > tiers ล่าสุด.upTo → `above_max` bound=upTo สุดท้าย · ไม่งั้นหา tier แรกที่ `qty <= upTo`: flat → price; ไม่ flat → เกลี่ยกับ tier ก่อนหน้า (`prev.upTo`, `prev.price`) แล้ว `ceilTo025`
- 422 body จาก route: `{ error: 'below_min', message: 'ปฏิทินจีนขั้นต่ำ 300 ชุด — แจ้งขั้นต่ำแล้วถามลูกค้าต่อ', productType, bound }` · `{ error: 'above_max', message: 'จำนวนเกินตารางราคา (สูงสุด 5,000 ชุด) — ส่งต่อทีมงานประเมินราคา', productType, bound }` (ชื่อสินค้าตาม kind: ปฏิทินจีน / ปฏิทินตั้งโต๊ะ / ปฏิทินแขวน; เลขจาก bound ใส่ comma)
- zod: `calendarSpecSchema = z.discriminatedUnion('kind', [ {kind:'chinese', variant: z.enum(['10.5x15','15x21']), qty}, {kind:'hanging', …เดียวกัน}, {kind:'desk', variant: z.enum(['8','14']), qty} ])`

- [ ] **Step 1: เขียน baseline แดงก่อน** — ต่อท้าย `cases` (ค่าคาดจาก spec §5.1/§5.2, pin `unitPrice`+`totalPrice`+`sheetsPerSet`):

| name | request.spec | expect |
|---|---|---|
| `calendar-chinese-s-300` | `{kind:'chinese', variant:'10.5x15', qty:300}` | `{unitPrice:35, totalPrice:10500, sheetsPerSet:13}` |
| `calendar-chinese-l-1500` | `{kind:'chinese', variant:'15x21', qty:1500}` | `{unitPrice:24.75, totalPrice:37125, sheetsPerSet:13}` (27→22.5 ที่ 1000→2000: 24.75 ตรงขั้น) |
| `calendar-desk-14-1000` | `{kind:'desk', variant:'14', qty:1000}` | `{unitPrice:45, totalPrice:45000, sheetsPerSet:14}` |
| `calendar-desk-8-250` | `{kind:'desk', variant:'8', qty:250}` | `{unitPrice:72.5, totalPrice:18125, sheetsPerSet:8}` (85→60) |
| `calendar-hanging-l-800` | `{kind:'hanging', variant:'15x21', qty:800}` | `{unitPrice:20.25, totalPrice:16200, sheetsPerSet:14}` (20.2 → ปัด 0.25) |
| `calendar-hanging-s-100` | `{kind:'hanging', variant:'10.5x15', qty:100}` | `{unitPrice:40, totalPrice:4000, sheetsPerSet:14}` |
| `calendar-hanging-s-101` | `…qty:101` | `{unitPrice:40, totalPrice:4040, sheetsPerSet:14}` (39.95 → ปัดขึ้น 40) |
| `calendar-hanging-s-150` | `…qty:150` | `{unitPrice:37.5, totalPrice:5625, sheetsPerSet:14}` |
| `calendar-hanging-s-5000` | `…qty:5000` | `{unitPrice:6.25, totalPrice:31250, sheetsPerSet:14}` |
| `calendar-chinese-below-min` | `{kind:'chinese', variant:'10.5x15', qty:200}` + `expectStatus:422` | `{error:'below_min', bound:300}` |
| `calendar-hanging-above-max` | `{kind:'hanging', variant:'10.5x15', qty:6000}` + `expectStatus:422` | `{error:'above_max', bound:5000}` |
| `calendar-desk-bad-variant` | `{kind:'desk', variant:'10.5x15', qty:100}` + `expectStatus:422` | `{error:'invalid spec'}` |

- [ ] **Step 2: รัน smoke local → 12 เคสใหม่แดง (ตอนนี้ productType ไม่รู้จัก → 422 `invalid spec` ทุกเคส)**
Run: `BASE_URL=http://localhost:3100 QUOTE_API_TOKEN=test node scripts/smoke.mjs`
Expected: 9 เคส 200 ล้ม `→ 422 (expected 200)` · `calendar-desk-bad-variant` เขียวโดยบังเอิญ (ยอมรับ) · เคส below/above ล้มที่ `error` ไม่ตรง
- [ ] **Step 3: types.ts — เพิ่ม types ตาม Interfaces + `calendar: CalendarConfig` ใน `CalcConfig`**
- [ ] **Step 4: defaults.ts — `calendar` ตาม spec §5.1** (hanging/chinese tiers แรก flat; desk `{upTo:100, price:145/250, flat:true}` แล้วจุดถัดไป flat:false; chinese `minQty:300` tier แรก `{upTo:300, price:35|65, flat:true}`; ที่เหลือ `minQty:1`)
- [ ] **Step 5: calc.ts — `ceilTo025` · `tierUnitPrice` · `computeCalendar`** (`totalPrice = unitPrice × qty` ปัดทศนิยม 2; VAT ×`config.vat`+1)
- [ ] **Step 6: quote-schema.ts — `calendarSpecSchema` + เพิ่มใน `quoteRequestSchema` union** · route.ts — `case 'calendar'` + guard: `if ('outOfRange' in result) return json({ error: result.outOfRange, message: …, productType, bound: result.bound }, 422)` · storage.ts — `calendar: DEFAULT_CONFIG.calendar`
- [ ] **Step 7: `npm run type-check` ผ่าน → รัน smoke local → ทุกเคสเขียว**
Expected: `✅ smoke passed (33 checks)` (auth + 20 เดิม + 12 ใหม่)
- [ ] **Step 8: `node scripts/smoke.mjs --capture` เทียบ unitPrice/totalPrice ที่ API คืนกับ baseline ตรงตัว (float ต้องเท่ากันเป๊ะ — ถ้า totalPrice ออกเช่น 16200.000000001 ให้ปัด 2 ตำแหน่งใน `computeCalendar` ไม่ใช่แก้ baseline)**
- [ ] **Step 9: Commit**
```bash
git add lib/types.ts lib/defaults.ts lib/calc.ts lib/quote-schema.ts lib/storage.ts app/api/quote/route.ts scripts/smoke-baselines.json
git commit -m "feat(quote): calendar (chinese/desk/hanging) — tier table with linear interpolation, 0.25 ceil"
```

### Task 3: บัตร PVC + docs calc

**Files:**
- Modify: `lib/types.ts`, `lib/defaults.ts`, `lib/calc.ts`, `lib/quote-schema.ts`, `app/api/quote/route.ts`, `lib/storage.ts` (ที่เดียวกับ Task 2)
- Modify: `CLAUDE.md` (section "6 ประเภทงาน" → 8 · เพิ่ม "### 0b. ปฏิทิน" + "### 0c. บัตร PVC" รูปแบบเดียวกับ "### 0. นามบัตร" · section Pricing API request union · บรรทัด update protocol "ราคาปฏิทิน/PVC เปลี่ยน = รูปใน dashboard `public/price-tables/` + `DEFAULT_CONFIG` + baselines คอมมิตเดียว")
- Test: `scripts/smoke-baselines.json`

**Interfaces (Produces):**
```ts
export interface PvcCardConfig { table: TierTable; designFee: number; designFeeFreeFrom: number }  // 300, 30
export interface PvcCardInput { qty: number }
export interface PvcCardResult { qty: number; unitPrice: number; designFee: number; totalPrice: number; unitPriceVat: number; totalPriceVat: number }
// CalcConfig += pvccard: PvcCardConfig
export function computePvcCard(config: CalcConfig, input: PvcCardInput): PvcCardResult | TierRangeError
```
- tiers: `[{9,150,flat},{99,90,flat},{100,75},{200,65},{500,60},{1000,39}]` minQty 1 · `designFee = qty < 30 ? 300 : 0` · `totalPrice = unitPrice×qty + designFee` · 422 `above_max` message "จำนวนเกินตารางราคา (สูงสุด 1,000 ใบ) — ส่งต่อทีมงานประเมินราคา"

- [ ] **Step 1: baseline แดงก่อน** (Review Focus 1-2):

| name | qty | expect |
|---|---|---|
| `pvc-20` | 20 | `{unitPrice:90, designFee:300, totalPrice:2100}` |
| `pvc-29` | 29 | `{unitPrice:90, designFee:300, totalPrice:2910}` |
| `pvc-30` | 30 | `{unitPrice:90, designFee:0, totalPrice:2700}` |
| `pvc-5` | 5 | `{unitPrice:150, designFee:300, totalPrice:1050}` |
| `pvc-99` | 99 | `{unitPrice:90, designFee:0, totalPrice:8910}` |
| `pvc-100` | 100 | `{unitPrice:75, designFee:0, totalPrice:7500}` |
| `pvc-150` | 150 | `{unitPrice:70, designFee:0, totalPrice:10500}` |
| `pvc-1000` | 1000 | `{unitPrice:39, designFee:0, totalPrice:39000}` |
| `pvc-above-max` | 1001 + `expectStatus:422` | `{error:'above_max', bound:1000}` |

- [ ] **Step 2: รัน smoke local → 9 เคสแดง**
- [ ] **Step 3: เพิ่ม types/defaults/calc/schema/route/storage สำหรับ `pvccard`** (`pvccardSpecSchema = z.object({ qty: qtySchema })`)
- [ ] **Step 4: type-check + smoke local → `✅ smoke passed (42 checks)`** (auth + 32 + 9 ใหม่)
- [ ] **Step 5: อัปเดต CLAUDE.md ตามรายการใน Files** (ตารางราคาคัดจาก spec §5.1, กฎเกลี่ย/ปัด 0.25, ขั้นต่ำ/เกินตาราง = 422, "API-only ไม่มีแท็บ UI")
- [ ] **Step 6: `npm run lint && npm run build` เขียว → Commit**
```bash
git add lib/ app/api/quote/route.ts scripts/smoke-baselines.json CLAUDE.md
git commit -m "feat(quote): pvccard — tier table + design fee under 30 cards; docs for calendar/pvc"
```
- [ ] **Step 7: push calc → รอ CI + post-deploy smoke เขียว pin sha ของ commit นี้** (`gh run list --json headSha,status,conclusion,name` กรองด้วย sha เอง — บทเรียน ci-wait-pin-headsha) · ถ้า `gh` ถูกบล็อก ยิง `curl -X POST https://calc.penprinting.co/api/quote` ด้วย request `pvc-150` + token prod ไม่ได้ → ให้คุณนุ๊กดู Actions

---

## Part B — dashboard (`penprinting-dashboard`)

### Task 4: `price-tables.ts` + รูป 4 ใบ + tool enum/ส่งตาราง

**Files:**
- Create: `lib/ai-quote/price-tables.ts`
- Create: `public/price-tables/calendar_chinese.jpg`, `calendar_desk.jpg`, `calendar_hanging.jpg`, `pvc_card.jpg` (คัดลอกจาก `/private/tmp/claude-501/-Users-witsarut-p-Desktop-Project-Report-Penprinting/e3eade3c-2db2-40f4-a998-0f1f0e72aa9e/images/{1,2,3,4}.jpg` ตามลำดับ — 1=จีน 2=ตั้งโต๊ะ 3=แขวน 4=PVC; ถ้า path หายให้ขอรูปจากคุณนุ๊กใหม่ ห้ามใช้รูปอื่นแทน)
- Modify: `lib/ai-quote/types.ts:6` (`ProductType` union)
- Modify: `lib/ai-quote/tools.ts` (enum + description ของ `compute_quote`, เพิ่ม `SEND_PRICE_TABLE_TOOL`)
- Test: `tests/ai-quote-price-tables.test.ts` (ใหม่), `tests/ai-quote-tools.test.ts`

**Interfaces (Produces):**
```ts
// lib/ai-quote/price-tables.ts  (pure, no server-only)
export const PRICE_TABLE_IDS = ['calendar_chinese', 'calendar_desk', 'calendar_hanging', 'pvc_card'] as const;
export type PriceTableId = (typeof PRICE_TABLE_IDS)[number];
export const PRICE_TABLE_LABEL: Record<PriceTableId, string>;   // ปฏิทินจีน · ปฏิทินตั้งโต๊ะ 6x8 นิ้ว · ปฏิทินแขวน · บัตร PVC
export const PRICE_TABLE_BASE = 'https://dashboard.penprinting.co/price-tables/';
export function isPriceTableId(x: unknown): x is PriceTableId
export function priceTableUrl(id: PriceTableId): string            // `${PRICE_TABLE_BASE}${id}.jpg`
export function priceTableImageMessage(id: PriceTableId, channel: 'line' | 'messenger'): Record<string, unknown>
//   line      → { type:'image', originalContentUrl:url, previewImageUrl:url }
//   messenger → { attachment:{ type:'image', payload:{ url, is_reusable:true } } }
// lib/ai-quote/tools.ts
export const SEND_PRICE_TABLE_TOOL = { name: 'send_price_table', description: …, input_schema: { type:'object', properties:{ table:{ type:'string', enum:[...PRICE_TABLE_IDS] } }, required:['table'] } };
// lib/ai-quote/types.ts
export type ProductType = 'brochure' | 'book' | 'notebook' | 'namecard' | 'calendar' | 'pvccard';
```
- `compute_quote` description เพิ่ม: `calendar: {kind('chinese'|'desk'|'hanging'), variant(จีน/แขวน '10.5x15'|'15x21' · ตั้งโต๊ะ '8'|'14' แผ่น), qty(ชุด)} · pvccard: {qty(ใบ)}` และ "รองรับ 6 ชนิด" · `send_price_table` description: "ส่งรูปตารางราคาให้ลูกค้าดู — เรียกครั้งแรกที่รู้ว่าเป็นปฏิทินแบบไหน/บัตร PVC, 1 ครั้งต่อตารางต่อบทสนทนา. ไม่ใช่การคิดราคา"

- [ ] **Step 1: เขียน `tests/ai-quote-price-tables.test.ts`**
```ts
it('every id has a label and an https jpg url under the dashboard host', () => {
  for (const id of PRICE_TABLE_IDS) {
    expect(PRICE_TABLE_LABEL[id]).toBeTruthy();
    expect(priceTableUrl(id)).toBe(`https://dashboard.penprinting.co/price-tables/${id}.jpg`);
  }
});
it('isPriceTableId accepts ids and rejects junk', () => { expect(isPriceTableId('pvc_card')).toBe(true); expect(isPriceTableId('sticker')).toBe(false); expect(isPriceTableId(null)).toBe(false); });
it('line image message carries original + preview urls', () => expect(priceTableImageMessage('pvc_card', 'line')).toEqual({ type: 'image', originalContentUrl: priceTableUrl('pvc_card'), previewImageUrl: priceTableUrl('pvc_card') }));
it('messenger image message is a reusable attachment', () => expect(priceTableImageMessage('calendar_desk', 'messenger')).toEqual({ attachment: { type: 'image', payload: { url: priceTableUrl('calendar_desk'), is_reusable: true } } }));
it('every id has its jpg in public/price-tables (≤ 1 MB — LINE preview limit)', () => {
  for (const id of PRICE_TABLE_IDS) { const st = statSync(`public/price-tables/${id}.jpg`); expect(st.size).toBeGreaterThan(0); expect(st.size).toBeLessThanOrEqual(1_000_000); }
});
```
และใน `tests/ai-quote-tools.test.ts`:
```ts
it('compute_quote enum lists all 6 product types', () => expect(COMPUTE_QUOTE_TOOL.input_schema.properties.productType.enum).toEqual(['brochure','book','notebook','namecard','calendar','pvccard']));
it('send_price_table tool enum matches PRICE_TABLE_IDS', () => expect(SEND_PRICE_TABLE_TOOL.input_schema.properties.table.enum).toEqual([...PRICE_TABLE_IDS]));
```
- [ ] **Step 2: รัน → FAIL (module ไม่มี / enum ไม่ครบ)**
Run: `npx vitest run tests/ai-quote-price-tables.test.ts tests/ai-quote-tools.test.ts`
- [ ] **Step 3: สร้าง `public/price-tables/` + คัดลอกรูป 4 ไฟล์ · เขียน `price-tables.ts` · แก้ `types.ts` + `tools.ts`**
- [ ] **Step 4: รัน → PASS** · `npm run type-check`
- [ ] **Step 5: Commit**
```bash
git add public/price-tables lib/ai-quote/price-tables.ts lib/ai-quote/types.ts lib/ai-quote/tools.ts tests/ai-quote-price-tables.test.ts tests/ai-quote-tools.test.ts
git commit -m "feat(ai-quote): price-table ids + images + send_price_table tool; calendar/pvccard product types"
```

### Task 5: `runQuoteTurn` รองรับ `send_price_table` → `priceTables`

**Files:**
- Modify: `lib/ai-quote/run.ts` (`RunQuoteTurnOutput`, tools array, tool loop บรรทัด ~141-156)
- Test: `tests/ai-quote-run.test.ts`

**Interfaces:**
- Consumes: `SEND_PRICE_TABLE_TOOL`, `isPriceTableId`, `PriceTableId` (Task 4)
- Produces: `RunQuoteTurnOutput.priceTables: PriceTableId[]` (ไม่ซ้ำ, เรียงตามลำดับที่ model เรียก) · tool_result ของ `send_price_table` = `JSON.stringify({ sent: true, table })` · id ไม่รู้จัก → `is_error: true, content: 'unknown table id'` · tool อื่นที่ไม่รู้จัก → ข้ามเหมือนเดิม

- [ ] **Step 1: เขียนเทสต์**
```ts
const sendTableMsg = { stop_reason: 'tool_use', content: [
  { type: 'tool_use', id: 'tu_a', name: 'send_price_table', input: { table: 'calendar_hanging' } },
  { type: 'tool_use', id: 'tu_b', name: 'send_price_table', input: { table: 'calendar_hanging' } },   // duplicate
  { type: 'tool_use', id: 'tu_c', name: 'send_price_table', input: { table: 'sticker' } },            // unknown
] };
it('collects price tables once each and feeds a tool_result per call', async () => {
  const client = fakeClient([sendTableMsg, { stop_reason: 'end_turn', content: [{ type: 'text', text: '📊 ตารางราคาปฏิทินแขวนอยู่ด้านบนนะคะ ขนาดไหน กี่ชุดดีคะ' }] }]);
  const out = await runQuoteTurn({ history: [], userMessage: 'แขวน' }, { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'm' });
  expect(out.priceTables).toEqual(['calendar_hanging']);
  const second = (client.messages.create as Mock).mock.calls[1][0].messages.at(-1);   // tool_result turn
  expect(second.content).toHaveLength(3);
  expect(second.content[2]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_c', is_error: true });
  expect(out.quotes).toHaveLength(0);
});
it('both tools are offered to the model', async () => { … expect(create.mock.calls[0][0].tools.map(t => t.name)).toEqual(['compute_quote', 'send_price_table']); });
it('priceTables is [] when the model never calls send_price_table', …existing no-tool case → expect(out.priceTables).toEqual([]));
```
- [ ] **Step 2: รัน → FAIL** (`priceTables` undefined / tool ถูกข้าม)
- [ ] **Step 3: แก้ run.ts** — `tools: [COMPUTE_QUOTE_TOOL, SEND_PRICE_TABLE_TOOL]`; ใน loop แยก branch ตาม `block.name`; `priceTables` dedupe ด้วย `includes`; output เพิ่ม `priceTables`
- [ ] **Step 4: รัน → PASS** (`npx vitest run tests/ai-quote-run.test.ts`)
- [ ] **Step 5: Commit** `feat(ai-quote): runQuoteTurn handles send_price_table → priceTables`

### Task 6: adapters ส่งหลาย message (LINE array ≤5 · Messenger ตามลำดับ)

**Files:**
- Modify: `lib/ai-quote/channels/types.ts` (`ChannelAdapter.reply`/`push` message type)
- Modify: `lib/ai-quote/channels/line.ts` (`replyLine`, `pushLine`, adapter)
- Modify: `lib/ai-quote/channels/messenger.ts` (adapter `reply`)
- Test: `tests/ai-quote-line-messages.test.ts` (ใหม่), `tests/ai-quote-messenger-send.test.ts`

**Interfaces (Produces):**
```ts
// channels/types.ts
export type OutboundMessage = string | object;
reply(msg, message: OutboundMessage | OutboundMessage[], quickReplies?): Promise<void>;
push(channelUserId, message: OutboundMessage | OutboundMessage[]): Promise<void>;
// channels/line.ts (pure, exported)
export const LINE_MAX_MESSAGES = 5;
export function buildLineMessages(message: OutboundMessage | OutboundMessage[], qrs?: QuickReply[]): Record<string, unknown>[]
//   string → {type:'text', text} · object → as-is · quickReply ติดตัวสุดท้าย · เกิน 5 → เก็บ 4 ตัวแรก + ตัวสุดท้าย (ข้อความต้องรอด)
```
- `replyLine`/`pushLine` ใช้ `buildLineMessages` แล้วส่ง `messages: [...]` · Messenger adapter: `reply` วน `for` ส่งทีละตัว **await ต่อกัน** quick replies เฉพาะตัวสุดท้าย

- [ ] **Step 1: เขียนเทสต์ `tests/ai-quote-line-messages.test.ts`**
```ts
it('wraps a string as one text message (unchanged behaviour)', () => expect(buildLineMessages('hi')).toEqual([{ type: 'text', text: 'hi' }]));
it('keeps order and attaches quick replies to the LAST message only', () => {
  const out = buildLineMessages([{ type: 'image', originalContentUrl: 'u', previewImageUrl: 'u' }, 'text'], [{ label: 'L', text: 'T' }]);
  expect(out[0]).toEqual({ type: 'image', originalContentUrl: 'u', previewImageUrl: 'u' });
  expect(out[1]).toMatchObject({ type: 'text', text: 'text', quickReply: { items: [{ type: 'action', action: { type: 'message', label: 'L', text: 'T' } }] } });
});
it('caps at 5 messages keeping the last one', () => {
  const out = buildLineMessages(['a','b','c','d','e','f','last']);
  expect(out).toHaveLength(5); expect(out.at(-1)).toEqual({ type: 'text', text: 'last' }); expect(out[0]).toEqual({ type: 'text', text: 'a' });
});
```
และใน `tests/ai-quote-messenger-send.test.ts` (ใช้ `vi.stubGlobal('fetch', …)` + `buildMessengerAdapter('s')`):
```ts
it('adapter.reply with an array sends one Send API call per message, in order, quick replies on the last', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetchMock); process.env.FB_PAGE_TOKEN = 'tok';
  await buildMessengerAdapter('s').reply({ channel: 'messenger', channelUserId: 'P1', kind: 'text' }, [{ attachment: { type: 'image', payload: { url: 'u', is_reusable: true } } }, 'ข้อความ'], [{ label: 'L', text: 'T' }]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
  expect(bodies[0].message.attachment.type).toBe('image'); expect(bodies[0].message.quick_replies).toBeUndefined();
  expect(bodies[1].message.text).toBe('ข้อความ'); expect(bodies[1].message.quick_replies).toHaveLength(1);
});
```
- [ ] **Step 2: รัน → FAIL**
- [ ] **Step 3: แก้ types/line/messenger ตาม Interfaces** (`quickReplyPayload` เดิมใช้ต่อได้)
- [ ] **Step 4: รัน 2 ไฟล์ → PASS · `npm run type-check`** (เทสต์เดิมที่ assert `messages: [msg]` ถ้ามีต้องยังผ่าน — shape เดิมคือ array 1 ตัว)
- [ ] **Step 5: Commit** `feat(ai-quote/channels): reply/push accept message arrays (LINE ≤5, Messenger sequential)`

### Task 7: router ส่ง `[รูป…, ข้อความ]` เมื่อเทิร์นมี `priceTables`

**Files:**
- Modify: `lib/ai-quote/webhook-router.ts` (ท้ายทาง `ai` บรรทัด ~400 `await deps.adapter.reply(m, out.reply)`)
- Test: `tests/ai-quote-webhook-router.test.ts` (describe "handleInbound — customer AI mode")

**Interfaces:**
- Consumes: `priceTableImageMessage` (Task 4) · `out.priceTables` (Task 5) · adapter array (Task 6)
- Produces: helper ภายใน `withPriceTables(out: RunQuoteTurnOutput, channel): OutboundMessage | OutboundMessage[]` — ไม่มีตาราง → `out.reply` (string เหมือนเดิม) · มี → `[...images, out.reply]` · escalate path **ไม่** แนบรูป (เดิม)

- [ ] **Step 1: เขียนเทสต์** (ใช้ `stubAi`/`stubDeps` เดิม — `runTurn` คืน `priceTables`)
```ts
it('in-mode turn with price tables replies [image…, text] — image first, text last', async () => {
  const { ai } = stubAi({ runTurn: async () => ({ reply: '📊 ตารางราคาบัตร PVC อยู่ด้านบนนะคะ กี่ใบดีคะ', quotes: [], escalated: false, newHistory: [], priceTables: ['pvc_card'] }) });
  const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
  await handleInbound(text1on1('บัตร PVC'), deps as never);
  const sent = replies[0] as unknown[];
  expect(Array.isArray(sent)).toBe(true); expect(sent).toHaveLength(2);
  expect(sent[0]).toMatchObject({ type: 'image', originalContentUrl: expect.stringContaining('/price-tables/pvc_card.jpg') });
  expect(sent[1]).toContain('กี่ใบ');
});
it('messenger channel gets an attachment image instead of a LINE image', …channel:'messenger' → expect(sent[0]).toMatchObject({ attachment: { type: 'image' } }));
it('turn without price tables still replies a plain string', …priceTables: [] → expect(typeof replies[0]).toBe('string'));
```
- [ ] **Step 2: รัน → FAIL** · **Step 3: แก้ router** · **Step 4: รัน → PASS** (`npx vitest run tests/ai-quote-webhook-router.test.ts`)
- [ ] **Step 5: Commit** `feat(ai-quote): LINE/Messenger reply carries the price-table image before the text`

### Task 8: ราคาฝั่งลูกค้า (exempt สินค้าใหม่) + trigger/คำพูดนอกโหมด

**Files:**
- Modify: `lib/ai-quote/customer-deps.ts:roundOutcomeForCustomer` (เงื่อนไข `!== 'namecard'` → set `KEEP_CALC_TOTAL = new Set(['namecard','calendar','pvccard'])`)
- Modify: `lib/ai-quote/customer-triggers.ts` (เพิ่ม `detectPriceTableTopic`, `hintQuickReply`, `SEEDED_EXIT_HINT`; แก้ `INTRO_TEXT`/`HINT_TEXT` list สินค้า)
- Test: `tests/ai-quote-customer-deps.test.ts`, `tests/ai-quote-customer-triggers.test.ts`

**Interfaces (Produces):**
```ts
export type PriceTableTopic = 'pvc' | 'calendar';
export function detectPriceTableTopic(text: string): PriceTableTopic | null   // PVC ก่อน: /pvc|พีวีซี|บัตรพลาสติก/i · แล้ว /ปฏิทิน/ · ไม่เจอ = null
export function hintQuickReply(topic: PriceTableTopic | null): QuickReply
//   null → HINT_QUICK_REPLY · 'pvc' → { label:'🤖 ดูราคาบัตร PVC', text:'ขอราคา AI บัตร PVC' } · 'calendar' → { label:'🤖 ดูราคาปฏิทิน', text:'ขอราคา AI ปฏิทิน' }
export const SEEDED_EXIT_HINT = "(พิมพ์ 'ออก' เมื่อต้องการกลับไปคุยกับทีมงานค่ะ)";
```
- `INTRO_TEXT` บรรทัด "• ตีราคาได้: โบรชัวร์/ใบปลิว · หนังสือ · สมุด · นามบัตร · ปฏิทิน · บัตร PVC" · `HINT_TEXT` "(เฉพาะรายการโบรชัวร์ · หนังสือ · สมุด · นามบัตร · ปฏิทิน · บัตร PVC)"

- [ ] **Step 1: เขียนเทสต์** — customer-deps:
```ts
it('keeps calendar/pvccard totalPrice from calc (design fee + 0.25-step unit must survive)', () => {
  const r = roundOutcomeForCustomer({ ok: true, productType: 'pvccard', spec: { qty: 20 }, result: { unitPrice: 90, designFee: 300, totalPrice: 2100, unitPriceVat: 96.3, totalPriceVat: 2247 } });
  if (r.ok) { expect(r.result.totalPrice).toBe(2100); expect(r.result.unitPrice).toBe(90); expect(r.result.unitPriceVat).toBeUndefined(); }
  const c = roundOutcomeForCustomer({ ok: true, productType: 'calendar', spec: { qty: 800 }, result: { unitPrice: 20.25, totalPrice: 16200 } });
  if (c.ok) { expect(c.result.unitPrice).toBe(20.25); expect(c.result.totalPrice).toBe(16200); }
});
```
customer-triggers:
```ts
it.each([['บัตร PVC ราคาเท่าไหร่','pvc'],['ทำบัตรพีวีซีไหม','pvc'],['ปฏิทินแขวน 500 ชุด','calendar'],['อยากได้ปฏิทินกับบัตร pvc','pvc'],['โบรชัวร์ A4','null']])('detectPriceTableTopic(%s) → %s', (t, want) => expect(String(detectPriceTableTopic(t))).toBe(want));
it('hintQuickReply labels fit the LINE 20-char limit and carry the AI token', () => {
  for (const topic of ['pvc','calendar',null] as const) { const q = hintQuickReply(topic); expect(Array.from(q.label).length).toBeLessThanOrEqual(20); expect(q.text).toMatch(/^ขอราคา AI/); }
  expect(hintQuickReply(null)).toEqual(HINT_QUICK_REPLY);
});
it('intro + hint list the two new products', () => { for (const t of [INTRO_TEXT, HINT_TEXT]) { expect(t).toContain('ปฏิทิน'); expect(t).toContain('บัตร PVC'); } });
```
- [ ] **Step 2: รัน → FAIL** · **Step 3: แก้ 2 ไฟล์** · **Step 4: รัน → PASS** (เทสต์เดิมที่ pin INTRO/HINT ต้องยังผ่าน — ถ้ามีตัวที่ pin ข้อความเต็ม ปรับให้ตรงข้อความใหม่)
- [ ] **Step 5: Commit** `feat(ai-quote): customer totals keep calc value for calendar/pvccard; topic-aware hint button + product lists`

### Task 9: เข้าโหมดด้วย seed (Messenger ปุ่มพกสินค้า) + hint ใช้ปุ่มตาม topic

**Files:**
- Modify: `lib/ai-quote/webhook-router.ts` (`isEnterAiKeyword`, ใหม่ `parseEnterAiSeed`, `handleInbound` route `enter-ai` + hint path บรรทัด ~283)
- Test: `tests/ai-quote-webhook-router.test.ts`

**Interfaces (Produces):**
```ts
export function parseEnterAiSeed(text: string): string | null   // /^\/?(ขอราคา|ตีราคา)\s*ai\s+(\S.*)$/i → group ตัดช่องว่าง; ไม่ตรง → null
// isEnterAiKeyword(text) = ฟอร์มเปล่าเดิม || parseEnterAiSeed(text) !== null
```
- `handleInbound` route `enter-ai`: `seed = m.kind === 'text' ? parseEnterAiSeed(m.text) : null` → `await ai.enterMode(uid)` → ไม่มี seed: reply INTRO (เดิม) · มี seed: เดินทาง `ai` ต่อด้วย `text = seed` — โหลด mode **หลัง** enterMode (ให้ `roundsNoQuote` อ่านจาก row = 0) และข้ามเช็ค `active` (เพิ่งเข้า) · reply/persist ใช้ `out.reply + '\n\n' + SEEDED_EXIT_HINT` (ข้อความที่ persist = ที่ลูกค้าเห็น) · triggers ①④/rate limit/escalate ทำงานบน seed ตามปกติ
- hint path: `deps.adapter.reply(m, HINT_TEXT, [hintQuickReply(detectPriceTableTopic(m.text!))])`

- [ ] **Step 1: เขียนเทสต์**
```ts
// routeInbound
it.each(['ขอราคา AI บัตร PVC', '/ขอราคา AI ปฏิทิน', 'ขอราคาai ปฏิทิน'])('seed form %s → enter-ai', (t) => expect(routeInbound({ ...base, kind: 'text', text: t }, on)).toBe('enter-ai'));
it.each(['ขอราคา ปฏิทิน 500 ชุด', 'ขอราคาบัตร PVC หน่อย', 'ตีราคา แขวน'])('natural sentence without the AI token %s → ai (NOT enter-ai)', (t) => expect(routeInbound({ ...base, kind: 'text', text: t }, on)).toBe('ai'));
it('parseEnterAiSeed extracts the trailing product phrase', () => { expect(parseEnterAiSeed('ขอราคา AI บัตร PVC')).toBe('บัตร PVC'); expect(parseEnterAiSeed('ขอราคา AI')).toBeNull(); expect(parseEnterAiSeed('ขอราคา ปฏิทิน')).toBeNull(); });
// handleInbound
it('seeded entry enters the mode and runs the first turn with the seed, appending the exit hint', async () => {
  const runTurn = vi.fn(async () => ({ reply: '📊 ตารางราคาบัตร PVC อยู่ด้านบนนะคะ กี่ใบดีคะ', quotes: [], escalated: false, newHistory: [], priceTables: ['pvc_card'] }));
  const { ai, calls } = stubAi({ runTurn });
  const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
  await handleInbound(text1on1('ขอราคา AI บัตร PVC'), deps as never);
  expect(calls).toContain('enter');
  expect(runTurn).toHaveBeenCalledWith(expect.anything(), 'บัตร PVC');
  const sent = replies[0] as unknown[];
  expect(sent[0]).toMatchObject({ type: 'image' }); expect(sent[1]).toContain('ออก');
  expect(String(replies[0])).not.toContain('ประเมินราคาอัตโนมัติ');   // no INTRO
});
it('bare enter keyword still sends the intro (unchanged)', …existing test stays green);
it('out-of-mode PVC text gets the PVC button; generic text keeps the default button', async () => {
  const { ai } = stubAi({ modeActive: () => false, loadMode: async () => null });
  const quick: unknown[] = []; const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai, adapter: { downloadImage: async () => new Blob(), push: async () => {}, reply: async (_m, _msg, qrs) => { quick.push(qrs); } } });
  await handleInbound(text1on1('บัตร PVC ราคาเท่าไหร่'), deps as never);
  expect(quick[0]).toEqual([{ label: '🤖 ดูราคาบัตร PVC', text: 'ขอราคา AI บัตร PVC' }]);
});
```
- [ ] **Step 2: รัน → FAIL** · **Step 3: แก้ router** · **Step 4: รัน → PASS ทั้งไฟล์**
- [ ] **Step 5: Commit** `feat(ai-quote): seeded mode entry from product-aware hint button (Messenger)`

### Task 10: prompts (ลูกค้า + staff) — ปฏิทิน/PVC + กฎ `send_price_table`

**Files:**
- Modify: `lib/ai-quote/prompt-customer.ts`, `lib/ai-quote/prompt.ts`
- Test: `tests/ai-quote-prompt.test.ts` (มี describe ของทั้ง 2 prompt อยู่แล้ว — เพิ่มใน describe ที่ตรง)

**เนื้อหาที่ต้องมีทั้งสอง prompt** (copy ตาม spec §4/§5/§6.4 — ปรับ voice ตาม prompt: ลูกค้า "ค่ะ", staff เดิม):
- หัวข้อ "งานที่ประเมินราคาได้" → **6 ชนิด** + 2 บรรทัดใหม่: `**ปฏิทิน** (calendar): kind = chinese/desk/hanging · variant (จีน/แขวน '10.5x15' หรือ '15x21' นิ้ว · ตั้งโต๊ะ '8' หรือ '14' แผ่น) · qty (ชุด)` และ `**บัตร PVC** (pvccard): qty (ใบ)`
- section "## ปฏิทิน + บัตร PVC — กฎเฉพาะ": สเปกที่ราคารวม (จีน 13 แผ่น/ชุด ขั้นต่ำ 300 ชุด · แขวน = หัวป้ายโฆษณา 1 แผ่น + แผ่นเดือน 13 แผ่น · ตั้งโต๊ะ 6x8 นิ้ว รวมฐานตั้ง + สันห่วง · PVC 5.4x8.6 ซม. พิมพ์หน้าเดียวหรือสองหน้าราคาเดียวกัน ทนน้ำ ทนรอยขีดข่วน · ≥30 ใบ ออกแบบฟรี <30 ใบ ค่าออกแบบ 300 บาท) · "ขนาด/แบบอื่นนอกตาราง → ส่งต่อทีมงาน" · เครื่องมือตอบ `below_min` → แจ้งขั้นต่ำแล้วถามต่อ **ห้ามใช้วลี "ส่งต่อทีมงาน"** · `above_max` → ส่งต่อทีมงาน
- กฎ `send_price_table`: เรียกครั้งแรกที่รู้ชนิด (PVC ทันที · ปฏิทินเมื่อรู้แบบ) 1 ครั้งต่อตาราง · ข้อความต้องมีบรรทัด "📊 ตารางราคา{ชื่อ}อยู่ด้านบนนะคะ" · ถ้าบทสนทนาก่อนหน้ามีบรรทัดนี้ของตารางเดียวกันแล้ว ไม่เรียกซ้ำ เว้นแต่ลูกค้าขอดูอีก
- เกณฑ์ครบพอตีราคา: ปฏิทิน = แบบ + ขนาด/จำนวนแผ่น + จำนวน (**ขนาดห้ามเดา** — ถามรวมครั้งเดียวหลังส่งรูป) · PVC = จำนวนอย่างเดียว
- ประโยคถามแบบปฏิทิน (ลูกค้า) ตรงตัว: "ทำได้ค่ะ 😊 แบบที่นิยมมี 3 แบบ: ปฏิทินจีน · ตั้งโต๊ะ 6x8 นิ้ว · แขวน รับแบบไหนดีคะ (ขนาดอื่นนอกจากนี้ ทีมงานคุยรายละเอียดให้ค่ะ)"
- รูปแบบตอบราคา: ปฏิทิน "ชุดละ X · รวม Y" + 📋 บอกว่า 1 ชุดได้อะไร · PVC "ใบละ X · (ค่าออกแบบ 300 บาท ต่ำกว่า 30 ใบ) · รวม Y" + 📋 ขนาด/หน้า/ทนน้ำ — ราคารวมใช้ `totalPrice` จากเครื่องมือ (มีค่าออกแบบรวมแล้ว)
- template "ขอราคาหน่อย" (ลูกค้า): "6 ประเภท" + เพิ่ม 2 บรรทัด `📅 ปฏิทิน` `💳 บัตร PVC` · หัวข้อ "เมื่องานเกินขอบเขต": "งานนอก 6 ชนิด"

- [ ] **Step 1: เขียนเทสต์ (ทั้ง describe ลูกค้าและ staff)**
```ts
it('lists calendar + pvccard as quotable with their tool specs', () => { expect(p).toContain('calendar'); expect(p).toContain('pvccard'); expect(p).toContain('10.5x15'); expect(p).toContain("'8'"); });
it('pins what each calendar/PVC price includes + the PVC design-fee rule', () => { expect(p).toContain('13 แผ่น'); expect(p).toContain('สันห่วง'); expect(p).toContain('5.4x8.6'); expect(p).toMatch(/ค่าออกแบบ 300/); expect(p).toContain('ขั้นต่ำ 300'); });
it('tells the model to send the price table once and mark it in the reply', () => { expect(p).toContain('send_price_table'); expect(p).toContain('📊 ตารางราคา'); expect(p).toMatch(/1 ครั้งต่อตาราง|ครั้งเดียว/); });
it('never guesses calendar size; other sizes hand off', () => { expect(p).toMatch(/ขนาดห้ามเดา|ห้ามเดาขนาด/); expect(p).toMatch(/ขนาด\/แบบอื่น[^\n]*ส่งต่อทีมงาน|นอกตาราง[^\n]*ส่งต่อทีมงาน/); });
// customer only
it('below_min keeps the customer talking (no hand-off phrase) and asks the popular-3 question verbatim', () => { expect(p).toContain('แบบที่นิยมมี 3 แบบ'); expect(p).toMatch(/below_min[^\n]*ห้ามใช้วลี/); expect(p).toContain('📅 ปฏิทิน'); expect(p).toContain('💳 บัตร PVC'); });
```
- [ ] **Step 2: รัน → FAIL** · **Step 3: แก้ 2 prompt** (เทสต์เดิม "4 ชนิด"/template ถ้า pin ข้อความเดิมให้ปรับ) · **Step 4: รัน → PASS**
- [ ] **Step 5: Commit** `feat(ai-quote): prompts know calendar/PVC tables, send_price_table rule, min/max handling`

### Task 11: staff surface — `priceTables` ใน response/panel + labels

**Files:**
- Modify: `lib/ai-quote/types.ts` (`AiQuoteResponse.priceTables?: PriceTableId[]`)
- Modify: `app/api/ai-quote/route.ts` (ใส่ `priceTables: out.priceTables`)
- Modify: `app/quote-assistant/quote-assistant-client.tsx` (`PRODUCT_LABEL` + `UNIT_LABEL` + state `lastTables` + ลิงก์ใต้ price card)
- Modify: `lib/ai-quote/escalation-flex.ts:28` (`PRODUCT_LABEL` + หน่วย)
- Test: `tests/ai-quote-escalation-flex.test.ts`

**Interfaces:**
- Create: `lib/ai-quote/product-labels.ts` (pure) — `PRODUCT_LABEL: Record<string,string>` (6 ชนิด) + `UNIT_LABEL: Record<string, string> = { calendar: 'ชุด', pvccard: 'ใบ', namecard: 'ใบ' }` + `unitLabel(productType): string` default `'ชิ้น'` — panel ใช้ `บาท/${unit}`, escalation ใช้ `บ./${unit}`; ลบ map `PRODUCT_LABEL` ซ้ำใน panel + escalation-flex (และ quote-leads ถ้ามี) แล้ว import จากที่เดียว
- panel: ใต้ "ราคาที่คำนวณได้" (หรือแยกกล่องถ้าไม่มี quote) แสดง "📊 ตารางราคาที่ส่งให้ลูกค้า:" + ลิงก์ `PRICE_TABLE_LABEL[id]` → `priceTableUrl(id)` `target="_blank" rel="noreferrer"`

- [ ] **Step 1: เขียนเทสต์ escalation-flex**
```ts
it('labels calendar/pvccard quotes with product name and unit', () => {
  const flex = JSON.stringify(buildEscalationFlex({ ...baseInput, lastQuote: { productType: 'calendar', unitPrice: 20.25 } }));
  expect(flex).toContain('ปฏิทิน'); expect(flex).toContain('20.25 บ./ชุด');
  expect(JSON.stringify(buildEscalationFlex({ ...baseInput, lastQuote: { productType: 'pvccard', unitPrice: 90 } }))).toContain('บัตร PVC');
});
```
- [ ] **Step 2: รัน → FAIL** · **Step 3: สร้าง `product-labels.ts` (`PRODUCT_LABEL`, `UNIT_LABEL`, `unitLabel(productType)`) · แก้ escalation-flex/panel/route/types** · **Step 4: รัน → PASS · `npm run type-check` · `npm run build`**
- [ ] **Step 5: Commit** `feat(ai-quote): staff panel shows sent price tables; shared product/unit labels`

### Task 12: docs + deploy dashboard + runbook smoke prod

**Files:**
- Modify: `dashboard-v2.md` (§10 version history: entry 2026-10-19 — สรุป feature, ไฟล์, tool ใหม่, Messenger-only seed, update protocol รูป+ราคา) · section AI quote features list (6 ชนิด)
- Modify: `PATTERNS.md` — เพิ่ม §"ตารางราคาแบบขั้น + รูปตารางคู่กัน" 5-8 บรรทัด (เมื่อไหร่ใช้ tier table แทนสูตร · รูปกับโค้ดต้องเปลี่ยนคู่กัน · tool ที่ไม่มี I/O เป็นสัญญาณให้ router)
- Modify: `NEXT-SESSION.md` — ทำใน `/session-end` (ไม่ใช่ task นี้)

- [ ] **Step 1: gates เต็ม** `npm run type-check && npm run lint && npm test && npm run build` — ทั้งหมดเขียว (tests เดิม 751 + ใหม่ ≈ 775+)
- [ ] **Step 2: อัปเดต dashboard-v2.md + PATTERNS.md · Commit** `docs(dashboard-v2): calendar/PVC price-table products + send_price_table`
- [ ] **Step 3: ยืนยัน calc smoke ของ Task 3 เขียวแล้ว (pin sha) ก่อน push dashboard** → `git push origin main` → รอ CI + post-deploy smoke dashboard เขียว pin sha
- [ ] **Step 4: ตรวจรูปบน prod** `curl -sI https://dashboard.penprinting.co/price-tables/pvc_card.jpg` → `200` + `content-type: image/jpeg`
- [ ] **Step 5: ส่ง runbook smoke ให้คุณนุ๊ก (เปิดบทสนทนาใหม่)** — ตาม spec §6.7 ข้อ 3: LINE (a)-(e) ผ่าน rich menu · Messenger (f) ปุ่ม "🤖 ดูราคาบัตร PVC" (ต้องเป็นบัญชีที่ยังไม่ได้ hint ใน 24 ชม. และทีมไม่ได้ตอบใน 48 ชม.) · ค่าที่คาด: PVC 150 ใบ = 70/ใบ รวม 10,500 · แขวน 15x21 800 ชุด = 20.25 รวม 16,200 · PVC 20 ใบ = 90 + 300 รวม 2,100 · จีน 200 ชุด = แจ้งขั้นต่ำ 300 · แขวน 6,000 = ส่งต่อทีมงาน + การ์ดกลุ่มทีม "ปฏิทิน"
