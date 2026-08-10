import { describe, it, expect } from 'vitest';
import { orderFormFromRaw, prefillOrderFormFromRaw } from '@/lib/photobook';

/** orderFormFromRaw is the pure builder behind the "สั่งซ้ำ" (duplicate)
 *  prefill: the OrderForm effect calls it on the source order's rawData and
 *  only resets the dates. So the duplicate flow carrying the job name +
 *  customer over depends entirely on this function reading them from raw.
 *
 *  NOTE (diagnose seam): the actual duplicate-flow effect lives inside the
 *  <OrderForm> client component (app/board/order-form.tsx) and there is no
 *  jsdom/RTL harness in this repo (vitest env = node, tests are *.ts). These
 *  tests pin the data dependency the fix relies on; the component wiring
 *  itself is verified visually (see NEXT-SESSION visual-verify pattern). */
describe('orderFormFromRaw — duplicate prefill carries identity fields', () => {
  it('carries name + customer from rawData', () => {
    const raw = {
      name: 'นามบัตร คุณเอ',
      customer: 'บริษัท เอ จำกัด',
      qty: '1000',
      paperCover: 'Art 260',
    };
    const form = orderFormFromRaw(raw, 'nook');
    expect(form.name).toBe('นามบัตร คุณเอ');
    expect(form.customer).toBe('บริษัท เอ จำกัด');
    // spec fields carry too
    expect(form.qty).toBe('1000');
    expect(form.paperCover).toBe('Art 260');
  });

  it('leaves name + customer empty when raw omits them (no crash)', () => {
    const form = orderFormFromRaw({ qty: '500' }, 'nook');
    expect(form.name).toBe('');
    expect(form.customer).toBe('');
    expect(form.qty).toBe('500');
  });

  it('ignores non-string name/customer (defensive)', () => {
    const form = orderFormFromRaw(
      { name: 123 as unknown as string, customer: null as unknown as string },
      'nook',
    );
    expect(form.name).toBe('');
    expect(form.customer).toBe('');
  });
});

/** prefillOrderFormFromRaw is the shared policy for every "start a new order
 *  from an existing snapshot" flow — duplicate ("สั่งซ้ำ"), template quick-fill,
 *  and "ดึงงานล่าสุด". It must carry the full spec INCLUDING name + customer
 *  (2026-08-10 fix: template apply used to blank them — same port-regression
 *  class as the duplicate fix `c7daeb0`) and reset only the dates. */
describe('prefillOrderFormFromRaw — shared duplicate/template prefill policy', () => {
  const snapshot = {
    name: 'ใบปลิวซุปเปอร์',
    customer: 'ซุปเปอร์มาร์เก็ต ขอนแก่น',
    dateIn: '2026-05-01',
    dateDue: '2026-05-15',
    qty: '8000',
    paperInner: 'ปอนด์ 60g',
    orderer: 'สมชาย',
  };

  it('carries name + customer + spec from the snapshot (template quick-fill)', () => {
    const form = prefillOrderFormFromRaw(snapshot, 'nook', '2026-08-10');
    expect(form.name).toBe('ใบปลิวซุปเปอร์');
    expect(form.customer).toBe('ซุปเปอร์มาร์เก็ต ขอนแก่น');
    expect(form.qty).toBe('8000');
    expect(form.paperInner).toBe('ปอนด์ 60g');
  });

  it('resets dates: dateIn = today, dateDue blank', () => {
    const form = prefillOrderFormFromRaw(snapshot, 'nook', '2026-08-10');
    expect(form.dateIn).toBe('2026-08-10');
    expect(form.dateDue).toBe('');
  });

  it('keepOrderer forces the current user over the snapshot orderer (template flow)', () => {
    const form = prefillOrderFormFromRaw(snapshot, 'nook', '2026-08-10', { keepOrderer: 'นุ๊ก' });
    expect(form.orderer).toBe('นุ๊ก');
  });

  it('without keepOrderer the snapshot orderer wins (duplicate-flow parity)', () => {
    const form = prefillOrderFormFromRaw(snapshot, 'nook', '2026-08-10');
    expect(form.orderer).toBe('สมชาย');
  });

  it('empty snapshot → fallback orderer + today, no crash', () => {
    const form = prefillOrderFormFromRaw({}, 'nook', '2026-08-10');
    expect(form.orderer).toBe('nook');
    expect(form.dateIn).toBe('2026-08-10');
    expect(form.name).toBe('');
    expect(form.customer).toBe('');
  });
});
