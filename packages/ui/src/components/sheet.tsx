'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { useEscape, useFocusTrap, useLockBodyScroll } from '../hooks';
import { IconButton } from './button';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  /** Required: names the dialog (aria-labelledby) and is shown at the top. */
  title: ReactNode;
  description?: ReactNode;
  /** bottom = bottom sheet (More, Categories); full = full-screen sheet (Filters, menus). */
  variant?: 'bottom' | 'full';
  children?: ReactNode;
  /** Sticky footer (e.g. "Show 24 results"). */
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** The browser/phone Back button closes the sheet (adds one history entry while open). Default true. */
  closeOnBack?: boolean;
  /** Heading level of the title (default 2). */
  headingLevel?: 2 | 3;
  testId?: string;
  className?: string;
};

/**
 * Sheet (phones): bottom sheet or full-screen sheet. role="dialog" aria-modal with the title as its name; drag handle
 * (visual only), close button; Esc, Back, the close button and a tap on the backdrop close it; focus is trapped inside
 * and returns to the element that opened it; page scroll is locked while open.
 * Renders in place (fixed), so it keeps the ODS theme and density of where it is used.
 * Desktop: works the same (bottom sheet is max 640 px wide, centred); desktop pages usually use Drawer/Modal instead.
 */
export function Sheet({ open, onClose, title, description, variant = 'bottom', children, footer, initialFocusRef, closeOnBack = true, headingLevel = 2, testId, className }: SheetProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEscape(open, onClose);
  useFocusTrap(panelRef, open, { initialFocus: initialFocusRef ?? panelRef });
  useLockBodyScroll(open);

  // Back closes: push one entry while open; popping it closes the sheet.
  useEffect(() => {
    if (!open || !closeOnBack) return;
    const key = `ods-sheet-${id}`;
    window.history.pushState({ ...(window.history.state ?? {}), odsSheet: key }, '');
    const onPop = (e: PopStateEvent) => {
      if ((e.state as { odsSheet?: string } | null)?.odsSheet !== key) closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if ((window.history.state as { odsSheet?: string } | null)?.odsSheet === key) window.history.back();
    };
  }, [open, closeOnBack, id]);

  if (!open) return null;
  const H = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className="fixed inset-0 z-(--z-modal)">
      <div aria-hidden className="absolute inset-0 bg-ods-navy/50" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-testid={testId}
        data-variant={variant}
        className={cx(
          'absolute flex flex-col bg-ods-surface text-ods-text shadow-ods-dialog',
          variant === 'bottom' ? 'inset-x-0 bottom-0 mx-auto max-h-[85dvh] w-full max-w-[640px] rounded-t-[16px]' : 'inset-0',
          className,
        )}
      >
        {variant === 'bottom' ? <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-ods-pill bg-ods-line-strong" /> : null}
        <div className={cx('flex shrink-0 items-center gap-3 px-4', variant === 'bottom' ? 'pt-1 pb-2' : 'border-b border-ods-line py-2')}>
          <div className="min-w-0 flex-1">
            <H id={titleId} className="text-ods-h2 font-bold text-ods-navy">
              {title}
            </H>
            {description ? (
              <p id={descId} className="text-ods-small text-ods-slate">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} tooltipSide="start" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? <div className="shrink-0 border-t border-ods-line bg-ods-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </div>
    </div>
  );
}
