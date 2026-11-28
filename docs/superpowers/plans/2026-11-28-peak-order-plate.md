# `/order` PLATE from the chosen press — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A work order opened from `/order` in the LINE group arrives with its "PLATE / การพิมพ์" fields filled from the chosen press, asking one extra question only when the press alone does not decide them.

**Architecture:** One pure rules module (`lib/peak-order/plate.ts`) owns the table press → question → form fields; the postback codec, the cards, the state machine and the order-body mapper all read that one table. The draft gets one new step `plate` between `press` and `date`, entered only when the press has a question. No table change (the step is TEXT, the answer lives in the unit's `choices` JSON).

**Tech Stack:** Next.js 15, TypeScript, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-28-peak-order-plate-design.md`

## Global Constraints

- Press → PLATE, exactly: `sm74` → ขนาด `ตัด 3` · `mo5`, `mo` → `ตัด 4` · `hamada` → `ตัด 5`, each asking `เพลทใหม่` / `เพลทเก่า` · `inkjet` (แป๋) asks `Copyprint` / `Inkjet` / `Print Digital`, no size, the Inkjet button ticks Inkjet only · no press (`''`) → `Print Digital`, no question · `outsource` → no question, LINE writes no PLATE field.
- Uncertain = blank: a press with a question and no valid answer writes no PLATE field (never a default).
- What was chosen in LINE wins over what the keyword rules read from the line text; where LINE decides nothing (Outsource, unanswered), the text-read `digital` stays as it is today.
- Postback `data` ≤ 300 characters; forged / stale postbacks are ignored silently (no reply, no write).
- The duplicate guard (`claimLines` / `finalizeLinks` / `findOrderByPeakMarker`, the `creating` step) is not touched.
- Web form behaviour unchanged. Thai copy matches the existing `/order` cards.
- No `\uXXXX` escapes typed into source by the Write tool for Thai text — write the characters.

## Review Focus

1. A `plate` tap whose answer is not offered for the unit's press (`copyprint` after ต้อม, `new` after แป๋, any answer after Outsource / no press) → nothing happens. *(Task 4)*
2. A draft made before the deploy, already past `press` with an offset press and no plate answer → the order is created with PLATE blank, the summary card shows the press name alone. *(Tasks 1, 3, 4)*
3. Line text says "พิมพ์ดิจิตอล" and an offset press is chosen → `digital` is false on the order and the summary card does not say Digital; with Outsource the same text still ticks Digital and the card says so. *(Tasks 2, 3, 4)*
4. "เหมือนใบก่อน" copies the plate answer with the press; a source unit without an answer copies none. *(Task 4)*
5. A press id added to `STAFF.print` later without a row in the table → a test fails (no silent "Print Digital" or blank for a new press). *(Task 1)*

---

### Task 1: The rules table

**Files:**
- Create: `lib/peak-order/plate.ts`
- Modify: `lib/photobook.ts` (export `PLATE_SIZES`), `app/board/order-form.tsx:106` (import it instead of the local constant)
- Test: `tests/peak-order-plate.test.ts`

**Interfaces — Produces:**

```ts
// lib/photobook.ts
export const PLATE_SIZES = ['ตัด 5', 'ตัด 4', 'ตัด 3'] as const;

// lib/peak-order/plate.ts — pure, no 'server-only'
export const PLATE_ANSWERS = ['new', 'old', 'copyprint', 'inkjet', 'digital'] as const;
export type PlateAnswer = (typeof PLATE_ANSWERS)[number];
export const PLATE_LABEL: Record<PlateAnswer, string>; // เพลทใหม่ · เพลทเก่า · Copyprint · Inkjet · Print Digital
export type PlateFields = Pick<OrderFormData, 'plateOld' | 'plateNew' | 'copyprint' | 'inkjet' | 'digital' | 'plateSize'>;
export interface PlateQuestion { size: string | null; options: readonly PlateAnswer[] }
/** What to ask after this press; null = nothing to ask ('' / outsource / unknown id). */
export function plateQuestion(press: string): PlateQuestion | null;
/** All six PLATE fields as LINE decides them; null = LINE decides nothing. */
export function plateFields(press: string, plate: unknown): PlateFields | null;
/** 'ตัด 4 · เพลทใหม่' / 'Copyprint' / 'Print Digital'; '' when plateFields is null. */
export function plateSummary(press: string, plate: unknown): string;
```

- [x] **Step 1: failing tests** — `tests/peak-order-plate.test.ts`:
  - `it.each` over the spec table: `['sm74','new'] → { plateNew: true, plateSize: ['ตัด 3'] }`, `['sm74','old']`, `['mo5','new'|'old'] → ['ตัด 4']`, `['mo', …] → ['ตัด 4']`, `['hamada', …] → ['ตัด 5']`, `['inkjet','copyprint'|'inkjet'|'digital']` → that one flag, `plateSize: []`; every result `toEqual` the full six-key object (all other flags `false`).
  - `plateFields('', undefined)` and `plateFields('', 'new')` → Print Digital only.
  - null cases: `('outsource', anything)`, `('sm74', undefined | 'copyprint' | 'digital' | 7)`, `('inkjet', 'new' | undefined)`, `('nobody', 'new')`.
  - `plateQuestion`: options `['new','old']` + size for the four offset ids; `['copyprint','inkjet','digital']`, size null for `inkjet`; null for `''`, `'outsource'`, `'nobody'`.
  - every size the table can write is in `PLATE_SIZES`.
  - Review Focus 5: the set of press ids the table has a row for equals `STAFF.print.map((s) => s.id)`.
  - `plateSummary`: `('mo','new') → 'ตัด 4 · เพลทใหม่'`, `('inkjet','copyprint') → 'Copyprint'`, `('', undefined) → 'Print Digital'`, `('outsource', undefined) → ''`, `('sm74', undefined) → ''`.
- [x] **Step 2:** `npx vitest run tests/peak-order-plate.test.ts` → FAIL (module missing).
- [x] **Step 3:** implement; the table is one `Record<string, …>` keyed by press id and is the only place sizes and options are written. `order-form.tsx` imports `PLATE_SIZES` from `lib/photobook`.
- [x] **Step 4:** same command → PASS; `npm run type-check`.
- [x] **Step 5:** commit `feat(peak-order): press → PLATE rules table`.

### Task 2: Codec, mapper, spec summary

**Files:**
- Modify: `lib/peak-order/postback.ts`, `lib/peak-order/mapper.ts`, `lib/peak-order/spec-from-text.ts`
- Test: `tests/peak-order-postback.test.ts`, `tests/peak-order-mapper.test.ts`, `tests/peak-order-spec-from-text.test.ts`

**Interfaces — Consumes:** Task 1. **Produces:**

```ts
// postback.ts
| { a: 'plate'; draft: string; u: number; v: PlateAnswer }   // wire: po1|plate|<draft>|<u>|<v>
// mapper.ts
export interface UnitChoices { qtyUnit?: string; graphic: string; press: string; plate?: string; dateDue: string }
// buildOrderBody: `...p.spec, ...(plateFields(p.choices.press, p.choices.plate) ?? {})` — after spec, before the rest
// spec-from-text.ts
/** The same spec without the print-method tick (fields.digital and its part of the summary). */
export function withoutPrintMethod(spec: SpecFromText): SpecFromText;
```

- [x] **Step 1: failing tests**
  - postback: round trip for each of the five answers; decode returns null for `po1|plate|d1|0|`, `…|0|NEW`, `…|0|ตัด 4`, a fifth field, a bad `u`.
  - mapper `buildOrderBody`: offset + `new` + `spec: { digital: true, size: 'A4' }` → `plateNew: true, plateSize: ['ตัด 4'], digital: false, size: 'A4'`; press `''` → `digital: true`; `outsource` + `spec.digital` → `digital: true`, `plateNew: false`, `plateSize: []`; offset press without `plate` → all PLATE fields as `emptyOrderForm` has them (and `digital` from spec kept).
  - `withoutPrintMethod`: digital-only spec → `{ fields: {}, summary: '' }`; a real corpus line that reads Digital with other fields → fields equal minus `digital`, summary equal minus its last ` · Digital`; a spec without digital → the same object; a paper name containing the word Digital is untouched when `digital` was not read.
- [x] **Step 2:** run the three files → the new cases FAIL.
- [x] **Step 3:** implement. `withoutPrintMethod` lives next to `summarise` and shares its label and separator constants (Digital is always the last part).
- [x] **Step 4:** the three files PASS; `npm run type-check`.
- [x] **Step 5:** commit `feat(peak-order): plate postback, PLATE fields in the order body`.

### Task 3: Cards

**Files:** Modify `lib/peak-order/flex.ts` · Test `tests/peak-order-flex.test.ts`

**Interfaces — Consumes:** Tasks 1–2. **Produces:** `export function plateCard(d: DraftRow): Card`

- Body: `draftHeader(d, p, false)`, then `ส่งต่อพิมพ์: <press name>` + ` · <size>` when the question has one, then the prompt `เพลท:` (offset) or `ประเภทงานพิมพ์:` (แป๋). Buttons: one per option, label `PLATE_LABEL`, data `{ a: 'plate', draft, u, v }`, then `ยกเลิก`. Alt text line `ตัวเลือก: … / ยกเลิก`. Card title `เพลท / การพิมพ์`.
- `summaryCard`: the press line gets ` · ${plateSummary(press, plate)}` when non-empty; the "สเปกที่อ่านได้" line uses `withoutPrintMethod(spec)` when `plateFields(press, plate)` is non-null.

- [x] **Step 1: failing tests** — `plateCard` for `mo` (decoded postbacks = new, old, cancel; text contains `MO (วล) · ตัด 4` and `เพลท:`), for `inkjet` (three options + cancel, no `ตัด`); the existing `invariants(c)` on both; the "every card" loop at `tests/peak-order-flex.test.ts:442` includes `plateCard`. `summaryCard`: `ส่งต่อพิมพ์ MO (วล) · ตัด 4 · เพลทใหม่`; press `''` → `ยังไม่ระบุ · Print Digital`; offset without answer → the press name alone (Review Focus 2); a line reading Digital + offset/new → no `Digital` in text or flex; the same line + `outsource` → `Digital` present (Review Focus 3).
- [x] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [x] **Step 5:** commit `feat(peak-order): plate card, PLATE on the summary card`.

### Task 4: The step

**Files:** Modify `lib/peak-order/db.ts` (`DraftStep`, `DRAFT_STEPS`: `'plate'` after `'press'`), `lib/peak-order/handler.ts` · Test `tests/peak-order-handler-steps.test.ts` (helper `toConfirm` taps `{ a: 'plate', v: 'copyprint' }` after its press)

**Interfaces — Consumes:** Tasks 1–3.

- `STEP_OF.plate = 'plate'`.
- `press`: valid press → `plateQuestion(press)` non-null → gate to `plate`, reply `plateCard`; null → gate to `date` as today. (A `plate` left over from before cannot matter: the plate step overwrites it, and `plateFields` ignores an answer the press does not offer.)
- `plate`: `plateQuestion(unit.choices.press ?? '')` must offer `p.v`, else return null (no gate); gate to `date` with `plate: p.v`, reply `dateCard`.
- `gfx` / `same`: copies `plate` when the source has one.
- `createUnit`: passes `plate: c.plate` in `choices`.

- [x] **Step 1: failing tests** (new `describe('handlePeakOrderPostback — plate')`):
  - offset walk: press `mo` → step `plate`, reply `plateCard(draft)`; plate `new` → step `date`, choices `{ …, press: 'mo', plate: 'new' }`, reply `dateCard`; create → body `plateNew: true`, `plateSize: ['ตัด 4']`, `forwardPrint: 'mo'`.
  - แป๋ walk with `inkjet` → body `inkjet: true`, `digital: false`, `copyprint: false`.
  - press `none` (graphic chosen) and `outsource` → straight to `date`; bodies: `digital: true` / every PLATE field empty.
  - Review Focus 1: at step `plate` after `sm74`, taps `copyprint`, `digital`; after `inkjet`, tap `new`; a plate tap with another `u`; a plate tap while the step is `press` or `date` → `state(f)` unchanged.
  - double tap on a plate button → one transition, one reply.
  - Review Focus 2: a draft seeded at `confirm` with `press: 'sm74'` and no plate → create → PLATE fields all empty.
  - Review Focus 3: line text with "พิมพ์ดิจิตอล": `mo` + `old` → body `digital: false`, `plateOld: true`, summary card without Digital; `outsource` → body `digital: true`.
  - Review Focus 4: split draft, unit 0 = `mo` + `new` created; unit 1 "เหมือนใบก่อน" → choices carry `plate: 'new'`, body `plateNew: true`, `plateSize: ['ตัด 4']`; a source with press `''` copies no `plate` and the body is Print Digital.
  - `x` (cancel) at step `plate` cancels the draft.
- [x] **Step 2:** run the file → new cases FAIL; existing cases that walk an offset / แป๋ press past `press` fail until they tap the plate step — update each to tap it (no assertion weakened).
- [x] **Step 3:** implement. **Step 4:** the file PASSES.
- [x] **Step 5:** `npm test`, `npm run type-check`, `npm run lint`, `npm run build` → all pass. Commit `feat(peak-order): ask the plate after the press, fill PLATE on the order`.

### Task 5: Review, docs, ship

- [x] Independent review of the whole diff (state machine + mapper) before pushing; fix what it finds test-first. — 2026-11-28: no functional defect; 1 Medium + 2 Low were test gaps (the step list vs its type, the dashboard-draft / forced-create paths, cut-from-the-end), all closed with a test that kills the mutant the review named. `DraftStep` is now derived from `DRAFT_STEPS`.
- [ ] Docs: spec status, `dashboard-v2.md` §10, `PATTERNS.md` §12, `CLAUDE.md` source-of-truth row for `lib/peak-order/plate.ts`, `NEXT-SESSION.md`.
- [ ] Push; post-deploy smoke run for that commit is green.
- [ ] Left for the owner's team: first real `/order` with an offset press — the new card appears, the order's PLATE section is filled.
