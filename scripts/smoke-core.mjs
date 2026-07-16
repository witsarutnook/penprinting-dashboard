// scripts/smoke-core.mjs — post-deploy smoke shared core.
// ⚠️ TWIN FILE: an identical copy lives in BOTH repos —
//   penprinting-dashboard/scripts/smoke-core.mjs
//   penprinting-calc/scripts/smoke-core.mjs
// Edit both together (keep byte-identical). Unit tests live in
// penprinting-dashboard/tests/smoke-core.test.mjs only.
// Zero dependencies — plain Node 20+ (global fetch).
// Spec: docs/superpowers/specs/2026-07-16-post-deploy-smoke-design.md

/** Compare expected subset vs actual (recursive, exact ===). → [{path, expected, actual}] */
export function compareFields(expected, actual, prefix = '') {
  const diffs = [];
  for (const [key, want] of Object.entries(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const got = actual == null ? undefined : actual[key];
    if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
      diffs.push(...compareFields(want, got, path));
    } else if (got !== want) {
      diffs.push({ path, expected: want, actual: got });
    }
  }
  return diffs;
}

export function buildFailMessage({ repo, failures, runUrl, hint }) {
  const lines = [`🔥 Post-deploy smoke FAILED — ${repo}`];
  for (const f of failures) lines.push(`❌ ${f.name}: ${f.detail}`);
  if (hint) lines.push(hint);
  if (runUrl) lines.push(`รายละเอียด: ${runUrl}`);
  return lines.join('\n');
}

export async function withRetry(fn, { attempts = 3, delayMs = 5_000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/** Run all checks ({name, run}) — collect every failure, never stop early. */
export async function runChecks(checks, retryOpts = {}) {
  const failures = [];
  for (const check of checks) {
    try {
      await withRetry(check.run, retryOpts);
      console.log(`✅ ${check.name}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${check.name}: ${detail}`);
      failures.push({ name: check.name, detail });
    }
  }
  return failures;
}

/** GET/…: assert HTTP status (no auto-redirect). → Response */
export async function expectStatus(url, expected, init = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    ...init,
  });
  if (res.status !== expected) {
    throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} (expected ${expected})`);
  }
  return res;
}

export async function pushLine(text, { token, groupId }) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
}

/** Shared entry: run checks → on failure LINE-notify (best-effort) + exit 1. */
export async function smokeMain({ repo, checks, hint, retry }) {
  const failures = await runChecks(checks, retry);
  if (failures.length === 0) {
    console.log(`✅ smoke passed (${checks.length} checks)`);
    return;
  }
  const msg = buildFailMessage({ repo, failures, runUrl: process.env.RUN_URL, hint });
  const token = process.env.LINE_CHANNEL_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  if (token && groupId) {
    try {
      await pushLine(msg, { token, groupId });
      console.error('LINE notify sent');
    } catch (err) {
      console.error(String(err)); // workflow-red is the backstop
    }
  } else {
    console.error('LINE_CHANNEL_TOKEN/LINE_GROUP_ID not set — skip notify');
  }
  process.exitCode = 1;
}
