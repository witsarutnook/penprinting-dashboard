// tests/quote-fab-visibility.test.ts
import { describe, it, expect } from 'vitest';
import { shouldShowFab } from '@/lib/quote-fab-visibility';

describe('shouldShowFab', () => {
  it('shows for admin on a normal page', () => {
    expect(shouldShowFab('admin', '/board')).toBe(true);
  });
  it('shows for sales on a normal page', () => {
    expect(shouldShowFab('sales', '/orders')).toBe(true);
  });
  it('hides for staff (non-privileged role)', () => {
    expect(shouldShowFab('staff', '/board')).toBe(false);
  });
  it('hides for an empty/unknown role', () => {
    expect(shouldShowFab('', '/board')).toBe(false);
  });
  it('hides on the dedicated /quote-assistant page (full view already)', () => {
    expect(shouldShowFab('admin', '/quote-assistant')).toBe(false);
  });
});
