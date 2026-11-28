import { describe, expect, it } from 'vitest';
import type { PeakQuotation } from '@/lib/peak/read';
import { emptyOrderForm } from '@/lib/photobook';
import { QTY_UNITS } from '@/lib/order-constants';
import { NO_NAME, addDaysISO, bangkokISODate, buildOrderBody, firstLine, formatQty, notesBody, planUnits, unitNotes } from '@/lib/peak-order/mapper';
import type { SpecFields } from '@/lib/peak-order/spec-from-text';

const Q = (lines: Array<[string, string, number | null]>): PeakQuotation => ({
  code: 'QO-20261100072',
  status: 'approved',
  issuedDate: '2026-11-01',
  contactCode: 'C1',
  netAmount: null,
  lines: lines.map(([key, description, quantity]) => ({ key, description, quantity, price: 5 })),
});

describe('firstLine', () => {
  it('strips bullets and takes the first non-empty line', () => {
    expect(firstLine('- สติกเกอร์ขาวมุกขนาด 14x10 ซม.\n- พิมพ์ 4 สี')).toBe('สติกเกอร์ขาวมุกขนาด 14x10 ซม.');
    expect(firstLine('\n  \n• * ป้าย')).toBe('ป้าย');
  });
  it('empty / whitespace -> NO_NAME', () => {
    expect(firstLine('')).toBe(NO_NAME);
    expect(firstLine('\n  \n')).toBe(NO_NAME);
    expect(firstLine('- \n * ')).toBe(NO_NAME);
  });
  it('clips to 120 chars', () => {
    expect(Array.from(firstLine('ก'.repeat(300)))).toHaveLength(120);
  });
});

describe('formatQty', () => {
  it('plain integers and decimals', () => {
    expect(formatQty(10)).toBe('10');
    expect(formatQty(50000)).toBe('50000');
    expect(formatQty(0.125)).toBe('0.125');
    expect(formatQty(12.5)).toBe('12.5');
  });
  it('no float noise', () => {
    expect(formatQty(0.1 + 0.2)).toBe('0.3');
    expect(formatQty(1.1 * 3)).toBe('3.3');
  });
  it('0 / null / NaN -> empty', () => {
    expect(formatQty(0)).toBe('');
    expect(formatQty(null)).toBe('');
    expect(formatQty(NaN)).toBe('');
  });
});

describe('dates', () => {
  it('bangkokISODate is the Asia/Bangkok calendar day', () => {
    expect(bangkokISODate(new Date('2026-11-14T18:30:00Z'))).toBe('2026-11-15');
    expect(bangkokISODate(new Date('2026-11-14T16:59:59Z'))).toBe('2026-11-14');
  });
  it('addDaysISO is pure calendar arithmetic', () => {
    expect(addDaysISO('2026-11-28', 3)).toBe('2026-12-01');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2026-11-14', -30)).toBe('2026-10-15');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('planUnits', () => {
  it('single', () => {
    const q = Q([['a', '- ไวนิล 1x2\nรายละเอียด', 3]]);
    expect(planUnits(q, 'single')).toEqual([
      { lineKeys: ['a'], name: 'ไวนิล 1x2', qty: '3', notes: '- ไวนิล 1x2\nรายละเอียด\n\nอ้างอิง Peak: QO-20261100072' },
    ]);
  });
  it('single requires exactly one line', () => {
    expect(() => planUnits(Q([]), 'single')).toThrow('planUnits single requires exactly one line');
    expect(() => planUnits(Q([['a', 'x', 1], ['b', 'y', 1]]), 'single')).toThrow('planUnits single requires exactly one line');
  });
  it('split with and without onlyKeys', () => {
    const q = Q([['a', 'A', 1], ['b', 'B', 2], ['c', 'C', 3]]);
    expect(planUnits(q, 'split').map((u) => u.lineKeys)).toEqual([['a'], ['b'], ['c']]);
    expect(planUnits(q, 'split', ['c', 'a']).map((u) => u.name)).toEqual(['A', 'C']);
  });
  it('merged of 3 lines', () => {
    const q = Q([['a', 'งาน A', 1000], ['b', 'งาน B', 3000], ['c', 'งาน C', null]]);
    const [u, ...rest] = planUnits(q, 'merged');
    expect(rest).toHaveLength(0);
    expect(u.lineKeys).toEqual(['a', 'b', 'c']);
    expect(u.name).toBe('งาน A (+2 รายการ)');
    expect(u.qty).toBe('');
    expect(u.notes).toContain('รายการ 2 (จำนวน 3000): งาน B');
    expect(u.notes.endsWith('\n\nอ้างอิง Peak: QO-20261100072')).toBe(true);
  });
  it('empty description still yields a unit named NO_NAME; long text kept in notes', () => {
    const [u] = planUnits(Q([['a', '   ', 2]]), 'single');
    expect(u.name).toBe(NO_NAME);
    const long = 'ข'.repeat(500);
    const [v] = planUnits(Q([['a', long, 2]]), 'single');
    expect(Array.from(v.name)).toHaveLength(120);
    expect(v.notes).toContain(long);
  });
  it('merged name stays within 120 chars', () => {
    const [u] = planUnits(Q([['a', 'ก'.repeat(300), 1], ['b', 'x', 1]]), 'merged');
    expect(Array.from(u.name).length).toBeLessThanOrEqual(120);
    expect(u.name.endsWith(' (+1 รายการ)')).toBe(true);
  });
});

describe('buildOrderBody', () => {
  const unit = { lineKeys: ['a', 'b'], name: 'ป้าย', qty: '10', notes: 'n' };
  const base = {
    unit,
    choices: { qtyUnit: 'ชิ้น', graphic: 'pook', press: 'inkjet', dateDue: '2026-11-20' },
    customerName: 'ไทยฟูดส์',
    orderer: 'นุ๊ก',
    qoCode: 'QO-20261100072',
    draftId: 'd-1',
    todayISO: '2026-11-14',
    asDraft: false,
  };
  it('maps fields and the peak marker; never sets price or status', () => {
    const b = buildOrderBody(base);
    expect(b).toMatchObject({
      name: 'ป้าย', customer: 'ไทยฟูดส์', dateIn: '2026-11-14', dateDue: '2026-11-20', qty: '10', qtyUnit: 'ชิ้น',
      notes: 'n', assignStaff: 'pook', forwardPrint: 'inkjet', orderer: 'นุ๊ก', orderType: 'normal',
      peak: { code: 'QO-20261100072', lineKeys: ['a', 'b'], draftId: 'd-1' },
    });
    expect(QTY_UNITS).toContain(b.qtyUnit);
    expect(b.peak).toEqual({ code: 'QO-20261100072', lineKeys: ['a', 'b'], draftId: 'd-1' });
    expect('price' in b).toBe(false);
    expect('status' in b).toBe(false);
    expect('force' in b).toBe(false);
  });
  it('asDraft / force / empty graphic', () => {
    const b = buildOrderBody({ ...base, asDraft: true, force: true, choices: { ...base.choices, graphic: '' } });
    expect(b.status).toBe('draft');
    expect(b.force).toBe(true);
    expect(b.assignStaff).toBe('');
  });
  it('merged unit marker lists every line key, exactly', () => {
    const q = Q([['a', 'A', 1], ['b', 'B', 2], ['c', 'C', 3]]);
    const [u] = planUnits(q, 'merged');
    const b = buildOrderBody({ ...base, unit: u, choices: { graphic: 'pook', press: '', dateDue: '2026-11-20' } });
    expect(b.peak).toEqual({ code: 'QO-20261100072', lineKeys: ['a', 'b', 'c'], draftId: 'd-1' });
    expect(Object.keys(b.peak as object).sort()).toEqual(['code', 'draftId', 'lineKeys']);
  });
  it('no qtyUnit keeps the form default', () => {
    const b = buildOrderBody({ ...base, choices: { graphic: 'pook', press: '', dateDue: '2026-11-20' } });
    expect(b.qtyUnit).toBe(emptyOrderForm().qtyUnit);
  });
  it('spec fields land in the body; an A-size leaves the size unit at the form default', () => {
    const b = buildOrderBody({
      ...base,
      spec: { size: 'A4', paperInner: 'อาร์ตมัน 120 แกรม', innerColor: '4สี', coatMatte: true },
    });
    expect(b).toMatchObject({ size: 'A4', paperInner: 'อาร์ตมัน 120 แกรม', innerColor: '4สี', coatMatte: true });
    expect(b.sizeUnit).toBe(emptyOrderForm().sizeUnit);
    expect(b.coatGloss).toBe(false);
    expect(b.paperCover).toBe('');
  });
  it('spec cannot override what came from Peak or was chosen in LINE', () => {
    const hostile = {
      name: 'x', customer: 'x', qty: '9', qtyUnit: 'ถุง', notes: 'x', orderer: 'x', assignStaff: 'x',
      forwardPrint: 'x', dateDue: 'x', dateIn: 'x', orderType: 'photobook', peak: 'x',
    } as unknown as SpecFields;
    const plain = buildOrderBody(base);
    const b = buildOrderBody({ ...base, spec: hostile });
    for (const k of Object.keys(hostile)) expect(b[k], k).toEqual(plain[k]);
  });
  it('notes given at creation replace the notes stored in the unit; without them the unit\'s notes stand', () => {
    expect(buildOrderBody({ ...base, notes: 'เหลือเท่านี้' }).notes).toBe('เหลือเท่านี้');
    expect(buildOrderBody({ ...base, notes: '' }).notes).toBe('');
    expect(buildOrderBody(base).notes).toBe('n');
    expect(buildOrderBody({ ...base, notes: undefined }).notes).toBe('n');
  });
  it('no spec and an empty spec give the same body as before', () => {
    expect(buildOrderBody({ ...base, spec: {} })).toEqual(buildOrderBody(base));
    expect(buildOrderBody({ ...base, spec: undefined })).toEqual(buildOrderBody(base));
  });

  describe('PLATE fields from the press and its answer (spec 2026-11-28)', () => {
    const PLATE_KEYS = ['plateOld', 'plateNew', 'copyprint', 'inkjet', 'digital', 'plateSize'] as const;
    const plateOf = (b: Record<string, unknown>) => Object.fromEntries(PLATE_KEYS.map((k) => [k, b[k]]));
    const EMPTY = plateOf(emptyOrderForm() as unknown as Record<string, unknown>);
    const withChoices = (press: string, plate?: string, spec?: SpecFields) =>
      buildOrderBody({ ...base, choices: { graphic: 'pook', press, dateDue: '2026-11-20', ...(plate === undefined ? {} : { plate }) }, spec });

    it('an offset press + new: its size and Plate ใหม่', () => {
      expect(plateOf(withChoices('mo', 'new'))).toEqual({ ...EMPTY, plateNew: true, plateSize: ['ตัด 4'] });
      expect(plateOf(withChoices('sm74', 'old'))).toEqual({ ...EMPTY, plateOld: true, plateSize: ['ตัด 3'] });
      expect(plateOf(withChoices('hamada', 'old'))).toEqual({ ...EMPTY, plateOld: true, plateSize: ['ตัด 5'] });
    });
    it('แป๋ + Inkjet ticks Inkjet alone', () => {
      expect(plateOf(withChoices('inkjet', 'inkjet'))).toEqual({ ...EMPTY, inkjet: true });
      expect(plateOf(withChoices('inkjet', 'copyprint'))).toEqual({ ...EMPTY, copyprint: true });
    });
    it('no press = Print Digital', () => {
      expect(plateOf(withChoices(''))).toEqual({ ...EMPTY, digital: true });
    });
    it('what was chosen in LINE wins over what the text said: offset + a line reading "digital" → not digital', () => {
      const b = withChoices('mo', 'new', { digital: true, size: 'A4', coatMatte: true });
      expect(plateOf(b)).toEqual({ ...EMPTY, plateNew: true, plateSize: ['ตัด 4'] });
      expect(b).toMatchObject({ size: 'A4', coatMatte: true }); // the rest of the spec stays
      expect(plateOf(withChoices('inkjet', 'copyprint', { digital: true }))).toEqual({ ...EMPTY, copyprint: true });
    });
    it('Outsource: LINE writes no PLATE field — a "digital" read from the text stays as before', () => {
      expect(plateOf(withChoices('outsource'))).toEqual(EMPTY);
      expect(plateOf(withChoices('outsource', 'new'))).toEqual(EMPTY);
      expect(plateOf(withChoices('outsource', undefined, { digital: true }))).toEqual({ ...EMPTY, digital: true });
    });
    it('a press with a question and no (valid) answer — a draft from before the plate step — leaves PLATE as before', () => {
      expect(plateOf(withChoices('sm74'))).toEqual(EMPTY);
      expect(plateOf(withChoices('sm74', 'copyprint'))).toEqual(EMPTY);
      expect(plateOf(withChoices('sm74', undefined, { digital: true }))).toEqual({ ...EMPTY, digital: true });
      expect(withChoices('sm74')).toEqual(buildOrderBody({ ...base, choices: { graphic: 'pook', press: 'sm74', dateDue: '2026-11-20' } }));
    });
    it('the answer itself is not a form field: the body has no "plate" key', () => {
      expect('plate' in withChoices('mo', 'new')).toBe(false);
    });
    it('a hostile spec cannot set the plate fields LINE decided', () => {
      const hostile = { plateOld: true, plateSize: ['ตัด 5'], copyprint: true, inkjet: true } as unknown as SpecFields;
      expect(plateOf(withChoices('mo', 'new', hostile))).toEqual({ ...EMPTY, plateNew: true, plateSize: ['ตัด 4'] });
    });
  });
});

// Spec §13.7: the notes keep every line of the text except the line that is the order's name.
describe('notesBody — the line text for the notes', () => {
  const REAL =
    'ปฏิทินแขวน ขนาด 15x21 นิ้ว\nปฏิทินขนาดป้าย 15x21 นิ้ว พิมพ์ 4 สี\nกระดาษการ์ดอาร์ตหน้าเดียว 230 แกรม เคลือบเงา\nภู่ปฏิทิน ขนาด 7x15 นิ้ว พิมพ์ 4 สี กระดาษปอนด์ 55 แกรม\nเข้าหัวเหล็ก';

  it("คุณนุ๊ก's first real order: only the name line goes; every line under it stays as written", () => {
    expect(notesBody(REAL, firstLine(REAL))).toBe(REAL.split('\n').slice(1).join('\n'));
  });
  it('nothing to drop -> the text exactly as it is', () => {
    const d = '  ก \r\n\r\n\r\n ข ';
    expect(notesBody(d, 'อื่น')).toBe(d);
  });
  it('the first line stays when it is not the whole name (a clipped name)', () => {
    const d = `${'ก'.repeat(300)}\nขนาด A4`;
    expect(notesBody(d, firstLine(d))).toBe(d);
  });
  it('the name is compared without the bullet; leading blank lines do not count', () => {
    expect(notesBody('\n  \n- สมุดโน้ต\n- 80 แผ่น', 'สมุดโน้ต')).toBe('- 80 แผ่น');
  });
  it('only the first line can be the name', () => {
    expect(notesBody('ก\nข\nก', 'ก')).toBe('ข\nก');
    expect(notesBody('ข\nก', 'ก')).toBe('ข\nก');
  });
  it('a name that is not in the text drops nothing', () => {
    expect(notesBody('ก\nข', NO_NAME)).toBe('ก\nข');
    expect(notesBody('', NO_NAME)).toBe('');
  });
  it('a text that is only the name line -> empty', () => {
    expect(notesBody('ใบปลิว', 'ใบปลิว')).toBe('');
    expect(notesBody('\n- ใบปลิว\n\n  \n', 'ใบปลิว')).toBe('');
  });
  it('blank lines left behind by the name line do not pile up or lead / trail', () => {
    expect(notesBody('ชื่อ\n\nก\n\n \nข\n\n', 'ชื่อ')).toBe('ก\n\nข');
    expect(notesBody('\n\nชื่อ\n\n\nก', 'ชื่อ')).toBe('ก');
  });
  it('kept lines keep their own spaces and bullets', () => {
    expect(notesBody('ชื่อ\n  - ปั๊มฟอยล์ทอง  \nขนาด A4', 'ชื่อ')).toBe('  - ปั๊มฟอยล์ทอง  \nขนาด A4');
  });
  it('CRLF and lone CR text', () => {
    expect(notesBody('ชื่อ\r\nขนาด A4\r\nปั๊มฟอยล์\rเข้าหัวเหล็ก', 'ชื่อ')).toBe('ขนาด A4\nปั๊มฟอยล์\nเข้าหัวเหล็ก');
  });
});

// Spec §13.7: what order creation writes into the notes — every line under the name line.
describe('unitNotes — notes of a unit at creation', () => {
  const CARD = 'นามบัตรขนาด 9x5.5 ซม.\nพิมพ์ 4 สี 1 หน้า\nกระดาษอาร์ตมัน 260 แกรม';
  const TICKET = 'ตั๋วขนาด 6x12 ซม.\nกระดาษอาร์ต 260 แกรม\nเคลือบด้าน';
  const q = Q([['a', CARD, 100], ['b', TICKET, 50]]);
  const REF = 'อ้างอิง Peak: QO-20261100072';
  const [ua, ub] = planUnits(q, 'split');

  it('one line: without the name line; every spec line stays as written; the Peak reference stays', () => {
    expect(unitNotes(q, ua, q.code)).toBe(`พิมพ์ 4 สี 1 หน้า\nกระดาษอาร์ตมัน 260 แกรม\n\n${REF}`);
  });
  it('lines whose values are all in a field stay too', () => {
    expect(unitNotes(q, ub, q.code)).toBe(`กระดาษอาร์ต 260 แกรม\nเคลือบด้าน\n\n${REF}`);
  });
  it('a line that is only the name: only the Peak reference is left', () => {
    const one = Q([['a', 'ไวนิลขนาด 1x2 เมตร', 1]]);
    expect(unitNotes(one, planUnits(one, 'single')[0], one.code)).toBe(REF);
  });
  // One text from each of the 8 ways the second independent review (2026-11-19) made a spec line
  // leave the notes while what it said was in no field, or in the wrong one.
  it.each<[string, string]>([
    ['two parts named with a Thai joiner', 'แคตตาล็อคขนาด 19x26 cm\nเนื้อในรวมปก 16 หน้า\nกระดาษอาร์ต 160g\nพิมพ์ 4 สี\nมุงหลังคา'],
    ['a line above a ปก line says "not included"', 'หนังสือขนาด A4\nเนื้อในปอนด์ 80 แกรม พิมพ์ 1 สี 32 หน้า\nเข้าเล่มไสกาวปกอ่อน\nราคานี้ไม่รวม\nปกเคลือบด้าน'],
    ['headings that carry a value', 'ตั๋วขนาด 6x12 ซม.\nกระดาษอาร์ต 260 แกรม\nด้านหน้า พิมพ์ 4 สี\nเคลือบด้าน\nด้านหลัง พิมพ์ 4 สี\nเคลือบ UV'],
    ['a second item in the same text', 'นามบัตรขนาด 9x5.5 ซม.\nพิมพ์ 4 สี 1 หน้า\nกล่องใส่นามบัตร พิมพ์ 4 สี\nกระดาษอาร์ตมัน 260 แกรม\nเคลือบด้าน'],
    ['a list under "not included"', 'นามบัตร 9x5.5 ซม.\nพิมพ์ 4 สี 2 หน้า\nราคานี้ไม่รวม\n- เคลือบด้าน\n- Spot UV'],
    ['unticked boxes', 'หนังสือ\n(x) ไสกาว\n( ) มุงหลังคา\n( ) กระดูกงู'],
    ['a coating on its own line under a part heading', 'แฟ้ม\nปกหน้า\nเคลือบ Spot UV\nปกหลัง\nเคลือบด้าน'],
    ['calendar: the ป้าย line between the ไส้ line and its own colour line', 'ปฏิทินตั้งโต๊ะ\nไส้ 7x15 นิ้ว กระดาษปอนด์\nป้าย ขนาด 15x21 นิ้ว กระดาษอาร์ต 230g\nพิมพ์ 4 สี 2 หน้า'],
  ])('no spec line leaves — %s', (_name, d) => {
    const one = Q([['a', d, 1]]);
    const under = d.split('\n').slice(1).join('\n');
    expect(unitNotes(one, planUnits(one, 'single')[0], one.code)).toBe(`${under}\n\n${REF}`);
  });
  it('merged unit: the notes as planned (every line in full)', () => {
    const [m] = planUnits(q, 'merged');
    expect(unitNotes(q, m, q.code)).toBe(m.notes);
    expect(m.notes).toContain(CARD);
    expect(m.notes).toContain(TICKET);
  });
  it('no snapshot, a line that is gone, a line without text: the notes as planned', () => {
    expect(unitNotes(null, ua, q.code)).toBe(ua.notes);
    expect(unitNotes(undefined, ua, q.code)).toBe(ua.notes);
    expect(unitNotes({ ...q, lines: [] }, ua, q.code)).toBe(ua.notes);
    expect(unitNotes({ ...q, lines: undefined as unknown as PeakQuotation['lines'] }, ua, q.code)).toBe(ua.notes);
    const odd = { ...q, lines: [{ key: 'a', description: null as unknown as string, quantity: 1, price: 1 }] };
    expect(unitNotes(odd, ua, q.code)).toBe(ua.notes);
    expect(ua.notes).toBe(`${CARD}\n\n${REF}`);
  });
  it('a unit whose name is not the first line (edited name) keeps that line', () => {
    expect(unitNotes(q, { ...ua, name: 'ชื่ออื่น' }, q.code)).toBe(`${CARD}\n\n${REF}`);
  });
});
