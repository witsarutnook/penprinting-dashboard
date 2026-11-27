import { describe, it, expect } from 'vitest';
import { safeNextPath } from '@/lib/safe-next-path';

/**
 * M7-login-next-unvalidated (audit 2026-11-27, found by the independent reviewer). After a
 * successful login the form did `window.location.href = next` with `next` taken straight from
 * `?next=`. A crafted login link could send the user to another site right after they typed
 * their password, and a `javascript:` value would run in the dashboard's own origin.
 * Only a path of this site may be the place to go after login.
 */
describe('safeNextPath', () => {
  it('a path of this site is kept as it is', () => {
    for (const path of [
      '/board',
      '/analytics',
      '/orders/202611151/edit?from=board',
      '/board?dept=graphic&q=%E0%B9%83%E0%B8%9A%E0%B8%9B%E0%B8%A5%E0%B8%B4%E0%B8%A7',
      '/peak?error=state',
      '/orders#top',
    ]) {
      expect(safeNextPath(path), path).toBe(path);
    }
  });

  it('what middleware sends (the path the visitor asked for) round-trips', () => {
    // middleware.ts: url.searchParams.set('next', pathname + search)
    const asked = '/orders/202611143/edit?from=board';
    const login = new URL('https://dashboard.penprinting.co/login');
    login.searchParams.set('next', asked);
    expect(safeNextPath(new URL(login.toString()).searchParams.get('next'))).toBe(asked);
  });

  it('another site is never the place to go', () => {
    for (const evil of [
      'https://example.com',
      'http://example.com/board',
      'HTTPS://EXAMPLE.COM/board',
      '//example.com',
      '//example.com/board',
      '///example.com',
      'example.com',
      'example.com/board',
    ]) {
      expect(safeNextPath(evil), evil).toBe('/analytics');
    }
  });

  it('a backslash, tab or newline cannot smuggle another site in (browsers read /\\ and /<tab>/ as //)', () => {
    for (const evil of [
      '/\\example.com',
      '\\\\example.com',
      '/\\/example.com',
      '\\/example.com',
      '/\t/example.com',
      '/\n/example.com',
      '/\r/example.com',
      '\t//example.com',
      '/board\r\nSet-Cookie: a=b',
      '/board' + String.fromCharCode(0),
      '/board' + String.fromCharCode(127),
    ]) {
      expect(safeNextPath(evil), JSON.stringify(evil)).toBe('/analytics');
    }
  });

  // Found before the first commit: `/.//example.com` starts with one slash and parses as a path
  // of this site — but the parser folds the dot segment away and leaves the path `//example.com`.
  // Returning that normalised path would send the browser to example.com. Such a value is
  // refused, and what is returned is always the value as it was given, never a re-serialised one.
  it('a dot segment cannot fold a path into //another-site', () => {
    for (const evil of [
      '/.//example.com',
      '/..//example.com',
      '/a/..//example.com',
      '/%2e//example.com',
      '/%2E%2e//example.com/board',
      '/./\\example.com',
    ]) {
      expect(safeNextPath(evil), evil).toBe('/analytics');
    }
  });

  it('whatever it returns, the browser stays on this site', () => {
    const SITE = 'https://dashboard.penprinting.co';
    const corpus = [
      '/board', '/board?next=//example.com', '/board#//example.com', '/a/../board', '/./board', '/board/.', '/board/..',
      '/.//example.com', '/..//example.com', '/%2e//example.com', '/a/b/../..//example.com', '/;//example.com',
      '/?//example.com', '/#//example.com', '/@example.com', '/:80', '/board@example.com', '/%09/example.com',
      '/%5Cexample.com', '/%2F%2Fexample.com', '/\\example.com', '//example.com', 'https://example.com',
      'https:example.com', 'https:/example.com', '/https://example.com', 'javascript:alert(1)', '/javascript:alert(1)',
      '/\t/example.com', '/ /example.com', '/board?x=\\\\example.com',
    ];
    for (const input of corpus) {
      const out = safeNextPath(input);
      // The form does `window.location.href = out` on a page of the site.
      expect(new URL(out, `${SITE}/login`).origin, JSON.stringify(input)).toBe(SITE);
      expect(out.startsWith('/') && !out.startsWith('//'), JSON.stringify(input)).toBe(true);
      // Returned as given, or the default — never something the parser rebuilt.
      expect(out === input || out === '/analytics', JSON.stringify(input)).toBe(true);
    }
  });

  // Independent review (2026-11-27, after the first commit): no bypass found, but the corpus above
  // is all ASCII — a version that normalised the value (NFKC turns the fullwidth slash U+FF0F into
  // "/") or dropped zero-width characters stayed green and sent the browser to example.com.
  // Look-alikes are fine AS GIVEN (the browser percent-encodes them into a path of this site);
  // the value must come back untouched.
  it('look-alike slashes and invisible characters come back exactly as given', () => {
    const SITE = 'https://dashboard.penprinting.co';
    const FULLWIDTH_SLASH = String.fromCharCode(0xff0f);
    const FULLWIDTH_BACKSLASH = String.fromCharCode(0xff3c);
    const FULLWIDTH_DOT = String.fromCharCode(0xff0e);
    const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
    const LINE_SEPARATOR = String.fromCharCode(0x2028);
    const NBSP = String.fromCharCode(0xa0);
    for (const ch of [FULLWIDTH_SLASH, FULLWIDTH_BACKSLASH, FULLWIDTH_DOT, ZERO_WIDTH_SPACE, LINE_SEPARATOR, NBSP]) {
      for (const input of [`/${ch}example.com`, `/${ch}/example.com`, `/${ch}${ch}/example.com`, `/.${ch}/example.com`]) {
        const label = `U+${ch.charCodeAt(0).toString(16)} ${input.length}`;
        const out = safeNextPath(input);
        expect(out, label).toBe(input);
        expect(new URL(out, `${SITE}/login`).origin, label).toBe(SITE);
      }
    }
  });

  // Same review: any path of the site was accepted, API routes included — and some admin routes
  // write on GET (`/api/admin/seed-id-counters?min=…` lifts the job-id counter). A login link
  // must not end in one. Middleware only ever sends pages.
  it('only a page: an API route, a build asset or the login page itself is not a place to go', () => {
    for (const notAPage of [
      '/api/admin/seed-id-counters?min=999999999999',
      '/api/admin/db-migrate',
      '/api',
      '/api/',
      '/api?x=1',
      '/API/admin/db-migrate',
      '/%61pi/admin/db-migrate',
      '/%41PI/admin/db-migrate',
      '/x/../api/admin/db-migrate',
      '/./api/admin/db-migrate',
      '/_next/static/chunks/main.js',
      '/login',
      '/login?next=/board',
      '/login/',
      '/LOGIN',
    ]) {
      expect(safeNextPath(notAPage), notAPage).toBe('/analytics');
    }
  });

  it('a page whose name merely starts like one of those is still a page', () => {
    for (const page of ['/apiary', '/api-docs', '/login-help', '/_nextstep', '/orders/api', '/board?next=/api/x']) {
      expect(safeNextPath(page), page).toBe(page);
    }
  });

  it('a script or data URL is never the place to go', () => {
    for (const evil of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://dashboard.penprinting.co/x',
    ]) {
      expect(safeNextPath(evil), JSON.stringify(evil)).toBe('/analytics');
    }
  });

  it('nothing, a non-string or an absurdly long value → the default page', () => {
    for (const none of [null, undefined, '', 42, ['/board'], { path: '/board' }, '/' + 'x'.repeat(2100)]) {
      expect(safeNextPath(none), String(none).slice(0, 30)).toBe('/analytics');
    }
  });

  it('the default page can be chosen by the caller', () => {
    expect(safeNextPath('https://example.com', '/board')).toBe('/board');
    expect(safeNextPath('/orders', '/board')).toBe('/orders');
  });
});
