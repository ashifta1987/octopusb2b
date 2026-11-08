import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/cn';
import { humanize, money, fmtDate } from '@/lib/format';

/* ───────── Logo ───────── */
/**
 * Brand logo — full lockup only, never recoloured, stretched or rotated (brand guide).
 * Colour version on light backgrounds, white version on Ink or black. Header 42 px (phone 36), footer `size="footer"` 48 px.
 */
export function Logo({ white = false, className, size = 'header' }: { white?: boolean; className?: string; size?: 'header' | 'footer' }) {
  return (
    <Link href="/" className={cn('inline-flex items-center shrink-0', className)} aria-label="Octopus B2B home">
      <Image src={white ? '/brand/octopus-b2b-logo-white.png' : '/brand/octopus-b2b-logo.png'} alt="Octopus B2B" width={800} height={208}
        sizes={size === 'footer' ? '185px' : '162px'} priority={size === 'header'}
        className={cn('block w-auto', size === 'footer' ? 'h-12' : 'h-9 sm:h-[42px]')} />
    </Link>
  );
}

/* ───────── StatusBadge — driven by state-machine enums; always text + colour ───────── */
const TONES: Record<string, string> = {
  green: 'bg-ok-bg text-ok',
  amber: 'bg-warn-bg text-warn',
  red: 'bg-bad-bg text-bad',
  blue: 'bg-tint text-coral-text',
  gray: 'bg-fill text-black',
  navy: 'bg-ink text-white',
};
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  verified: 'green', live: 'green', paid: 'green', confirmed: 'green', completed: 'green', delivered: 'green', credited: 'green', active: 'green',
  approved: 'green', executed: 'green', published: 'green', closed: 'gray', resolved: 'green', settled: 'green', balance_paid: 'green', deposit_paid: 'green',
  accepted: 'green', report_ready: 'blue',
  submitted: 'blue', in_review: 'blue', quoted: 'amber', sent: 'blue', shipped: 'blue', in_transit: 'blue', in_production: 'blue', qc: 'blue',
  assigned: 'blue', quoting: 'blue', open: 'blue', new: 'blue', viewed: 'blue', ready_to_ship: 'blue', picked_up: 'blue', out_for_delivery: 'blue',
  label_ready: 'blue', created: 'blue', in_progress: 'blue', scheduled: 'blue', requested: 'amber',
  pending: 'amber', awaiting_payment: 'amber', deposit_pending: 'amber', balance_pending: 'amber', pi_issued: 'amber', more_info: 'amber',
  waiting_customer: 'amber', waiting_internal: 'amber', paused: 'amber', draft: 'gray', not_started: 'gray', expiring: 'amber', initiated: 'gray',
  rejected: 'red', cancelled: 'red', failed: 'red', expired: 'gray', disputed: 'red', exception: 'red', refunded: 'gray', superseded: 'gray',
  archived: 'gray', ended: 'gray', returned: 'red', reopened: 'amber', issued: 'blue', not_configured: 'gray', sandbox: 'amber', off: 'gray',
};
export function StatusBadge({ status, label, tone }: { status: string; label?: string; tone?: keyof typeof TONES }) {
  const t = tone ?? STATUS_TONE[status] ?? 'gray';
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', TONES[t])}>
      {label ?? humanize(status)}
    </span>
  );
}

/* ───────── Money ───────── */
/** MoneyField: minor units in, formatted in the record's currency out (SPEC §15.1). */
export function Money({ cents, currency = 'USD', className, compact }: { cents: number | null | undefined; currency?: string | null; className?: string; compact?: boolean }) {
  return <span className={cn('mono font-semibold tabular-nums', className)}>{money(cents, currency, { compact })}</span>;
}

/* ───────── SupplierCode — buyers only ever see code + country + badge (SPEC §3, §8.4) ───────── */
export function SupplierCode({ code, country, verified, className }: { code: string; country?: string | null; verified?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-muted', className)}>
      {country && <span className="mono text-[10px] font-semibold bg-pearl border border-line rounded px-1 py-px text-ink">{country}</span>}
      <span>Supplier {code}</span>
      {verified && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ok" strokeWidth="2.2" aria-label="Verified supplier" role="img">
          <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
        </svg>
      )}
    </span>
  );
}

/* ───────── Card helpers ───────── */
export function Card({ children, className, title, action }: { children: React.ReactNode; className?: string; title?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={cn('card', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, hintTone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; hintTone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-2 font-display text-[28px] font-bold leading-tight text-ink">{value}</div>
      {hint && <div className={cn('mt-1 text-sm', hintTone === 'ok' ? 'text-ok' : hintTone === 'warn' ? 'text-warn' : hintTone === 'bad' ? 'text-bad' : 'text-muted')}>{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-[30px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/* ───────── EmptyState ───────── */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-full bg-pearl border border-line flex items-center justify-center mb-3" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-muted" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
      </div>
      <div className="font-semibold">{title}</div>
      {body && <p className="text-sm text-muted mt-1 max-w-md">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ───────── Timeline (order + tracking events) ───────── */
export function Timeline({ items }: { items: { title: string; body?: string | null; at: string; tone?: 'done' | 'current' | 'todo' }[] }) {
  if (!items.length) return <EmptyState title="No events yet" />;
  return (
    <ol className="relative ml-2">
      {items.map((it, i) => (
        <li key={i} className="relative pl-6 pb-5 last:pb-0">
          {i < items.length - 1 && <span className="absolute left-[5px] top-3 bottom-0 w-px bg-line" aria-hidden />}
          <span className={cn('absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full border-2', it.tone === 'todo' ? 'bg-white border-line-strong' : it.tone === 'current' ? 'bg-coral border-coral-text' : 'bg-ok border-ok')} aria-hidden />
          <div className="font-semibold text-[15px]">{it.title}</div>
          {it.body && <div className="text-sm text-muted">{it.body}</div>}
          <div className="text-xs text-muted mono mt-0.5">{fmtDate(it.at, true)}</div>
        </li>
      ))}
    </ol>
  );
}

/* ───────── Order progress bar (Customer.png) ───────── */
const PROGRESS = ['confirmed', 'in_production', 'shipped', 'delivered'] as const;
const ORDER_RANK: Record<string, number> = {
  pi_issued: 0, deposit_pending: 0, deposit_paid: 0, confirmed: 1, in_production: 2, qc: 2, balance_pending: 2, balance_paid: 2, ready_to_ship: 2,
  shipped: 3, delivered: 4, closed: 4,
};
export function OrderProgress({ status }: { status: string }) {
  const rank = ORDER_RANK[status] ?? 0;
  return (
    <div className="grid grid-cols-4 gap-2">
      {PROGRESS.map((p, i) => (
        <div key={p}>
          <div className={cn('h-1 rounded-full', i < rank ? 'bg-coral' : 'bg-line')} />
          <div className={cn('mt-2 text-sm', i < rank ? 'font-semibold text-ink' : 'text-muted')}>{p === 'in_production' ? 'Processing' : humanize(p)}</div>
        </div>
      ))}
    </div>
  );
}

/* ───────── Simple server-side table (DataTable for client lives in components/data-table) ───────── */
export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : !!children;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="w-full border-collapse">
        <thead><tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
        <tbody>{hasRows ? children : <tr><td colSpan={head.length}>{empty ?? <EmptyState title="Nothing here yet" />}</td></tr>}</tbody>
      </table>
    </div>
  );
}

/* ───────── PermissionGate (UI only — RLS/server enforce the real rule) ───────── */
export function PermissionGate({ allowed, children, fallback = null }: { allowed: boolean; children: React.ReactNode; fallback?: React.ReactNode }) {
  return <>{allowed ? children : fallback}</>;
}

export function Notice({ tone = 'blue', children }: { tone?: 'blue' | 'amber' | 'red' | 'green'; children: React.ReactNode }) {
  const t = { blue: 'bg-tint border-coral-text/30 text-coral-text', amber: 'bg-warn-bg border-warn/40 text-warn', red: 'bg-bad-bg border-bad/40 text-bad', green: 'bg-ok-bg border-ok/40 text-ok' }[tone];
  return <div role="status" className={cn('rounded-[10px] border px-4 py-3 text-sm', t)}>{children}</div>;
}

export function SampleBadge() {
  return <span className="inline-block rounded-md bg-pearl border border-line px-2 py-1 text-xs font-semibold text-ink">Sample data</span>;
}

