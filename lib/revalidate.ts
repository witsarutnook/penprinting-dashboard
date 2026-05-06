import { revalidateTag } from 'next/cache';
import { LOAD_ALL_TAG } from './api';

/** Bust the loadAll fetch-cache so the very next page render hits Apps
 *  Script for fresh data instead of the (up to 60s) ISR cache.
 *
 *  Call this from every write route immediately before returning success.
 *  Without it, drag-drop / forward / cancel etc. feel "slow" because the
 *  page still serves stale data for up to a minute even after the write
 *  succeeds — see user report 2026-05-06. */
export function bustLoadAllCache(): void {
  try {
    revalidateTag(LOAD_ALL_TAG);
  } catch {
    // revalidateTag throws when called outside a request context — safe to ignore
  }
}
