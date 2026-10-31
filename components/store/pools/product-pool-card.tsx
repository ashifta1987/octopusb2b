import Link from 'next/link';
import { money } from '@/lib/format';
import { getSiteContent } from '@/lib/content';
import { listOpenPools } from '@/components/store/data';
import { unitOne } from '@/components/store/product-card';
import { Countdown } from './countdown';
import { ProgressBar } from './pool-card';
import { poolSettings } from './shared';

/** Product.png — "MOQ too big? Join a group buy" card after the Request quote CTA (SPEC §18.4). */
export async function ProductPoolCard({ productId, moq, unit }: { productId: string; moq: number; unit: string }) {
  const [{ settings }, { items, total }] = await Promise.all([getSiteContent(), listOpenPools({ productId, sort: 'filled', limit: 1 })]);
  const rules = poolSettings(settings);
  if (!rules.enabled) return null;
  const p = items[0];
  const u = unitOne(unit);
  return (
    <section className="card p-5 border-2 border-navy" aria-labelledby="pool-card-h">
      <div className="flex justify-between items-start gap-3">
        <h2 id="pool-card-h" className="font-semibold text-[16px] inline-flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2A6FD6" strokeWidth="2" aria-hidden><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c2.8 0 5 2 5 5" /></svg>
          MOQ too big? Join a group buy
        </h2>
        {total > 0 && <span className="text-[12px] font-semibold text-[#B4540A] whitespace-nowrap">{total} active {total === 1 ? 'pool' : 'pools'}</span>}
      </div>
      <p className="text-[13px] text-muted mt-2">
        Can&apos;t afford {moq.toLocaleString('en-US')} {unit} on your own? Share the minimum with other buyers. Pay a {rules.depositPct}% deposit now, pay the rest only if the pool fills.
      </p>
      {p ? (
        <>
          <div className="rounded-[10px] border border-line p-3 mt-3">
            <div className="flex justify-between items-center gap-2 text-[12px]">
              <Link href={`/pool/${p.code}`} className="mono font-semibold hover:text-blue">{p.code}</Link>
              <span className="font-semibold text-[#B4540A]"><Countdown to={p.deadline_at} prefix="Closes in " /></span>
            </div>
            <ProgressBar filled={p.filled_qty} target={p.target_qty} className="h-1.5 mt-2" />
            <div className="flex justify-between text-[12px] text-muted mt-1.5">
              <span><span className="mono font-semibold text-navy">{p.filled_qty.toLocaleString('en-US')}</span> / {p.target_qty.toLocaleString('en-US')} {unit}</span>
              <span>{p.buyers} {p.buyers === 1 ? 'buyer' : 'buyers'} · from {money(p.target_price_minor ?? p.pool_price_minor, p.currency)}/{u}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Link href={`/pool/${p.code}`} className="btn btn-dark btn-sm">Join this pool</Link>
            <Link href={`/pools/start?product=${productId}`} className="btn btn-ghost btn-sm">Start your own pool</Link>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2 mt-3">
          <Link href={`/pools/start?product=${productId}`} className="btn btn-dark btn-sm flex-1">Start a pool</Link>
          <Link href="/pools" className="btn btn-ghost btn-sm">See open pools</Link>
        </div>
      )}
    </section>
  );
}
