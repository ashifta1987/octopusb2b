import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getReportsPage, type ReportsPageData } from '@/lib/dropship-ds12';
import { periodRange, type PeriodKey } from '@/lib/dropship-ds12-shared';
import { COUNTRY_NAMES } from '@/lib/format';
import { ReportsClient } from './reports-client';

export const metadata = { title: 'Reports · Octopus Dropship' };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * Release 5 · Step 13 — Reports (screens/Reports.html, mobile/M_Reports.html). Data: ds_reports_page(from, to, country):
 * store sales (the buyer's prices on the store order in USD at the FX rate locked at intake; unknown stays unknown), Octopus
 * costs (what was charged — the OCT-DS invoice lines — minus refunds) split product / processing / shipping / duties, refund
 * rate, delivery days (hand-over to the carrier → delivered), 12-week profit, top products, and CSV.
 */
async function Reports({ searchParams }: { searchParams: Search }) {
  await requireDropshipV2Merchant('/account/dropship/reports');
  const sp = await searchParams;
  const period = (['30d', '7d', 'quarter', 'custom'].includes(one(sp.period) ?? '') ? one(sp.period) : '30d') as PeriodKey;
  const country = /^[A-Z]{2}$/.test(one(sp.country) ?? '') ? one(sp.country) : null;
  const range = periodRange(period, new Date(), one(sp.from), one(sp.to)) ?? periodRange('30d', new Date())!;
  const badCustom = period === 'custom' && !periodRange(period, new Date(), one(sp.from), one(sp.to));
  let data: ReportsPageData | null = null;
  let error: string | null = null;
  try {
    data = await getReportsPage(range.from, range.to, country);
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds-reports-page">
        <h1 className="m-0 text-[26px] font-bold text-ink">Reports</h1>
        <DsNotice tone="bad" title="Reports could not be loaded" testId="reports-error"
          action={<DsLinkButton href="/account/dropship/reports" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return (
    <ReportsClient data={data} period={period} customFrom={one(sp.from)} customTo={one(sp.to)} badCustom={badCustom} countryNames={COUNTRY_NAMES} />
  );
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<div className="ds-card" data-testid="reports-loading"><DsSkeleton immediate /></div>}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}
