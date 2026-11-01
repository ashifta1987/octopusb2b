import Link from 'next/link';
import { getSiteContent } from '@/lib/content';
import { listOpenPools } from '@/components/store/data';
import { PoolCard } from './pool-card';
import { poolSettings } from './shared';

/** Main.png — "MOQ too big? Pool with other buyers" (4 open pools). Hidden when group buying is off; empty state when no pool is open. */
export async function HomePoolsSection() {
  const [{ settings }, { items }] = await Promise.all([getSiteContent(), listOpenPools({ sort: 'filled', limit: 4 })]);
  const rules = poolSettings(settings);
  if (!rules.enabled) return null;
  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]" aria-labelledby="home-pools-h">
      <span className="inline-flex rounded-full bg-[#FFF3D6] text-[#8A5A00] text-[11px] font-semibold px-2.5 py-1 uppercase tracking-wide">Group buying</span>
      <div className="flex flex-wrap justify-between items-end gap-4 mt-3 mb-6">
        <div className="max-w-[640px]">
          <h2 id="home-pools-h" className="text-[28px] sm:text-[34px] font-extrabold leading-tight">MOQ too big? Pool with other buyers.</h2>
          <p className="text-[15px] text-muted mt-2">
            Join an open pool and share the factory minimum. Pay a {rules.depositPct}% deposit, pay the rest only if the pool fills. Octopus holds every deposit in escrow and ships each buyer separately.
          </p>
        </div>
        <Link href="/pools" className="font-semibold text-blue">See all open pools <span aria-hidden>→</span></Link>
      </div>
      {items.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((p) => <li key={p.id}><PoolCard pool={p} variant="compact" /></li>)}
        </ul>
      ) : (
        <div className="card p-6 sm:p-8 flex flex-wrap items-center justify-between gap-4">
          <p className="text-[15px] text-[#3B4556]">No pools are open right now. Start one on any product and share the MOQ with other buyers.</p>
          <Link href="/pools#how" className="btn btn-dark min-h-11">How group buying works</Link>
        </div>
      )}
    </section>
  );
}
