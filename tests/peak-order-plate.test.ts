import { describe, expect, it } from 'vitest';
import { STAFF } from '@/lib/board';
import { PLATE_SIZES } from '@/lib/photobook';
import {
  PLATE_ANSWERS,
  PLATE_LABEL,
  PLATE_PRESS_IDS,
  plateFields,
  plateQuestion,
  plateSummary,
  type PlateFields,
} from '@/lib/peak-order/plate';

const NONE: PlateFields = { plateOld: false, plateNew: false, copyprint: false, inkjet: false, digital: false, plateSize: [] };

describe('plateFields — the owner\'s table (spec 2026-11-28)', () => {
  it.each([
    ['sm74', 'new', { plateNew: true, plateSize: ['ตัด 3'] }],
    ['sm74', 'old', { plateOld: true, plateSize: ['ตัด 3'] }],
    ['mo5', 'new', { plateNew: true, plateSize: ['ตัด 4'] }],
    ['mo5', 'old', { plateOld: true, plateSize: ['ตัด 4'] }],
    ['mo', 'new', { plateNew: true, plateSize: ['ตัด 4'] }],
    ['mo', 'old', { plateOld: true, plateSize: ['ตัด 4'] }],
    ['hamada', 'new', { plateNew: true, plateSize: ['ตัด 5'] }],
    ['hamada', 'old', { plateOld: true, plateSize: ['ตัด 5'] }],
    ['inkjet', 'copyprint', { copyprint: true }],
    ['inkjet', 'inkjet', { inkjet: true }], // Inkjet alone — not Print Digital too (owner, 2026-11-28)
    ['inkjet', 'digital', { digital: true }],
  ] as const)('%s + %s', (press, plate, want) => {
    expect(plateFields(press, plate)).toEqual({ ...NONE, ...want });
  });

  it('no press (graphic only) = Print Digital, whatever answer rides along', () => {
    expect(plateFields('', undefined)).toEqual({ ...NONE, digital: true });
    expect(plateFields('', 'new')).toEqual({ ...NONE, digital: true });
    expect(plateFields('', 'copyprint')).toEqual({ ...NONE, digital: true });
  });

  it.each([
    ['outsource', undefined],
    ['outsource', 'new'],
    ['outsource', 'digital'],
    ['sm74', undefined], // a draft from before the plate step: unanswered = blank, never a default
    ['sm74', ''],
    ['sm74', 'copyprint'],
    ['sm74', 'inkjet'],
    ['sm74', 'digital'],
    ['sm74', 7],
    ['sm74', null],
    ['sm74', ['new']],
    ['hamada', 'NEW'],
    ['inkjet', undefined],
    ['inkjet', 'new'],
    ['inkjet', 'old'],
    ['nobody', 'new'], // not a press
    ['pook', 'new'], // a graphic id
    ['__proto__', 'new'],
    ['constructor', 'new'],
    ['toString', 'new'],
  ] as const)('%s + %j decides nothing', (press, plate) => {
    expect(plateFields(press, plate)).toBeNull();
    expect(plateSummary(press, plate)).toBe('');
  });

  it('a result is a fresh object each time (a caller may spread or mutate it)', () => {
    const a = plateFields('mo', 'new')!;
    a.plateSize.push('ตัด 3');
    a.plateNew = false;
    expect(plateFields('mo', 'new')).toEqual({ ...NONE, plateNew: true, plateSize: ['ตัด 4'] });
  });
});

describe('plateQuestion', () => {
  it.each([
    ['sm74', 'ตัด 3'],
    ['mo5', 'ตัด 4'],
    ['mo', 'ตัด 4'],
    ['hamada', 'ตัด 5'],
  ] as const)('%s asks new / old and names its size', (press, size) => {
    expect(plateQuestion(press)).toEqual({ size, options: ['new', 'old'] });
  });

  it('แป๋ asks Copyprint / Inkjet / Print Digital, no size', () => {
    expect(plateQuestion('inkjet')).toEqual({ size: null, options: ['copyprint', 'inkjet', 'digital'] });
  });

  it.each(['', 'outsource', 'nobody', 'pook', '__proto__', 'constructor', 'hasOwnProperty'])('%j has nothing to ask', (press) => {
    expect(plateQuestion(press)).toBeNull();
  });

  it('every option of every question is an answer plateFields accepts for that press', () => {
    for (const s of STAFF.print) {
      for (const v of plateQuestion(s.id)?.options ?? []) expect(plateFields(s.id, v)).not.toBeNull();
    }
  });

  it('and nothing else is: an answer that is not offered decides nothing', () => {
    for (const s of STAFF.print) {
      const offered = new Set<string>(plateQuestion(s.id)?.options ?? []);
      for (const v of PLATE_ANSWERS) if (!offered.has(v)) expect(plateFields(s.id, v)).toBeNull();
    }
  });
});

describe('the table and the rest of the app', () => {
  it('has a row for every press on the board — a new press must be decided here, not default silently', () => {
    expect([...PLATE_PRESS_IDS].sort()).toEqual(STAFF.print.map((s) => s.id).sort());
  });

  it('writes only plate sizes the order form has a checkbox for', () => {
    for (const s of STAFF.print) {
      const size = plateQuestion(s.id)?.size;
      if (size != null) expect(PLATE_SIZES).toContain(size);
      for (const v of PLATE_ANSWERS) for (const z of plateFields(s.id, v)?.plateSize ?? []) expect(PLATE_SIZES).toContain(z);
    }
  });

  it('labels every answer', () => {
    expect(PLATE_LABEL).toEqual({ new: 'เพลทใหม่', old: 'เพลทเก่า', copyprint: 'Copyprint', inkjet: 'Inkjet', digital: 'Print Digital' });
  });
});

describe('plateSummary — the words on the summary card', () => {
  it.each([
    ['mo', 'new', 'ตัด 4 · เพลทใหม่'],
    ['sm74', 'old', 'ตัด 3 · เพลทเก่า'],
    ['hamada', 'new', 'ตัด 5 · เพลทใหม่'],
    ['inkjet', 'copyprint', 'Copyprint'],
    ['inkjet', 'inkjet', 'Inkjet'],
    ['inkjet', 'digital', 'Print Digital'],
    ['', undefined, 'Print Digital'],
  ] as const)('%j + %j → %s', (press, plate, want) => {
    expect(plateSummary(press, plate)).toBe(want);
  });
});
