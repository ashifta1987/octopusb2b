'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { focusables } from '../hooks';

/**
 * Internal overlay plumbing for Drawer and Modal (not exported from a barrel).
 *
 *  - `OverlayPortal` renders its children at the end of the nearest `[data-theme="ods"]` root (so tokens still apply
 *    and no ancestor `overflow`/`transform` can clip a fixed overlay), and copies the density of the place it was
 *    rendered from (a Drawer opened from a compact panel stays compact).
 *  - `useOverlayLayer` keeps a stack of open overlays. Only the TOP layer handles Esc and traps Tab, so a Modal opened
 *    on top of a Drawer (the unsaved-changes guard) behaves on its own. Focus moves in on open and goes back to the
 *    element that was focused before (the trigger) on close.
 *  - Body scroll is locked with a counter, so stacked overlays restore the page correctly in any unmount order.
 */

const layers: object[] = [];
let locks = 0;
let savedOverflow = '';

export function OverlayPortal({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<{ el: HTMLElement; density: string | null } | null>(null);
  useEffect(() => {
    const a = anchor.current;
    if (!a) return;
    const root = a.closest<HTMLElement>('[data-theme="ods"]') ?? document.body;
    const density = a.closest('[data-density]')?.getAttribute('data-density') ?? null;
    setTarget({ el: root, density });
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {target && children ? createPortal(<div data-density={target.density ?? undefined}>{children}</div>, target.el) : null}
    </>
  );
}

export function useOverlayLayer(
  ref: RefObject<HTMLElement | null>,
  opts: { onEscape: () => void; initialFocus?: () => HTMLElement | null | undefined },
) {
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const token = {};
    layers.push(token);
    if (locks++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const previous = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const first = latest.current.initialFocus?.() ?? focusables(root)[0] ?? root;
      first.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (layers[layers.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables(root);
      if (!els.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const a = els[0];
      const z = els[els.length - 1];
      const cur = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (cur === a || cur === root || !root.contains(cur))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (cur === z || !root.contains(cur))) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      const i = layers.indexOf(token);
      if (i >= 0) layers.splice(i, 1);
      if (--locks === 0) document.body.style.overflow = savedOverflow;
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref]);
}
