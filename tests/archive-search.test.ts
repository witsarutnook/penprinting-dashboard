import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  queueResult,
  resetMockPostgres,
  setConfigured,
  sqlCalls,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  normalizeArchiveQuery,
  escapeLikePattern,
} from '@/lib/archive-search';

describe('normalizeArchiveQuery', () => {
  it('returns null for empty / undefined / whitespace-only input', () => {
    expect(normalizeArchiveQuery(undefined)).toBeNull();
    expect(normalizeArchiveQuery(null)).toBeNull();
    expect(normalizeArchiveQuery('')).toBeNull();
    expect(normalizeArchiveQuery('   ')).toBeNull();
  });

  it('returns null when shorter than 2 characters after trim', () => {
    expect(normalizeArchiveQuery(' a ')).toBeNull();
    expect(normalizeArchiveQuery('ก')).toBeNull();
  });

  it('keeps exactly 2 characters', () => {
    expect(normalizeArchiveQuery('ab')).toBe('ab');
    expect(normalizeArchiveQuery('ใบ')).toBe('ใบ');
  });

  it('trims and collapses internal whitespace', () => {
    expect(normalizeArchiveQuery('  ใบปลิว   ซุปเปอร์ ')).toBe('ใบปลิว ซุปเปอร์');
    expect(normalizeArchiveQuery('a\t\nb')).toBe('a b');
  });
});

describe('escapeLikePattern', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('c\\d')).toBe('c\\\\d');
  });

  it('leaves normal text untouched', () => {
    expect(escapeLikePattern('ใบปลิว ซุปเปอร์')).toBe('ใบปลิว ซุปเปอร์');
  });
});

// keep imports used — later tasks add the searchArchiveOrders / archiveRowState suites
void queueResult; void resetMockPostgres; void setConfigured; void sqlCalls; void beforeEach;
