// tests/bulk-mode-signal.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getBulkActive, setBulkActive, subscribeBulkActive } from '@/lib/bulk-mode-signal';

describe('bulk-mode-signal', () => {
  beforeEach(() => setBulkActive(false));

  it('defaults to false', () => {
    expect(getBulkActive()).toBe(false);
  });

  it('setBulkActive updates the snapshot', () => {
    setBulkActive(true);
    expect(getBulkActive()).toBe(true);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeBulkActive(() => { calls++; });
    setBulkActive(true);
    expect(calls).toBe(1);
    unsub();
    setBulkActive(false);
    expect(calls).toBe(1);
  });

  it('does not notify when the value is unchanged', () => {
    let calls = 0;
    const unsub = subscribeBulkActive(() => { calls++; });
    setBulkActive(false);
    expect(calls).toBe(0);
    unsub();
  });
});
