/**
 * Concurrency helpers — kept tiny and zero-dep on purpose. We don't
 * pull in `p-limit` for two callers; this file inlines the same idea.
 *
 * Why caps matter on cascade fallback paths: each Apps Script POST
 * holds a ~600ms LockService scope. Firing N writes at once when N is
 * large (multi-job order with cowork) risks tail timeouts because the
 * 9th request is queued behind 8 others and Apps Script
 * `LockService.waitLock(10000)` gives up after 10s. p-limit=3 keeps
 * the queue depth bounded while preserving most of the parallelism win
 * over fully sequential.
 */

/**
 * Run `tasks` with at most `cap` in flight at once. Resolves to an
 * array of `Promise.allSettled`-shaped results in the original order
 * of the input — drop-in for `Promise.allSettled(tasks.map(fn))` when
 * you want a concurrency cap.
 */
export async function allSettledLimit<T>(
  tasks: Array<() => Promise<T>>,
  cap: number,
): Promise<Array<PromiseSettledResult<T>>> {
  if (tasks.length === 0) return [];
  if (cap <= 0 || cap >= tasks.length) {
    return Promise.allSettled(tasks.map((t) => t()));
  }

  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]();
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  // Spin up `cap` workers in parallel; each pulls from the shared cursor
  // until the task list is exhausted.
  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < cap; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
