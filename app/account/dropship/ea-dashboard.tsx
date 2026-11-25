import Link from 'next/link';
import { DsBadge, DsCard, DsIcon, DsLinkButton, DsNotice, DsPageHeader } from '@/components/dropship-ui';
import { COUNTRY_NAMES, fmtDate, money } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import {
  getDropshipCatalogue,
  getMyDropshipAccessState,
  getMyDropshipOnboardingState,
  listMyDropshipRequests,
  pickRoute,
  type StockStatus,
} from '@/lib/dropship';
import type { DropshipFeatures } from '@/lib/dropship-features-shared';
import { EaRequestActions } from './ea-request-actions';

const STOCK: Record<StockStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
  in_stock: { label: 'In stock', tone: 'ok' },
  low: { label: 'Low stock', tone: 'warn' },
  out: { label: 'Out of stock', tone: 'bad' },
  extended: { label: 'Extended', tone: 'info' },
};
const REQUEST_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  submitted: 'info', assigned: 'info', quoting: 'info', quoted: 'warn', accepted: 'ok', expired: 'neutral', cancelled: 'neutral',
};
const countryName = (c: string) => COUNTRY_NAMES[c] ?? c;

type Step = { key: string; title: string; detail: string; state: 'done' | 'waiting' | 'todo' | 'next'; href?: string };

/**
 * Release 1 · EA-2 — screens/EA_Dashboard.html + mobile/M_EA_Dashboard.html.
 * Everything shown is real state: KYC, access approval, selling countries, seller profile, wallet, requests and
 * the newest catalogue products with landed cost to the merchant's first country. No sample orders in early access.
 */
export async function EarlyAccessDashboard({ orgId, orgName, features }: { orgId: string; orgName: string; features: DropshipFeatures }) {
  const sb = await createClient();
  const [onb, access, requests, wallet, kyc] = await Promise.all([
    getMyDropshipOnboardingState(),
    getMyDropshipAccessState(),
    features.requests ? listMyDropshipRequests() : Promise.resolve([]),
    sb.rpc('my_wallet_summary'),
    sb.from('kyc_submissions').select('reviewed_at').eq('org_id', orgId).eq('status', 'verified').order('reviewed_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const w = (wallet.data ?? null) as { available_cents?: number; on_hold_cents?: number } | null;
  const available = w?.available_cents != null ? Number(w.available_cents) : null;
  const held = w?.on_hold_cents != null ? Number(w.on_hold_cents) : null;
  const firstCountry = onb.markets[0]?.country ?? null;
  const catalogue = features.find && firstCountry ? await getDropshipCatalogue({ country: firstCountry, page: 1 }) : { rows: [], totalCount: 0 };
  const newest = catalogue.rows
    .map((r) => ({ r, route: pickRoute(r.routes, null) }))
    .filter((x) => x.route && x.route.landed_price_cents != null)
    .slice(0, 4);
  const sp = onb.seller_profile;
  const approved = access?.latest_request?.status === 'approved' ? access.latest_request : null;

  const steps: Step[] = [
    {
      key: 'kyc', title: 'Company verified',
      detail: onb.kyc_status === 'verified' ? (kyc.data?.reviewed_at ? `KYC approved ${fmtDate(kyc.data.reviewed_at)}` : 'KYC approved') : 'Verify your company to keep Dropshipping on',
      state: onb.kyc_status === 'verified' ? 'done' : 'todo', href: onb.kyc_status === 'verified' ? undefined : '/account/kyc',
    },
    {
      key: 'access', title: 'Dropshipping access approved',
      detail: approved?.decided_at ? `By your account manager, ${fmtDate(approved.decided_at)}` : 'By your account manager',
      state: 'done',
    },
    {
      key: 'countries', title: 'Selling countries set',
      detail: onb.markets.length ? onb.markets.map((m) => countryName(m.country)).join(', ') : 'Choose where you sell',
      state: onb.markets.length ? 'done' : 'todo', href: onb.markets.length ? undefined : '/account/dropship/onboarding?step=1',
    },
    {
      key: 'profile', title: 'Return and brand profile',
      detail: !sp ? 'Add your brand and return address. Needed before any parcel ships.'
        : sp.status === 'approved' ? `Approved${sp.reviewed_at ? ` ${fmtDate(sp.reviewed_at)}` : ''}`
        : sp.status === 'rejected' ? (sp.customer_message ? `Changes needed: ${sp.customer_message}` : 'Changes needed. Open onboarding to fix it.')
        : 'Waiting for staff approval. Needed before any parcel ships.',
      state: !sp || sp.status === 'rejected' ? 'todo' : sp.status === 'approved' ? 'done' : 'waiting',
      href: !sp || sp.status === 'rejected' ? '/account/dropship/onboarding?step=2' : undefined,
    },
    {
      key: 'funds', title: 'Add funds',
      detail: `Wallet: ${available != null ? money(available, 'USD') : 'not available'}`,
      state: available != null && available > 0 ? 'done' : 'todo', href: '/account/dropship/wallet',
    },
    { key: 'store', title: 'Connect your Shopify store', detail: 'Next release', state: 'next' },
  ];
  const STATE_BADGE: Record<Step['state'], { tone: 'ok' | 'warn' | 'neutral' | 'info'; label: string }> = {
    done: { tone: 'ok', label: 'Done' }, waiting: { tone: 'warn', label: 'Waiting' }, todo: { tone: 'neutral', label: 'To do' }, next: { tone: 'info', label: 'Next release' },
  };

  return (
    <div className="flex flex-col gap-5" data-testid="ea-dashboard">
      <DsPageHeader
        title="Dashboard"
        subtitle={`Early access · ${orgName}`}
        icon="grid"
        actions={
          <>
            {features.find && <DsLinkButton href="/account/dropship/catalogue" variant="secondary" icon="search">Find products</DsLinkButton>}
            <DsLinkButton href="/account/dropship/wallet" variant="primary" icon="wallet">Add funds</DsLinkButton>
          </>
        }
      />

      <DsNotice tone="info" title="Store connection is the next release." testId="ea-next-release">
        Until then you can browse products with real landed costs to your countries, request products we don’t stock yet, and add funds to your wallet.
      </DsNotice>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
        <DsCard title="Getting started" subtitle="What’s done and what’s next" icon="check" testId="ea-getting-started">
          <ol className="list-none m-0 p-0 flex flex-col">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start justify-between gap-3 py-2.5 border-b border-[#EEF0F4] last:border-0" data-testid={`ea-step-${s.key}`}>
                <div className="flex items-start gap-3 min-w-0">
                  <span className={`mt-0.5 inline-flex w-6 h-6 rounded-full items-center justify-center shrink-0 ${s.state === 'done' ? 'bg-[#0B7A75] text-white' : 'border-2 border-[#C9D0DD] text-[#5B6478]'}`} aria-hidden="true">
                    {s.state === 'done' ? <DsIcon name="check" size={14} /> : null}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-[#1A174A]">{s.href ? <Link href={s.href} className="text-[#1A174A] underline">{s.title}</Link> : s.title}</div>
                    <div className="text-[13px] text-[#5B6478]">{s.detail}</div>
                  </div>
                </div>
                <DsBadge tone={STATE_BADGE[s.state].tone}>{STATE_BADGE[s.state].label}</DsBadge>
              </li>
            ))}
          </ol>
        </DsCard>

        <DsCard title="Wallet" icon="wallet" testId="ea-wallet">
          <dl className="m-0 flex flex-col gap-2 text-[14px]">
            <div className="flex justify-between gap-3"><dt className="text-[#5B6478]">Available</dt><dd className="m-0 font-mono font-semibold">{available != null ? money(available, 'USD') : '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#5B6478]">Held for protected orders</dt><dd className="m-0 font-mono">{held != null ? money(held, 'USD') : '—'}</dd></div>
          </dl>
          <p className="mt-3 mb-3 text-[13px] text-[#5B6478]">Add funds by bank transfer. Use your reference so we can match it.</p>
          <DsLinkButton href="/account/dropship/wallet" variant="secondary" icon="wallet">Add funds</DsLinkButton>
        </DsCard>
      </div>

      {features.requests && (
        <DsCard title="Your product requests" icon="file" noPadding testId="ea-requests"
          actions={<DsLinkButton href="/account/dropship/requests" variant="secondary" icon="send">Request a product</DsLinkButton>}>
          {requests.length === 0 ? (
            <p className="m-0 px-5 py-4 text-[13.5px] text-[#5B6478]">No requests yet. Ask our sourcing team for a product we don’t stock yet. It’s free.</p>
          ) : (
            <div className="ds-scroll">
              <table className="ds-tbl min-w-[640px]">
                <thead><tr><th scope="col">Request</th><th scope="col">Product</th><th scope="col">Status</th><th scope="col">Next step</th></tr></thead>
                <tbody>
                  {requests.slice(0, 5).map((r) => (
                    <tr key={r.rfq_id} data-testid={`ea-request-${r.rfq_code}`}>
                      <td className="font-mono">{r.rfq_code}</td>
                      <td>{r.title}</td>
                      <td><DsBadge tone={REQUEST_TONE[r.merchant_status] ?? 'neutral'}>{r.merchant_label}</DsBadge></td>
                      <td className="text-[13px]">
                        {r.merchant_status === 'quoted' && r.quoted_landed_cents != null ? (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <span>Landed {money(r.quoted_landed_cents, 'USD')}{r.quoted_country ? ` to ${countryName(r.quoted_country)}` : ''}</span>
                            <EaRequestActions rfqId={r.rfq_id} rfqCode={r.rfq_code} />
                          </span>
                        ) : r.dropship_model_no ? (
                          <span>{r.dropship_product_id ? <Link href={`/account/dropship/catalogue/${r.dropship_product_id}`} className="underline text-[#2A6FD1]">{r.dropship_model_no}</Link> : r.dropship_model_no} · only for you</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DsCard>
      )}

      {features.find && (
        <DsCard title="New in the catalogue" icon="package" testId="ea-new-products"
          subtitle="Landed cost = product + processing + shipping + duties (DDP)"
          actions={<DsLinkButton href="/account/dropship/catalogue" variant="secondary" icon="arrow">See all</DsLinkButton>}>
          {!firstCountry ? (
            <p className="m-0 text-[13.5px] text-[#5B6478]">Choose your selling countries to see landed costs. <Link href="/account/dropship/onboarding?step=1" className="underline text-[#2A6FD1]">Set countries</Link></p>
          ) : newest.length === 0 ? (
            <p className="m-0 text-[13.5px] text-[#5B6478]">No products with a full landed cost to {countryName(firstCountry)} yet.</p>
          ) : (
            <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {newest.map(({ r, route }) => (
                <li key={r.product_id} className="rounded-[12px] border border-[#E3E7EF] overflow-hidden bg-white">
                  <Link href={features.product_detail ? `/account/dropship/catalogue/${r.product_id}?country=${firstCountry}` : '/account/dropship/catalogue'} className="block no-underline text-[#1A174A] hover:text-[#1A174A]">
                    <div className="h-[120px] bg-[#E9EDF5] flex items-center justify-center text-[12px] text-[#5B6478]">
                      {r.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.images[0]} alt={r.title} className="w-full h-full object-cover" />
                      ) : 'No image yet'}
                    </div>
                    <div className="p-3 flex flex-col gap-1">
                      <span className="text-[14px] font-semibold leading-tight">{r.title}</span>
                      <span className="font-mono text-[12px] text-[#5B6478]">{r.model_no}</span>
                      <span className="text-[13px]">Landed to {countryName(firstCountry)} <strong className="font-mono">{money(route!.landed_price_cents, 'USD')}</strong></span>
                      <span><DsBadge tone={STOCK[r.stock_status]?.tone ?? 'info'}>{STOCK[r.stock_status]?.label ?? r.stock_status}</DsBadge></span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DsCard>
      )}
    </div>
  );
}
