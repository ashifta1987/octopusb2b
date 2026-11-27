'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useOutsideClick } from '../hooks';
import { orderMenuItems } from '../grid-state';

export type ContextMenuItem = {
  id: string;
  label?: string;
  icon?: LucideIcon;
  /** Shortcut hint shown on the right, e.g. "Ctrl ↵". */
  shortcut?: string;
  onSelect?: () => void;
  /** Red, and always moved to the end after a separator (Part 7.2). */
  destructive?: boolean;
  disabled?: boolean;
  /** Shown under a disabled item (disabled things always say why). */
  disabledReason?: string;
  /** A divider line instead of an item. */
  separator?: boolean;
};

/** Where to open: a pointer position (right-click) or an element (⋯ button / Shift+F10). */
export type ContextMenuAnchor = { x: number; y: number } | HTMLElement;

export type ContextMenuProps = {
  open: boolean;
  onClose: () => void;
  items: ContextMenuItem[];
  anchor: ContextMenuAnchor | null;
  /** Accessible name, e.g. "Actions for INV-1042". */
  label: string;
  /** Element that gets focus back on close (defaults to whatever was focused when the menu opened). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  'data-testid'?: string;
};

const GAP = 4;

/**
 * ContextMenu (2.5 / 7.2): right-click, the ⋯ button or Shift+F10 opens it.
 * role="menu" with role="menuitem" items; ↑ ↓ move (looping), Home/End, Enter/Space choose, Esc or Tab closes and focus
 * returns to the trigger. Items: icon, shortcut hint, separators; destructive items last, in red. Disabled items stay
 * focusable (aria-disabled) and show their reason. Rendered position:fixed and clamped inside the viewport (flips
 * above/start when there's no room) — no portal, so it keeps the ODS theme and density of where it is used.
 * Phones: the same menu (opened by ⋯; there is no right-click), clamped to the screen width with 44 px rows.
 */
export function ContextMenu({ open, onClose, items, anchor, label, returnFocusRef, className, 'data-testid': testId = 'contextmenu' }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  const ordered = orderMenuItems(items);

  // remember the trigger, place the menu (directly on the DOM: it needs its own measured size), focus the first item
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    prevFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    const el = ref.current;
    if (!el) return;
    placeMenu(el, anchor);
    const first = el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? el.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
  }, [open, anchor]);

  const close = (restore = true) => {
    onClose();
    if (!restore) return;
    const target = returnFocusRef?.current ?? prevFocus.current;
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  };

  useOutsideClick([ref], open, () => close(false));

  useEffect(() => {
    if (!open) return;
    // a menu opened from a button follows it when the page scrolls; a right-click menu closes
    const onScroll = (e: Event) => {
      const el = ref.current;
      if (!el || (e.target instanceof Node && el.contains(e.target))) return;
      if (anchor instanceof HTMLElement) {
        const r = anchor.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) onClose();
        else placeMenu(el, anchor);
      } else onClose();
    };
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, anchor]);

  if (!open || !anchor) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = els.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(i + 1);
      case 'ArrowUp':
        return move(i < 0 ? els.length - 1 : i - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(els.length - 1);
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        return close();
      case 'Tab':
        e.preventDefault();
        return close();
      default:
        // type-ahead: first item starting with the typed letter
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const k = e.key.toLowerCase();
          const start = i + 1;
          const hit = [...els.slice(start), ...els.slice(0, start)].find((el) => el.textContent?.trim().toLowerCase().startsWith(k));
          if (hit) {
            e.preventDefault();
            hit.focus();
          }
        }
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      data-testid={testId}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ top: 0, left: 0, visibility: 'hidden' }}
      className={cx(
        'fixed z-(--z-dropdown) max-w-[calc(100vw-8px)] min-w-56 rounded-ods-control border border-ods-line bg-ods-surface py-1 text-ods-body text-ods-text shadow-ods-pop',
        className,
      )}
    >
      {ordered.map((item, idx) =>
        item.separator ? (
          <div key={item.id + idx} role="separator" className="my-1 h-px bg-ods-line" />
        ) : (
          <MenuRow key={item.id} item={item as ContextMenuItem} reasonId={`${id}-${item.id}-reason`} onDone={() => close()} />
        ),
      )}
    </div>
  );
}

/** Places the menu next to the anchor, flipping above / to the start when there's no room, clamped to the viewport. */
function placeMenu(el: HTMLElement, anchor: ContextMenuAnchor) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const { width, height } = el.getBoundingClientRect();
  const rtl = getComputedStyle(el).direction === 'rtl';
  let top: number;
  let left: number;
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    top = r.bottom + GAP;
    if (top + height > vh - GAP) top = r.top - height - GAP;
    left = rtl ? r.left : r.right - width; // align to the trigger's end edge
  } else {
    top = anchor.y;
    left = rtl ? anchor.x - width : anchor.x;
    if (top + height > vh - GAP) top = anchor.y - height;
    if (left + width > vw - GAP) left = anchor.x - width;
  }
  el.style.top = `${Math.max(GAP, Math.min(top, vh - height - GAP))}px`;
  el.style.left = `${Math.max(GAP, Math.min(left, vw - width - GAP))}px`;
  el.style.visibility = 'visible';
}

function MenuRow({ item, reasonId, onDone }: { item: ContextMenuItem; reasonId: string; onDone: () => void }) {
  const choose = () => {
    if (item.disabled) return;
    onDone();
    item.onSelect?.();
  };
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={item.disabled || undefined}
      aria-describedby={item.disabled && item.disabledReason ? reasonId : undefined}
      onClick={choose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      }}
      className={cx(
        'mx-1 flex min-h-ods-control cursor-default items-center gap-2 rounded-[4px] px-2 outline-offset-[-3px] select-none',
        item.disabled ? 'cursor-not-allowed text-ods-slate' : item.destructive ? 'text-ods-danger hover:bg-ods-danger-tint focus:bg-ods-danger-tint' : 'hover:bg-ods-blue-tint focus:bg-ods-blue-tint',
      )}
    >
      {item.icon ? <Icon icon={item.icon} /> : <span aria-hidden className="size-ods-icon shrink-0" />}
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="truncate">{item.label}</span>
        {item.disabled && item.disabledReason ? (
          <span id={reasonId} className="text-ods-small text-ods-slate">
            {item.disabledReason}
          </span>
        ) : null}
      </span>
      {item.shortcut ? (
        <kbd aria-hidden className="ms-4 font-ods text-ods-small text-ods-slate">
          {item.shortcut}
        </kbd>
      ) : null}
    </div>
  );
}

/** Small helper for a ⋯ trigger + menu pair: returns props for both. */
export function useContextMenu() {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  return {
    open: anchor !== null,
    anchor,
    openAt: (a: ContextMenuAnchor) => setAnchor(a),
    onClose: () => setAnchor(null),
  };
}
