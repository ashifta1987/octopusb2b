import { Suspense } from 'react';
import { COUNTRY_NAMES } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import {
  dropshipSettings,
  getDropshipCountries,
  listMyDropshipRequests,
  requireDropshipV2Merchant,
} from '@/lib/dropship';
import { DropshipRequestsClient } from './requests-client';

export const metadata = { title: 'Request a product · Octopus Dropship' };

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="ds-card">
          <DsSkeleton immediate />
        </div>
      }
    >
      <RequestsPage />
    </Suspense>
  );
}

async function RequestsPage() {
  await requireDropshipV2Merchant('/account/dropship/requests');
  const sb = await createClient();

  const [cfg, merchantCountries, requests, priceRes, siteContent] = await Promise.all([
    dropshipSettings(),
    getDropshipCountries(),
    listMyDropshipRequests(),
    sb.rpc('service_price_info', { p_code: 'dropship_request', p_currency: 'USD' }),
    getSiteContent(),
  ]);

  const priceRow = Array.isArray(priceRes.data) ? priceRes.data[0] : null;
  const requestFeeCents =
    priceRow && priceRow.amount_minor != null ? Math.max(0, Number(priceRow.amount_minor)) : 0;

  const merchantCodes = merchantCountries.map((m) => m.country);
  const allCodes = Array.from(
    new Set([...merchantCodes, ...cfg.supportedCountries.slice(0, 8)]),
  );
  const countryOptions: [string, string][] = allCodes
    .map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const defaultCountries =
    merchantCodes.length > 0 ? merchantCodes.slice(0, 2) : ['AE'];

  const rawReply = Number(siteContent.settings['sourcing.reply_hours'] ?? 24);
  const replyHours = Number.isFinite(rawReply) && rawReply > 0 ? Math.round(rawReply) : 24;

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-requests-page">
      <DsPageHeader
        title="Request a product"
        subtitle="Can't find it in the catalogue? The Octopus sourcing team will find it, quote it and add it for you."
        icon="send"
      />

      <DropshipRequestsClient
        initialRequests={requests}
        countryOptions={countryOptions}
        defaultCountries={defaultCountries}
        requestFeeCents={requestFeeCents}
        replyHours={replyHours}
        countryNames={COUNTRY_NAMES}
      />
    </div>
  );
}
