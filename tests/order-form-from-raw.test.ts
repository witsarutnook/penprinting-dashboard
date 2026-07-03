import { describe, it, expect } from 'vitest';
import { orderFormFromRaw } from '@/lib/photobook';

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
