'use client';

import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { useHotkey, focusables } from '../hooks';
import { IconButton } from './button';
import { Modal } from './modal';
import { OverlayPortal, useOverlayLayer } from './overlay';

export type DrawerProps = {
  open: boolean;
  /** Called after the unsaved-changes guard (Esc, ✕, backdrop) or directly when not `dirty`. */
  onClose: () => void;
  title: ReactNode;
  /** One line under the title (record status, customer …). */
  description?: ReactNode;
  children: ReactNode;
  /** Sticky footer (Save / Cancel + shortcut hints). */
  footer?: ReactNode;
  /** 380 = comfortable (mini-cart), 460 = compact edit (Back Office). Full width on phones either way. */
  width?: 380 | 460;
  /** Always the inline end (right in LTR, left in RTL). */
  side?: 'end';
  /** When true, closing asks "Discard unsaved changes?" first. */
  dirty?: boolean;
  /** Ctrl S (⌘ S) calls this while the drawer is open. */
  onSave?: () => void;
  /** Extra header buttons before ✕ (e.g. "Open in a tab"). */
  actions?: ReactNode;
  /** Sticky row under the header, e.g. Tabs. */
  subheader?: ReactNode;
  /** Element to focus on open. Default: the first focusable in the body, else ✕. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Accessible name of the close button. */
  closeLabel?: string;
  'data-testid'?: string;
};

/**
 * Drawer (2.5): slides in from the inline end; 380 px (comfortable) or 460 px (compact edit). role="dialog",
 * aria-modal, labelled by its title. Focus is trapped and starts on the first field; Esc / ✕ / backdrop close it and
 * focus returns to the trigger. With `dirty`, closing asks "Discard unsaved changes?" (Keep editing / Discard) in a
 * Modal stacked on top. Ctrl S calls `onSave` only while open. Sticky header and footer, scrolling body. z drawer.
 * Phones (< 768): full width and full height (a full-screen sheet); the footer stays at the bottom.
 */
export function Drawer(props: DrawerProps) {
  return <OverlayPortal>{props.open ? <DrawerPanel {...props} /> : null}</OverlayPortal>;
}

function DrawerPanel({
  onClose,
  title,
  description,
  children,
  footer,
  width = 380,
  dirty,
  onSave,
  actions,
  subheader,
  initialFocusRef,
  closeLabel = 'Close',
  'data-testid': testId,
}: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const [confirm, setConfirm] = useState(false);
  const requestClose = () => (dirty ? setConfirm(true) : onClose());
  useOverlayLayer(ref, {
    onEscape: requestClose,
    initialFocus: () => initialFocusRef?.current ?? (bodyRef.current ? focusables(bodyRef.current)[0] : null),
  });
  useHotkey('Ctrl+S', () => onSave?.(), { enabled: !!onSave && !confirm });
  return (
    <div className="fixed inset-0 z-(--z-drawer)">
      <div aria-hidden="true" className="absolute inset-0 bg-ods-navy/40 transition-opacity duration-(--ods-motion) starting:opacity-0" onClick={requestClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
        tabIndex={-1}
        className={cx(
          'absolute inset-y-0 end-0 flex w-full max-w-full flex-col bg-ods-surface text-ods-text shadow-ods-dialog',
          'transition-transform duration-(--ods-motion) ease-ods starting:translate-x-full rtl:starting:-translate-x-full',
          width === 460 ? 'ods-tablet:w-[460px]' : 'ods-tablet:w-[380px]',
        )}
      >
        <div className="flex flex-none items-start gap-2 border-b border-ods-line px-ods-pad-card py-3">
          <div className="min-w-0 flex-1 self-center">
            <h2 id={titleId} className="truncate text-ods-h2 font-bold text-ods-navy">
              {title}
            </h2>
            {description ? (
              <div id={descId} className="mt-0.5 text-ods-small text-ods-slate">
                {description}
              </div>
            ) : null}
          </div>
          {actions}
          <IconButton icon={X} label={closeLabel} tooltipSide="start" onClick={requestClose} />
        </div>
        {subheader ? <div className="flex-none border-b border-ods-line px-ods-pad-card">{subheader}</div> : null}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-ods-pad-card py-4">
          {children}
        </div>
        {footer ? <div className="flex-none border-t border-ods-line bg-ods-surface px-ods-pad-card pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div> : null}
        <Modal
          open={confirm}
          onClose={() => setConfirm(false)}
          title="Discard unsaved changes?"
          description="The changes you made in this panel will be lost."
          destructive
          cancelLabel="Keep editing"
          confirmLabel="Discard"
          onConfirm={() => {
            setConfirm(false);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
