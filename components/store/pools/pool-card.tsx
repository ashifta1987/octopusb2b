import Link from 'next/link';
import { money } from '@/lib/format';
import { ProductImage, unitOne } from '@/components/store/product-card';
import type { PoolCard as Pool } from '@/components/store/data';
import { Countdown } from './countdown';
import { fillTone, pct } from './shared';

const n = (v: number) => v.toLocaleString('en-US');

export function ProgressBar({ filled, target, className = 'h-1.5', label }: { filled: number; target: number; className?: string; label?: string }) {
  const p = pct(filled, target);
  return (
    <div className={`w-full rounded-full bg-[#E9ECF1] overflow-hidden ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}
      aria-label={label ?? `${n(filled)} of ${n(target)} pledged (${p}%)`}>
      <div className="h-full rounded-full bg-blue-fill" style={{ width: `${p}%` }} />
    </div>
  );
}

export function FillBadge({ filled, target }: { filled: number; target: number }) {
  const t = fillTone(filled, target);
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.cls}`}>{t.label}</span>;
}

/** Pools.png card (grid / list) and Main.png compact card. Amounts in the pool's own currency. */
export function PoolCard({ pool: p, categoryName, variant = 'grid' }: { pool: Pool; categoryName?: string; variant?: 'grid' | 'list' | 'compact' }) {
  const u = unitOne(p.product.unit);
  const href = `/pool/${p.code}`;
  const left = Math.max(0, p.target_qty - p.filled_qty);

  if (variant === 'compact') {
    return (
      <article className="card p-4 flex flex-col gap-2.5 h-full">
        <div className="flex justify-between items-start gap-2">
          <h3 className="font-semibold text-[14px] leading-snug line-clamp-2"><Link href={href} className="hover:text-blue">{p.product.title}</Link></h3>
          <span className="shrink-0 rounded-full bg-[#FFF3D6] text-[#8A5A00] text-[11px] font-semibold px-2 py-0.5"><Countdown to={p.deadline_at} prefix="Closes in " /></span>
        </div>
        <ProgressBar filled={p.filled_qty} target={p.target_qty} />
        <div className="flex justify-between text-[12px] text-muted"><span>{n(p.filled_qty)} of {n(p.target_qty)} {p.product.unit}</span><span>{n(left)} to go</span></div>
        <div className="flex justify-between items-end mt-auto">
          <span className="text-[13px]"><span className="mono font-semibold">{money(p.pool_price_minor, p.currency)}</span><span className="text-muted">/{u}</span></span>
          {p.saving_pct > 0 && <span className="text-[12px] font-semibold text-ok">save {p.saving_pct}%</span>}
        </div>
      </article>
    );
  }

  const body = (
    <>
      <div className="flex justify-between items-start gap-3">
        <h3 className="font-semibold text-[15px] leading-snug"><Link href={href} className="hover:text-blue">{p.product.title}</Link></h3>
        <span className="mono text-[11px] text-muted shrink-0 pt-0.5">{p.code}</span>
      </div>
      {p.supplier && <div className="text-[12px] text-muted">Supplier <span className="mono">{p.supplier.code}</span>{p.supplier.country && <> · {p.supplier.country}</>}</div>}
      <ProgressBar filled={p.filled_qty} target={p.target_qty} />
      <div className="flex justify-between text-[12px] text-muted">
        <span><span className="mono font-semibold text-navy">{n(p.filled_qty)} {p.product.unit}</span> of {n(p.target_qty)} {p.product.unit}</span>
        <span>{p.buyers} {p.buyers === 1 ? 'buyer' : 'buyers'}</span>
      </div>
      <div className="flex justify-between items-end">
        <div>
          <div className="font-display font-bold text-[18px] leading-none">{money(p.pool_price_minor, p.currency)}</div>
          <div className="text-[11px] text-muted mt-1">/ {u} at pool price</div>
        </div>
        {p.saving_pct > 0 && <span className="text-[13px] font-semibold text-ok" title="Saving against the base tier price if the pool fills">save {p.saving_pct}%</span>}
      </div>
      <div className="flex justify-between items-center mt-auto pt-1">
        <span className="text-[12px] font-semibold text-[#B4540A] inline-flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>
          <Countdown to={p.deadline_at} suffix=" left" />
        </span>
        <Link href={href} className="btn btn-primary btn-sm" aria-label={`Join pool ${p.code}: ${p.product.title}`}>Join</Link>
      </div>
    </>
  );

  const photo = (
    <div className="relative">
      <ProductImage src={p.product.image_url} alt={p.product.title} className={variant === 'list' ? 'aspect-square h-full' : 'aspect-[16/10]'} />
      <div className="absolute inset-x-2.5 top-2.5 flex justify-between items-start gap-2">
        {categoryName ? <span className="rounded-full bg-white text-navy text-[11px] font-semibold px-2 py-0.5 shadow-sm">{categoryName}</span> : <span />}
        <FillBadge filled={p.filled_qty} target={p.target_qty} />
      </div>
    </div>
  );

  if (variant === 'list') {
    return (
      <article className="card overflow-hidden grid grid-cols-[140px_1fr] sm:grid-cols-[180px_1fr]">
        {photo}
        <div className="p-4 flex flex-col gap-2 min-w-0">{body}</div>
      </article>
    );
  }
  return (
    <article className="card overflow-hidden flex flex-col h-full">
      {photo}
      <div className="p-4 flex flex-col gap-2.5 flex-1">{body}</div>
    </article>
  );
}

export function PoolGrid({ pools, categoryNames, view = 'grid' }: { pools: Pool[]; categoryNames: Record<string, string>; view?: 'grid' | 'list' }) {
  return (
    <ul className={view === 'list' ? 'grid gap-3' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>
      {pools.map((p) => (
        <li key={p.id}><PoolCard pool={p} categoryName={p.product.category_id ? categoryNames[p.product.category_id] : undefined} variant={view} /></li>
      ))}
    </ul>
  );
}

/** "How group buying works" 4 steps (Pools.png) — numbers come from the pool settings. */
export function HowPoolsWork({ depositPct, minPledge, balanceHours, id = 'how' }: { depositPct: number; minPledge: number; balanceHours: number; id?: string }) {
  const steps: [string, string][] = [
    ['Join or start a pool', `Pick an open pool, pledge your quantity (minimum ${n(minPledge)} pcs by default), and pay a ${depositPct}% deposit from your wallet or card.`],
    ['Pool fills', 'As more buyers join, the per-piece price drops. Share the pool link with partners to fill faster.'],
    ['Pay the balance', `If the pool fills before the deadline, you get a proforma invoice for the balance at the final pool price. Pay within ${balanceHours} hours.`],
    ['One PO, separate shipments', 'Octopus places one order with the supplier, runs a shared QC inspection, then ships each buyer separately with its own tracking. If the pool does not fill, every deposit is refunded.'],
  ];
  return (
    <section id={id} className="card p-6 sm:p-8 scroll-mt-6" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-[22px] sm:text-[26px] font-bold">How group buying works on Octopus</h2>
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mt-6">
        {steps.map(([t, b], i) => (
          <li key={t}>
            <span className="w-8 h-8 rounded-full bg-navy text-white font-semibold text-sm flex items-center justify-center" aria-hidden>{i + 1}</span>
            <h3 className="font-semibold mt-3"><span className="sr-only">Step {i + 1}: </span>{t}</h3>
            <p className="text-[13px] text-muted mt-1.5 leading-relaxed">{b}</p>
          </li>
        ))}
      </ol>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line mt-6 pt-4 text-[13px] text-muted">
        {['Deposits held by Octopus in escrow', 'Shared QC inspection before shipment', 'Each buyer gets a separate shipment', 'Deposit refunded if the pool does not fill'].map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5"><span aria-hidden className="text-ok">✓</span>{s}</li>
        ))}
      </ul>
    </section>
  );
}
