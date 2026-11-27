'use client';

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { cx } from '../cx';
import { Icon, ODS_SERVICE_ICONS } from '../icon';
import { odsServices, type OdsServiceKey } from '../tokens';
import { pickCurrentSection } from '../selection-logic';
import { INSET_RING, SCROLL_ROW, useRowScroll } from './selection-shared';

export type JumpBarSection = {
  service: OdsServiceKey;
  /** id of the section (or of its heading) on the page. Focus goes to the section's first h2–h4 (or the element). */
  targetId: string;
  count?: number;
  /** Overrides the service name. */
  label?: string;
};

export type JumpBarProps = {
  sections: JumpBarSection[];
  /** nav aria-label (unique per page). Default "Shop sections". */
  label?: string;
  /** Sticky under the shop header (default true); pass false to render inline (demos). */
  sticky?: boolean;
  /** Sticky offset = the header height (number = px). Also used as the in-view line for aria-current. */
  stickyTop?: number;
  className?: string;
  'data-testid'?: string;
};

// literal classes so Tailwind sees them; icon + name always (never colour alone)
const SVC_TEXT: Record<OdsServiceKey, string> = {
  sourcing: 'text-ods-svc-sourcing',
  pools: 'text-ods-svc-pools',
  dropship: 'text-ods-svc-dropship',
  '3pl': 'text-ods-svc-3pl',
  turnkey: 'text-ods-svc-turnkey',
  brand: 'text-ods-svc-brand',
};

/** Focus the section heading (made focusable with tabIndex -1) and scroll it to the top. */
function jumpTo(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const heading = /^H[1-6]$/.test(target.tagName) ? target : (target.querySelector<HTMLElement>('h2, h3, h4') ?? target);
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  heading.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/**
 * JumpBar, Part 2.5: shop main page. Pill links (FilterPills look) to the six service sections, each with the
 * service icon + name (from `odsServices` / `ODS_SERVICE_ICONS`) and a count.
 * - Click / Enter: moves focus to the section heading (tabIndex -1 added) and scrolls it into view (the link's
 *   href="#id" still works without JS). Give the sections `scroll-margin-top` ≥ the sticky offset.
 * - `aria-current="location"` marks the section in view (IntersectionObserver), with the navy fill as the visual.
 * - Sticky under the header by default (`sticky={false}` renders inline). Phones: the row scrolls sideways and the
 *   current pill is kept in view.
 */
export function JumpBar({ sections, label = 'Shop sections', sticky = true, stickyTop = 0, className, 'data-testid': testId }: JumpBarProps) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  useRowScroll(rowRef, '[aria-current]', currentId);
  const ids = sections.map((s) => s.targetId).join('|');
  // after a click the chosen section stays current (while it is on screen) until the user scrolls on their own:
  // near the page end the target can't reach the top, so "first section in view" would point at an earlier one
  const pinned = useRef<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const order = ids.split('|');
    const visible: Record<string, boolean> = {};
    const onScreen: Record<string, boolean> = {};
    const update = () => {
      const pin = pinned.current;
      setCurrentId((prev) => (pin && onScreen[pin] !== false ? pin : pickCurrentSection(order, visible, prev)));
    };
    const unpin = () => {
      if (!pinned.current) return;
      pinned.current = null;
      update();
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible[e.target.id] = e.isIntersecting;
        update();
      },
      // a section counts as "in view" while it crosses the band just under the sticky bar
      { rootMargin: `-${stickyTop + 56}px 0px -55% 0px` },
    );
    const screenIo = new IntersectionObserver((entries) => {
      for (const e of entries) onScreen[e.target.id] = e.isIntersecting;
    });
    order.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        io.observe(el);
        screenIo.observe(el);
      }
    });
    const opts = { passive: true } as const;
    window.addEventListener('wheel', unpin, opts);
    window.addEventListener('touchmove', unpin, opts);
    return () => {
      io.disconnect();
      screenIo.disconnect();
      window.removeEventListener('wheel', unpin);
      window.removeEventListener('touchmove', unpin);
    };
  }, [ids, stickyTop]);

  const style: CSSProperties | undefined = sticky ? { top: stickyTop } : undefined;
  const onClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    pinned.current = id;
    setCurrentId(id);
    jumpTo(id);
  };

  return (
    <nav aria-label={label} data-testid={testId} className={cx('min-w-0 bg-ods-surface py-2', sticky && 'sticky z-(--z-sticky) border-b border-ods-line', className)} style={style}>
      <ul ref={rowRef} className={cx(SCROLL_ROW, 'gap-2 py-0.5')}>
        {sections.map((s) => {
          const svc = odsServices.find((x) => x.key === s.service);
          const on = s.targetId === currentId;
          return (
            <li key={s.targetId} className="shrink-0">
              <a
                href={`#${s.targetId}`}
                aria-current={on ? 'location' : undefined}
                onClick={(e) => onClick(e, s.targetId)}
                className={cx(
                  'inline-flex h-[calc(var(--ods-control-h)-4px)] items-center gap-1.5 rounded-ods-pill border px-3 whitespace-nowrap',
                  'text-ods-label font-semibold no-underline transition-colors duration-(--ods-motion) ease-ods',
                  INSET_RING,
                  on ? 'border-ods-navy bg-ods-navy text-white hover:bg-ods-navy-hover' : 'border-ods-line-strong bg-ods-surface text-ods-text hover:border-ods-navy hover:bg-ods-canvas',
                )}
              >
                <Icon icon={ODS_SERVICE_ICONS[s.service]} size="auto" className={on ? 'text-white' : SVC_TEXT[s.service]} />
                <span>{s.label ?? svc?.name ?? s.service}</span>
                {s.count != null ? <span className={cx('tabular-nums', on ? 'text-white' : 'text-ods-slate')}>{s.count}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
