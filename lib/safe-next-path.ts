/**
 * The page to go to after login, from the `?next=` of the login URL.
 * No 'server-only': used by the login form (client).
 *
 * Only a path of this site is accepted (audit 2026-11-27, M7): the login form navigates with
 * `window.location.href`, so an unchecked value was an open redirect right after the password
 * was typed, and a `javascript:` value would have run in the dashboard's own origin.
 */

/** Any origin that is not ours: `next` is resolved against it, and must stay on it. */
const BASE = 'https://next.invalid';
const MAX_LENGTH = 2000;

/** True when `s` holds a control character (tab, newline, NUL, DEL …). A browser drops tab and
 *  newline from a URL before reading it, so `/<tab>/example.com` is read as `//example.com`. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * `next` when it is a path of this site (`/…`, with its query and hash), else `fallback`.
 * Rejected: anything that is not a string, another site in any spelling (`https://…`, `//…`,
 * `/\…` — a browser reads a backslash as a slash), a scheme (`javascript:`, `data:`), a value
 * with a control character, a value that does not start with one `/`.
 */
export function safeNextPath(next: unknown, fallback = '/analytics'): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > MAX_LENGTH) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next.includes('\\') || hasControlChar(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  // The parser has the last word: whatever it makes of `next`, it must still be on our origin.
  if (url.origin !== BASE) return fallback;
  // `/.//example.com` is on our origin, but the parser folds the dot segment away and the path
  // it is left with is `//example.com`. Nothing of ours looks like that: refuse it.
  if (url.pathname.startsWith('//')) return fallback;
  // The value as it was given — never the parser's re-serialised path (that is how
  // `//example.com` above would have got out).
  return next;
}
