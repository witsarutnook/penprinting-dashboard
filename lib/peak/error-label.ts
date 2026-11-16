const KNOWN = new Set([
  'PeakAuthError',
  'PeakUnavailableError',
  'PeakConfigError',
  'PeakNotConnectedError',
  'PeakToolError',
]);

/** Safe label for logs / admin UI: a known Peak class name, else 'Error'. Never the message. */
export function peakErrorLabel(err: unknown): string {
  const n = err instanceof Error ? err.name : '';
  return KNOWN.has(n) ? n : 'Error';
}
