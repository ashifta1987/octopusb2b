/**
 * ODS T9 · Turnkey — shared presentational pieces (server-safe, props only): page head with today's Turnkey section menu,
 * panels, status pill from today's tone, simple compact tables and load-error states.
 */
import type { ReactNode } from 'react';
import { Breadcrumbs, Card, ErrorState, StatusPill, type BreadcrumbItem } from '@octopus/ui';
import { odsTone, turnkeySections } from '../_lib/turnkey-logic';

export function TurnkeyHead({ title, subtitle, crumbs, current, isAdmin, actions, showNav = true }: { title: ReactNode; subtitle?: ReactNode; crumbs?: BreadcrumbItem[]; current?: string; isAdmin: boolean; actions?: ReactNode; showNav?: boolean }) {
  return (
    <div className="grid gap-2" data-testid="tk-head">
      <Breadcrumbs items={crumbs ?? [{ label: 'Services' }, { label: 'Turnkey' }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{title}</h1>
          {subtitle ? <p className="m-0 mt-0.5 max-w-[72ch] text-ods-small text-ods-slate">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {showNav ? <TurnkeyNav current={current} isAdmin={isAdmin} /> : null}
    </div>
  );
}

/** Today's Turnkey section menu (same links and test ids), as an ODS underline row; scrolls sideways on phones. */
export function TurnkeyNav({ current, isAdmin }: { current?: string; isAdmin: boolean }) {
  return (
    <nav aria-label="Turnkey sections" data-testid="tk-staff-nav" className="-mx-1 overflow-x-auto">
      <ul className="m-0 flex min-w-max list-none gap-1 border-b border-ods-line p-0 px-1">
        {turnkeySections(isAdmin).map((i) => {
          const on = current === i.key;
          return (
            <li key={i.key}>
              <a
                href={i.href}
                aria-current={on ? 'page' : undefined}
                data-testid={i.testid}
                className={`-mb-px inline-flex h-ods-tab items-center border-b-[length:var(--ods-tab-bar)] px-3 text-ods-body no-underline ${on ? 'border-ods-blue font-bold text-ods-navy' : 'border-transparent text-ods-slate hover:text-ods-navy'}`}
              >
                {i.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Panel({ title, actions, children, testId, className, error, description, id }: { title: ReactNode; actions?: ReactNode; children?: ReactNode; testId?: string; className?: string; error?: ReactNode; description?: ReactNode; id?: string }) {
  return (
    <Card as="section" title={title} headingLevel={2} actions={actions} data-testid={testId} className={className} error={error || undefined} description={description} id={id}>
      {children}
    </Card>
  );
}

export function LoadError({ what = 'this part' }: { what?: string }) {
  return <ErrorState title={`We couldn't load ${what}`} description="Reload the page to try again. The rest of the page still works." headingLevel={3} />;
}

export const TkPill = ({ label, tone, testId }: { label: string; tone: string; testId?: string }) => <StatusPill tone={odsTone(tone)} data-testid={testId}>{label}</StatusPill>;

export function SimpleTable({ caption, head, rows, numeric = [], empty, testId, minWidth = 560 }: { caption: string; head: string[]; rows: { key: string; cells: ReactNode[]; testId?: string; className?: string }[]; numeric?: number[]; empty?: ReactNode; testId?: string; minWidth?: number }) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption} data-testid={testId}>
      <table className="w-full border-collapse text-ods-table" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="h-ods-head border-b border-ods-line-strong bg-ods-canvas text-ods-label text-ods-slate">
            {head.map((h, i) => <th key={h || i} scope="col" className={`whitespace-nowrap px-2 font-semibold ${numeric.includes(i) ? 'text-end' : 'text-start'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`h-ods-row border-b border-ods-line ${r.className ?? ''}`} data-testid={r.testId}>
              {r.cells.map((c, i) => <td key={i} className={`px-2 py-1 ${numeric.includes(i) ? 'text-end tabular-nums' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValues({ rows, testId, labelWidth = '9rem' }: { rows: ([string, ReactNode] | null | false)[]; testId?: string; labelWidth?: string }) {
  return (
    <dl className="m-0 grid text-ods-table" style={{ gridTemplateColumns: `minmax(6rem, ${labelWidth}) 1fr` }} data-testid={testId}>
      {rows.filter(Boolean).map((r) => {
        const [k, v] = r as [string, ReactNode];
        return (
          <div key={k} className="contents">
            <dt className="border-b border-ods-line py-1.5 pe-3 text-ods-slate">{k}</dt>
            <dd className="m-0 min-w-0 break-words border-b border-ods-line py-1.5 text-ods-text">{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export const A = ({ href, children, testId, external }: { href: string; children: ReactNode; testId?: string; external?: boolean }) => (
  <a href={href} data-testid={testId} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="inline-flex min-h-6 items-center font-semibold text-ods-blue hover:underline">{children}</a>
);

/** Blue/amber/red note line (gate texts), never colour alone: always a sentence. */
export function Note({ tone = 'info', children, testId }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; testId?: string }) {
  const cls = { info: 'bg-ods-info-tint text-ods-info', warning: 'bg-ods-warning-tint text-ods-warning', danger: 'bg-ods-danger-tint text-ods-danger', success: 'bg-ods-success-tint text-ods-success' }[tone];
  return <p className={`m-0 rounded-ods-control px-3 py-2 text-ods-small ${cls}`} data-testid={testId}>{children}</p>;
}
