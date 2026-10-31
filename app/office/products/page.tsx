import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, EmptyState, Money, Notice } from '@/components/ui';
import { ReasonButton, RunButton } from '@/components/backoffice/action-form';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, money } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { cn } from '@/lib/cn';
import { moderateProduct } from '../actions';

export const metadata = { title: 'Product moderation' };

export default async function Moderation({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireStaff('products', 'approve', '/office/products');
  const { p: selId } = await searchParams;
  const sb = await createClient();
  const { data: queue } = await sb.from('products')
    .select('id, title, status, updated_at, image_url, suppliers(code, country)')
    .in('status', ['submitted', 'in_review']).order('updated_at').limit(100);
  const sel = selId ?? queue?.[0]?.id;
  const { data: p } = sel ? await sb.from('products')
    .select('id, title, description, status, unit, moq, lead_time_days, incoterm, origin_country, hs_code, octopus_dropship, ready_to_ship, seo_title, seo_description, image_url, updated_at, rejection_reason, suppliers(code, legal_name, country, verified, supplier_switches(listings_live)), categories(name), currency, price_tiers(min_qty, unit_price_cents, currency), product_specs(name, value, sort), product_media(url, sort), product_tags(tags(name)), product_certificates(certificates(name, status))')
    .eq('id', sel).maybeSingle() : { data: null };
  const sup = p ? one(p.suppliers as unknown as { code: string; legal_name: string; country: string; verified: boolean; supplier_switches: { listings_live: boolean } | { listings_live: boolean }[] | null } | null) : null;
  const listingsOff = sup ? one(sup.supplier_switches)?.listings_live === false : false;
  const tiers = ((p?.price_tiers ?? []) as { min_qty: number; unit_price_cents: number; currency: string }[]).sort((a, b) => a.min_qty - b.min_qty);
  const cx = await getCurrencyContext();
  const lowest = tiers[tiers.length - 1];
  // storefront shows catalogue prices converted to the platform currency (SPEC §15.1)
  const lowestPlatform = lowest && lowest.currency !== cx.currency ? toPlatform(cx, lowest.unit_price_cents, lowest.currency) : null;
  const media = ((p?.product_media ?? []) as { url: string; sort: number }[]).sort((a, b) => a.sort - b.sort);
  const issues = p ? [
    !p.description || p.description.length < 80 ? 'Description is short (under 80 characters)' : null,
    !tiers.length ? 'No price tiers' : null,
    !media.length && !p.image_url ? 'No photos' : null,
    !p.hs_code ? 'Missing HS code' : null,
    !one(p.categories as unknown as { name: string } | null) ? 'No category' : null,
  ].filter(Boolean) as string[] : [];

  return (
    <>
      <PageHeader title="Product moderation" subtitle="Check listings before they go live. Approve publishes to the storefront; reject sends the reason back to the distributor." />
      <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
        <Card title={`Queue · ${queue?.length ?? 0}`}>
          {!queue?.length ? <EmptyState title="Queue is clear" body="Submitted products appear here." /> : (
            <ul className="border-t border-line divide-y divide-line">
              {queue.map((q) => (
                <li key={q.id}>
                  <Link href={`/office/products?p=${q.id}`} aria-current={q.id === sel ? 'true' : undefined}
                    className={cn('flex gap-3 px-5 py-3 border-l-[3px]', q.id === sel ? 'bg-blue-soft border-blue' : 'border-transparent hover:bg-surface')}>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm line-clamp-2">{q.title}</div>
                      <div className="text-xs text-muted mono">{one(q.suppliers as unknown as { code: string } | null)?.code} · {fmtDate(q.updated_at, true)}</div>
                    </div>
                    <StatusBadge status={q.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {p ? (
          <section className="card p-6">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <div className="mono text-xs text-muted">{sup?.code} · {sup?.legal_name} · {sup?.country}{sup?.verified ? ' · verified' : ''}</div>
                <h2 className="text-2xl font-semibold mt-1">{p.title}</h2>
                <div className="text-sm text-muted">{one(p.categories as unknown as { name: string } | null)?.name ?? 'No category'} · updated {fmtDate(p.updated_at, true)}</div>
              </div>
              <StatusBadge status={p.status} />
            </div>
            {listingsOff && <div className="mt-4"><Notice tone="red">This supplier&apos;s “listings live” switch is off — approval will fail until it is turned on.</Notice></div>}
            {issues.length > 0 && <div className="mt-4"><Notice tone="amber"><b>Check:</b> {issues.join(' · ')}</Notice></div>}
            <div className="grid md:grid-cols-[260px_1fr] gap-6 mt-5">
              <div>
                {(media[0]?.url ?? p.image_url)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={media[0]?.url ?? p.image_url!} alt={p.title} className="w-full aspect-square object-cover rounded-[10px] border border-line" />
                  : <div className="ph aspect-square rounded-[10px]">No photo</div>}
                <div className="flex gap-2 mt-2 flex-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {media.slice(1, 5).map((m) => <img key={m.url} src={m.url} alt="" className="w-14 h-14 object-cover rounded-md border border-line" />)}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Price tiers{tiers[0] ? <span className="ml-2 text-xs font-normal text-muted">entered in {tiers[0].currency}</span> : null}</h3>
                  {tiers.length ? (
                    <table className="w-full text-sm"><tbody>
                      {tiers.map((t, i) => <tr key={t.min_qty} className="border-b border-line"><td className="py-1.5">{t.min_qty.toLocaleString()}{tiers[i + 1] ? `–${(tiers[i + 1].min_qty - 1).toLocaleString()}` : '+'} {p.unit}</td><td className="py-1.5 text-right"><Money cents={t.unit_price_cents} currency={t.currency} /></td></tr>)}
                    </tbody></table>
                  ) : <p className="text-sm text-bad">No tiers</p>}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[['MOQ', `${p.moq} ${p.unit}`], ['Lead time', p.lead_time_days ? `${p.lead_time_days} days` : '—'], ['Incoterm', p.incoterm], ['Origin', p.origin_country], ['HS code', p.hs_code],
                    ['Flags', [p.octopus_dropship && 'Octopus Dropship', p.ready_to_ship && 'Ready to ship'].filter(Boolean).join(', ') || '—']]
                    .map(([l, v]) => <div key={l as string}><dt className="text-muted">{l}</dt><dd className="font-medium">{v || '—'}</dd></div>)}
                </dl>
                <div className="flex flex-wrap gap-1">
                  {((p.product_tags ?? []) as { tags: { name: string } | { name: string }[] | null }[]).map((t, i) => <span key={i} className="text-xs rounded-full bg-blue-soft text-[#1E4F9C] px-2 py-0.5 font-semibold">{one(t.tags)?.name}</span>)}
                  {((p.product_certificates ?? []) as { certificates: { name: string; status: string } | { name: string; status: string }[] | null }[]).map((c, i) => { const x = one(c.certificates); return <span key={`c${i}`} className="text-xs rounded-full bg-[#E3F5EA] text-[#156B3A] px-2 py-0.5 font-semibold">{x?.name} · {x?.status}</span>; })}
                </div>
              </div>
            </div>
            <div className="mt-5">
              <h3 className="font-semibold mb-1">Description</h3>
              <p className="text-sm whitespace-pre-line">{p.description || <span className="text-muted">—</span>}</p>
            </div>
            {((p.product_specs ?? []) as { name: string; value: string; sort: number }[]).length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold mb-1">Specifications</h3>
                <dl className="grid sm:grid-cols-2 gap-x-6 text-sm">
                  {((p.product_specs ?? []) as { name: string; value: string; sort: number }[]).sort((a, b) => a.sort - b.sort).map((s) => <div key={s.name} className="flex justify-between border-b border-line py-1"><dt className="text-muted">{s.name}</dt><dd>{s.value}</dd></div>)}
                </dl>
              </div>
            )}
            <div className="mt-4 rounded-[10px] bg-surface p-4 text-sm">
              <div className="text-xs text-muted">Search preview</div>
              <div className="text-blue font-semibold">{p.seo_title || p.title}</div>
              <div className="text-muted">{p.seo_description || '—'}</div>
              {tiers[0] && <div className="text-xs text-muted mt-1">From {money(lowest.unit_price_cents, lowest.currency)} / {p.unit}{lowestPlatform != null ? ` · storefront ≈ ${money(lowestPlatform, cx.currency)} (converted)` : ''}</div>}
            </div>
            <div className="border-t border-line mt-6 pt-5 flex flex-wrap gap-3 justify-end">
              {p.status === 'submitted' && <RunButton action={moderateProduct.bind(null, p.id, 'in_review', '')}>Start review</RunButton>}
              <ReasonButton action={moderateProduct.bind(null, p.id, 'rejected')} label="Reject" title="Reject listing" placeholder="Reason (sent to the distributor)" className="btn btn-ghost text-bad" danger confirmLabel="Reject" />
              <RunButton className="btn bg-ok text-white" action={moderateProduct.bind(null, p.id, 'live', '')} confirm="Publish this listing to the storefront?">Approve &amp; publish</RunButton>
            </div>
          </section>
        ) : <Card><EmptyState title="Select a product" /></Card>}
      </div>
    </>
  );
}
