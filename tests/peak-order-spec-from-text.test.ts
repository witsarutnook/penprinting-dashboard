import { describe, it, expect } from 'vitest';
import type { PeakQuotation } from '@/lib/peak/read';
import { EMPTY_SPEC, specForUnit, specFromText, type SpecFields } from '@/lib/peak-order/spec-from-text';

// Every description below is a real quotation line (production census, 2026-11-18).
const ROWS: Array<[string, string, SpecFields]> = [
  ['1 namecard', 'นามบัตรขนาด 9x5.5 ซม.\nพิมพ์ 4 สี 1 หน้า\nกระดาษอาร์ตมัน 260 แกรม',
    { size: '9x5.5', sizeUnit: 'ซม.', paperInner: 'อาร์ตมัน 260 แกรม', innerColor: '4สี' }],
  ['2 voucher, cm, no colour count', 'voucher ขนาด 6.25x15 cm\nพิมพ์หน้าเดียว กระดาษอาร์ต 230g',
    { size: '6.25x15', sizeUnit: 'ซม.', paperInner: 'อาร์ต 230g' }],
  ['3 A-size keeps the form unit', 'แผ่นพับขนาด A4\nพิมพ์ 4 สี หน้าหลัง\nกระดาษอาร์ตมัน 120 แกรม',
    { size: 'A4', paperInner: 'อาร์ตมัน 120 แกรม', innerColor: '4สี' }],
  ['4 matte', 'ตั๋วขนาด 6x12 ซม.\nพิมพ์ 4 สี 1 หน้า\nกระดาษอาร์ต 260 แกรม\nเคลือบด้าน',
    { size: '6x12', sizeUnit: 'ซม.', paperInner: 'อาร์ต 260 แกรม', innerColor: '4สี', coatMatte: true }],
  ['5 notebook, inner carried to the next line',
    'สมุดบันทึก ขนาดเอ 5\nเนื้อใน 80 แผ่น(160หน้า)\nกระดาษถนอมสายตา(จริงใจ AA) 75 แกรม พิมพ์ 1 สี-น้ำเงิน\nปก อาร์ทการ์ดหน้าเดียว 350 แกรม พิมพ์ 4 สี\nปกนอกเคลือบลามิเนตด้าน\nเข้าเล่มแบบห่วงลวดกระดูกงู ไดคัทมุม 2 ด้านนอก',
    {
      size: 'A5', paperInner: 'ถนอมสายตา(จริงใจ AA) 75 แกรม', innerColor: '1สี', innerColorNote: 'น้ำเงิน',
      paperCover: 'อาร์ทการ์ดหน้าเดียว 350 แกรม', coverColor: '4สี', coatMatte: true, spine: true,
    }],
  ['6 notebook, cover then inner over three lines',
    'สมุดขนาด A5 ปกหุ้มจั่วปัง เข้าห่วง\nปกอาร์ต 230 แกรม พิมพ์ 4 สี\nเนื้อใน 200 หน้า 100 แผ่น\nกระดาษ ถนอมสายตา 75 แกรม\nพิมพ์ 1 สี (ดำ)\nปั๊มฟอยล์ทอง 2 จุด (โลโก้ และ ตัวอักษร)',
    {
      size: 'A5', paperCover: 'อาร์ต 230 แกรม', coverColor: '4สี',
      paperInner: 'ถนอมสายตา 75 แกรม', innerColor: '1สี', innerColorNote: 'ดำ', spine: true,
    }],
  ['7 book, glue; "ปกอ่อน" opens no section',
    'หนังสือขนาด A4\nปกอาร์ต 230 แกรม เคลือบด้าน พิมพ์ 4 สี\nเนื้อในปอนด์ 80 แกรม พิมพ์ 1 สี 32 หน้า\nเข้าเล่มไสกาวปกอ่อน\n',
    {
      size: 'A4', paperCover: 'อาร์ต 230 แกรม', coverColor: '4สี', coatMatte: true,
      paperInner: 'ปอนด์ 80 แกรม', innerColor: '1สี', glue: true,
    }],
  ['8 catalogue; "รวมปก" opens no section',
    'แคตตาล็อคขนาด 19x26 cm\n16 หน้ารวมปก\nปกกระดาษอาร์ต 230g\nเนื้อในกระดาษปอนด์ 80g\nมุงหลังคา',
    { size: '19x26', sizeUnit: 'ซม.', paperCover: 'อาร์ต 230g', paperInner: 'ปอนด์ 80g', saddle: true }],
  ['9 "ครึ่งเอ 4" is no size; cover paper without a paper word is no paper; misspelt saddle',
    'สมุดประจำตัวผู้ป่วย\nขนาดครึ่งเอ 4 ปก 4 สี 230 แกรม\nเนื้อใน 4 สีทั้งเล่ม 20 หน้า กระดาษปอนด์ 70g\nเข้าเล่มเย็มมุงหลังคา',
    { coverColor: '4สี', innerColor: '4สี', paperInner: 'ปอนด์ 70g', saddle: true }],
  ['10 two inner papers -> inner paper blank',
    'สมุด Passport \nขนาด 13x9.5 ซม.\nปกกระดาษอาร์ตมัน 230 แกรมเคลือบด้าน\nเนื้อในกระดาษปอนด์ 100\nจำนวน 8 หน้า\nกระดาษเปล่า 70g รองปก 1 แผ่น',
    { size: '13x9.5', sizeUnit: 'ซม.', paperCover: 'อาร์ตมัน 230 แกรม', coatMatte: true }],
  ['11 calendar: two sizes and two papers -> both blank',
    'ปฏิทินแขวน\nขนาดป้าย 15x21 นิ้ว พิมพ์ 4 สี\nกระดาษอาร์ต 230 แกรม เคลือบเงา\nภู่ปฏิทิน ขนาด 7x15 นิ้ว\nพิมพ์ 4สี กระดาษปอนด์\nเข้าหัวเหล็กปฏิทิน',
    { innerColor: '4สี', coatGloss: true }],
  ['12 calendar: the size after "ขนาด" wins; "หน้าปก" opens no section',
    'ปฏิทินแขวน ตัด 4 ขนาด 15x21 นิ้ว\nพิมพ์ 4 สี หน้าเดียว กระดาษอาร์ต 230g\nเคลือบเงา เข้าหัวเหล็ก\nไส้ 7x15 นิ้ว พิมพ์ 4 สี กระดาษปอนด์\nหน้าปกแบบโฆษณาของร้าน',
    { size: '15x21', sizeUnit: 'นิ้ว', innerColor: '4สี', coatGloss: true }],
  ['13 unfolded + finished size -> blank',
    'หนังสือพับ 11.11 Midmonth\n- ขนาดกางออก 63 x 29.7 cm.\n- ขนาดสำเร็จ A4 พับ 3 ทบ\n- กระดาษอาร์ต 230 แกรม\n- เคลือบด้าน\n- พิมพ์หน้า-หลัง',
    { paperInner: 'อาร์ต 230 แกรม', coatMatte: true }],
  ['14 "กางออก A5" is no size', 'แผ่นพับ ขนาดกางออก A5\nพิมพ์ 4 สี หน้าหลัง\nกระดาษอาร์ตมัน 120g\nพับครึ่ง',
    { innerColor: '4สี', paperInner: 'อาร์ตมัน 120g' }],
  ['15 "เคลือบเงาหรือด้าน" ticks nothing', 'ป้ายแขวนประตู ขนาด 24x9.5 cm\nพิมพ์ 4 สี 2 หน้า\nกระดาษอาร์ต 350g เคลือบเงาหรือด้าน',
    { size: '24x9.5', sizeUnit: 'ซม.', innerColor: '4สี', paperInner: 'อาร์ต 350g' }],
  ['16 two colours with names; die-cut ticks nothing', 'ซองใส่คีย์การ์ด\nกระดาษการ์ด 240 แกรม\nพิมพ์ 2 สี (แดง ดำ)\nไดคัทติดกาวตามรูปแบบ',
    { paperInner: 'การ์ด 240 แกรม', innerColor: '2สี', innerColorNote: 'แดง ดำ' }],
  ['17 perforation', 'งานขนาด 6x22.5cm\nพิมพ์ 4 สี หน้าเดียว\nกระดาษอาร์ต 190g\nปรุ 5 ตอน 50 ใบต่อเล่ม\n(ทั้งหมด 500,000 ดวง)',
    { size: '6x22.5', sizeUnit: 'ซม.', innerColor: '4สี', paperInner: 'อาร์ต 190g', perf: true }],
  ['18 "ปรุ๊ฟ" is not perforation', 'ใบเสร็จรับเงิน\nขนาด A5 พิมพ์สีเดียว-น้ำเงิน\n2 ใบ/ชุด 50 ชุด/เล่ม (ขาว ปรุ๊ฟ)',
    { size: 'A5', innerColor: '1สี', innerColorNote: 'น้ำเงิน' }],
  ['19 weight range copied as written; digital', 'เมนู ขนาด 29.7*42 ซม. พิมพ์ 4 สี 2 หน้า\nกระดาษอาร์ต 260 - 300 แกรม\nเคลือบด้าน ปริ้น Digital ไดคัทมุม 4 มุม',
    { size: '29.7x42', sizeUnit: 'ซม.', innerColor: '4สี', paperInner: 'อาร์ต 260 - 300 แกรม', coatMatte: true, digital: true }],
  ['20 same size twice is one size', 'สติ๊กเกอร์ A3\nสติ๊กเกอร์ A3 พิมพ์ 4 สี ดิจิตอล พร้อมไดคัท\n- โดนัทหมูหยองน้ำสลัด 50 แผ่น',
    { size: 'A3', innerColor: '4สี', digital: true }],
  ['21 a stray A3 loses to the size after "ขนาด"', 'ใบสื่อการสอนขนาด 4x4 นิ้ว\nกระดาษอาร์ตมัน 300 แกรม\nพิมพ์ 1 หน้า 4 สี\nจำนวนพิมพ์ 9 แผ่น A3',
    { size: '4x4', sizeUnit: 'นิ้ว', paperInner: 'อาร์ตมัน 300 แกรม', innerColor: '4สี' }],
  ['22 "x สูง"', 'ป้ายไวนิลกองโจรกรอบไม้ ขนาด 120 x สูง 240 ซม.', { size: '120x240', sizeUnit: 'ซม.' }],
  ['23 three dimensions', 'กล่องกาแฟ First ขนาด 11.5 x 15.5 x 5 ซม.\nพิมพ์ 4 สี กระดาษการ์ดอาร์ตหน้าเดียว 270g\nเคลือบเงา ไดคัท ติดกาว',
    { size: '11.5x15.5x5', sizeUnit: 'ซม.', innerColor: '4สี', paperInner: 'การ์ดอาร์ตหน้าเดียว 270g', coatGloss: true }],
  ['24 labelled dimensions are no size; "สีดำ" is no colour count', 'ถุงขนาด สูง12" ยาว15" กว้าง6"\nกระดาษอาร์ต 230 แกรม\nเคลือบด้าน ร้อยริบบิ้นสีดำ',
    { paperInner: 'อาร์ต 230 แกรม', coatMatte: true }],
  ['25 "ถุงกระดาษ" is not paper', 'ถุงกระดาษ ขนาด กว้าง 9 ซม. ยาว 9 ซม. สูง 18 ซม.\nพิมพ์สีเดียว-ชมพู กระดาษน้ำตาล KI 185g\nไดคัท หูถุงเชือกกลมสีขาว',
    { innerColor: '1สี', innerColorNote: 'ชมพู', paperInner: 'น้ำตาล KI 185g' }],
  ['26 paper without a weight', 'ใบเสร็จรับเงิน ขนาด 6.5x7 นิ้ว\nกระดาษคาร์บอน 2 ชั้น (ขาวบน, ขาวล่าง)\nพิมพ์ สีเดียว (ฟ้า)\nกล่องละ 1,000 ชุด',
    { size: '6.5x7', sizeUnit: 'นิ้ว', paperInner: 'คาร์บอน 2 ชั้น (ขาวบน, ขาวล่าง)', innerColor: '1สี', innerColorNote: 'ฟ้า' }],
  ['27 unknown paper name with a weight', 'นามบัตรขนาด 9x5.5 ซม.\nพิมพ์ 4 สี หน้าหลัง\nกระดาษ Echo Green หนา 300 แกรม\nเคลือบด้าน',
    { size: '9x5.5', sizeUnit: 'ซม.', innerColor: '4สี', paperInner: 'Echo Green หนา 300 แกรม', coatMatte: true }],
  ['28 UV; cover only', 'ปฏิทินแขวนขนาด 15x21 นิ้ว\nปกอาร์ต 230 แกรม เคลือบ UV\nติดไส้ปฏิทินสำเร็จ',
    { size: '15x21', sizeUnit: 'นิ้ว', paperCover: 'อาร์ต 230 แกรม', coatUV: true }],
  ['29 manual: cover and inner each with colour + name',
    'คู่มือการใช้งาน ขนาด A4\nปกพิมพ์ 1 สี-ดำ กระดาษการ์ดฟ้า 150g\nเนื้อใน พิมพ์สีเดียว-ดำ 25 หน้า พิมพ์หน้าเดียว\nกระดาษปอนด์ 70g\nเข้าเล่มไสกาว',
    {
      size: 'A4', coverColor: '1สี', coverColorNote: 'ดำ', paperCover: 'การ์ดฟ้า 150g',
      innerColor: '1สี', innerColorNote: 'ดำ', paperInner: 'ปอนด์ 70g', glue: true,
    }],
  ['30 colour name after a space; "เนื้อหา" opens no section',
    'สมุดขนาด A5\nปก พิมพ์ 4 สี 4 หน้า\nเนื้อในพิมพ์สีเดียว น้ำเงิน 32 หน้า (เนื้อหา 8-10 หน้า ที่เหลือ note)\nเย็บมุงหลังคา',
    { size: 'A5', coverColor: '4สี', innerColor: '1สี', innerColorNote: 'น้ำเงิน', saddle: true }],
  ['31 colour before the first section is not used',
    'photobook ขนาด 26x26 ซม.\nพิมพ์ 4 สี ทั้งเล่ม\nเนื้อใน 40 หน้า กระดาษอาร์ต 160 แกรม\nปกแข็ง เคลือบด้าน\nเข้าเล่มไสกาว',
    { size: '26x26', sizeUnit: 'ซม.', paperInner: 'อาร์ต 160 แกรม', coatMatte: true, glue: true }],
  ['32 paper word + bare number', 'ซองตะเกียบ ขนาดกางออก 20.5x8 cm\nพิมพ์ 1 สี (แดง)\nกระดาษปอนด์ 100\nไดคัทติดกาวขึ้นซอง',
    { innerColor: '1สี', innerColorNote: 'แดง', paperInner: 'ปอนด์ 100' }],
  ['33 "กระดาษหัวจดหมาย" is not paper; colour name later on the line',
    'กระดาษหัวจดหมาย ขนาด เอ 4\nกระดาษปอนด์ 80 แกรม พิมพ์ 1 สี 1 หน้า สีทอง\n',
    { size: 'A4', paperInner: 'ปอนด์ 80 แกรม', innerColor: '1สี', innerColorNote: 'ทอง' }],
  ['34 "*" separator', 'กระดาษหัวจดหมาย ขนาด 10*14 ซม.\nกระดาษปอนด์ 80 แกรม พิมพ์ 4 สี 1 หน้า',
    { size: '10x14', sizeUnit: 'ซม.', paperInner: 'ปอนด์ 80 แกรม', innerColor: '4สี' }],
  ['35 "กระดาษไดคัท…" is not paper', 'กระดาษไดคัทมุมโค้ง 1 มุม\nขนาด 10.5x15.5 ซม.\nกระดาษปอนด์ 80 แกรม\nพิมพ์ 2 สี (แดง ดำ) 1 หน้า',
    { size: '10.5x15.5', sizeUnit: 'ซม.', paperInner: 'ปอนด์ 80 แกรม', innerColor: '2สี', innerColorNote: 'แดง ดำ' }],
  ['36 "เข้าห่วง"; a word between "ขนาด" and the size', 'ปฏิทินตั้งโต๊ะ แนวนอน\nขนาด กว้าง 10x7 นิ้ว\nจำนวน 7 แผ่น 14 หน้า\nพิมพ์ 4 สี หน้าหลัง\nเข้าห่วงบน',
    { size: '10x7', sizeUnit: 'นิ้ว', innerColor: '4สี', spine: true }],
  ['37 "เข้ากระดูกงู"', 'ปฏิทินตั้งโต๊ะขนาด 6x8 นิ้ว\nกระดาษอาร์ต 230 แกรม\nพิมพ์ 4 สี 8 แผ่น 16 หน้า\nเข้ากระดูกงู ติดฐานปฏิทินพิมพ์ตีพื้น',
    { size: '6x8', sizeUnit: 'นิ้ว', paperInner: 'อาร์ต 230 แกรม', innerColor: '4สี', spine: true }],
  ['38 "เนื้อ KA" opens no section', 'ซองเอกสาร\nขนาด 11x17 นิ้ว ซองขยายข้าง\nเนื้อ KA', { size: '11x17', sizeUnit: 'นิ้ว' }],
  ['39 "ขาวด้าน" is not matte coating; typo "สีี"', 'สติกเกอร์ขาวด้านไดคัท\nขนาด A5 พิมพ์ 4 สีี', { size: 'A5', innerColor: '4สี' }],
  ['40 size without "ขนาด"', 'A5 หน้าหลัง\nกระดาษอาร์ตมัน 120g', { size: 'A5', paperInner: 'อาร์ตมัน 120g' }],
  ['41 dimension without "ขนาด"', 'ป้ายกองโจร 120 x สูง 240 ซม.', { size: '120x240', sizeUnit: 'ซม.' }],
  ['42 Thai "เอ 3"', 'โปสเตอร์ เอ 3 บัตรฟรี 4eve + ไดคัท', { size: 'A3' }],
  ['43 "X7" is no size', 'ใบติ๊กเมนูเตี๋ยว X7 ,เมนูยำ\nพิมพ์ 1 สี หน้า หลัง', { innerColor: '1สี' }],
  ['44 "กระดาษคำตอบ" is not paper', 'การประเมิน NT ป.3\n- ภาษาไทย จำนวน 18 หน้า\nกระดาษคำตอบ 1 หน้า (7 บาท)', {}],
];

describe('specFromText — real quotation lines', () => {
  it.each(ROWS)('%s', (_name, description, expected) => {
    expect(specFromText(description).fields).toEqual(expected);
  });

  it.each(['ค่าจัดส่ง', 'สติ๊กเกอร์', 'ขออนุญาติติดตั้ง 2 เดือน', ''])('no spec in %j', (d) => {
    expect(specFromText(d)).toEqual({ fields: {}, summary: '' });
  });
});

describe('specFromText — never throws', () => {
  it('non-string input gives the empty spec', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(specFromText(v)).toEqual(EMPTY_SPEC);
    expect(EMPTY_SPEC).toEqual({ fields: {}, summary: '' });
  });
  it('CRLF line ends', () => {
    expect(specFromText('ขนาด A4\r\nพิมพ์ 4 สี\r\nกระดาษปอนด์ 80g').fields).toEqual({
      size: 'A4', innerColor: '4สี', paperInner: 'ปอนด์ 80g',
    });
  });
  it('very long text returns', () => {
    expect(() => specFromText('ขนาด 1x1 '.repeat(2500))).not.toThrow();
    expect(() => specFromText('ก'.repeat(20000))).not.toThrow();
    expect(() => specFromText('กระดาษ'.repeat(4000) + '\n'.repeat(5000))).not.toThrow();
  });
});

describe('specFromText — look-alikes', () => {
  it.each<[string, SpecFields]>([
    ['หนังสือปรับปรุงครั้งที่ 2', {}],
    ['เส้นใหญ่ ปกติ กระดาษปอนด์ 70g พิมพ์ 1 สี', { paperInner: 'ปอนด์ 70g', innerColor: '1สี' }],
    ['ขนาด 15x21', {}],
    ['พิมพ์ 5 สี', {}],
    ['พิมพ์ 14 สี', {}],
    ['ใบปลิว A4 สี 2 หน้า', { size: 'A4' }],
    ['โปสเตอร์ เอ 3 สี', { size: 'A3' }],
    ['ป้าย 3 สีเดียว-ดำ', { innerColor: '1สี', innerColorNote: 'ดำ' }],
    ['พิมพ์ 4 สี 12 หน้า ขาวดำ 128 หน้า', {}],
    ['ขนาด a4', { size: 'A4' }],
    ['ขนาด 10.5X15 นิ้ว', { size: '10.5x15', sizeUnit: 'นิ้ว' }],
    ['ขนาด 100x200 มม.', { size: '100x200', sizeUnit: 'มม.' }],
    ['เคลือบ Spot UV', { coatSpotUV: true }],
    ['กระดาษอาร์ต 230g ไม่เคลือบเงา', { paperInner: 'อาร์ต 230g' }],
    ['พิมพ์ 1 สี กระดาษการ์ดสีชมพู 150g', { innerColor: '1สี', paperInner: 'การ์ดสีชมพู 150g' }],
  ])('%j', (d, expected) => {
    expect(specFromText(d).fields).toEqual(expected);
  });
});

describe('specFromText — summary', () => {
  it('book: size, cover, inner, coating, binding', () => {
    expect(specFromText(ROWS[4][1]).summary).toBe(
      'ขนาด A5 · ปก อาร์ทการ์ดหน้าเดียว 350 แกรม 4สี · เนื้อใน ถนอมสายตา(จริงใจ AA) 75 แกรม 1สี (น้ำเงิน) · เคลือบด้าน · กระดูกงู',
    );
  });
  it('single sheet: no cover / inner label', () => {
    expect(specFromText(ROWS[0][1]).summary).toBe('ขนาด 9x5.5 ซม. · อาร์ตมัน 260 แกรม 4สี');
  });
});

describe('specForUnit', () => {
  const q: PeakQuotation = {
    code: 'QO-1', status: 'Approve', issuedDate: '2026-11-18', contactCode: 'C1', netAmount: null,
    lines: [
      { key: 'a', description: ROWS[0][1], quantity: 100, price: 1 },
      { key: 'b', description: 'ค่าจัดส่ง', quantity: 1, price: 1 },
    ],
  };
  it('one line key -> that line read', () => {
    expect(specForUnit(q, ['a'])).toEqual(specFromText(ROWS[0][1]));
    expect(specForUnit(q, ['a']).fields.size).toBe('9x5.5');
  });
  it('merged unit, unknown key, missing snapshot -> empty', () => {
    expect(specForUnit(q, ['a', 'b'])).toEqual(EMPTY_SPEC);
    expect(specForUnit(q, ['zzz'])).toEqual(EMPTY_SPEC);
    expect(specForUnit(q, [])).toEqual(EMPTY_SPEC);
    expect(specForUnit(null, ['a'])).toEqual(EMPTY_SPEC);
    expect(specForUnit(undefined, ['a'])).toEqual(EMPTY_SPEC);
    expect(specForUnit(q, null)).toEqual(EMPTY_SPEC);
    expect(specForUnit({ ...q, lines: undefined as unknown as PeakQuotation['lines'] }, ['a'])).toEqual(EMPTY_SPEC);
  });
});
