// lib/ai-quote/track-flex.ts
// Port of buildOrderFlex_ + helpers from production-monitoring/google-apps-script-line-webhook.js
// (lines 286–590). JS→TS: added types, removed Logger.log, replaced Apps Script-only
// Utilities.formatDate with Intl.DateTimeFormat (TZ-safe, Bangkok timezone).

export interface TrackState {
  order: { name?: string; customer?: string; dateIn?: string; dateDue?: string; [k: string]: unknown };
  job: { dept?: string; date?: string; [k: string]: unknown } | null;
  shipped: Record<string, unknown> | null;
  cancelled: { reason?: string; [k: string]: unknown } | null;
}

export function isTrackCommand(text: string): boolean {
  return /^\/?track\s+\d{6,}/i.test(text.trim());
}

export function extractOrderId(text: string): string | null {
  const m = text.trim().match(/^\/?track\s+(\d{6,})/i);
  return m ? m[1] : null;
}

// ─── Main export ───

export function buildOrderFlex(orderId: string, state: TrackState | null): Record<string, unknown> {
  if (!state) {
    return {
      type: 'text',
      text: '❌ ไม่พบใบสั่งงาน #' + orderId + '\nกรุณาตรวจสอบเลขที่ใบสั่งงานอีกครั้ง',
    };
  }

  const orderName   = state.order.name || '-';
  const customer    = maskCustomer_(state.order.customer || '');
  const dateIn      = cleanDate_(state.order.dateIn || '');
  const dateDue     = cleanDate_(state.order.dateDue || '');
  const isCancelled = state.cancelled !== null;
  const isShipped   = state.shipped !== null;
  const currentDept = state.job ? (state.job.dept || '') : '';

  // ─── Status badge label + colors (mirror web logic exactly) ───
  let badgeLabel = 'รับใบสั่งงาน';
  let badgeBg    = '#fef3c7';
  let badgeFg    = '#b45309';

  if (isCancelled) {
    badgeLabel = 'ยกเลิก';
    badgeBg = '#f3f4f6'; badgeFg = '#6b7280';
  } else if (isShipped) {
    badgeLabel = 'จัดส่งเรียบร้อยแล้ว';
    badgeBg = '#dcfce7'; badgeFg = '#059669';
  } else if (currentDept === 'graphic') {
    badgeLabel = 'กราฟิกกำลังดำเนินการ';
    badgeBg = '#dbeafe'; badgeFg = '#1d4ed8';
  } else if (currentDept === 'print') {
    badgeLabel = 'อยู่ระหว่างพิมพ์';
    badgeBg = '#dbeafe'; badgeFg = '#1d4ed8';
  } else if (currentDept === 'post') {
    badgeLabel = 'ขั้นตอนหลังพิมพ์';
    badgeBg = '#dbeafe'; badgeFg = '#1d4ed8';
  }

  // ─── Days hint (override badge color if overdue) ───
  let daysHint = '';
  if (state.job && !isCancelled && !isShipped) {
    const due = state.job.date || '';
    const parts = due.split('/');
    if (parts.length === 3) {
      const dt    = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      // Build "today" from the Bangkok calendar date so both dt and today are server-local-midnight
      // of their Bangkok dates — the subtraction cancels cleanly even on a UTC server (Vercel).
      // (Apps Script ran in Bangkok TZ so this wasn't needed there; Node on Vercel runs UTC, where
      //  new Date(); setHours(0,...) = UTC-midnight = 07:00 Bangkok → off-by-one 00:00–07:00 BKK.)
      const nowBkk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
      const today = new Date(+nowBkk[0], +nowBkk[1] - 1, +nowBkk[2]);
      const daysLeft = Math.floor((dt.getTime() - today.getTime()) / 86400000);
      if (daysLeft < 0) {
        daysHint = 'เลยกำหนด ' + Math.abs(daysLeft) + ' วัน';
        badgeBg = '#fee2e2'; badgeFg = '#dc2626';
      } else if (daysLeft === 0) {
        daysHint = 'กำหนดส่งวันนี้';
      } else {
        daysHint = 'เหลืออีก ' + daysLeft + ' วัน';
      }
    }
  }

  // ─── Steps (icon circle + Thai/English labels) ───
  const stepBoxes = buildStepBoxes_(currentDept, isCancelled, isShipped);

  // ─── Status header section (cream bg) ───
  const headerContents: Record<string, unknown>[] = [
    { type: 'text', text: orderName, size: 'xl', weight: 'bold', color: '#1a202c', wrap: true },
    {
      type: 'box', layout: 'vertical', margin: 'md', spacing: 'xs',
      contents: [
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: 'ลูกค้า', size: 'xs', color: '#a0aec0', flex: 0 },
            { type: 'text', text: customer, size: 'xs', color: '#4a5568', flex: 1 },
          ],
        },
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: 'เลขที่', size: 'xs', color: '#a0aec0', flex: 0 },
            { type: 'text', text: '#' + orderId, size: 'xs', color: '#4a5568', flex: 1 },
          ],
        },
      ],
    },
    {
      type: 'box', layout: 'horizontal', margin: 'lg',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 0,
          paddingTop: 'sm', paddingBottom: 'sm',
          paddingStart: 'lg', paddingEnd: 'lg',
          cornerRadius: '20px', backgroundColor: badgeBg,
          contents: [
            { type: 'text', text: badgeLabel, size: 'sm', weight: 'bold', color: badgeFg, align: 'center' },
          ],
        },
        { type: 'filler' },
      ],
    },
  ];

  if (daysHint) {
    headerContents.push({
      type: 'text', text: daysHint, size: 'xs', color: '#718096', margin: 'sm', weight: 'bold',
    });
  }

  // ─── Cancellation reason box (if applicable) ───
  const extraSections: Record<string, unknown>[] = [];
  if (isCancelled && state.cancelled && state.cancelled.reason) {
    extraSections.push({
      type: 'box', layout: 'vertical',
      paddingStart: 'lg', paddingEnd: 'lg', paddingBottom: 'lg',
      contents: [
        {
          type: 'box', layout: 'vertical',
          paddingAll: 'md', cornerRadius: '8px', backgroundColor: '#fef2f2',
          contents: [
            { type: 'text', text: 'เหตุผล: ' + state.cancelled.reason, size: 'xs', color: '#dc2626', wrap: true },
          ],
        },
      ],
    });
  }

  return {
    type: 'flex',
    altText: 'สถานะงาน #' + orderId + ' — ' + orderName + ' (' + badgeLabel + ')',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: 'md', backgroundColor: '#1a202c',
        contents: [
          { type: 'text', text: 'PENPRINTING', color: '#ffffff', weight: 'bold', size: 'md', align: 'center' },
          { type: 'text', text: 'โรงพิมพ์เพ็ญพรินติ้ง', color: '#a0aec0', size: 'xxs', align: 'center', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: 'none', backgroundColor: '#ffffff',
        contents: ([
          // Status header
          {
            type: 'box', layout: 'vertical',
            paddingAll: 'lg', backgroundColor: '#f5f5f0',
            contents: headerContents,
          },
          // Date row (วันสั่ง / กำหนดส่ง)
          {
            type: 'box', layout: 'horizontal',
            paddingTop: 'lg', paddingBottom: 'lg', paddingStart: 'lg', paddingEnd: 'lg',
            spacing: 'md',
            contents: [
              {
                type: 'box', layout: 'vertical', flex: 1, spacing: 'xs',
                contents: [
                  { type: 'text', text: 'วันสั่ง', size: 'xxs', color: '#a0aec0', weight: 'bold' },
                  { type: 'text', text: dateIn, size: 'sm', color: '#1a202c', weight: 'bold' },
                ],
              },
              {
                type: 'box', layout: 'vertical', flex: 1, spacing: 'xs',
                contents: [
                  { type: 'text', text: 'กำหนดส่ง', size: 'xxs', color: '#a0aec0', weight: 'bold' },
                  { type: 'text', text: dateDue, size: 'sm', color: '#1a202c', weight: 'bold' },
                ],
              },
            ],
          },
          { type: 'separator', color: '#ebebeb' },
          // Steps
          {
            type: 'box', layout: 'vertical',
            paddingTop: 'lg', paddingBottom: 'lg', paddingStart: 'lg', paddingEnd: 'lg',
            contents: [
              { type: 'text', text: 'ขั้นตอน', size: 'xxs', color: '#a0aec0', weight: 'bold' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'md', contents: stepBoxes },
            ],
          },
        ] as Record<string, unknown>[]).concat(extraSections),
      },
      footer: {
        type: 'box', layout: 'vertical',
        paddingAll: 'md', backgroundColor: '#f5f5f0',
        contents: [
          { type: 'text', text: 'ติดต่อสอบถาม 043-220-582', size: 'xs', color: '#4a5568', align: 'center' },
        ],
      },
    },
  };
}

// ─── Build step rows (Order received → Pre-press → Print → Post → Pickup → Complete) ───
function buildStepBoxes_(currentDept: string, isCancelled: boolean, isShipped: boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  // Step 1: รับใบสั่งงาน — always done
  out.push(makeStep_('done', '✓', 'รับใบสั่งงาน', 'Order received'));

  if (isCancelled) {
    out.push(makeStep_('cancelled', '✕', 'ยกเลิกโดยโรงพิมพ์', 'Order cancelled'));
    return out;
  }

  const depts = [
    { key: 'graphic', th: 'กราฟิกกำลังดำเนินการ', en: 'Pre-press unit' },
    { key: 'print',   th: 'อยู่ระหว่างพิมพ์',     en: 'Printing in progress' },
    { key: 'post',    th: 'ขั้นตอนหลังพิมพ์',     en: 'Post-press unit' },
  ];
  const deptIdx: Record<string, number> = { graphic: 1, print: 2, post: 3 };
  const currentIdx = deptIdx[currentDept] || 0;

  depts.forEach((d) => {
    let cls = 'pending', icon = '○';
    if (isShipped) { cls = 'done'; icon = '✓'; }
    else if (d.key === currentDept) { cls = 'current'; icon = '●'; }
    else if (currentIdx > 0 && deptIdx[d.key] < currentIdx) { cls = 'done'; icon = '✓'; }
    out.push(makeStep_(cls, icon, d.th, d.en));
  });

  // Step 5: สินค้าพร้อมรับ
  out.push(makeStep_(isShipped ? 'done' : 'pending', isShipped ? '✓' : '○',
    'สินค้าพร้อมรับ', 'Ready for pick up'));

  // Step 6: จัดส่งเรียบร้อยแล้ว
  out.push(makeStep_(isShipped ? 'done' : 'pending', isShipped ? '✓' : '○',
    'จัดส่งเรียบร้อยแล้ว', 'Order complete'));

  return out;
}

function makeStep_(cls: string, icon: string, thai: string, eng: string): Record<string, unknown> {
  let iconBg: string, iconFg: string, thColor: string, enColor: string, thWeight = 'regular';
  if (cls === 'done') {
    iconBg = '#dcfce7'; iconFg = '#059669';
    thColor = '#1a202c'; enColor = '#64748b';
  } else if (cls === 'current') {
    iconBg = '#dbeafe'; iconFg = '#1d4ed8';
    thColor = '#1d4ed8'; enColor = '#3b82f6';
    thWeight = 'bold';
  } else if (cls === 'cancelled') {
    iconBg = '#fee2e2'; iconFg = '#dc2626';
    thColor = '#dc2626'; enColor = '#dc2626';
    thWeight = 'bold';
  } else { // pending
    iconBg = '#f1f5f9'; iconFg = '#cbd5e0';
    thColor = '#cbd5e0'; enColor = '#cbd5e0';
  }

  return {
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [
      {
        type: 'box', layout: 'vertical',
        width: '28px', height: '28px',
        cornerRadius: '14px', backgroundColor: iconBg,
        flex: 0,
        contents: [
          { type: 'text', text: icon, color: iconFg, size: 'md', weight: 'bold',
            align: 'center', gravity: 'center' },
        ],
      },
      {
        type: 'box', layout: 'vertical', flex: 1, spacing: 'none', justifyContent: 'center',
        contents: [
          { type: 'text', text: thai, size: 'sm', color: thColor, weight: thWeight },
          { type: 'text', text: eng, size: 'xxs', color: enColor },
        ],
      },
    ],
  };
}

// ─── Helpers (mirror PHP page-track-order.php logic) ───

function maskCustomer_(name: string): string {
  name = String(name || '').trim();
  if (!name) return '-';
  // For Thai text use Array.from to count graphemes properly
  const chars = Array.from(name);
  if (chars.length <= 2) return name;
  return chars.slice(0, 2).join('') + '•'.repeat(Math.max(1, chars.length - 2));
}

function cleanDate_(d: unknown): string {
  if (d === null || d === undefined || d === '') return '-';
  const s = String(d).trim();
  if (!s || s === '-') return '-';

  // 1) ถ้า string มี DD/MM/YYYY อยู่แล้ว → ดึงออกมาตรงๆ (กัน suffix หลังวันที่ + กัน timezone shift)
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const dd = m[1].length === 1 ? '0' + m[1] : m[1];
    const mm = m[2].length === 1 ? '0' + m[2] : m[2];
    return dd + '/' + mm + '/' + m[3];
  }

  // 2) ISO/GMT/Date object → format ด้วย Bangkok timezone เสมอ (ไม่เพี้ยน)
  // Note: ใน Apps Script ใช้ Utilities.formatDate — ใน Node.js ใช้ Intl.DateTimeFormat แทน (TZ-safe เหมือนกัน)
  const ts = new Date(s);
  if (!isNaN(ts.getTime())) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const result = fmt.format(ts); // usually dd/mm/yyyy, but ECMA-402 doesn't mandate the separator
    return /^\d{2}\/\d{2}\/\d{4}$/.test(result) ? result : s;
  }

  // 3) Parse ไม่ได้ → คืนค่าเดิม
  return s;
}
