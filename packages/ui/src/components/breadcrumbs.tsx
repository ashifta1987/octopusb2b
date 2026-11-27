import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';

export type BreadcrumbItem = { label: string; href?: string };

export type BreadcrumbsProps = {
  /** From the top level to the current page (the last item is the current page). */
  items: BreadcrumbItem[];
  /** Landmark name. Keep "Breadcrumb" on real pages; change only when two appear on one page. */
  label?: string;
  /** auto = full trail from 768 px, "‹ Parent" on phones; full / back force one form (demos, narrow panels). */
  variant?: 'auto' | 'full' | 'back';
  className?: string;
};

/**
 * Breadcrumbs (every page below level 1): `nav aria-label="Breadcrumb"` with an ordered list and › separators; the last
 * item is bold, not a link, and has aria-current="page". Phones (< 768 px): only "‹ Parent" (a link to the item before
 * the current one). Server-safe (no client code).
 */
export function Breadcrumbs({ items, label = 'Breadcrumb', variant = 'auto', className }: BreadcrumbsProps) {
  if (!items.length) return null;
  const parent = [...items.slice(0, -1)].reverse().find((i) => i.href);
  return (
    <nav aria-label={label} className={cx('text-ods-label', className)}>
      {variant !== 'back' ? (
        <ol className={cx('flex-wrap items-center gap-x-1 gap-y-1', variant === 'auto' ? 'hidden ods-tablet:flex' : 'flex')}>
          {items.map((it, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${it.label}-${i}`} className="inline-flex items-center gap-1">
                {last || !it.href ? (
                  <span aria-current={last ? 'page' : undefined} className={cx(last ? 'font-bold text-ods-navy' : 'text-ods-slate')}>
                    {it.label}
                  </span>
                ) : (
                  <Link href={it.href} className="rounded-ods-control text-ods-slate underline-offset-4 hover:text-ods-blue hover:underline">
                    {it.label}
                  </Link>
                )}
                {!last ? <Icon icon={ChevronRight} size="xs" className="text-ods-slate rtl:rotate-180" /> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {variant !== 'full' && parent?.href ? (
        <Link
          href={parent.href}
          className={cx(
            'min-h-ods-control items-center gap-1 rounded-ods-control font-semibold text-ods-blue underline-offset-4 hover:underline',
            variant === 'auto' ? 'inline-flex ods-tablet:hidden' : 'inline-flex',
          )}
        >
          <Icon icon={ChevronLeft} size="sm" className="rtl:rotate-180" />
          <span>
            <span className="sr-only">Back to </span>
            {parent.label}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
