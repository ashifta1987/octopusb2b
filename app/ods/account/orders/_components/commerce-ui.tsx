import type { ReactNode } from 'react';
import {Breadcrumbs, ErrorState, type BreadcrumbItem } from '@octopus/ui';
import { OdsButton } from './ods-button';

/**
 * Small server-safe building blocks shared by the ODS My account commerce pages (requests, orders, wallet, invoices).
 * Every page has exactly one H1 (PageHead).
 */
export function PageHead({ crumbs, title, titleAfter, subtitle, actions, testId }: { crumbs?: BreadcrumbItem[]; title: ReactNode; titleAfter?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <header className="mb-5 flex flex-col gap-3" data-testid={testId}>
      {crumbs?.length ? <Breadcrumbs items={crumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 text-ods-h1 font-bold text-ods-navy [overflow-wrap:anywhere]">{title}</h1>
            {titleAfter}
          </div>
          {subtitle ? <p className="m-0 mt-1 text-ods-body text-ods-slate">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A panel that failed on its own: says what happened, with Try again (reloads this URL). */
export function PanelError({ what, href, headingLevel = 3 }: { what: string; href?: string; headingLevel?: 2 | 3 | 4 }) {
  return (
    <ErrorState
      title={`We couldn't load ${what}.`}
      description="The rest of the page still works. Try again in a moment."
      headingLevel={headingLevel}
      action={href ? <OdsButton href={href} variant="secondary" size="sm">Try again</OdsButton> : undefined}
    />
  );
}

/** Previous / Next with "Showing 1–20 of 24" (URL ?page=). */
export function Pager({ page, pages, total, pageSize, hrefFor, label }: { page: number; pages: number; total: number; pageSize: number; hrefFor: (p: number) => string; label: string }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 border-t border-ods-line px-4 py-3">
      <p className="m-0 text-ods-small text-ods-slate" aria-live="polite">
        Showing {from}–{to} of {total}
      </p>
      {pages > 1 ? (
        <div className="flex gap-2">
          <OdsButton variant="secondary" size="sm" icon="arrowLeft" href={page > 1 ? hrefFor(page - 1) : undefined} disabled={page <= 1} data-testid="page-prev">
            Previous
          </OdsButton>
          <OdsButton variant="secondary" size="sm" iconEnd="arrowRight" href={page < pages ? hrefFor(page + 1) : undefined} disabled={page >= pages} data-testid="page-next">
            Next
          </OdsButton>
        </div>
      ) : null}
    </nav>
  );
}

/** Label / value row used in cards (Payment, Shipping, Request details). */
export function KV({ k, children, strong }: { k: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? 'border-t border-ods-line pt-2 font-bold' : ''}`}>
      <dt className={strong ? 'text-ods-navy' : 'text-ods-slate'}>{k}</dt>
      <dd className="m-0 text-end text-ods-navy [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** "Sample data" ribbon for staging fixtures (never on real pages). */
export function SampleNote() {
  return <p className="m-0 mt-6 text-ods-small text-ods-slate">Sample data for design review only.</p>;
}
