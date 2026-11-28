// ODS T9
/**
 * ODS T9 · small presentational pieces shared by the Sales screens of batch 2 (KYC review, Service requests,
 * Assistant queue): page head, key/value list, inline notice. Server + client safe (no hooks).
 */
import type { ReactNode } from 'react';
import { Breadcrumbs, type BreadcrumbItem } from '@octopus/ui';

export function SalesPageHead({ crumbs, title, subtitle, meta, actions, testId }: {
  crumbs: BreadcrumbItem[]; title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; actions?: ReactNode; testId?: string;
}) {
  return (
    <header className="flex flex-col gap-2 ods-tablet:flex-row ods-tablet:items-end ods-tablet:justify-between" data-testid={testId}>
      <div className="min-w-0">
        <Breadcrumbs items={crumbs} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{title}</h1>
          {meta}
        </div>
        {subtitle ? <p className="m-0 mt-0.5 text-ods-small text-ods-slate">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function KeyValueList({ rows, testId, columns = 2 }: { rows: [string, ReactNode][]; testId?: string; columns?: 1 | 2 }) {
  return (
    <dl data-testid={testId} className={`m-0 grid gap-x-6 gap-y-2.5 ${columns === 2 ? 'ods-tablet:grid-cols-2' : ''}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-ods-small text-ods-slate">{k}</dt>
          <dd className="m-0 break-words text-ods-body font-medium text-ods-text">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

const NOTICE_TONE = {
  info: 'border-ods-blue bg-ods-blue-tint text-ods-navy',
  warning: 'border-ods-warning bg-ods-warning-tint text-ods-text',
  danger: 'border-ods-danger bg-ods-danger-tint text-ods-text',
  success: 'border-ods-success bg-ods-success-tint text-ods-text',
} as const;

export function InlineNotice({ tone = 'info', children, role, testId, className = '' }: { tone?: keyof typeof NOTICE_TONE; children: ReactNode; role?: 'status' | 'alert'; testId?: string; className?: string }) {
  return (
    <div role={role} data-testid={testId} className={`rounded-ods-control border-s-4 px-3 py-2 text-ods-small ${NOTICE_TONE[tone]} ${className}`}>
      {children}
    </div>
  );
}
