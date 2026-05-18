import 'server-only';
import { loadAll } from '@/lib/api';
import type { Job, Order } from '@/lib/types';

/**
 * Morning Report — daily LINE Flex alert of overdue / D-Day / urgent jobs.
 *
 * Ported from the standalone "Morning Report V2" Apps Script project, which
 * is now retired. Data comes from `loadAll()` (Postgres-first mirror, Apps
 * Script fallback) — no separate HTTP hop. Driven by the Vercel cron route
 * `app/api/cron/morning-report/route.ts` (8 AM Bangkok).
 */

const ICON_BASE = 'https://penprinting.co/icons/';
const DASHBOARD_URL = 'https://dashboard.penprinting.co/board';
const LINE_PUSH_API = 'https://api.line.me/v2/bot/message/push';

const STAFF_MAP: Record<string, string> = {
  pook: 'ปุ๊ก', perl: 'เปิ้ล', aed: 'แอ๊ด',
  sm74: 'SM74 (ต้อม)', mo5: 'MO 5สี (เกมส์)', mo: 'MO (วล)', hamada: 'Hamada (กุ้ง)',
  inkjet: 'Inkjet/Copyprint (แป๋)',
  cut: 'เครื่องตัด (หลง)', bind: 'เข้าเล่ม', ship: 'รอจัดส่ง',
};

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A LINE Flex JSON node — structurally open; LINE validates the shape. */
type Flex = Record<string, unknown>;

interface ReportItem {
  name: string;
  customer: string;
  owner: string;
  deadline: Date;
  daysLeft: number;
}

export interface Report {
  overdue: ReportItem[];
  dday: ReportItem[];
  urgent: ReportItem[];
}

// ── date helpers ──────────────────────────────────────────────
// Vercel runs in UTC; the Sheet/Apps Script ran in Asia/Bangkok. All dates
// below are snapped to a calendar day's 00:00 UTC keyed to the Bangkok
// calendar, so day-diff math is exact regardless of trigger time.

/** Today (Bangkok calendar) at 00:00 UTC. */
function bangkokToday(): Date {
  const bkk = new Date(Date.now() + BKK_OFFSET_MS);
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()));
}

/** Parse a job deadline string → calendar day at 00:00 UTC, or null. */
function parseDeadline(value: string | undefined | null): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  // DD/MM/YYYY
  const slash = s.split('/');
  if (slash.length === 3 && /^\d{1,2}$/.test(slash[0])) {
    const t = Date.UTC(Number(slash[2]), Number(slash[1]) - 1, Number(slash[0]));
    if (!isNaN(t)) return new Date(t);
  }

  // YYYY-MM-DD
  const dash = s.split('-');
  if (dash.length >= 3 && dash[0].length === 4) {
    const t = Date.UTC(Number(dash[0]), Number(dash[1]) - 1, Number(dash[2]));
    if (!isNaN(t)) return new Date(t);
  }

  // Fallback: native parse (Google Sheets Date.toString(), e.g.
  // "Sat Apr 18 2026 00:00:00 GMT+0700"). Shift the resulting instant into
  // Bangkok local time before reading the calendar date.
  const native = new Date(s);
  if (!isNaN(native.getTime())) {
    const bkk = new Date(native.getTime() + BKK_OFFSET_MS);
    return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()));
  }
  return null;
}

function todayThai(): string {
  const bkk = new Date(Date.now() + BKK_OFFSET_MS);
  return 'วัน' + THAI_DAYS[bkk.getUTCDay()] + 'ที่ ' + bkk.getUTCDate() + ' '
    + THAI_MONTHS[bkk.getUTCMonth()] + ' ' + (bkk.getUTCFullYear() + 543);
}

function fmtDateThai(dt: Date): string {
  return dt.getUTCDate() + ' ' + THAI_MONTHS[dt.getUTCMonth()] + ' ' + (dt.getUTCFullYear() + 543);
}

// ── report logic ──────────────────────────────────────────────

/** Bucket non-done jobs into overdue / D-Day / urgent (≤3 days). */
export function buildReport(jobs: Job[], orders: Order[]): Report {
  const orderMap = new Map<number, Order>();
  for (const o of orders) orderMap.set(o.id, o);

  const today = bangkokToday().getTime();
  const overdue: ReportItem[] = [];
  const dday: ReportItem[] = [];
  const urgent: ReportItem[] = [];

  for (const job of jobs) {
    if (job.status === 'done') continue;
    const deadline = parseDeadline(job.date);
    if (!deadline) continue;

    const daysLeft = Math.floor((deadline.getTime() - today) / DAY_MS);
    const order = job.orderId != null ? orderMap.get(job.orderId) : undefined;
    const item: ReportItem = {
      name: job.name || '-',
      customer: order ? (order.customer || '-') : '-',
      owner: STAFF_MAP[job.staff] || job.staff || '-',
      deadline,
      daysLeft,
    };

    if (daysLeft < 0) overdue.push(item);
    else if (daysLeft === 0) dday.push(item);
    else if (daysLeft <= 3) urgent.push(item);
  }

  overdue.sort((a, b) => a.daysLeft - b.daysLeft);
  dday.sort((a, b) => a.name.localeCompare(b.name));
  urgent.sort((a, b) => a.daysLeft - b.daysLeft);

  return { overdue, dday, urgent };
}

// ── flex builders ─────────────────────────────────────────────

function iconUrl(name: string): string {
  return ICON_BASE + name + '.png';
}

function miniIcon(name: string, sizePx = 16): Flex {
  const s = sizePx + 'px';
  return {
    type: 'box', layout: 'vertical', width: s, height: s, flex: 0,
    contents: [{ type: 'image', url: iconUrl(name), size: 'full', aspectRatio: '1:1' }],
  };
}

function buildStatBox(num: string, label: string, accentColor: string): Flex {
  return {
    type: 'box', layout: 'vertical', flex: 1,
    backgroundColor: '#ffffff', cornerRadius: '12px', paddingAll: '0px',
    contents: [
      { type: 'box', layout: 'vertical', height: '3px', backgroundColor: accentColor, contents: [{ type: 'filler' }] },
      {
        type: 'box', layout: 'vertical', paddingAll: '10px',
        contents: [
          { type: 'text', text: num, size: 'xxl', weight: 'bold', color: accentColor, align: 'center' },
          { type: 'text', text: label, size: 'xxs', color: '#718096', align: 'center', margin: 'xs' },
        ],
      },
    ],
  };
}

function buildHeaderBubble(r: Report): Flex {
  const total = r.overdue.length + r.dday.length + r.urgent.length;
  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box', layout: 'vertical', backgroundColor: '#f5f5f0', paddingAll: '20px',
      contents: [
        { type: 'text', text: 'PENPRINTING', size: 'xxs', color: '#a0aec0', align: 'end' },
        {
          type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md', alignItems: 'center',
          contents: [
            {
              type: 'box', layout: 'vertical', width: '44px', height: '44px',
              backgroundColor: '#fef3c7', cornerRadius: '10px',
              justifyContent: 'center', alignItems: 'center',
              contents: [
                {
                  type: 'box', layout: 'vertical', width: '24px', height: '24px',
                  contents: [{ type: 'image', url: iconUrl('alert'), size: 'full', aspectRatio: '1:1', aspectMode: 'fit' }],
                },
              ],
            },
            { type: 'text', text: 'แจ้งเตือนงานด่วน', size: 'xl', weight: 'bold', color: '#1a202c', wrap: true, flex: 1 },
          ],
        },
        { type: 'text', text: todayThai(), size: 'sm', color: '#046bd2', margin: 'sm', weight: 'bold' },
        {
          type: 'box', layout: 'baseline', spacing: 'sm', margin: 'xs',
          contents: [
            { type: 'icon', url: iconUrl('signal'), size: 'xs' },
            { type: 'text', text: 'ข้อมูลจาก Production Monitoring', size: 'xxs', color: '#a0aec0' },
          ],
        },
        { type: 'separator', margin: 'lg', color: '#ddd9d0' },
        {
          type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm',
          contents: [
            buildStatBox(String(r.overdue.length), 'เกินกำหนด', '#ef4444'),
            buildStatBox(String(r.dday.length), 'D-Day', '#7c3aed'),
            buildStatBox(String(r.urgent.length), 'เร่งด่วน', '#f59e0b'),
          ],
        },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          backgroundColor: '#ffffff', cornerRadius: '12px', paddingAll: '10px',
          justifyContent: 'center', spacing: 'sm',
          contents: [
            miniIcon('chart', 18),
            { type: 'text', text: 'รวมต้องดำเนินการ ' + total + ' รายการ', size: 'sm', weight: 'bold', color: '#1a202c' },
          ],
        },
      ],
    },
  };
}

type BadgeKind = 'overdue' | 'dday' | 'urgent';

function buildSectionBubble(
  title: string,
  items: ReportItem[],
  accentColor: string,
  badgeBg: string,
  badgeText: string,
  badgeKind: BadgeKind,
): Flex {
  const contents: Flex[] = [
    {
      type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center',
      contents: [
        { type: 'box', layout: 'vertical', width: '10px', height: '10px', backgroundColor: accentColor, cornerRadius: '5px', contents: [{ type: 'filler' }] },
        { type: 'text', text: title, size: 'md', weight: 'bold', color: accentColor, flex: 1 },
      ],
    },
    { type: 'separator', margin: 'md', color: '#ddd9d0' },
  ];

  const maxItems = Math.min(items.length, 6);
  for (let i = 0; i < maxItems; i++) {
    const item = items[i];
    let badgeStr: string;
    if (badgeKind === 'overdue') badgeStr = 'เกิน ' + Math.abs(item.daysLeft) + ' วัน';
    else if (badgeKind === 'dday') badgeStr = 'D-Day!';
    else badgeStr = 'เหลือ ' + item.daysLeft + ' วัน';

    contents.push({
      type: 'box', layout: 'horizontal',
      backgroundColor: '#ffffff', cornerRadius: '10px', margin: 'sm',
      contents: [
        { type: 'box', layout: 'vertical', width: '4px', backgroundColor: accentColor, contents: [{ type: 'filler' }] },
        {
          type: 'box', layout: 'vertical', flex: 1, paddingAll: '14px',
          contents: [
            {
              type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: item.name || '-', size: 'sm', weight: 'bold', color: '#1a202c', flex: 1, wrap: true },
                {
                  type: 'box', layout: 'vertical',
                  backgroundColor: badgeBg, cornerRadius: '10px',
                  paddingAll: '4px', paddingStart: '8px', paddingEnd: '8px',
                  contents: [{ type: 'text', text: badgeStr, size: 'xxs', color: badgeText, align: 'center', weight: 'bold' }],
                },
              ],
            },
            {
              type: 'box', layout: 'vertical', margin: 'sm', spacing: 'sm',
              contents: [
                {
                  type: 'box', layout: 'baseline', spacing: 'sm',
                  contents: [
                    { type: 'icon', url: iconUrl('building'), size: 'xs' },
                    { type: 'text', text: item.customer || '-', size: 'xxs', color: '#1d4ed8', weight: 'bold', flex: 1, wrap: true },
                    { type: 'icon', url: iconUrl('user'), size: 'xs' },
                    { type: 'text', text: item.owner || '-', size: 'xxs', color: '#718096' },
                  ],
                },
                {
                  type: 'box', layout: 'baseline', spacing: 'sm',
                  contents: [
                    { type: 'icon', url: iconUrl('calendar'), size: 'xs' },
                    { type: 'text', text: fmtDateThai(item.deadline), size: 'xxs', color: '#718096', flex: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  }

  if (items.length > 6) {
    contents.push({
      type: 'box', layout: 'vertical',
      backgroundColor: '#eff6ff', cornerRadius: '8px', paddingAll: '10px', margin: 'md',
      action: { type: 'uri', label: 'ดูทั้งหมด', uri: DASHBOARD_URL },
      contents: [
        {
          type: 'box', layout: 'baseline', justifyContent: 'center', spacing: 'sm',
          contents: [
            { type: 'text', text: 'ดูทั้งหมด (' + items.length + ' รายการ)', size: 'xs', color: '#046bd2', weight: 'bold' },
            { type: 'icon', url: iconUrl('chevron'), size: 'xs' },
          ],
        },
      ],
    });
  }

  return {
    type: 'bubble', size: 'mega',
    body: { type: 'box', layout: 'vertical', backgroundColor: '#f5f5f0', paddingAll: '20px', contents },
  };
}

function buildAlertFlex(r: Report): Flex {
  const bubbles: Flex[] = [buildHeaderBubble(r)];
  if (r.overdue.length > 0) bubbles.push(buildSectionBubble('เกินกำหนดส่ง', r.overdue, '#ef4444', '#fee2e2', '#dc2626', 'overdue'));
  if (r.dday.length > 0) bubbles.push(buildSectionBubble('ครบกำหนดวันนี้', r.dday, '#7c3aed', '#f5f3ff', '#7c3aed', 'dday'));
  if (r.urgent.length > 0) bubbles.push(buildSectionBubble('เร่งด่วน (≤3 วัน)', r.urgent, '#f59e0b', '#fef3c7', '#b45309', 'urgent'));

  return {
    type: 'flex',
    altText: '⚠️ แจ้งเตือนงานด่วน Penprinting — ' + todayThai(),
    contents: { type: 'carousel', contents: bubbles.slice(0, 12) },
  };
}

function buildNoAlertFlex(): Flex {
  const bubble: Flex = {
    type: 'bubble', size: 'mega',
    body: {
      type: 'box', layout: 'vertical', backgroundColor: '#f5f5f0', paddingAll: '24px',
      contents: [
        {
          type: 'box', layout: 'horizontal', justifyContent: 'center', margin: 'lg',
          contents: [
            {
              type: 'box', layout: 'vertical', width: '64px', height: '64px',
              backgroundColor: '#ffffff', cornerRadius: '32px',
              borderWidth: '2px', borderColor: '#dcfce7',
              justifyContent: 'center', alignItems: 'center',
              contents: [
                {
                  type: 'box', layout: 'vertical', width: '32px', height: '32px',
                  contents: [{ type: 'image', url: iconUrl('check'), size: 'full', aspectRatio: '1:1', aspectMode: 'fit' }],
                },
              ],
            },
          ],
        },
        { type: 'text', text: 'ไม่มีงานด่วน', size: 'xl', weight: 'bold', color: '#059669', align: 'center', margin: 'lg' },
        { type: 'text', text: 'งานทั้งหมดอยู่ในกำหนดเวลา', size: 'sm', color: '#718096', align: 'center', margin: 'md' },
        { type: 'separator', margin: 'xl', color: '#ddd9d0' },
        { type: 'text', text: 'Production Monitoring', size: 'xs', color: '#a0aec0', align: 'center', margin: 'lg' },
        { type: 'text', text: todayThai(), size: 'xxs', color: '#a0aec0', align: 'center', margin: 'xs' },
      ],
    },
  };

  return { type: 'flex', altText: '✅ Penprinting — ไม่มีงานด่วน', contents: bubble };
}

/** Build the LINE Flex message for a report (carousel if any urgent jobs). */
export function buildFlexMessage(r: Report): Flex {
  const total = r.overdue.length + r.dday.length + r.urgent.length;
  return total === 0 ? buildNoAlertFlex() : buildAlertFlex(r);
}

// ── send ──────────────────────────────────────────────────────

async function sendToLine(message: Flex): Promise<void> {
  const token = process.env.LINE_CHANNEL_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  if (!token || !groupId) {
    throw new Error('LINE_CHANNEL_TOKEN or LINE_GROUP_ID env var missing');
  }
  const res = await fetch(LINE_PUSH_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [message] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

export interface MorningReportResult {
  sent: boolean;
  overdue: number;
  dday: number;
  urgent: number;
  total: number;
}

/** Load jobs/orders, build the report, and push the Flex message to LINE.
 *  `dryRun` builds the report but skips the LINE push (for verification). */
export async function sendMorningReport(opts: { dryRun?: boolean } = {}): Promise<MorningReportResult> {
  const data = await loadAll();
  const report = buildReport(data.jobs || [], data.orders || []);
  const total = report.overdue.length + report.dday.length + report.urgent.length;

  if (!opts.dryRun) {
    await sendToLine(buildFlexMessage(report));
  }

  return {
    sent: !opts.dryRun,
    overdue: report.overdue.length,
    dday: report.dday.length,
    urgent: report.urgent.length,
    total,
  };
}
