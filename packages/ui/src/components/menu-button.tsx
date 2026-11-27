'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { rovingKeyDown, useOutsideClick } from '../hooks';
import { buttonClass } from '../styles';

export type MenuButtonItem = {
  id: string;
  label: ReactNode;
  icon?: LucideIcon;
  /** Renders the item as a link. */
  href?: string;
  target?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Shown under the label when disabled (2.6: disabled things say why). */
  disabledReason?: string;
  description?: ReactNode;
  /** Radio-style choice (company switcher, app switcher): renders role="menuitemradio" with aria-checked. */
  checked?: boolean;
  /** Current page (links): aria-current="page" and bold. */
  current?: boolean;
  destructive?: boolean;
  /** Keyboard hint shown at the end, e.g. "N". */
  shortcut?: string;
  separatorBefore?: boolean;
};

export type MenuButtonProps = {
  /** Visible trigger content. */
  label: ReactNode;
  /** Accessible name when the visible label is not enough (icon-only trigger, initials …). */
  triggerAriaLabel?: string;
  items: MenuButtonItem[];
  /** Name of the menu (aria-label); defaults to the trigger's name. */
  menuLabel?: string;
  align?: 'start' | 'end';
  /** Opens above the trigger (bottom bars). */
  side?: 'bottom' | 'top';
  /** Replaces the default ghost button classes of the trigger. */
  triggerClassName?: string;
  menuClassName?: string;
  showChevron?: boolean;
  /** Extra content at the top of the menu (e.g. signed-in user). */
  header?: ReactNode;
  /** Trigger shows the selected style (e.g. More ▾ holds the current page). */
  triggerCurrent?: boolean;
  onOpenChange?: (open: boolean) => void;
  testId?: string;
  className?: string;
};

/**
 * MenuButton (shared nav primitive): a button with aria-haspopup="menu" / aria-expanded / aria-controls that opens a
 * role="menu" list. Keyboard: Enter/Space/↓ opens and focuses the first item (↑ the last); ↑ ↓ Home End move; Esc or Tab
 * closes and returns focus to the trigger; click outside closes. Items are links (href) or buttons (onSelect);
 * disabled items stay focusable and show their reason.
 * Phones: same dropdown (at most 320 px wide).
 */
export function MenuButton({
  label,
  triggerAriaLabel,
  items,
  menuLabel,
  align = 'start',
  side = 'bottom',
  triggerClassName,
  menuClassName,
  showChevron = true,
  header,
  triggerCurrent,
  onOpenChange,
  testId,
  className,
}: MenuButtonProps) {
  const id = useId();
  const menuId = `${id}-menu`;
  const triggerId = `${id}-trigger`;
  const [open, setOpenState] = useState(false);
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useOutsideClick([wrapRef], open, () => close(false));

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? []);
      const el = focusOnOpen.current === 'last' ? els[els.length - 1] : els[0];
      el?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusOnOpen.current = e.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
    }
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    rovingKeyDown(e, { orientation: 'vertical', loop: true });
  };

  const itemClass = (it: MenuButtonItem) =>
    cx(
      'flex w-full min-h-ods-control items-center gap-3 rounded-ods-control px-3 py-1 text-start text-ods-table no-underline',
      'hover:bg-ods-blue-tint focus-visible:bg-ods-blue-tint',
      it.destructive ? 'text-ods-danger' : 'text-ods-navy',
      it.current && 'font-bold',
      it.disabled && 'cursor-not-allowed text-ods-slate hover:bg-transparent',
    );

  const inner = (it: MenuButtonItem, reasonId: string) => (
    <>
      {it.checked !== undefined ? (
        <span className="inline-grid size-ods-icon place-items-center">{it.checked ? <Icon icon={Check} className="text-ods-blue" /> : null}</span>
      ) : it.icon ? (
        <Icon icon={it.icon} />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{it.label}</span>
        {it.description ? <span className="block text-ods-small text-ods-slate">{it.description}</span> : null}
        {it.disabled && it.disabledReason ? (
          <span id={reasonId} className="block text-ods-small text-ods-slate">
            {it.disabledReason}
          </span>
        ) : null}
      </span>
      {it.shortcut ? <kbd className="font-ods text-ods-small text-ods-slate">{it.shortcut}</kbd> : null}
    </>
  );

  return (
    <div ref={wrapRef} className={cx('relative inline-flex', className)} data-testid={testId}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerAriaLabel}
        onClick={() => {
          focusOnOpen.current = 'first';
          setOpen(!open);
        }}
        onKeyDown={onTriggerKey}
        className={triggerClassName ?? cx(buttonClass('ghost', 'md'), 'px-3', triggerCurrent && 'font-bold')}
      >
        {label}
        {showChevron ? <Icon icon={ChevronDown} className={cx('transition-transform duration-(--ods-motion-fast)', open && 'rotate-180')} /> : null}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          aria-labelledby={menuLabel ? undefined : triggerId}
          onKeyDown={onMenuKey}
          className={cx(
            'absolute z-(--z-dropdown) w-max max-w-80 min-w-56 rounded-ods-card border border-ods-line bg-ods-surface p-1 text-ods-navy shadow-ods-pop',
            side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
            align === 'start' ? 'start-0' : 'end-0',
            menuClassName,
          )}
        >
          {header ? <div className="border-b border-ods-line px-3 py-2 text-ods-small text-ods-slate">{header}</div> : null}
          {items.map((it) => {
            const reasonId = `${id}-${it.id}-reason`;
            const common = {
              role: it.checked !== undefined ? 'menuitemradio' : 'menuitem',
              'aria-checked': it.checked,
              'aria-disabled': it.disabled || undefined,
              'aria-describedby': it.disabled && it.disabledReason ? reasonId : undefined,
              tabIndex: -1,
              'data-roving': '',
              className: itemClass(it),
            } as const;
            return (
              <div key={it.id} role="none" className={cx(it.separatorBefore && 'mt-1 border-t border-ods-line pt-1')}>
                {it.href && !it.disabled ? (
                  <Link
                    {...common}
                    href={it.href}
                    target={it.target}
                    aria-current={it.current ? 'page' : undefined}
                    onClick={() => {
                      it.onSelect?.();
                      close(false);
                    }}
                  >
                    {inner(it, reasonId)}
                  </Link>
                ) : (
                  <button
                    {...common}
                    type="button"
                    onClick={() => {
                      if (it.disabled) return;
                      close(true);
                      it.onSelect?.();
                    }}
                  >
                    {inner(it, reasonId)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
