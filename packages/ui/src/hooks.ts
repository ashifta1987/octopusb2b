'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Shared behaviour hooks for @octopus/ui client components (T2).
 * All keyboard handling follows Part 2.9 / Appendix B: Tab order, Enter/Space, arrows in groups, Esc closes.
 */

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Controlled / uncontrolled value. */
export function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void): [T, (v: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? (value as T) : inner;
  const set = useCallback(
    (v: T) => {
      if (!controlled) setInner(v);
      onChange?.(v);
    },
    [controlled, onChange],
  );
  return [current, set];
}

/** Calls `handler` on Escape while `active`. */
export function useEscape(active: boolean, handler: () => void) {
  const ref = useRef(handler);
  useIsoLayoutEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        ref.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}

/** Calls `handler` on a pointer-down outside every given element while `active`. */
export function useOutsideClick(refs: RefObject<HTMLElement | null>[], active: boolean, handler: () => void) {
  const ref = useRef(handler);
  useIsoLayoutEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.every((r) => !r.current || !r.current.contains(t))) ref.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // refs are stable objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

export const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('inert') && el.getClientRects().length > 0);
}

/**
 * Traps Tab inside `ref` while `active`; focuses `initialFocus` (or the first focusable, or the container) on open and
 * returns focus to the element that was focused before opening when it closes (Drawer, Modal, Sheet, palette).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, opts: { initialFocus?: RefObject<HTMLElement | null>; returnFocus?: boolean } = {}) {
  const { initialFocus, returnFocus = true } = opts;
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = initialFocus?.current ?? focusables(root)[0] ?? root;
    // after paint so the element is visible
    const raf = requestAnimationFrame(() => first.focus({ preventScroll: false }));
    const onKey = (e: KeyboardEvent) => {
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
      if (e.shiftKey && (cur === a || !root.contains(cur))) {
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
      if (returnFocus && previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active, ref, initialFocus, returnFocus]);
}

/** Locks page scroll while `active` (overlays). */
export function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [active]);
}

/** `true` when the media query matches (false on the server and before mount). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Phones: < 768 px (Part 2.2 breakpoints). */
export const usePhone = () => useMediaQuery('(max-width: 767px)');

export type Hotkey = { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean };
/** Parses "Ctrl+K", "Alt+W", "Ctrl+Shift+Tab", "/" ("Ctrl" also matches ⌘ on macOS). */
export function parseHotkey(combo: string): Hotkey {
  const parts = combo.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const mods = parts.map((p) => p.toLowerCase());
  return { key: key.toLowerCase(), ctrl: mods.includes('ctrl') || mods.includes('mod'), alt: mods.includes('alt'), shift: mods.includes('shift') };
}
export function matchesHotkey(e: KeyboardEvent | React.KeyboardEvent, hk: Hotkey): boolean {
  const k = e.key.toLowerCase();
  return k === hk.key && !!hk.ctrl === (e.ctrlKey || e.metaKey) && !!hk.alt === e.altKey && (hk.shift === undefined || !!hk.shift === e.shiftKey);
}
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/**
 * Global keyboard shortcut. Single keys without modifiers ("/", "N", "J") are ignored while typing in a field.
 */
export function useHotkey(combo: string | string[], handler: (e: KeyboardEvent) => void, opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const ref = useRef(handler);
  useIsoLayoutEffect(() => {
    ref.current = handler;
  });
  const key = Array.isArray(combo) ? combo.join('|') : combo;
  useEffect(() => {
    if (!enabled) return;
    const hks = key.split('|').map(parseHotkey);
    const onKey = (e: KeyboardEvent) => {
      for (const hk of hks) {
        if (!matchesHotkey(e, hk)) continue;
        if (!hk.ctrl && !hk.alt && isTyping(e.target)) return;
        e.preventDefault();
        ref.current(e);
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}

/**
 * Roving focus for a group (tabs, segmented, bottom nav, menus): returns a keydown handler that moves focus between
 * `[data-roving]` items inside the container with arrows, Home and End. `orientation` picks the arrow keys.
 * Disabled items (aria-disabled="true" or disabled) are skipped. Returns the newly focused index via `onMove`.
 */
export function rovingKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  opts: { orientation?: 'horizontal' | 'vertical' | 'both'; loop?: boolean; onMove?: (el: HTMLElement, index: number) => void } = {},
) {
  const { orientation = 'horizontal', loop = true, onMove } = opts;
  const keys: Record<string, number | 'home' | 'end'> = { Home: 'home', End: 'end' };
  if (orientation !== 'vertical') Object.assign(keys, { ArrowRight: 1, ArrowLeft: -1 });
  if (orientation !== 'horizontal') Object.assign(keys, { ArrowDown: 1, ArrowUp: -1 });
  const step = keys[e.key];
  if (step === undefined) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-roving]')).filter(
    (el) => el.getAttribute('aria-disabled') !== 'true' && !(el as HTMLButtonElement).disabled,
  );
  if (!items.length) return;
  e.preventDefault();
  const cur = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (step === 'home') next = 0;
  else if (step === 'end') next = items.length - 1;
  else {
    // in RTL, horizontal arrows are mirrored
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const s = rtl && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') ? -step : step;
    next = cur < 0 ? 0 : cur + s;
    if (loop) next = (next + items.length) % items.length;
    else next = Math.max(0, Math.min(items.length - 1, next));
  }
  items[next].focus();
  onMove?.(items[next], next);
}

/** Calls `fn` after `delay` ms of `value` staying the same. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Persisted UI preference (localStorage), e.g. collapsed sidebar or groups. SSR-safe: starts with `initial`. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the stored preference once after mount
      if (raw != null) setV(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}
