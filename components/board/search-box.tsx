'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IconSearch, IconX } from '@/lib/icons';

const DEBOUNCE_MS = 300;

/** Search box — pushes `?q=` to URL after debounce so server filters jobs.
 *  Within-board scope (decision #4): searches active jobs only. */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get('q') || '';
  const [value, setValue] = useState(initial);

  // Sync from URL when user navigates back/forward.
  useEffect(() => {
    setValue(params.get('q') || '');
  }, [params]);

  // Debounced URL push.
  useEffect(() => {
    if (value === initial) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function clear() {
    setValue('');
    const next = new URLSearchParams(params.toString());
    next.delete('q');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="relative w-full sm:w-80">
      <IconSearch
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="ค้นหางาน"
        placeholder="ค้นหา ชื่องาน / ลูกค้า / id..."
        className="w-full pl-9 pr-9 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="ล้างคำค้น"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-700 rounded hover:bg-stone-100"
        >
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}
