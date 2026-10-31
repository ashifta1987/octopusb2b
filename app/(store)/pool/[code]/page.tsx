import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { money, fmtDate, COUNTRY_NAMES, humanize } from '@/lib/format';
import { StatusBadge, Notice } from '@/components/ui';
import { getStoreContent } from '@/components/store/currency';
import { getPool, getGroupBuyTerms, type PoolDetail, type PoolParticipant } from '@/components/store/data';
import { ProductImage, unitOne } from '@/components/store/product-card';
import { Breadcrumbs, JsonLd, breadcrumbLd, SITE_URL } from '@/components/store/seo';
import { getSettings, getWalletBalance } from '@/components/account/data';
import { getCurrencyContext } from '@/lib/currency';
import { Countdown } from '@/components/store/pools/countdown';
import { JoinPoolForm, type AddressOpt } from '@/components/store/pools/join-form';
import { WithdrawButton, CopyLinkButton } from '@/components/store/pools/pool-actions';
import { fillTone, pct, poolSettings, priceAt, type PoolSettings } from '@/components/store/pools/shared';

type Params = Promise<{ code: string }>;
const fmt = (n: number) => n.toLocaleString('en-US');
const ACTIVE = ['pending', 'paid', 'confirmed', 'shipped', 'delivered'];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  const p = await getPool(code);
  if (!p) return { title: 'Pool not found', robots: { index: false } };
  const title = `Group buy: ${p.product.title} (${p.code})`;
  const description = `Join pool ${p.code}: ${fmt(p.filled_qty)} of ${fmt(p.target_qty)} ${p.product.unit} pledged by ${p.buyers} buyers. Pool price ${money(p.pool_price_minor, p.currency)} per ${unitOne(p.product.unit)}, ${p.deposit_pct}% deposit held in escrow.`;
  return {
    title: { absolute: title }, description,
    alternates: { canonical: `/pool/${p.code}` },
    openGraph: { title, description, type: 'website', url: `/pool/${p.code}`, images: p.product.image_url ? [p.product.image_url] : undefined },
    robots: p.status === 'open' ? undefined : { index: false },
  };
}

/** Pool.png — pool detail (SPEC §18.4). Public parts are cached ('pools'); the join panel and "You" row stream per user. */
export default function PoolPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<PoolSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Params }) {
  const { code } = await params;
  const p = await getPool(code);
  if (!p) notFound();
  const [{ settings, company }, terms] = await Promise.all([getStoreContent(), getGroupBuyTerms()]);
  const rules = poolSettings(settings);
  const u = unitOne(p.product.unit);
  const need = Math.max(0, p.target_qty - p.filled_qty);
  const tone = fillTone(p.filled_qty, p.target_qty);
  const crumbs = [
    { name: 'Home', href: '/' }, { name: 'Group buying pools', href: '/pools' },
    { name: p.product.title, href: `/p/${p.product.slug}` }, { name: `Pool ${p.code}`, href: `/pool/${p.code}` },
  ];
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: `Group buy: ${p.product.title}`, sku: p.code, url: `${SITE_URL}/pool/${p.code}`,
    image: p.product.image_url ?? undefined,
    brand: { '@type': 'Brand', name: company?.brand ?? 'Octopus B2B' },
    offers: p.pool_price_minor != null ? {
      '@type': 'Offer', priceCurrency: p.currency, price: (p.pool_price_minor / 100).toFixed(2), url: `${SITE_URL}/pool/${p.code}`,
      availability: p.status === 'open' ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/SoldOut',
      priceValidUntil: p.deadline_at.slice(0, 10),
      eligibleQuantity: { '@type': 'QuantitativeValue', minValue: p.min_pledge, unitText: p.product.unit },
      seller: { '@type': 'Organization', name: company?.brand ?? 'Octopus B2B' },
    } : undefined,
  };
  const markers = p.tiers.filter((t, i) => i > 0 && t.min_qty < p.target_qty);
  const targetTier = p.tiers.reduce((idx, t, i) => (p.target_qty >= t.min_qty ? i : idx), 0);
  const currentTier = p.tiers.reduce((idx, t, i) => (p.filled_qty >= t.min_qty ? i : idx), 0);

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6">
      <JsonLd data={ld} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs items={crumbs} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-5 items-start">
        <div className="space-y-6 min-w-0">
          {/* Hero */}
          <section className="card p-6 flex flex-col sm:flex-row gap-6">
            <div className="w-[120px] shrink-0 rounded-[12px] overflow-hidden"><ProductImage src={p.product.image_url} alt={p.product.title} className="aspect-square" width={240} height={240} /></div>
            <div className="min-w-0">
              {p.status === 'open'
                ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF3D6] text-[#8A5A00] text-[12px] font-semibold px-2.5 py-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /></svg>
                    Pool closes in <Countdown to={p.deadline_at} withMinutes className="mono" />
                  </span>
                : <StatusBadge status={p.status} label={`Pool ${humanize(p.status).toLowerCase()}`} />}
              <h1 className="text-[26px] sm:text-[32px] font-extrabold leading-tight mt-3">Group buy: {p.product.title}</h1>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-muted mt-2">
                <span className="mono">{p.code}</span>
                {p.supplier && <span>Supplier <span className="mono">{p.supplier.code}</span>{p.supplier.country && ` · ${p.supplier.country}`}</span>}
                {p.product.hs_code && <span>HS {p.product.hs_code}</span>}
                <Link href={`/p/${p.product.slug}`} className="text-blue font-semibold">View product</Link>
              </div>
              <p className="text-[15px] text-[#3B4556] leading-relaxed mt-3">
                Join this pool to buy fewer pieces at the factory tier price. Everyone pays a {p.deposit_pct}% deposit now. When the pool fills, Octopus places one order with the supplier and ships each buyer their part.
              </p>
            </div>
          </section>

          {/* Progress */}
          <section className="card p-6" aria-labelledby="prog-h">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <h2 id="prog-h" className="text-[20px] font-bold">Pool progress</h2>
              {p.status === 'open' ? <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone.cls}`}>{tone.key === 'hot' ? 'Almost full' : tone.key === 'warm' ? 'On track to fill' : 'Needs more buyers'}</span> : <StatusBadge status={p.status} />}
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mt-3">
              <div className="flex items-baseline gap-4 flex-wrap">
                <span><span className="font-display font-extrabold text-[34px]">{fmt(p.filled_qty)}</span> <span className="text-muted">/ {fmt(p.target_qty)} {p.product.unit}</span></span>
                {p.week_qty > 0 && <span className="font-semibold text-ok">+{fmt(p.week_qty)} {p.product.unit} this week</span>}
              </div>
              <span className="text-[14px] text-[#3B4556]">{p.buyers} {p.buyers === 1 ? 'buyer' : 'buyers'} joined{need > 0 ? ` · needs ${fmt(need)} ${p.product.unit} more` : ' · target reached'}</span>
            </div>
            <div className="relative mt-4">
              <div className="h-3 rounded-full bg-[#E9ECF1] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={p.target_qty} aria-valuenow={p.filled_qty} aria-label={`${fmt(p.filled_qty)} of ${fmt(p.target_qty)} ${p.product.unit} pledged`}>
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#2A6FD6,#1E58B0)]" style={{ width: `${pct(p.filled_qty, p.target_qty)}%` }} />
              </div>
              {markers.map((t) => <span key={t.min_qty} aria-hidden className="absolute top-0 h-3 w-0.5 bg-[#B4540A]" style={{ left: `${(t.min_qty / p.target_qty) * 100}%` }} />)}
            </div>
            <div className="relative h-5 mt-2 text-[12px]">
              <span className="absolute left-0 text-muted">0</span>
              {markers.map((t) => {
                const tierNo = p.tiers.indexOf(t) + 1;
                return <span key={t.min_qty} className="absolute -translate-x-1/2 font-semibold text-[#B4540A] whitespace-nowrap" style={{ left: `${(t.min_qty / p.target_qty) * 100}%` }}>{fmt(t.min_qty)} · tier {tierNo} unlocks here</span>;
              })}
              <span className="absolute right-0 text-muted">Target {fmt(p.target_qty)}</span>
            </div>
            {p.tiers.length > 0 && (
              <ul className="grid gap-3 sm:grid-cols-3 mt-5">
                {p.tiers.slice(0, 3).map((t, i) => (
                  <li key={t.min_qty} className={`rounded-[12px] border-2 px-4 py-3 ${i === targetTier ? 'border-blue bg-blue-soft/30' : 'border-line bg-surface'}`}>
                    <div className="mono text-[11px] uppercase tracking-wide text-muted">At {fmt(t.min_qty)} {p.product.unit}</div>
                    <div className="font-display font-bold text-[20px]">{money(t.unit_price_minor, p.currency)} / {u}</div>
                    <div className="text-[12px] text-muted">tier {i + 1}{i === currentTier ? ' · current' : ''}{i === targetTier ? ' · if pool fills' : i > targetTier ? ' · next pool' : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Buyers */}
          <section className="card overflow-hidden" aria-labelledby="buyers-h">
            <div className="flex flex-wrap justify-between items-center gap-2 px-6 pt-6 pb-3">
              <h2 id="buyers-h" className="text-[20px] font-bold">Buyers in this pool</h2>
              <p className="text-[13px] text-muted">Supplier and other buyers see codes only, not names.</p>
            </div>
            <Suspense fallback={<BuyersTable pool={p} />}>
              <BuyersWithMe pool={p} />
            </Suspense>
          </section>

          {/* How it works */}
          <section className="card p-6" aria-labelledby="how-h">
            <h2 id="how-h" className="text-[20px] font-bold">How a MOQ pool works</h2>
            <ol className="list-decimal pl-5 space-y-3 mt-4 text-[15px] leading-relaxed text-[#3B4556]">
              <li><b className="text-navy">Pledge your quantity</b> and pay a {p.deposit_pct}% deposit from your wallet or by card. Your deposit is held in escrow by Octopus.</li>
              <li><b className="text-navy">Wait for the pool to fill.</b> Share the pool link with partners if you want. New buyers&apos; pledges push the price down for everyone.</li>
              <li><b className="text-navy">If the pool fills before the deadline:</b> every buyer gets a proforma invoice for the balance ({100 - p.deposit_pct}%) at the pool price. Pay within {rules.balanceHours} hours.</li>
              <li><b className="text-navy">Octopus places one order</b> with the supplier. QC inspection is shared. Each buyer gets a separate shipment to their address with YunExpress tracking.</li>
              <li><b className="text-navy">If the pool does not fill:</b> all deposits are refunded to each buyer&apos;s wallet. No one is charged.</li>
            </ol>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted mt-5 border-t border-line pt-3">
              <li>· Minimum pledge {fmt(p.min_pledge)} {p.product.unit}</li>
              <li>· Deposit non-refundable if you back out after the pool fills</li>
              <li>· Governed by our <Link href="/pools/terms" className="text-navy font-semibold underline">Group Buy Terms</Link>{terms && ` (${terms.version})`}</li>
            </ul>
          </section>
        </div>

        {/* Right column */}
        <aside className="space-y-5 min-w-0 lg:sticky lg:top-6">
          <section className="card p-6 border-2 border-blue" aria-labelledby="join-h">
            <h2 id="join-h" className="text-[20px] font-bold">Join this pool</h2>
            <div className="rounded-[10px] bg-blue-soft/50 px-4 py-3 text-[13px] mt-4">
              <b>Current pool price</b> at {fmt(p.filled_qty)} {p.product.unit}: <span className="mono font-semibold">{money(p.pool_price_minor, p.currency)} / {u}</span>.
              {p.target_price_minor != null && p.target_price_minor !== p.pool_price_minor && <> Reaches <span className="mono font-semibold">{money(p.target_price_minor, p.currency)}</span> if the pool fills.</>}
            </div>
            <div className="mt-4">
              <Suspense fallback={<div className="h-[420px] rounded-[10px] bg-surface animate-pulse" aria-label="Loading join form" />}>
                <JoinPanel pool={p} rules={rules} termsId={terms?.id ?? p.terms_version_id} />
              </Suspense>
            </div>
          </section>

          <section className="card p-5" aria-labelledby="starter-h">
            <h2 id="starter-h" className="font-bold">Pool starter</h2>
            {p.starter ? (
              <div className="flex items-center gap-3 mt-3">
                <span className="w-10 h-10 rounded-full bg-navy text-white mono text-[12px] font-semibold flex items-center justify-center" aria-hidden>{p.starter.country ?? '—'}</span>
                <div>
                  <div className="mono font-semibold">{p.starter.buyer_code}</div>
                  <div className="text-[12px] text-muted">{p.starter.country ? (COUNTRY_NAMES[p.starter.country] ?? p.starter.country) : 'Country not shared'}</div>
                </div>
              </div>
            ) : <p className="text-[13px] text-muted mt-2">Opened by a verified Octopus buyer.</p>}
            <p className="text-[13px] text-muted mt-3">Started this pool on {fmtDate(p.created_at)}. Pool starters do not get a special rate; they just open the pool for others to join.</p>
            <div className="mt-3"><CopyLinkButton url={`${SITE_URL}/pool/${p.code}`} /></div>
          </section>

          <section className="card p-5" aria-labelledby="safe-h">
            <h2 id="safe-h" className="font-bold">Safeguards</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-[#3B4556] mt-3">
              <li>Deposits held by Octopus in escrow, not sent to the supplier.</li>
              <li>Shared QC inspection before shipment, report shared with every buyer.</li>
              <li>Separate claim window and refund route for each buyer.</li>
              <li>Pool capped at {p.max_buyers} buyers to keep logistics simple.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function BuyersTable({ pool: p, me }: { pool: PoolDetail; me?: { code: string; company: string } | null }) {
  const rows = [...p.participants].sort((a, b) => (me && a.buyer_code === me.code ? -1 : me && b.buyer_code === me.code ? 1 : b.joined_at.localeCompare(a.joined_at)));
  if (!rows.length) return <p className="px-6 pb-6 text-sm text-muted">No buyers yet — be the first to pledge.</p>;
  const paid = (r: PoolParticipant) => r.status !== 'pending';
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr>{['Buyer', 'Country', 'Pledged', 'Deposit', 'Joined'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const mine = me && r.buyer_code === me.code;
            return (
              <tr key={r.buyer_code + r.joined_at} className={mine ? 'bg-blue-soft/30' : undefined}>
                <td className="td font-semibold">{mine ? <>You · {me!.company}</> : <span className="mono">{r.buyer_code}</span>}</td>
                <td className="td">{r.country ?? '—'}</td>
                <td className="td mono">{fmt(r.qty)} {p.product.unit}</td>
                <td className={`td mono ${paid(r) ? 'text-ok' : 'text-warn'}`}>{money(r.deposit_minor, r.currency)} {paid(r) ? 'paid' : 'pending'}</td>
                <td className="td text-muted">{fmtDate(r.joined_at)}{r.is_starter && ' · starter'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function BuyersWithMe({ pool }: { pool: PoolDetail }) {
  const s = await getSession();
  if (!s?.org) return <BuyersTable pool={pool} />;
  const sb = await createClient();
  const { data } = await sb.from('organizations').select('buyer_code').eq('id', s.org.id).maybeSingle();
  return <BuyersTable pool={pool} me={data?.buyer_code ? { code: data.buyer_code as string, company: s.org.name } : null} />;
}

type MyPledge = {
  id: string; qty: number; status: string; deposit_minor: number; balance_minor: number | null; currency: string; pay_source: string;
  order_id: string | null; order_code: string | null; order_total_minor: number | null; order_paid_minor: number | null; balance_due_at: string | null; pool_status: string;
};

async function JoinPanel({ pool: p, rules, termsId }: { pool: PoolDetail; rules: PoolSettings; termsId: string | null }) {
  const s = await getSession();
  const next = `/pool/${p.code}`;
  if (!s) {
    return (
      <div className="space-y-3 text-[14px]">
        <p className="text-[#3B4556]">Sign in to pledge. Minimum pledge {fmt(p.min_pledge)} {p.product.unit}, {p.deposit_pct}% deposit held in escrow.</p>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn btn-primary w-full">Sign in to join</Link>
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="btn btn-ghost w-full">Create a buyer account</Link>
      </div>
    );
  }
  if (!s.org) {
    return s.isStaff
      ? <Notice tone="blue">You are signed in as staff. Manage pools in <Link href="/admin/pools" className="underline font-semibold">Admin › Group buying</Link>.</Notice>
      : <Notice tone="amber">Complete your company profile to join. <Link href={`/onboarding?next=${encodeURIComponent(next)}`} className="underline font-semibold">Finish onboarding</Link></Notice>;
  }
  const sb = await createClient();
  const [{ data: mine }, { data: addr }, settings, balance, ctx] = await Promise.all([
    sb.from('pool_pledge_mine_view').select('id, qty, status, deposit_minor, balance_minor, currency, pay_source, order_id, order_code, order_total_minor, order_paid_minor, balance_due_at, pool_status')
      .eq('pool_id', p.id).eq('org_id', s.org.id).in('status', ACTIVE).order('joined_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('addresses').select('id, label, line1, city, country').eq('org_id', s.org.id).order('is_default', { ascending: false }).order('created_at'),
    getSettings(),
    getWalletBalance(p.currency),
    getCurrencyContext(),
  ]);
  if (mine) return <MyPledgeCard pledge={mine as MyPledge} pool={p} />;
  if (p.status !== 'open') return <p className="text-[14px] text-muted">This pool is {humanize(p.status).toLowerCase()} and no longer takes pledges. <Link href="/pools" className="text-blue font-semibold">See open pools</Link>.</p>;
  if (!rules.enabled) return <Notice tone="amber">Group buying is paused right now. Please check back later.</Notice>;
  if (ctx.currency !== p.currency) return <Notice tone="amber">This pool is priced in {p.currency}, but Octopus now bills in {ctx.currency}, so it cannot take new pledges. Start a new pool on the <Link href={`/p/${p.product.slug}`} className="underline font-semibold">product page</Link>.</Notice>;
  if (p.buyers >= p.max_buyers) return <Notice tone="amber">This pool has reached its {p.max_buyers}-buyer limit.</Notice>;
  return (
    <JoinPoolForm
      pool={{ id: p.id, code: p.code, currency: p.currency, min_pledge: p.min_pledge, filled_qty: p.filled_qty, target_qty: p.target_qty, deposit_pct: p.deposit_pct, tiers: p.tiers, unit: p.product.unit, unitOne: unitOne(p.product.unit) }}
      addresses={(addr ?? []) as AddressOpt[]} walletEnabled={settings.wallet_enabled} walletBalance={balance} termsId={termsId} company={s.org.name}
    />
  );
}

function MyPledgeCard({ pledge: m, pool: p }: { pledge: MyPledge; pool: PoolDetail }) {
  const unpaid = m.order_total_minor != null && m.order_paid_minor != null ? Math.max(0, Number(m.order_total_minor) - Number(m.order_paid_minor)) : null;
  const est = priceAt(p.tiers, Math.max(p.target_qty, p.filled_qty));
  return (
    <div className="space-y-3 text-[14px]">
      <div className="flex justify-between items-center gap-2">
        <span className="font-semibold">Your pledge</span>
        <StatusBadge status={m.status} label={m.status === 'pending' ? 'Deposit pending' : m.status === 'paid' ? 'Deposit paid' : undefined} />
      </div>
      <dl className="space-y-1.5">
        <div className="flex justify-between"><dt className="text-muted">Quantity</dt><dd className="mono font-semibold">{fmt(m.qty)} {p.product.unit}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Deposit ({m.pay_source === 'wallet' ? 'wallet' : 'card / bank'})</dt><dd className="mono font-semibold">{money(m.deposit_minor, m.currency)}</dd></div>
        {m.order_id && unpaid != null ? (
          <div className="flex justify-between"><dt className="text-muted">Balance due</dt><dd className="mono font-semibold">{money(unpaid, m.currency)}</dd></div>
        ) : est != null && (
          <div className="flex justify-between"><dt className="text-muted">Balance when pool fills (est.)</dt><dd className="mono font-semibold">{money(Math.max(0, est * m.qty - m.deposit_minor), m.currency)}</dd></div>
        )}
      </dl>
      {m.status === 'pending' && <Notice tone="amber">Pay the {money(m.deposit_minor, m.currency)} deposit by card / bank transfer — your pledge lapses if it is unpaid when the pool fills.</Notice>}
      {m.order_id && unpaid != null && unpaid > 0 && (
        <div className="rounded-[10px] bg-[#FFF3D6] text-[#8A5A00] px-4 py-3">
          <div className="font-semibold">The pool filled — pay your balance{m.balance_due_at && <> within <Countdown to={m.balance_due_at} withMinutes /></>}.</div>
          <div className="text-[12px] mt-1">If the balance is unpaid by the deadline, the deposit is forfeited (Group Buy Terms §6).</div>
          <Link href={`/account/orders/${m.order_id}`} className="btn btn-primary btn-sm mt-3">Pay balance{m.order_code && ` · ${m.order_code}`}</Link>
        </div>
      )}
      {m.order_id && unpaid === 0 && <Notice tone="green">Balance paid — order <Link href={`/account/orders/${m.order_id}`} className="underline font-semibold">{m.order_code}</Link> is confirmed.</Notice>}
      {p.status === 'open' && ['pending', 'paid'].includes(m.status) && (
        <div className="flex flex-wrap justify-between items-center gap-2 border-t border-line pt-3">
          <span className="text-[12px] text-muted">You can back out until the pool fills.</span>
          <WithdrawButton pledgeId={m.id} code={p.code} />
        </div>
      )}
      <Link href="/account/pools" className="text-[13px] text-blue font-semibold">All my group buys →</Link>
    </div>
  );
}

function PoolSkeleton() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6" aria-busy="true" aria-label="Loading pool">
      <div className="h-4 w-72 bg-line rounded" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-5">
        <div className="space-y-6"><div className="card h-[240px]" /><div className="card h-[300px]" /><div className="card h-[320px]" /></div>
        <div className="card h-[640px]" />
      </div>
    </div>
  );
}
