// scripts/smoke.mjs — post-deploy smoke for dashboard.penprinting.co
// Run:  node scripts/smoke.mjs                       (against prod)
//       BASE_URL=http://localhost:3000 node scripts/smoke.mjs
//       node scripts/smoke.mjs --test-notify         (LINE plumbing test only)
// Env:  LINE_CHANNEL_TOKEN + LINE_GROUP_ID (notify) · RUN_URL (link in message)
// Spec: docs/superpowers/specs/2026-07-16-post-deploy-smoke-design.md
import { smokeMain, expectStatus, pushLine } from './smoke-core.mjs';

const BASE = process.env.BASE_URL ?? 'https://dashboard.penprinting.co';

const CHECKS = [
  { name: 'login-200', run: () => expectStatus(`${BASE}/login`, 200) },
  // /track is intentionally public (app/track/page.tsx) — update this check if it ever gets auth-gated
  { name: 'track-200', run: () => expectStatus(`${BASE}/track`, 200) },
  {
    name: 'board-redirects-to-login',
    run: async () => {
      const res = await expectStatus(`${BASE}/board`, 307);
      const loc = res.headers.get('location') ?? '';
      if (!loc.includes('/login')) throw new Error(`redirects to ${loc} (expected /login)`);
    },
  },
  { name: 'line-webhook-health-200', run: () => expectStatus(`${BASE}/api/ai-quote/line`, 200) },
  {
    name: 'line-webhook-fail-closed-401',
    run: () =>
      expectStatus(`${BASE}/api/ai-quote/line`, 401, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-line-signature': 'bogus' },
        body: JSON.stringify({ events: [] }),
      }),
  },
  {
    name: 'messenger-handshake-fail-closed-403',
    run: () =>
      expectStatus(
        `${BASE}/api/ai-quote/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`,
        403,
      ),
  },
  {
    name: 'admin-api-fail-closed-401',
    run: () => expectStatus(`${BASE}/api/admin/slip-metrics`, 401),
  },
];

if (process.argv.includes('--test-notify')) {
  await pushLine('🧪 smoke test-notify — penprinting-dashboard (ทดสอบระบบแจ้งเตือน ไม่ใช่ปัญหาจริง)', {
    token: process.env.LINE_CHANNEL_TOKEN,
    groupId: process.env.LINE_GROUP_ID,
  });
  console.log('test notify sent');
} else {
  await smokeMain({ repo: 'penprinting-dashboard', checks: CHECKS });
}
