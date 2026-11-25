import { Suspense } from 'react';
import { DsCard, DsSkeleton, DsBadge } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { WhHeader } from './wh-header';

export const metadata = { title: 'Warehouse dashboard · Back office' };

type Dash = {
  units_on_hand: number; units_reserved: number; movements_today: number; handoffs_open: number; handoffs_exception: number;
  shipments_open: number; shipments_exception: number; outbox: { pending: number; dead: number; last_processed_at: string | null };
};

/** Warehouse OS board 1 — the day at a glance plus the connections panel. Real numbers only. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_dashboard', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load the dashboard: ${error.message}`);
  const d = data as Dash;
  const yunMode = process.env.YUNEXPRESS_MODE === 'live' ? 'Live' : 'Sandbox';
  const tiles: [string, number, string][] = [
    ['Units in stock', Number(d.units_on_hand), `${Number(d.units_reserved)} reserved`],
    ['Stock movements today', Number(d.movements_today), 'China time'],
    ['Open handoffs', Number(d.handoffs_open), `${Number(d.handoffs_exception)} with a problem`],
    ['Shipments on the way', Number(d.shipments_open), `${Number(d.shipments_exception)} exceptions · all warehouses`],
  ];
  const outboxOk = Number(d.outbox.dead) === 0;
  return (
    <div className="flex flex-col gap-5" data-testid="wh-dashboard">
      <WhHeader access={access} title="Dashboard" icon="grid"
        subtitle={access.current ? `${access.current.name} · the day at a glance` : 'All warehouses · the day at a glance'} />
      <section aria-label="Today" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {tiles.map(([label, n, sub]) => (
          <div key={label} className="ds-card" data-testid={`wh-tile-${label.toLowerCase().replace(/ /g, '-')}`}>
            <div className="text-[13px] text-[#5B6478]">{label}</div>
            <div className="text-[28px] font-bold leading-tight">{n.toLocaleString('en-US')}</div>
            <div className="text-[12.5px] text-[#5B6478]">{sub}</div>
          </div>
        ))}
      </section>
      <DsCard title="Connections" icon="link" testId="wh-connections" subtitle="What reaches the warehouse and what goes back.">
        <ul className="list-none m-0 p-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[
            ['Octopus B2B (sourcing)', 'Stock notices and quality reports', outboxOk ? 'ok' : 'warn', outboxOk ? 'Connected' : `${d.outbox.dead} failed event(s)`],
            ['Make My Brand', 'Branded products and packaging', outboxOk ? 'ok' : 'warn', outboxOk ? 'Connected' : 'Check events'],
            ['Octopus Dropship', 'Store orders in, tracking back', outboxOk ? 'ok' : 'warn', outboxOk ? `Connected · ${d.outbox.pending} waiting` : 'Check events'],
            ['YunExpress', 'Labels and tracking', 'info', yunMode],
            ['4PX', 'Labels and tracking', 'neutral', 'Not connected yet (W4)'],
          ].map(([name, what, tone, state]) => (
            <li key={name} className="rounded-[10px] border border-[#E3E7EF] p-3 flex items-start justify-between gap-3">
              <div><div className="font-semibold text-[14px]">{name}</div><div className="text-[12.5px] text-[#5B6478]">{what}</div></div>
              <DsBadge tone={tone as 'ok' | 'warn' | 'info' | 'neutral'}>{state}</DsBadge>
            </li>
          ))}
        </ul>
        <p className="mt-3 mb-0 text-[12.5px] text-[#5B6478]">Last event processed: {d.outbox.last_processed_at ? fmtDate(d.outbox.last_processed_at, true) : 'none yet'}</p>
      </DsCard>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
