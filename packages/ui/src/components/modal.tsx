'use client';

import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { Button, IconButton } from './button';
import { OverlayPortal, useOverlayLayer } from './overlay';

export type ModalProps = {
  open: boolean;
  /** Called by Esc, the ✕ button, Cancel and (non-destructive only, by default) a backdrop click. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Custom footer. Put the safe button first; it gets the initial focus (or mark one with `data-autofocus`). */
  footer?: ReactNode;
  /** Element to focus on open. Default: `[data-autofocus]`, else the first footer button (Cancel), else ✕. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** sm = 420 px (confirmations), md = 560 px. */
  size?: 'sm' | 'md';
  /** Red confirm button, role="alertdialog", and the backdrop does NOT close it (an explicit choice is needed). */
  destructive?: boolean;
  /** Built-in footer: the confirm button label, named after the action ("Cancel invoice", never "OK"). */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** Built-in footer: the safe button. Default "Cancel"; name it after what stays ("Keep invoice") when clearer. */
  cancelLabel?: string;
  /** Built-in footer: confirm button is busy. */
  loading?: boolean;
  loadingText?: string;
  /** Override the backdrop rule (default: closes unless `destructive`). */
  closeOnBackdrop?: boolean;
  'data-testid'?: string;
};

/**
 * Modal (2.5): ONLY to confirm something that can't be undone. role="dialog" (role="alertdialog" when destructive),
 * aria-modal, labelled by its title and described by its description. Focus is trapped (Tab / Shift+Tab cycle inside),
 * starts on the safest button (Cancel) and returns to the trigger on close. Esc and ✕ always close.
 * Backdrop click closes non-destructive modals only: a destructive decision needs an explicit Cancel / ✕ / Esc, so a
 * stray click never dismisses the question the user was reading. Stacks above a Drawer (z modal).
 * Phones (< 768): a bottom-aligned, full-width sheet with full-width stacked buttons (Cancel first).
 */
export function Modal(props: ModalProps) {
  return <OverlayPortal>{props.open ? <ModalPanel {...props} /> : null}</OverlayPortal>;
}

function ModalPanel({
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  size = 'sm',
  destructive,
  confirmLabel,
  onConfirm,
  cancelLabel = 'Cancel',
  loading,
  loadingText,
  closeOnBackdrop,
  'data-testid': testId,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useOverlayLayer(ref, {
    onEscape: onClose,
    initialFocus: () =>
      initialFocusRef?.current ?? ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? footerRef.current?.querySelector<HTMLElement>('button, a[href]') ?? null,
  });
  const backdrop = closeOnBackdrop ?? !destructive;
  const builtIn =
    footer ??
    (confirmLabel ? (
      <>
        <Button variant="secondary" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} loadingText={loadingText}>
          {confirmLabel}
        </Button>
      </>
    ) : null);
  return (
    <div className="fixed inset-0 z-(--z-modal) flex items-end justify-center ods-tablet:items-center ods-tablet:p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-ods-navy/50 transition-opacity duration-(--ods-motion) starting:opacity-0" onClick={backdrop ? onClose : undefined} />
      <div
        ref={ref}
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[90dvh] w-full flex-col rounded-t-ods-card bg-ods-surface text-ods-text shadow-ods-dialog ods-tablet:rounded-ods-card',
          'transition-[opacity,translate] duration-(--ods-motion) ease-ods starting:translate-y-4 starting:opacity-0',
          size === 'sm' ? 'ods-tablet:max-w-[420px]' : 'ods-tablet:max-w-[560px]',
        )}
      >
        <div className="flex items-start gap-3 px-ods-pad-card pt-4 pb-3">
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={titleId} className="text-ods-h2 font-bold text-ods-navy">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-ods-body text-ods-slate">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon={X} label="Close" tooltipSide="start" onClick={onClose} className="-me-2 -mt-1" />
        </div>
        {children ? <div className="min-h-0 overflow-y-auto px-ods-pad-card pb-4">{children}</div> : null}
        {builtIn ? (
          <div
            ref={footerRef}
            className="flex flex-col gap-2 border-t border-ods-line px-ods-pad-card pt-3 pb-[max(12px,env(safe-area-inset-bottom))] ods-tablet:flex-row ods-tablet:justify-end ods-tablet:pb-3 [&>*]:w-full ods-tablet:[&>*]:w-auto"
          >
            {builtIn}
          </div>
        ) : null}
      </div>
    </div>
  );
}
