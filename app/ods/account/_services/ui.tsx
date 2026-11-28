import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Icon, Money, cx } from '@octopus/ui';
import { money } from '@/lib/format';

/**
 * Small server-safe building blocks shared by the ODS My account service pages (T6 · ACCOUNT SERVICES). The FRAME builder
 * owns the sidebar / topbar (app/ods/account/layout.tsx); these only render inside the page's <main>.
 */

/** The page column inside the frame's <main> (same as the FRAME builder's pages: centred, max content width, page padding). */
export function PageWrap({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="mx-auto flex w-full max-w-ods-content flex-col gap-6 p-ods-pad-page" data-testid={testId}>{children}</div>;
}

/** Page header: optional "‹ Parent" link, ONE H1, one-line description, actions on the inline end (wrap on phones). */
export function PageHead({ title, description, actions, back, eyebrow, meta, testId }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; eyebrow?: ReactNode; meta?: ReactNode; testId?: string;
}) {
  return (
    <header className="flex flex-col gap-3" data-testid={testId}>
      {back ? (
        <nav aria-label="Breadcrumb">
          <Link href={back.href} className="inline-flex min-h-ods-control items-center gap-1 text-ods-small font-semibold text-ods-slate hover:text-ods-navy">
            <Icon icon={ChevronLeft} size="sm" />{back.label}
          </Link>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? <p className="m-0 text-ods-small font-semibold text-ods-slate">{eyebrow}</p> : null}
          <h1 className="m-0 text-ods-h1 text-ods-navy">{title}</h1>
          {description ? <p className="m-0 max-w-[70ch] text-ods-body text-ods-slate">{description}</p> : null}
          {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Label / value pairs (a <dl>), two columns from tablet up. */
export function Facts({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx('m-0 grid grid-cols-1 gap-x-6 gap-y-3 ods-tablet:grid-cols-2', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-ods-small font-semibold text-ods-slate">{k}</dt>
          <dd className="m-0 break-words text-ods-body text-ods-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A quiet notice line (info / warning / success / danger) — text carries the meaning, colour only repeats it. */
export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'warning' | 'success' | 'danger'; children: ReactNode; testId?: string }) {
  const cls = { info: 'bg-ods-info-tint border-ods-info', warning: 'bg-ods-warning-tint border-ods-warning', success: 'bg-ods-success-tint border-ods-success', danger: 'bg-ods-danger-tint border-ods-danger' }[tone];
  return <div className={cx('rounded-ods-card border-s-4 px-4 py-3 text-ods-body text-ods-text', cls)} data-testid={testId}>{children}</div>;
}

/** Text link styled for ODS (underline, navy). */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <Link href={href} className={cx('font-semibold text-ods-blue underline underline-offset-2 hover:text-ods-navy', className)}>{children}</Link>;
}

/** Integer minor units → ODS Money (US$ 1,234.56, tabular). Other currencies keep today's money() text (CN¥ …). */
export function Cents({ cents, currency = 'USD', className }: { cents: number; currency?: string | null; className?: string }) {
  if (!currency || currency === 'USD') return <Money amount={Number(cents) / 100} className={className} />;
  return <span className={cx('tabular-nums whitespace-nowrap', className)}>{money(cents, currency)}</span>;
}

/** "1.2 MB" / "340 KB". */
export function fileSizeText(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}
