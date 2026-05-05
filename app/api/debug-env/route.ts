// Debug-only endpoint — exposes env var SHAPE (not values) to diagnose auth issues.
// Safe to expose because we never log the full token, only metadata.
// Delete this route once Phase 3.2 verification passes.

export async function GET() {
  const url = process.env.APPS_SCRIPT_URL || '';
  const token = process.env.APPS_SCRIPT_TOKEN || '';

  return Response.json({
    apps_script_url: {
      set: url.length > 0,
      length: url.length,
      starts_with: url.substring(0, 40),
      ends_with: url.substring(Math.max(0, url.length - 10)),
    },
    apps_script_token: {
      set: token.length > 0,
      length: token.length,
      // Token format should be: api:admin:dashboard:<exp_unix_seconds>:<64_char_hex>
      // Expected length: ~99 chars (4 + 5 + 9 + 10 + 64 + 4 colons = ~96 chars)
      colon_count: (token.match(/:/g) || []).length,
      starts_with: token.substring(0, 25),  // "api:admin:dashboard:..." — safe to show
      has_leading_whitespace: token.length > 0 && /\s/.test(token[0]),
      has_trailing_whitespace: token.length > 0 && /\s/.test(token[token.length - 1]),
      // First 8 chars of HMAC sig (last segment after final ':') — shows if sig is hex
      sig_preview: (token.split(':').pop() || '').substring(0, 12),
      sig_is_hex: /^[a-f0-9]+$/.test(token.split(':').pop() || ''),
    },
    expected: {
      token_format: 'api:admin:dashboard:<exp>:<64-char-hex>',
      token_colon_count: 4,
      token_length_approx: 99,
      sig_should_be: '64 lowercase hex chars',
    },
  });
}
