'use client';

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { IconAlertTriangle, IconAlertCircle, IconX } from '@/lib/icons';

/** Custom confirm/prompt dialog system — replaces window.confirm() and
 *  window.prompt() across the app (auditor H10). Native dialogs are
 *  buggy on iOS Safari + can't be styled to match the Penprinting brand.
 *  Use:
 *    const confirm = useConfirm();
 *    if (!await confirm({ title, message })) return;
 *    const reason = await prompt({ title, message, placeholder });
 */

type Variant = 'default' | 'danger' | 'warn';

interface ConfirmOpts {
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
}
interface PromptOpts extends ConfirmOpts {
  placeholder?: string;
  defaultValue?: string;
  rows?: number;
}

interface ConfirmApi {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

interface ActiveDialog {
  kind: 'confirm' | 'prompt';
  opts: PromptOpts;
  resolve: (v: boolean | string | null) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveDialog | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setActive({
          kind: 'confirm',
          opts,
          resolve: (v) => resolve(v === true),
        });
      }),
    [],
  );
  const promptFn = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setActive({
          kind: 'prompt',
          opts,
          resolve: (v) => resolve(typeof v === 'string' ? v : null),
        });
      }),
    [],
  );

  const value: ConfirmApi = { confirm, prompt: promptFn };

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {active && (
        <DialogShell
          dialog={active}
          onClose={(v) => {
            active.resolve(v);
            setActive(null);
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback to native API if Provider missing — keeps callers safe.
    return {
      confirm: async (opts) => window.confirm(opts.title + (opts.message ? '\n\n' + opts.message : '')),
      prompt: async (opts) =>
        window.prompt(opts.title + (opts.message ? '\n\n' + opts.message : ''), opts.defaultValue || ''),
    };
  }
  return ctx;
}

// ─── Dialog shell ─────────────────────────────────────────

const VARIANT_THEME: Record<Variant, { bg: string; text: string; icon: React.ReactNode; ok: string }> = {
  default: {
    bg: 'bg-sky-50', text: 'text-sky-800',
    icon: <IconAlertCircle size={18} />,
    ok: 'bg-sky-600 hover:bg-sky-700 text-white',
  },
  warn: {
    bg: 'bg-amber-50', text: 'text-amber-800',
    icon: <IconAlertTriangle size={18} />,
    ok: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  danger: {
    bg: 'bg-red-50', text: 'text-red-800',
    icon: <IconAlertTriangle size={18} />,
    ok: 'bg-red-600 hover:bg-red-700 text-white',
  },
};

function DialogShell({
  dialog, onClose,
}: {
  dialog: ActiveDialog;
  onClose: (v: boolean | string | null) => void;
}) {
  const { kind, opts } = dialog;
  const variant = opts.variant || 'default';
  const theme = VARIANT_THEME[variant];
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(opts.defaultValue || '');

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    // Focus the input/textarea (prompt) or the OK button (confirm) for keyboard UX.
    setTimeout(() => {
      if (kind === 'prompt' && inputRef.current) inputRef.current.focus();
    }, 50);
  }, [kind]);

  // Backdrop click + ESC = cancel
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') {
        onClose(kind === 'prompt' ? null : false);
      }
    }
    function onCancel(e: Event) {
      e.preventDefault();
      onClose(kind === 'prompt' ? null : false);
    }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose, kind]);

  function submit() {
    if (kind === 'prompt') onClose(value);
    else onClose(true);
  }
  function cancel() {
    onClose(kind === 'prompt' ? null : false);
  }

  return (
    <dialog
      ref={dlgRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-md w-[92vw]"
    >
      <div className="flex flex-col">
        <header className={`px-5 py-3 border-b border-stone-100 flex items-start gap-2.5 ${theme.bg}`}>
          <span className={`flex-shrink-0 mt-0.5 ${theme.text}`}>{theme.icon}</span>
          <div className="flex-grow">
            <h2 className={`text-base font-bold ${theme.text} leading-snug break-words`}>
              {opts.title}
            </h2>
            {opts.message && (
              <p className={`text-sm mt-1 ${theme.text} opacity-90 whitespace-pre-line`}>
                {opts.message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={cancel}
            className={`${theme.text} opacity-60 hover:opacity-100 w-6 h-6 flex items-center justify-center rounded`}
            aria-label="ปิด"
          >
            <IconX size={16} />
          </button>
        </header>

        {kind === 'prompt' && (
          <div className="px-5 py-4">
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder={opts.placeholder}
              rows={opts.rows ?? 3}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y"
            />
          </div>
        )}

        <footer className="px-5 py-3 border-t border-stone-100 bg-stone-50/60 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="px-4 py-2 rounded-lg bg-white border border-stone-200 text-stone-700 text-sm font-medium hover:bg-stone-100"
          >
            {opts.cancelLabel || 'ยกเลิก'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={kind === 'prompt' && !value.trim()}
            className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${theme.ok}`}
          >
            {opts.okLabel || 'ยืนยัน'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
