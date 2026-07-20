'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF } from '@/lib/board';
import { bangkokTodayISO, dmyToISOInput } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/components/toast-provider';
import {
  PB_SIZES, PB_BINDINGS, type PhotobookItem,
  type OrderFormData, emptyOrderForm, orderFormFromRaw, emptyPhotobookItem,
} from '@/lib/photobook';
import {
  IconX, IconCheck, IconAlertTriangle, IconAlertCircle, IconFileText, IconPlus, IconPrinter,
  IconTrash, IconDownload, IconRefreshCw, IconArrowLeft,
} from '@/lib/icons';
import type { OrderSummary } from '@/lib/board';
import type { Template } from '@/lib/types';

/** Order-form "ผู้สั่งงาน" dropdown options — mirrors WP `ORDERERS` const
 *  in production-monitoring.js:1390. Keep in sync with WP. */
const ORDERERS = ['นุ๊ก', 'กิ๊ฟ', 'เจี๊ยบ'];

interface OrderFormProps {
  open: boolean;
  onClose: () => void;
  defaultOrderer: string;
  initial?: OrderSummary | null;
  /** When true, render the form as an inline page section instead of a modal dialog.
   *  Used by /orders/new (dedicated page) — no <dialog>, no overlay, scrolls with the page. */
  inline?: boolean;
  /** Available templates (presets) to quick-fill the form. Only shown on
   *  new-order entry (not when editing). */
  templates?: Template[];
  /** Whether the user can manage (save/delete) templates — admin + sales. */
  canManageTemplates?: boolean;
  /** Duplicate-flow prefill — rawData of another order. The full spec
   *  including the job name + customer is carried over; only the dates reset
   *  so the user picks a fresh due date. Mirrors WP duplicateOrder(). */
  initialPrefill?: Record<string, unknown> | null;
  /** Recent orders for the "ดึงงานล่าสุดของลูกค้านี้" button + customer
   *  autocomplete history. Slim shape — rawData is fetched on demand from
   *  /api/orders/raw/[id] when the user clicks the button (M2 fix). */
  recentOrders?: Array<{
    id: number;
    name: string;
    customer: string;
    hasRawData: boolean;
  }>;
}

/** Customer master list — fetched once from /customers.json (1.6k rows,
 *  ~140KB) and cached in module scope so subsequent OrderForm mounts reuse
 *  it without refetching. */
interface CustomerEntry { name: string; tel?: string }
let customersCache: CustomerEntry[] | null = null;
let customersFetchPromise: Promise<CustomerEntry[]> | null = null;

function fetchCustomers(): Promise<CustomerEntry[]> {
  if (customersCache) return Promise.resolve(customersCache);
  if (customersFetchPromise) return customersFetchPromise;
  customersFetchPromise = fetch('/customers.json', { cache: 'force-cache' })
    .then((r) => r.ok ? r.json() : [])
    .then((data: unknown) => {
      const list = Array.isArray(data) ? data : [];
      customersCache = list
        .map((c: unknown) => {
          if (typeof c === 'string') return { name: c.trim() } as CustomerEntry;
          if (c && typeof c === 'object') {
            const obj = c as Record<string, unknown>;
            const name = String(obj.name || '').trim();
            if (!name) return null;
            return { name, tel: String(obj.tel || obj.phone || '') };
          }
          return null;
        })
        .filter((c): c is CustomerEntry => !!c);
      return customersCache;
    })
    .catch(() => {
      customersCache = [];
      return [];
    });
  return customersFetchPromise;
}

interface SuccessInfo {
  orderId: number;
  jobId: number | null;
  pin: string;
  partial: boolean;
  warning?: string;
  isEdit: boolean;
  cascaded?: number;
}

interface DuplicateInfo {
  duplicates: Array<{ id: number; name: string; customer: string; dateIn: string; kind?: 'draft' | 'active' | 'orphan' }>;
  /** Submit mode ที่ชน 409 — force-confirm ต้อง resubmit ด้วย mode เดิม
   *  ไม่งั้น "พิมพ์+สั่ง" จะได้ใบสั่งแต่หน้าพิมพ์ไม่เปิด (audit H1 2026-06-11) */
  mode: 'submit' | 'draft' | 'print' | 'submitAndPromote';
}

type TabKey = 'main' | 'post' | 'assign';

const SIZE_UNITS = ['ซม.', 'นิ้ว', 'มม.'];
const QTY_UNITS = ['แผ่น', 'ชุด', 'เล่ม', 'กล่อง', 'ถุง', 'ห่อ', 'ชิ้น', 'ซอง', 'แฟ้ม'];
const PLATE_SIZES = ['ตัด 5', 'ตัด 4', 'ตัด 3'];
const COVER_COLORS = ['1สี', '2สี', '3สี', '4สี'];

export function OrderForm({
  open, onClose, defaultOrderer, initial, inline = false,
  templates = [], canManageTemplates = false,
  initialPrefill = null,
  recentOrders = [],
}: OrderFormProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const router = useRouter();
  const confirmDlg = useConfirm();
  const toast = useToast();
  const isEdit = !!initial;
  const [customers, setCustomers] = useState<CustomerEntry[]>(customersCache || []);
  useEffect(() => {
    if (customersCache) return;
    let cancelled = false;
    fetchCustomers().then((list) => { if (!cancelled) setCustomers(list); });
    return () => { cancelled = true; };
  }, []);
  const [templateList, setTemplateList] = useState<Template[]>(templates);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  // Persist last-applied template id so the dropdown shows what was loaded
  // instead of resetting to the placeholder. Cleared when user picks the
  // empty option or applies a different template.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  const [tab, setTab] = useState<TabKey>('main');
  const [data, setData] = useState<OrderFormData>(() => emptyOrderForm(defaultOrderer));
  const [extraBills, setExtraBills] = useState(false); // expand bills 4-6

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  // Wraps router.refresh() so the sidebar/bottom-nav pulsing dot lights up
  // while the new SSR snapshot streams in (matches /board mutations). User
  // gets instant page-level feedback even when the form button itself has
  // already enabled (e.g. while transitioning to /print or staying on page).
  const [, startTransition] = useTransition();

  // Track which order id we've already initialized for this open session.
  // After save, lib/api.ts mirrors the write to Postgres + revalidatePath
  // bumps the cache, then the page re-renders with a FRESH `initial` object
  // whose .id matches the one we already initialized for. Without this guard
  // the useEffect below would re-run, setSuccess(null), and the post-save
  // SuccessView would vanish — the user would see the form re-rendered with
  // their just-saved data and conclude the save didn't happen, then click
  // save again. Phase 1.7's faster refresh made this flicker user-visible.
  const initializedIdRef = useRef<number | null | 'prefill' | 'empty'>(null);
  const wasOpenRef = useRef(false);

  // Initialize on open (inline mode is always considered "open")
  useEffect(() => {
    const isOpen = open || inline;
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    // Compute a stable identity for what we're populating the form from.
    // Same identity → skip re-init unless the modal just transitioned
    // from closed → open (modal "fresh open" case).
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    let identity: number | 'prefill' | 'empty';
    if (initial) identity = initial.id;
    else if (initialPrefill) identity = 'prefill';
    else identity = 'empty';

    if (!justOpened && initializedIdRef.current === identity) {
      // Same logical entity, mid-session re-render (e.g. router.refresh
      // after save) — preserve local form state INCLUDING the SuccessView.
      return;
    }
    initializedIdRef.current = identity;

    if (!initial && initialPrefill) {
      // Duplicate flow ("สั่งซ้ำ") — carry over the FULL spec including the
      // job name + customer (a repeat is the same job for the same client).
      // Only the dates reset so the user picks a fresh due date. Mirrors WP
      // duplicateOrder() (which restores name/customer and clears only the
      // due date). If the source order is still an active job, submit trips
      // the "พบใบสั่งงานคล้ายกัน" warning by design — the user confirms.
      const next = orderFormFromRaw(initialPrefill, defaultOrderer);
      next.dateIn = bangkokTodayISO();
      next.dateDue = '';
      setData(next);
      setExtraBills(next.billColors.slice(3).some((b) => b !== ''));
      setTab('main');
      setBusy(false);
      setError(null);
      setSuccess(null);
      setDuplicate(null);
      return;
    }
    if (initial) {
      // Header fields come from the canonical OrderSummary (top-level, always
      // present). The spec fields come from rawData — which is NULL on the
      // slim board-delta path (PERF-H2/M2, i.e. editing from a board card).
      // Apply the header immediately, then lazy-fetch the spec and re-apply.
      // Full orders (the /orders edit page) carry rawData inline → no fetch.
      const applyInitial = (rawSpec: Record<string, unknown>) => {
        const next = orderFormFromRaw(rawSpec, initial.orderer || defaultOrderer);
        // Override header from canonical OrderSummary fields (rawData might be stale)
        next.name = initial.name || '';
        next.customer = initial.customer || '';
        next.dateIn = dmyToISOInput(initial.dateIn);
        next.dateDue = dmyToISOInput(initial.dateDue);
        next.orderer = initial.orderer || defaultOrderer;
        // Trust orderFormFromRaw's read of assignStaff + forwardPrint from
        // rawData (both fields can be set together — graphic does the work
        // first, then forwards to the assigned print staff after). Only
        // fall back to the orders-sheet top-level columns when rawData is
        // empty (legacy orders saved before the dual-field flow existed).
        if (!next.assignStaff && !next.forwardPrint) {
          if (initial.assignDept === 'print') {
            next.forwardPrint = initial.assignStaff || '';
          } else {
            next.assignStaff = initial.assignStaff || '';
          }
        }
        setData(next);
        setExtraBills(next.billColors.slice(3).some((b) => b !== ''));
      };

      const inlineRaw = initial.rawData;
      if (inlineRaw && Object.keys(inlineRaw).length > 0) {
        applyInitial(inlineRaw);
      } else {
        applyInitial({}); // instant header; spec fields fill in after the fetch
        const fetchId = initial.id;
        fetch(`/api/orders/raw/${fetchId}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((payload) => {
            // Ignore if the form moved to a different order while fetching.
            if (initializedIdRef.current !== fetchId) return;
            const rawSpec = (payload?.rawData as Record<string, unknown>) || {};
            if (Object.keys(rawSpec).length > 0) applyInitial(rawSpec);
          })
          .catch(() => { /* keep the header-only form; user can still edit + save */ });
      }
    } else {
      setData(emptyOrderForm(defaultOrderer));
      setExtraBills(false);
      setData((d) => ({ ...d, dateIn: bangkokTodayISO() }));
    }
    setTab('main');
    setBusy(false);
    setError(null);
    setSuccess(null);
    setDuplicate(null);
  }, [open, initial, defaultOrderer, inline, initialPrefill]);

  // Sync native dialog (modal mode only)
  useEffect(() => {
    if (inline) return;
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open, inline]);

  useEffect(() => {
    if (inline) return;
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel(e: Event) { e.preventDefault(); onClose(); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose, inline]);

  // Patch helper
  function patch(p: Partial<OrderFormData>) {
    setData((d) => ({ ...d, ...p }));
  }
  function patchBillColor(idx: number, value: string) {
    setData((d) => {
      const next = d.billColors.slice();
      next[idx] = value;
      return { ...d, billColors: next };
    });
  }
  function togglePlateSize(s: string) {
    setData((d) => ({
      ...d,
      plateSize: d.plateSize.includes(s)
        ? d.plateSize.filter((x) => x !== s)
        : [...d.plateSize, s],
    }));
  }
  function setPbItem(i: number, p: Partial<PhotobookItem>) {
    setData((d) => ({
      ...d,
      photobookItems: d.photobookItems.map((it, idx) => (idx === i ? { ...it, ...p } : it)),
    }));
  }
  function addPbItem() {
    setData((d) => ({ ...d, photobookItems: [...d.photobookItems, emptyPhotobookItem()] }));
  }
  function removePbItem(i: number) {
    setData((d) => ({ ...d, photobookItems: d.photobookItems.filter((_, idx) => idx !== i) }));
  }

  // Progress: count of 9 required core fields filled
  const progress = useMemo(() => {
    const checks = [
      !!data.name.trim(), !!data.customer.trim(), !!data.dateDue,
      !!data.orderer.trim(), !!(data.assignStaff || data.forwardPrint),
      !!data.size.trim(), !!data.qty.trim(),
      !!data.paperCover.trim() || !!data.paperInner.trim(),
      data.plateOld || data.plateNew || data.copyprint || data.inkjet || data.digital,
    ];
    return { filled: checks.filter(Boolean).length, total: checks.length };
  }, [data]);

  /** True when the dashboard is launched as a PWA / installed app
   *  (Chrome standalone, iOS Add-to-Home-Screen). In that mode
   *  `window.open(url, '_blank')` bounces out to the default browser
   *  instead of staying inside the PWA window — the user reported
   *  this from a Mac-installed PWA on 2026-05-07. Detected via the
   *  display-mode media query (Chrome / Safari / Firefox standalone)
   *  plus iOS-Safari's legacy `navigator.standalone` boolean. */
  function isStandalonePWA(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true;
  }

  /**
   * Open the print page on click. Two strategies depending on launch
   * context:
   *
   * 1. **Browser tab**: pre-open `about:blank` synchronously inside the
   *    click handler so Chrome / Safari / Firefox popup blockers don't
   *    kill it post-await, then hand the window ref to `submit()` for
   *    the URL swap once the order id is known. Mirrors WP's
   *    `printOrder()` (production-monitoring.js:1952).
   *
   * 2. **Installed PWA** (display-mode: standalone): `window.open(_blank)`
   *    in Chrome PWA bounces out to the browser shell. Skip the popup
   *    and navigate the SAME window after the submit succeeds — keeps
   *    the print page inside the PWA, matches the order-list "พิมพ์ใบสั่งงาน"
   *    Link behaviour. User goes back via the in-app back gesture.
   */
  function openPrintPlaceholder(): Window | null {
    const pw = window.open('about:blank', '_blank');
    if (!pw) return null;
    try {
      pw.document.write(
        '<html><head><title>กำลังเตรียมเอกสาร...</title></head>' +
        '<body style="font:14px sans-serif;padding:40px;text-align:center;color:#666;">' +
        '⏳ กำลังเตรียมเอกสาร...</body></html>'
      );
    } catch { /* about:blank cross-origin protections vary — non-fatal */ }
    return pw;
  }

  function handleSubmitAndPrint() {
    if (isStandalonePWA()) {
      // PWA: same-window navigation; submit() handles router.push to print.
      void submit(false, 'print', null);
      return;
    }
    const pw = openPrintPlaceholder();
    if (!pw) {
      setError('Browser ปิด popup — โปรดอนุญาต popup สำหรับเว็บนี้');
      return;
    }
    void submit(false, 'print', pw);
  }

  async function submit(
    force = false,
    mode: 'submit' | 'draft' | 'print' | 'submitAndPromote' = 'submit',
    printWindow?: Window | null,
  ) {
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = { ...data };
    if (force) body.force = true;
    if (isEdit && initial) {
      body.id = initial.id;
      // Pass the existing-order snapshot so the server can skip
      // `loadAllFresh()` (saves ~600ms on every edit). Server uses
      // `srcOrder.rawData.pin` to preserve PIN, and the (oldName, oldDateDue)
      // pair to decide whether a cascade-rename loadAllFresh is needed.
      body.srcOrder = {
        name: initial.name,
        dateDue: initial.dateDue,
        dateIn: initial.dateIn,
        price: initial.price,
        status: initial.status,
        rawData: initial.rawData ?? null,
        details: initial.details ?? null,
      };
    }
    if (mode === 'draft') (body as { status?: string }).status = 'draft';

    const path = isEdit ? '/api/orders/update' : '/api/orders/add';
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const respJson = await res.json().catch(() => ({}));
      // Keep busy=true through the submitAndPromote chain so the button
      // label stays "กำลังส่ง..." for the full save→promote flow instead
      // of flashing back to idle for ~500ms between fetches (the "เงียบ"
      // gap user reported 2026-05-11).
      const willChain = mode === 'submitAndPromote' && res.ok && (respJson?.orderId || initial?.id);
      if (!willChain) setBusy(false);
      if (res.status === 409 && respJson?.error === 'duplicate') {
        // Keep mode so force-confirm resubmits the same way — the print
        // placeholder is re-opened inside the confirm click handler.
        setDuplicate({ duplicates: respJson.duplicates || [], mode });
        // Close the placeholder popup — user has to confirm duplicate first.
        if (printWindow && !printWindow.closed) printWindow.close();
        return;
      }
      if (!res.ok) {
        setError(respJson?.error || `HTTP ${res.status}`);
        if (printWindow && !printWindow.closed) printWindow.close();
        return;
      }
      broadcastWrite(path);
      startTransition(() => router.refresh());
      const successInfo: SuccessInfo = {
        orderId: Number(respJson.orderId || initial?.id || 0),
        jobId: respJson.jobId == null ? null : Number(respJson.jobId),
        pin: String(respJson.pin || ''),
        partial: !!respJson.partial,
        warning: respJson.warning,
        isEdit,
        cascaded: respJson.cascaded,
      };

      // ── Chain: save → promote-draft (skips the success modal so user
      //  doesn't have to click "เสร็จสิ้น" between save and promote) ──
      if (mode === 'submitAndPromote' && successInfo.orderId) {
        try {
          const promoteRes = await fetch('/api/orders/promote-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: successInfo.orderId }),
          });
          const promoteJson = await promoteRes.json().catch(() => ({}));
          if (!promoteRes.ok) {
            setBusy(false);
            setError(promoteJson?.error || `ส่งเข้าระบบไม่สำเร็จ — HTTP ${promoteRes.status}`);
            return;
          }
          broadcastWrite('/api/orders/promote-draft');
          startTransition(() => router.refresh());
          setSuccess({ ...successInfo, jobId: Number(promoteJson.jobId) || successInfo.jobId });
          // Toast for explicit "ส่งเข้าระบบสำเร็จ" feedback. The success
          // modal also flashes briefly before redirect, but the toast
          // persists across the navigation transition.
          toast.success(`ส่งใบสั่งงานเข้าระบบสำเร็จ — Job #${promoteJson.jobId || ''}`);
          // Auto-navigate to /board — long enough for user to perceive
          // the success state, short enough to feel snappy.
          setTimeout(() => router.push('/board'), 1200);
          return;
        } catch (err) {
          setBusy(false);
          setError(err instanceof Error ? err.message : 'ส่งเข้าระบบไม่สำเร็จ — เครือข่ายขัดข้อง');
          return;
        }
      }

      setSuccess(successInfo);
      if (mode === 'print' && successInfo.orderId) {
        const printUrl = `/orders/${successInfo.orderId}/print`;
        if (printWindow && !printWindow.closed) {
          // Browser-tab path: reuse the popup we opened on the click.
          printWindow.location.href = printUrl;
        } else if (isStandalonePWA()) {
          // PWA path: same-window soft-navigation keeps the print view
          // inside the installed app instead of bouncing to a browser tab.
          router.push(printUrl);
        } else {
          // Fallback for callers that didn't pre-open a window (e.g. force-
          // retry from duplicate confirm). Browser may block as non-user-
          // initiated popup, but worth attempting.
          window.open(printUrl, '_blank');
        }
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
      if (printWindow && !printWindow.closed) printWindow.close();
    }
  }

  async function reset() {
    const ok = await confirmDlg.confirm({
      title: 'ล้างข้อมูลทั้งหมดในฟอร์ม?',
      message: 'ค่าทุกช่องจะถูกตั้งค่ากลับเป็นค่าเริ่มต้น',
      variant: 'warn',
      okLabel: 'ล้าง',
    });
    if (!ok) return;
    setData(emptyOrderForm(defaultOrderer));
  }

  /** Edit-mode "ยกเลิกแก้ไข" — confirm + onClose to navigate back without
   *  saving. Mirrors WP cancelEditMode() (production-monitoring.js:2858). */
  async function cancelEdit() {
    const ok = await confirmDlg.confirm({
      title: 'ยกเลิกการแก้ไข?',
      message: 'การเปลี่ยนแปลงทั้งหมดที่ยังไม่ได้บันทึกจะหายไป',
      variant: 'warn',
      okLabel: 'ยกเลิกแก้ไข',
    });
    if (!ok) return;
    onClose();
  }

  /** Combined customer suggestions — recent orders (most-recent first) +
   *  customers.json (alphabetical). Dedupe by lowercase name. */
  const customerSuggestions = useMemo<CustomerEntry[]>(() => {
    const seen = new Map<string, CustomerEntry>();
    for (const o of recentOrders) {
      const name = (o.customer || '').trim();
      if (!name || name === '-') continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, { name });
    }
    for (const c of customers) {
      const key = c.name.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, c);
    }
    return Array.from(seen.values());
  }, [recentOrders, customers]);

  /** Find the most-recent order id with rawData for a customer (case-insensitive). */
  const lastOrderIdForCustomer = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of recentOrders) {
      const name = (o.customer || '').trim().toLowerCase();
      if (!name || name === '-' || !o.hasRawData) continue;
      if (!map.has(name)) map.set(name, o.id); // recentOrders is sorted desc by id, first wins
    }
    return map;
  }, [recentOrders]);

  const [loadingLast, setLoadingLast] = useState(false);

  async function loadFromLastOrder() {
    const customerName = data.customer.trim();
    if (!customerName) return;
    const lastId = lastOrderIdForCustomer.get(customerName.toLowerCase());
    if (!lastId) {
      toast.error('ไม่พบงานเก่าของลูกค้านี้');
      return;
    }
    setLoadingLast(true);
    try {
      // Fetch raw data on demand (M2 fix — was preloaded into props)
      const res = await fetch(`/api/orders/raw/${lastId}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.rawData) {
        toast.error(payload?.error || 'ดึงข้อมูลงานเก่าไม่สำเร็จ');
        return;
      }
      const next = orderFormFromRaw(
        payload.rawData as Record<string, unknown>,
        data.orderer || defaultOrderer,
      );
      // Preserve the customer name the user typed; reset dates
      next.customer = customerName;
      next.dateIn = bangkokTodayISO();
      next.dateDue = '';
      setData(next);
      setExtraBills(next.billColors.slice(3).some((b) => b !== ''));
      setTab('main');
    } finally {
      setLoadingLast(false);
    }
  }

  const hasLastOrderForCustomer =
    !!data.customer.trim() &&
    lastOrderIdForCustomer.has(data.customer.trim().toLowerCase());

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const tpl = templateList.find((t) => String(t.id) === templateId);
    if (!tpl) return;
    const raw = (tpl.rawData && typeof tpl.rawData === 'object')
      ? tpl.rawData as Record<string, unknown>
      : {};
    // Build the form from template's snapshot — preserve the current orderer
    // (templates aren't tied to a specific user) and reset dates so user
    // sets fresh ones for this order.
    const next = orderFormFromRaw(raw, data.orderer || defaultOrderer);
    next.dateIn = bangkokTodayISO();
    next.dateDue = '';
    // Don't carry the customer name from template either — usually it was the
    // sample customer. User should pick fresh.
    next.customer = '';
    next.name = '';
    setData(next);
    setTab('main');
    setTemplateError(null);
  }

  async function saveAsTemplate() {
    const name = await confirmDlg.prompt({
      title: 'ตั้งชื่อ template',
      message: 'ใช้ชื่อที่อ่านง่าย จะแสดงใน Quick-fill เมื่อสั่งงานใหม่',
      placeholder: 'เช่น "นามบัตร 4 สี ออฟเซต"',
      okLabel: 'บันทึก',
    });
    if (!name || !name.trim()) return;
    setTemplateError(null);
    setTemplateBusy(true);
    try {
      const res = await fetch('/api/orders/templates/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), rawData: data }),
      });
      const respJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTemplateError(respJson?.error || `HTTP ${res.status}`);
        return;
      }
      // Optimistic add — real list refreshes on next page load
      const tplId = Number(respJson.id);
      setTemplateList((list) => [
        ...list,
        {
          id: tplId, name: name.trim(),
          rawData: data as unknown as Record<string, unknown>,
          createdBy: defaultOrderer,
          createdAt: new Date().toISOString(),
        },
      ]);
      toast.success(`บันทึก template "${name.trim()}" สำเร็จ`);
      startTransition(() => router.refresh());
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    } finally {
      setTemplateBusy(false);
    }
  }

  async function deleteTemplate(id: number) {
    const tpl = templateList.find((t) => Number(t.id) === Number(id));
    const ok = await confirmDlg.confirm({
      title: 'ลบ template นี้?',
      message: 'ไม่สามารถย้อนกลับได้',
      variant: 'danger',
      okLabel: 'ลบ',
    });
    if (!ok) return;
    setTemplateError(null);
    setTemplateBusy(true);
    try {
      const res = await fetch('/api/orders/templates/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const respJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTemplateError(respJson?.error || `HTTP ${res.status}`);
        return;
      }
      setTemplateList((list) => list.filter((t) => Number(t.id) !== Number(id)));
      // Drop the dropdown selection if the user just deleted the loaded template
      if (selectedTemplateId === String(id)) setSelectedTemplateId('');
      toast.success(tpl ? `ลบ template "${tpl.name}" สำเร็จ` : 'ลบ template สำเร็จ');
      startTransition(() => router.refresh());
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    } finally {
      setTemplateBusy(false);
    }
  }

  const body = (
    <>
      {success ? (
        <SuccessView success={success} onClose={onClose} onCreateAnother={() => setSuccess(null)} isEdit={isEdit} />
      ) : duplicate ? (
        <DuplicateView duplicates={duplicate.duplicates} onCancel={() => setDuplicate(null)} onForce={() => {
          const dupMode = duplicate.mode;
          setDuplicate(null);
          // "พิมพ์+สั่ง" path: เปิด placeholder ใน click handler นี้ (popup-blocker
          // safe) เพราะ popup เดิมถูกปิดตอนเจอ 409 — ถ้าโดน block ก็ยัง submit ต่อ
          // (submit() มี window.open fallback ของตัวเอง)
          const pw = dupMode === 'print' && !isStandalonePWA() ? openPrintPlaceholder() : null;
          void submit(true, dupMode, pw);
        }} />
      ) : (
        <div className={`flex flex-col ${inline ? '' : 'max-h-[92vh]'}`}>
          {/* Header */}
          <header className="px-5 py-3 border-b border-stone-100 flex items-center justify-between flex-shrink-0">
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <IconFileText size={18} />
              {isEdit ? `แก้ไขใบสั่งงาน #${initial?.id}` : 'สั่งงาน (รับใบสั่งงาน)'}
            </h2>
            {!inline && (
              <button type="button" onClick={onClose} aria-label="ปิด"
                className="text-stone-400 hover:text-stone-700 w-11 h-11 flex items-center justify-center rounded hover:bg-stone-100">
                <IconX size={20} />
              </button>
            )}
          </header>

          {/* Order type segment + templates row */}
          <div className="px-5 pt-4 flex-shrink-0 flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex rounded-lg bg-stone-100 p-1 text-sm">
              <button type="button" onClick={() => patch({ orderType: 'normal' })}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md transition-colors ${
                  data.orderType === 'normal' ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
                }`}>
                <IconFileText size={13} />
                งานทั่วไป
              </button>
              <button type="button" onClick={() => {
                  patch({ orderType: 'photobook' });
                  if (data.photobookItems.length === 0) addPbItem();
                  // The "งานหลังพิมพ์" tab is hidden in photobook mode (the
                  // photobook segment lives on the main tab). Without this
                  // reset, switching while the post tab is active leaves the
                  // body blank — neither tab condition matches.
                  setTab('main');
                }}
                className={`px-4 py-1.5 rounded-md transition-colors ${
                  data.orderType === 'photobook' ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
                }`}>
                Photobook
              </button>
            </div>

            {/* Templates row — only on new entries (not when editing) */}
            {!isEdit && (
              <div className="flex items-center gap-2 flex-wrap">
                {templateList.length > 0 && (
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    disabled={busy || templateBusy}
                    className="px-2 py-1 border border-stone-200 rounded-lg text-xs bg-white focus:outline-none focus:border-accent disabled:opacity-50"
                  >
                    <option value="">— ใช้ template —</option>
                    {templateList.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
                {canManageTemplates && (
                  <>
                    <button
                      type="button"
                      onClick={saveAsTemplate}
                      disabled={busy || templateBusy || !data.name.trim()}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 disabled:opacity-50"
                      title="บันทึกข้อมูลปัจจุบันเป็น template"
                    >
                      <IconDownload size={12} />
                      บันทึก template
                    </button>
                    {templateList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setManageTemplatesOpen((v) => !v)}
                        disabled={busy || templateBusy}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 disabled:opacity-50"
                      >
                        จัดการ ({templateList.length})
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {manageTemplatesOpen && !isEdit && canManageTemplates && (
            <div className="mx-5 mt-3 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-stone-700">จัดการ template</h3>
                <button
                  type="button"
                  onClick={() => setManageTemplatesOpen(false)}
                  className="text-stone-400 hover:text-stone-700 w-6 h-6 flex items-center justify-center rounded hover:bg-stone-100"
                >
                  <IconX size={14} />
                </button>
              </div>
              {templateList.length === 0 ? (
                <p className="text-xs text-stone-500 py-2">ยังไม่มี template — กด &quot;บันทึก template&quot; เพื่อเก็บฟอร์มปัจจุบัน</p>
              ) : (
                <ul className="space-y-1">
                  {templateList.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 text-sm bg-white rounded px-2 py-1 border border-stone-100">
                      <span className="flex-1 min-w-0 font-medium text-stone-800 truncate">{t.name}</span>
                      <span className="hidden sm:block w-20 shrink-0 text-[11px] text-stone-400 text-right truncate">{t.createdBy}</span>
                      <button
                        type="button"
                        onClick={() => deleteTemplate(Number(t.id))}
                        disabled={templateBusy}
                        className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-0.5 rounded disabled:opacity-50"
                      >
                        <IconTrash size={11} />
                        ลบ
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {templateError && (
                <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                  {templateError}
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="px-5 pt-3 flex-shrink-0">
            <div className="flex items-center gap-3 text-xs text-stone-600">
              <span>ความคืบหน้า</span>
              <div className="flex-grow h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div className="h-full bg-sky-500 transition-all"
                  style={{ width: `${(progress.filled / progress.total) * 100}%` }} />
              </div>
              <span className="tabular-nums font-semibold">{progress.filled}/{progress.total}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-stone-100 flex-shrink-0 mt-3">
            <div className="flex px-5 gap-4 overflow-x-auto">
              <TabBtn active={tab === 'main'} onClick={() => setTab('main')} label="ข้อมูลหลัก" />
              {data.orderType === 'normal' && (
                <TabBtn active={tab === 'post'} onClick={() => setTab('post')} label="งานหลังพิมพ์" />
              )}
              <TabBtn active={tab === 'assign'} onClick={() => setTab('assign')} label="มอบหมาย + หมายเหตุ" />
            </div>
          </div>

          {/* Body */}
          <div className="flex-grow overflow-y-auto px-5 py-4 space-y-5">
            {tab === 'main' && (
              <MainTab
                data={data}
                patch={patch}
                togglePlateSize={togglePlateSize}
                onAddPbItem={addPbItem}
                onUpdatePbItem={setPbItem}
                onRemovePbItem={removePbItem}
                customerSuggestions={customerSuggestions}
                hasLastOrderForCustomer={hasLastOrderForCustomer}
                onLoadFromLastOrder={loadFromLastOrder}
                loadingLast={loadingLast}
              />
            )}
            {tab === 'post' && data.orderType === 'normal' && (
              <PostPressTab
                data={data}
                patch={patch}
                patchBillColor={patchBillColor}
                extraBills={extraBills}
                setExtraBills={setExtraBills}
              />
            )}
            {tab === 'assign' && (
              <AssignTab data={data} patch={patch} />
            )}

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="px-5 py-3 border-t border-stone-200 bg-stone-50/60 flex items-center justify-between gap-2 flex-shrink-0 flex-wrap">
            <p className="text-[11px] text-stone-400">
              {isEdit ? 'แก้ชื่อ/วันที่ → cascade ไป jobs ที่ผูกอยู่' : 'แจ้งเตือนถ้าซ้ำกับใบสั่งที่ยังไม่ปิด'}
            </p>
            <div className="flex flex-wrap gap-2">
              {isEdit ? (
                <button type="button" onClick={cancelEdit} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
                  title="ยกเลิกการแก้ไข — กลับไปหน้ารายการใบสั่งงานโดยไม่บันทึก">
                  <IconX size={14} />
                  ยกเลิกแก้ไข
                </button>
              ) : (
                <button type="button" onClick={reset} disabled={busy}
                  className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50">
                  รีเซ็ต
                </button>
              )}
              {!isEdit && (
                <button type="button" onClick={() => submit(false, 'draft')} disabled={busy || !data.name.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
                  title="บันทึกแบบร่าง — แก้ต่อภายหลังได้, ไม่สร้าง Job">
                  <IconFileText size={13} />
                  {busy ? '...' : 'บันทึกร่าง'}
                </button>
              )}
              <button type="button" onClick={() => submit(false, 'submit')} disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark disabled:opacity-50">
                <IconCheck size={14} />
                {busy ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'ส่งใบสั่งงาน'}
              </button>
              {/* Edit-draft shortcut: one-click save + promote. Avoids the
                  multi-step "บันทึก → เสร็จสิ้น → ส่งเข้าระบบ" UX trap. */}
              {isEdit && initial?.status === 'draft' && (
                <button type="button" onClick={() => submit(false, 'submitAndPromote')} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                  title="บันทึกฟอร์ม แล้วส่งเข้าสายผลิตในคลิกเดียว">
                  <IconCheck size={14} />
                  {busy ? 'กำลังส่ง...' : 'บันทึก + ส่งเข้าระบบ'}
                </button>
              )}
              {!isEdit && (
                <button type="button" onClick={handleSubmitAndPrint} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
                  title="ส่งใบสั่งงาน + เปิดหน้าพิมพ์ทันที">
                  <IconPrinter size={14} />
                  {busy ? 'กำลังบันทึก...' : 'พิมพ์+สั่ง'}
                </button>
              )}
            </div>
          </footer>
        </div>
      )}
    </>
  );

  if (inline) {
    return <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">{body}</div>;
  }
  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-4xl w-[96vw]"
    >
      {body}
    </dialog>
  );
}

// ─── Tab 1: ข้อมูลหลัก ─────────────────────────────────────

function MainTab({
  data, patch, togglePlateSize, onAddPbItem, onUpdatePbItem, onRemovePbItem,
  customerSuggestions, hasLastOrderForCustomer, onLoadFromLastOrder, loadingLast,
}: {
  data: OrderFormData;
  patch: (p: Partial<OrderFormData>) => void;
  togglePlateSize: (s: string) => void;
  onAddPbItem: () => void;
  onUpdatePbItem: (i: number, p: Partial<PhotobookItem>) => void;
  onRemovePbItem: (i: number) => void;
  customerSuggestions: CustomerEntry[];
  hasLastOrderForCustomer: boolean;
  onLoadFromLastOrder: () => void;
  loadingLast: boolean;
}) {
  const isPB = data.orderType === 'photobook';
  return (
    <>
      <Section title="ข้อมูลลูกค้า">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="ชื่องาน / ชื่อผลิตภัณฑ์ *">
            <input type="text" required value={data.name} onChange={(e) => patch({ name: e.target.value })}
              className={inputCls} maxLength={200} />
          </Field>
          <Field label="ชื่อลูกค้า *">
            <CustomerAutocomplete
              value={data.customer}
              onChange={(v) => patch({ customer: v })}
              suggestions={customerSuggestions}
            />
            {hasLastOrderForCustomer && (
              <button
                type="button"
                onClick={onLoadFromLastOrder}
                disabled={loadingLast}
                className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium disabled:opacity-50"
                title="ใส่ค่าจาก spec ของงานเก่าลูกค้านี้ — ระบบจะเซ็ตวันที่รับเป็นวันนี้และเคลียร์กำหนดส่ง"
              >
                {loadingLast ? (
                  <>
                    <IconRefreshCw size={12} className="animate-spin" />
                    กำลังดึงข้อมูล...
                  </>
                ) : (
                  <>
                    <IconArrowLeft size={12} />
                    ดึงรายละเอียดจากงานล่าสุดของลูกค้านี้
                  </>
                )}
              </button>
            )}
          </Field>
          <Field label="วันที่รับสั่งงาน">
            <input type="date" value={data.dateIn} onChange={(e) => patch({ dateIn: e.target.value })}
              className={`${inputCls} tabular-nums`} />
          </Field>
          <Field label="วันกำหนดส่ง *">
            <input type="date" required value={data.dateDue} onChange={(e) => patch({ dateDue: e.target.value })}
              className={`${inputCls} tabular-nums`} />
          </Field>
        </div>
      </Section>

      {!isPB && (
        <>
          <Section title="รายละเอียดงาน">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="ขนาด">
                <div className="flex gap-2">
                  <input type="text" value={data.size} onChange={(e) => patch({ size: e.target.value })}
                    className={`${inputCls} flex-grow`} placeholder="เช่น A4 หรือ 21x29.7" />
                  <select value={data.sizeUnit} onChange={(e) => patch({ sizeUnit: e.target.value })}
                    className={`${inputCls} w-20`}>
                    {SIZE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="จำนวน">
                <div className="flex gap-2">
                  <input type="text" value={data.qty} onChange={(e) => patch({ qty: e.target.value })}
                    className={`${inputCls} flex-grow tabular-nums`} />
                  <select value={data.qtyUnit} onChange={(e) => patch({ qtyUnit: e.target.value })}
                    className={`${inputCls} w-20`}>
                    {QTY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="กระดาษปก" className="sm:col-span-1">
                <div className="flex gap-2">
                  <input type="text" value={data.paperCover} onChange={(e) => patch({ paperCover: e.target.value })}
                    className={`${inputCls} flex-grow`} placeholder="เช่น อาร์ตการ์ด 230" />
                  <input type="text" value={data.coverColorNote} onChange={(e) => patch({ coverColorNote: e.target.value })}
                    className={`${inputCls} w-32 sm:w-36`} placeholder="หมายเหตุสีปก" aria-label="หมายเหตุสีปก" />
                </div>
              </Field>
              <RadioRowField
                label="สีปก" name="coverColor" options={COVER_COLORS}
                value={data.coverColor} onChange={(v) => patch({ coverColor: v })}
              />
              <Field label="กระดาษเนื้อใน" className="sm:col-span-1">
                <div className="flex gap-2">
                  <input type="text" value={data.paperInner} onChange={(e) => patch({ paperInner: e.target.value })}
                    className={`${inputCls} flex-grow`} placeholder="เช่น อาร์ตมัน 130" />
                  <input type="text" value={data.innerColorNote} onChange={(e) => patch({ innerColorNote: e.target.value })}
                    className={`${inputCls} w-32 sm:w-36`} placeholder="หมายเหตุสีเนื้อใน" aria-label="หมายเหตุสีเนื้อใน" />
                </div>
              </Field>
              <RadioRowField
                label="สีเนื้อใน" name="innerColor" options={COVER_COLORS}
                value={data.innerColor} onChange={(v) => patch({ innerColor: v })}
              />
            </div>
          </Section>

          <Section title="PLATE / การพิมพ์">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="block text-xs font-medium text-stone-600 mb-1.5">ประเภท PLATE</span>
                <div className="flex flex-wrap gap-3">
                  <CB checked={data.plateOld} onChange={(c) => patch({ plateOld: c })} label="เก่า" />
                  <CB checked={data.plateNew} onChange={(c) => patch({ plateNew: c })} label="ใหม่" />
                  <CB checked={data.copyprint} onChange={(c) => patch({ copyprint: c })} label="Copyprint" />
                  <CB checked={data.inkjet} onChange={(c) => patch({ inkjet: c })} label="Inkjet" />
                  <CB checked={data.digital} onChange={(c) => patch({ digital: c })} label="Print Digital" />
                </div>
              </div>
              <div>
                <span className="block text-xs font-medium text-stone-600 mb-1.5">ขนาด PLATE</span>
                <div className="flex flex-wrap gap-3">
                  {PLATE_SIZES.map((s) => (
                    <CB key={s} checked={data.plateSize.includes(s)} onChange={() => togglePlateSize(s)} label={s} />
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </>
      )}

      {isPB && (
        <Section title="รายการ Photobook">
          <PhotobookEditor
            items={data.photobookItems}
            onAdd={onAddPbItem}
            onUpdate={onUpdatePbItem}
            onRemove={onRemovePbItem}
          />
        </Section>
      )}
    </>
  );
}

// ─── Tab 2: งานหลังพิมพ์ ──────────────────────────────────

function PostPressTab({
  data, patch, patchBillColor, extraBills, setExtraBills,
}: {
  data: OrderFormData;
  patch: (p: Partial<OrderFormData>) => void;
  patchBillColor: (i: number, v: string) => void;
  extraBills: boolean;
  setExtraBills: (b: boolean) => void;
}) {
  return (
    <>
      <Section title="งานบิล">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="บิลต่อชุด"><input type="text" value={data.billPerSet} onChange={(e) => patch({ billPerSet: e.target.value })} className={inputCls} /></Field>
          <Field label="ชุดต่อเล่ม"><input type="text" value={data.setPerBook} onChange={(e) => patch({ setPerBook: e.target.value })} className={inputCls} /></Field>
          <Field label="แผ่นต่อเล่ม"><input type="text" value={data.sheetPerBook} onChange={(e) => patch({ sheetPerBook: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="mt-3">
          <span className="block text-xs font-medium text-stone-600 mb-1.5">สีบิล</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Field key={i} label={`บิล ${i + 1}`}>
                <input type="text" value={data.billColors[i] || ''} onChange={(e) => patchBillColor(i, e.target.value)}
                  className={inputCls} />
              </Field>
            ))}
          </div>
          {!extraBills ? (
            <button type="button" onClick={() => setExtraBills(true)}
              className="text-xs text-accent hover:text-accent-dark font-medium mt-2 inline-flex items-center gap-1">
              <IconPlus size={11} />
              เพิ่มสีบิล (บิล 4-6)
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              {[3, 4, 5].map((i) => (
                <Field key={i} label={`บิล ${i + 1}`}>
                  <input type="text" value={data.billColors[i] || ''} onChange={(e) => patchBillColor(i, e.target.value)}
                    className={inputCls} />
                </Field>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <CB checked={data.perf} onChange={(c) => patch({ perf: c })} label="ปรุ" />
            {data.perf && (
              <Field label="ตำแหน่งปรุ" className="mt-2">
                <input type="text" value={data.perfPos} onChange={(e) => patch({ perfPos: e.target.value })} className={inputCls} />
              </Field>
            )}
          </div>
          <div>
            <CB checked={data.runNo} onChange={(c) => patch({ runNo: c })} label="หมายเลขรัน" />
            {data.runNo && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Field label="รันเล่มที่"><input type="text" value={data.runBook} onChange={(e) => patch({ runBook: e.target.value })} className={inputCls} /></Field>
                <Field label="รันเลขที่"><input type="text" value={data.runNum} onChange={(e) => patch({ runNum: e.target.value })} className={inputCls} /></Field>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="เข้าเล่ม (Binding)">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <CB checked={data.glue} onChange={(c) => patch({ glue: c })} label="ไสกาว" />
          <CB checked={data.saddle} onChange={(c) => patch({ saddle: c })} label="มุงหลังคา" />
          <CB checked={data.sew} onChange={(c) => patch({ sew: c })} label="เย็บที่" />
          <CB checked={data.spine} onChange={(c) => patch({ spine: c })} label="กระดูกงู" />
          <CB checked={data.glueHead} onChange={(c) => patch({ glueHead: c })} label="กาวหัว" />
          <CB checked={data.glueSide} onChange={(c) => patch({ glueSide: c })} label="กาวข้าง" />
          <CB checked={data.sewHead} onChange={(c) => patch({ sewHead: c })} label="เย็บหัว" />
          <CB checked={data.sewSide} onChange={(c) => patch({ sewSide: c })} label="เย็บข้าง" />
          <CB checked={data.sewCorner} onChange={(c) => patch({ sewCorner: c })} label="เย็บมุม" />
          <CB checked={data.sewThread} onChange={(c) => patch({ sewThread: c })} label="เย็บด้าย" />
          <CB checked={data.sewSideTape} onChange={(c) => patch({ sewSideTape: c })} label="ติดเทปสัน" />
        </div>
      </Section>

      <Section title="เคลือบ / ปั๊ม (Coating & Stamping)">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <span className="block text-xs font-medium text-stone-600 mb-1.5">เคลือบ</span>
            <div className="flex flex-wrap gap-3">
              <CB checked={data.coatGloss} onChange={(c) => patch({ coatGloss: c })} label="เงา" />
              <CB checked={data.coatMatte} onChange={(c) => patch({ coatMatte: c })} label="ด้าน" />
              <CB checked={data.coatUV} onChange={(c) => patch({ coatUV: c })} label="UV" />
              <CB checked={data.coatSpotUV} onChange={(c) => patch({ coatSpotUV: c })} label="SPOT UV" />
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium text-stone-600 mb-1.5">ปั๊ม</span>
            <div className="flex flex-wrap gap-3">
              <CB checked={data.stampColor} onChange={(c) => patch({ stampColor: c })} label="ปั๊มสี" />
              <CB checked={data.emboss} onChange={(c) => patch({ emboss: c })} label="นูน" />
              <CB checked={data.diecut} onChange={(c) => patch({ diecut: c })} label="ส่งไดคัท" />
              <CB checked={data.diecutSelf} onChange={(c) => patch({ diecutSelf: c })} label="ไดคัทเอง" />
            </div>
          </div>
          <Field label="สีปั๊ม">
            <input type="text" value={data.stampColorNote} onChange={(e) => patch({ stampColorNote: e.target.value })}
              className={inputCls} disabled={!data.stampColor} />
          </Field>
        </div>
      </Section>
    </>
  );
}

// ─── Tab 3: มอบหมาย + หมายเหตุ ─────────────────────────────

function AssignTab({
  data, patch,
}: {
  data: OrderFormData;
  patch: (p: Partial<OrderFormData>) => void;
}) {
  return (
    <>
      <Section title="มอบหมายงาน">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="ผู้สั่งงาน *">
            <select value={data.orderer}
              onChange={(e) => patch({ orderer: e.target.value })}
              className={inputCls} required>
              <option value="">-- เลือก --</option>
              {ORDERERS.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
          <Field label="มอบหมายกราฟฟิก">
            <select value={data.assignStaff}
              onChange={(e) => patch({ assignStaff: e.target.value })}
              className={inputCls}>
              <option value="">-- ไม่ระบุ --</option>
              {STAFF.graphic.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="ส่งต่อพิมพ์">
            <select value={data.forwardPrint}
              onChange={(e) => patch({ forwardPrint: e.target.value })}
              className={inputCls}>
              <option value="">-- ไม่ระบุ --</option>
              {STAFF.print.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-stone-500 mt-2">
          * เลือกอย่างน้อย 1: มอบหมายกราฟฟิก หรือ ส่งต่อพิมพ์
        </p>
      </Section>

      <Section title="หมายเหตุเพิ่มเติม">
        <textarea value={data.notes} onChange={(e) => patch({ notes: e.target.value })} rows={5}
          className={`${inputCls} resize-y`} placeholder="รายละเอียดเพิ่มเติมที่อยากบอกฝ่ายผลิต..." />
      </Section>
    </>
  );
}

// ─── Photobook editor ─────────────────────────────────────

function PhotobookEditor({
  items, onAdd, onUpdate, onRemove,
}: {
  items: PhotobookItem[];
  onAdd: () => void;
  onUpdate: (i: number, p: Partial<PhotobookItem>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-stone-600">{items.length} เล่ม</span>
        <button type="button" onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-dark">
          <IconPlus size={11} />
          เพิ่มเล่ม
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-4">
          ยังไม่มีเล่ม — กด &quot;เพิ่มเล่ม&quot; เพื่อใส่รายการ
        </p>
      ) : (
        items.map((it, i) => (
          <div key={i} className="rounded-xl border border-stone-200 bg-stone-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-700">เล่มที่ {i + 1}</span>
              <button type="button" onClick={() => onRemove(i)}
                className="inline-flex items-center gap-0.5 text-xs text-stone-400 hover:text-red-700">
                <IconX size={11} />
                ลบ
              </button>
            </div>
            <RadioRowField label="ขนาด" name={`pb-size-${i}`} options={[...PB_SIZES]}
              value={it.size} onChange={(v) => onUpdate(i, { size: v })} />
            <RadioRowField label="เข้าเล่ม" name={`pb-bind-${i}`} options={[...PB_BINDINGS]}
              value={it.binding} onChange={(v) => onUpdate(i, { binding: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="จำนวนเล่ม">
                <input type="number" min={1} value={it.qty} onChange={(e) => onUpdate(i, { qty: e.target.value })}
                  className={`${inputCls} tabular-nums`} />
              </Field>
              <Field label="คำสั่งพิเศษ">
                <input type="text" value={it.special} onChange={(e) => onUpdate(i, { special: e.target.value })}
                  className={inputCls} />
              </Field>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Helpers (UI atoms) ───────────────────────────────────

const inputCls =
  'w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 disabled:bg-stone-50';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      <div className="rounded-xl border border-stone-100 bg-white p-3">{children}</div>
    </section>
  );
}

function Field({
  label, hint, children, className = '',
}: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}

function CB({ checked, onChange, label }: { checked: boolean; onChange: (c: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      <span>{label}</span>
    </label>
  );
}

/** Customer name input with autocomplete dropdown — port of WP
 *  initAutocomplete (production-monitoring.js:5220). Filters
 *  `suggestions` by substring match (case-insensitive), shows up to 12
 *  results, supports keyboard nav (Arrow up/down, Enter, Escape). */
function CustomerAutocomplete({
  value, onChange, suggestions,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: CustomerEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [value, suggestions]);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function pick(c: CustomerEntry) {
    onChange(c.name);
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pick(matches[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        required
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => { if (value.trim()) setOpen(true); }}
        onKeyDown={onKeyDown}
        className={inputCls}
        maxLength={200}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-stone-200 bg-white shadow-lg max-h-64 overflow-y-auto"
        >
          {matches.map((c, i) => (
            <button
              key={`${c.name}-${i}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                i === activeIdx ? 'bg-sky-50 text-sky-900' : 'hover:bg-stone-50'
              }`}
            >
              <span className="truncate">
                <span className="font-medium text-stone-900">{c.name}</span>
                {c.tel && <span className="ml-2 text-[11px] text-stone-500">{c.tel}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RadioRowField({
  label, name, options, value, onChange,
}: {
  label: string; name: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o;
          return (
            <label key={o}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                active ? 'bg-accent/10 border-accent text-accent font-medium' : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300'
              }`}>
              <input type="radio" name={name} checked={active} onChange={() => onChange(o)} className="sr-only" />
              {o}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'text-sky-700 border-sky-500' : 'text-stone-500 border-transparent hover:text-stone-700'
      }`}>
      {label}
    </button>
  );
}

function SuccessView({
  success, onClose, onCreateAnother, isEdit,
}: {
  success: SuccessInfo; onClose: () => void; onCreateAnother: () => void; isEdit: boolean;
}) {
  return (
    <div className="flex flex-col max-h-[90vh]">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
          {success.partial
            ? <IconAlertTriangle size={18} className="text-amber-600" />
            : <IconCheck size={18} className="text-emerald-600" />
          }
          {success.partial ? 'ใบสั่งบันทึกบางส่วน' : isEdit ? 'บันทึกการแก้ไขเรียบร้อย' : 'สร้างใบสั่งงานเสร็จ'}
        </h2>
        <button type="button" onClick={onClose} aria-label="ปิด"
          className="text-stone-400 hover:text-stone-700 w-11 h-11 flex items-center justify-center rounded hover:bg-stone-100">
          <IconX size={20} />
        </button>
      </header>
      <div className="p-5 space-y-3">
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-1.5 text-sm">
          <div><span className="text-stone-600">เลขใบสั่ง:</span>{' '}
            <strong className="tabular-nums text-stone-900">#{success.orderId}</strong></div>
          {success.jobId != null && (
            <div><span className="text-stone-600">Job ID:</span>{' '}
              <strong className="tabular-nums text-stone-900">#{success.jobId}</strong></div>
          )}
          {success.pin && (
            <div><span className="text-stone-600">PIN:</span>{' '}
              <strong className="tabular-nums text-stone-900">{success.pin}</strong></div>
          )}
          {success.cascaded != null && success.cascaded > 0 && (
            <div className="text-stone-600">อัปเดตชื่อ/วันที่ใน Kanban {success.cascaded} job</div>
          )}
        </div>
        {success.warning && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
            <IconAlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{success.warning}</span>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          {!isEdit && (
            <button type="button" onClick={onCreateAnother}
              className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200">
              สร้างใบสั่งใหม่
            </button>
          )}
          <button type="button" onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark">
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </div>
  );
}

const DUP_KIND_BADGE: Record<'draft' | 'active' | 'orphan', { label: string; cls: string }> = {
  active: { label: 'เปิดอยู่', cls: 'bg-amber-100 text-amber-800' },
  draft:  { label: 'ร่างค้าง', cls: 'bg-stone-200 text-stone-600' },
  orphan: { label: 'ไม่มีงานในบอร์ด', cls: 'bg-stone-200 text-stone-600' },
};

function DuplicateView({
  duplicates, onCancel, onForce,
}: {
  duplicates: Array<{ id: number; name: string; customer: string; dateIn: string; kind?: 'draft' | 'active' | 'orphan' }>;
  onCancel: () => void; onForce: () => void;
}) {
  return (
    <div className="flex flex-col max-h-[90vh]">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center gap-2">
        <IconAlertTriangle size={18} className="text-amber-700" />
        <h2 className="text-base font-bold text-amber-700">งานนี้อาจมีใบสั่งงานอยู่แล้ว</h2>
      </header>
      <div className="p-5 space-y-3 overflow-y-auto">
        <p className="text-sm text-stone-700">
          มีใบสั่งงานชื่อและลูกค้าเดียวกันที่ยังทำอยู่ในระบบ — ถ้าตั้งใจสั่งซ้ำ
          กดยืนยันสร้างใบใหม่ได้เลย ใบเดิมจะไม่ถูกแก้ไข
        </p>
        <ul className="rounded-lg border border-amber-200 bg-amber-50/50 divide-y divide-amber-100 text-sm">
          {duplicates.map((d) => {
            const badge = d.kind ? DUP_KIND_BADGE[d.kind] : null;
            return (
            <li key={d.id} className="px-3 py-2">
              <div className="font-medium text-stone-900 flex items-center gap-2">
                <span>#{d.id} <span className="text-stone-500">— {d.name}</span></span>
                {badge && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                )}
              </div>
              <div className="text-xs text-stone-500 mt-0.5">
                ลูกค้า: {d.customer}
                {d.dateIn && <span className="ml-2 tabular-nums">รับ {d.dateIn}</span>}
              </div>
            </li>
            );
          })}
        </ul>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200">
            กลับไปแก้ฟอร์ม
          </button>
          <button type="button" onClick={onForce}
            className="flex-1 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">
            ยืนยัน สร้างใบใหม่
          </button>
        </div>
      </div>
    </div>
  );
}
