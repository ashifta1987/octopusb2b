'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';

export type ToastTone = 'neutral' | 'success' | 'danger';

export type ToastOptions = {
  message: ReactNode;
  tone?: ToastTone;
  /** "Undo" wherever the action can be reversed. Clicking it runs `onClick` and closes the toast. */
  action?: { label: string; onClick: () => void };
  /** ms before it closes by itself (paused while hovered or focused). 0 = stays until closed. Default from provider. */
  duration?: number;
};

export type ToastApi = {
  /** Shows a toast; returns its id. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
};

type Item = ToastOptions & { id: number };

const ToastContext = createContext<ToastApi | null>(null);

/** Shows toasts from any client component under a `ToastProvider`. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider>.');
  return ctx;
}

export type ToastProviderProps = {
  children: ReactNode;
  /** Newest toasts push out the oldest beyond this. Default 3. */
  max?: number;
  /** Default auto-close time in ms. Default 6000 (long enough to reach Undo). */
  duration?: number;
  /** false = render the stack in the page flow (docs/demos); default fixed at the bottom. */
  fixed?: boolean;
  /** Phones: sit above the 60 px BottomNav. */
  aboveBottomNav?: boolean;
  /** Name of the live region. Default "Notifications". */
  regionLabel?: string;
  regionTestId?: string;
};

/**
 * Toasts (2.5): navy, at the bottom centre, white text, teal "Undo". The stack (max 3) lives in ONE always-present
 * role="status" region (aria-live="polite"), so every new toast is announced without stealing focus. Auto-close
 * pauses while the pointer is over a toast or focus is inside it; each toast has a close button. z toast.
 * Phones (< 768): full width at the bottom, above the BottomNav when `aboveBottomNav`.
 */
export function ToastProvider({ children, max = 3, duration = 6000, fixed = true, aboveBottomNav, regionLabel = 'Notifications', regionTestId }: ToastProviderProps) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (o: ToastOptions) => {
      const id = next.current++;
      setItems((list) => [...list, { ...o, id }].slice(-max));
      return id;
    },
    [max],
  );
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-label={regionLabel}
        data-testid={regionTestId}
        className={cx(
          'pointer-events-none flex flex-col items-stretch gap-2 ods-tablet:items-center',
          fixed
            ? cx('fixed inset-x-0 z-(--z-toast) px-3 pb-[max(12px,env(safe-area-inset-bottom))] ods-tablet:px-6 ods-tablet:pb-6', aboveBottomNav ? 'bottom-[60px] ods-tablet:bottom-0' : 'bottom-0')
            : 'relative',
        )}
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} duration={t.duration ?? duration} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE_ICON = { neutral: Info, success: CircleCheck, danger: CircleAlert } as const;

function ToastCard({ item, duration, onClose }: { item: Item; duration: number; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const started = useRef(0);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!duration || paused) return;
    started.current = Date.now();
    const t = setTimeout(() => close.current(), remaining.current);
    return () => {
      clearTimeout(t);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started.current));
    };
  }, [paused, duration]);
  const tone = item.tone ?? 'neutral';
  return (
    <div
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      className={cx(
        'pointer-events-auto flex min-h-ods-control w-full items-center gap-3 rounded-ods-control bg-ods-navy ps-3 text-ods-body text-white shadow-ods-pop ods-tablet:w-auto ods-tablet:max-w-[520px]',
        'transition-[opacity,translate] duration-(--ods-motion) ease-ods starting:translate-y-2 starting:opacity-0',
      )}
    >
      <Icon icon={TONE_ICON[tone]} className={tone === 'danger' ? 'text-ods-danger-tint' : 'text-ods-teal'} />
      <span className="min-w-0 flex-1 py-1">
        {tone === 'danger' ? <span className="sr-only">Error: </span> : null}
        {item.message}
      </span>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            onClose();
          }}
          className="h-ods-control shrink-0 rounded-ods-control px-2 font-semibold text-ods-teal underline-offset-4 hover:underline"
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" aria-label="Dismiss notification" onClick={onClose} className="inline-grid size-ods-control shrink-0 place-items-center rounded-ods-control text-white hover:bg-white/10">
        <Icon icon={X} />
      </button>
    </div>
  );
}
