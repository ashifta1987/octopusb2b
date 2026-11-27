'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, type FocusEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useControllable, useEscape, useOutsideClick, usePhone } from '../hooks';
import { Sheet } from './sheet';

export type MegaMenuLink = { label: string; href: string; description?: string; icon?: LucideIcon; target?: string };
export type MegaMenuColumn = { title: string; href?: string; icon?: LucideIcon; links: MegaMenuLink[] };
export type MegaMenuPromo = { eyebrow?: string; title: string; body?: string; href: string; linkLabel: string };

export type MegaMenuProps = {
  /** Trigger text, e.g. "Services" or "All categories". */
  label: ReactNode;
  /** Up to four columns. */
  columns: MegaMenuColumn[];
  /** One promoted box at the end. */
  promo?: MegaMenuPromo;
  /** Name of the panel region (defaults to the label when it is a string). */
  panelLabel?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerIcon?: LucideIcon;
  /** Replaces the trigger classes. */
  triggerClassName?: string;
  /** Trigger is selected (e.g. a category page is open). */
  triggerCurrent?: boolean;
  /** Text shown when there are no columns (empty state). */
  emptyText?: string;
  testIds?: { trigger?: string; panel?: string };
};

/**
 * MegaMenu (introduction site and Shop): opens on click (not hover). The trigger is a button with aria-expanded and
 * aria-controls; on open, focus moves to the first link; Tab moves through links in reading order; Esc closes and returns
 * focus to the trigger; a click outside or tabbing out closes it.
 * Layout: four columns + one promoted box, full width of the nearest positioned ancestor (put it inside a `relative` or
 * `sticky` bar — PublicHeader and SectionBar are). Phones (< 768 px): opens as a full-screen Sheet with the columns stacked.
 */
export function MegaMenu({
  label,
  columns,
  promo,
  panelLabel,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  triggerIcon,
  triggerClassName,
  triggerCurrent,
  emptyText = 'Nothing to show yet.',
  testIds,
}: MegaMenuProps) {
  const id = useId();
  const panelId = `${id}-panel`;
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange);
  const phone = usePhone();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const name = panelLabel ?? (typeof label === 'string' ? label : undefined);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };
  useEscape(open && !phone, () => close(true));
  useOutsideClick([triggerRef, panelRef], open && !phone, () => close(false));

  useEffect(() => {
    if (!open || phone) return;
    const raf = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, phone]);

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && !panelRef.current?.contains(next) && !triggerRef.current?.contains(next)) setOpen(false);
  };

  const body = (
    <div className={cx('grid gap-6', phone ? 'grid-cols-1 py-2' : 'grid-cols-2 @min-[960px]:grid-cols-[repeat(4,minmax(0,1fr))_minmax(220px,1.2fr)]')}>
      {columns.length === 0 ? <p className="text-ods-slate">{emptyText}</p> : null}
      {columns.slice(0, 4).map((col) => (
        <div key={col.title} className="min-w-0">
          <h3 className="flex items-center gap-2 text-ods-label font-bold text-ods-navy">
            {col.icon ? <Icon icon={col.icon} /> : null}
            {col.href ? (
              <Link href={col.href} className="rounded-ods-control hover:text-ods-blue hover:underline">
                {col.title}
              </Link>
            ) : (
              col.title
            )}
          </h3>
          <ul className="mt-2 grid gap-0.5">
            {col.links.map((l) => (
              <li key={l.href + l.label}>
                <Link
                  href={l.href}
                  target={l.target}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[calc(var(--ods-control-h)-8px)] items-start gap-2 rounded-ods-control px-2 py-1.5 text-ods-table text-ods-text hover:bg-ods-blue-tint hover:text-ods-blue"
                >
                  {l.icon ? <Icon icon={l.icon} className="mt-0.5" /> : null}
                  <span className="min-w-0">
                    <span className="block font-medium">{l.label}</span>
                    {l.description ? <span className="block text-ods-small text-ods-slate">{l.description}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {promo ? (
        <div className={cx('rounded-ods-card bg-ods-navy p-ods-pad-card text-white', !phone && 'col-span-2 @min-[960px]:col-span-1')}>
          {promo.eyebrow ? <p className="text-ods-small font-semibold text-ods-teal">{promo.eyebrow}</p> : null}
          <h3 className="mt-1 text-ods-body font-bold text-white">{promo.title}</h3>
          {promo.body ? <p className="mt-1 text-ods-small text-white/85">{promo.body}</p> : null}
          <Link href={promo.href} onClick={() => setOpen(false)} className="mt-3 inline-flex min-h-ods-control items-center gap-1 rounded-ods-control font-semibold text-ods-teal hover:underline">
            {promo.linkLabel}
            <Icon icon={ArrowRight} className="rtl:rotate-180" />
          </Link>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open || !phone ? panelId : undefined}
        aria-haspopup={phone ? 'dialog' : undefined}
        onClick={() => setOpen(!open)}
        data-testid={testIds?.trigger}
        className={
          triggerClassName ??
          cx(
            'inline-flex h-ods-control items-center gap-1 rounded-ods-control px-3 font-semibold whitespace-nowrap text-ods-navy hover:bg-ods-blue-tint aria-expanded:bg-ods-blue-tint',
            triggerCurrent && 'font-bold',
          )
        }
      >
        {triggerIcon ? <Icon icon={triggerIcon} /> : null}
        {label}
        <Icon icon={ChevronDown} className={cx('transition-transform duration-(--ods-motion-fast)', open && 'rotate-180')} />
      </button>
      {phone ? (
        <Sheet open={open} onClose={() => setOpen(false)} title={name ?? 'Menu'} variant="full" testId={testIds?.panel}>
          <div id={panelId}>{body}</div>
        </Sheet>
      ) : (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label={name}
          hidden={!open}
          onBlur={onBlur}
          data-testid={testIds?.panel}
          className="@container absolute inset-x-0 top-full z-(--z-dropdown) border-t border-b border-ods-line bg-ods-surface text-ods-text shadow-ods-pop"
        >
          <div className="mx-auto max-w-ods-content p-6">{body}</div>
        </div>
      )}
    </>
  );
}
