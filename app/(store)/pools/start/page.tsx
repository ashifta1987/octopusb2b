import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';
import { Notice, EmptyState } from '@/components/ui';
import { getStoreContent } from '@/components/store/currency';
import { getPoolStartProduct, listOpenPools } from '@/components/store/data';
import { ProductImage, unitOne } from '@/components/store/product-card';
import { Breadcrumbs } from '@/components/store/seo';
import { getSettings, getWalletFunds } from '@/components/account/data';
import { StartPoolForm } from '@/components/store/pools/start-form';
import type { AddressOpt } from '@/components/store/pools/join-form';
import { poolSettings } from '@/components/store/pools/shared';

export const metadata: Metadata = { title: 'Start a group-buying pool', robots: { index: false } };

type SP = Promise<{ product?: string }>;

/** Start a pool on a product (SPEC §18 — entry point from the product page card). */
export default function StartPoolPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<div className="max-w-[960px] mx-auto px-4 sm:px-8 py-8"><div className="card h-[600px]" aria-busy="true" /></div>}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const { product: productId = '' } = await searchParams;
  const next = `/pools/start${productId ? `?product=${encodeURIComponent(productId)}` : ''}`;
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  const crumbs = [{ name: 'Home', href: '/' }, { name: 'Group buying pools', href: '/pools' }, { name: 'Start a pool' }];
  const [product, { settings }] = await Promise.all([getPoolStartProduct(productId), getStoreContent()]);
  const rules = poolSettings(settings);
  const shell = (children: React.ReactNode) => (
    <div className="max-w-[960px] mx-auto px-4 sm:px-8 py-6">
      <Breadcrumbs items={crumbs} />
      <h1 className="text-[28px] sm:text-[34px] font-extrabold mt-3">Start a pool</h1>
      <div className="mt-5">{children}</div>
    </div>
  );
  if (!product) {
    return shell(<div className="card"><EmptyState title="Choose a product first" body="Open any product page and use “Start a pool” in the group-buy card." action={<Link href="/products" className="btn btn-primary btn-sm">Browse products</Link>} /></div>);
  }
  if (!rules.enabled) return shell(<Notice tone="amber">Group buying is paused right now. You can still <Link href={`/request/sourcing?product=${product.id}`} className="underline font-semibold">request a quote</Link>.</Notice>);
  if (!s.org) {
    return shell(s.isStaff
      ? <Notice tone="blue">Staff accounts cannot start pools. Sign in with a buyer account.</Notice>
      : <Notice tone="amber">Complete your company profile to start a pool. <Link href={`/onboarding?next=${encodeURIComponent(next)}`} className="underline font-semibold">Finish onboarding</Link></Notice>);
  }
  const sb = await createClient();
  const [{ data: addr }, st, balance, open] = await Promise.all([
    sb.from('addresses').select('id, label, line1, city, country').eq('org_id', s.org.id).order('is_default', { ascending: false }).order('created_at'),
    getSettings(),
    getWalletFunds(product.currency),
    listOpenPools({ productId: product.id, sort: 'filled', limit: 1 }),
  ]);
  const existing = open.items[0];
  const u = unitOne(product.unit);
  return shell(
    <div className="space-y-6">
      <section className="card p-5 flex gap-4 items-center">
        <div className="w-20 shrink-0 rounded-[10px] overflow-hidden"><ProductImage src={product.image_url} alt={product.title} className="aspect-square" width={160} height={160} /></div>
        <div className="min-w-0">
          <Link href={`/p/${product.slug}`} className="font-semibold text-[17px] hover:text-blue">{product.title}</Link>
          <div className="text-[13px] text-muted mt-1">
            MOQ {product.moq.toLocaleString('en-US')} {product.unit}
            {product.supplier && <> · Supplier <span className="mono">{product.supplier.code}</span>{product.supplier.country && ` · ${product.supplier.country}`}</>}
          </div>
          {product.tiers.length > 0 && (
            <div className="text-[13px] mt-1">{product.tiers.map((t) => `${t.min_qty.toLocaleString('en-US')}+ ${money(t.unit_price_minor, product.currency)}/${u}`).join(' · ')}</div>
          )}
        </div>
      </section>
      {existing && (
        <Notice tone="blue">
          There is already an open pool for this product: <Link href={`/pool/${existing.code}`} className="underline font-semibold">{existing.code}</Link> ({existing.filled_qty.toLocaleString('en-US')} of {existing.target_qty.toLocaleString('en-US')} {product.unit}). Joining it fills faster than starting a new one.
        </Notice>
      )}
      <StartPoolForm
        product={{ id: product.id, title: product.title, unit: product.unit, unitOne: u, moq: Math.max(1, product.moq), tiers: product.tiers, currency: product.currency }}
        rules={{ minDays: rules.minDays, maxDays: rules.maxDays, defaultDays: rules.defaultDays, depositPct: rules.depositPct, minPledge: product.pool_minimum_pledge ?? rules.minPledgeDefault, maxBuyers: rules.maxBuyers }}
        addresses={(addr ?? []) as AddressOpt[]} walletEnabled={st.wallet_enabled} walletBalance={balance.balance} walletCredit={balance.credit} company={s.org.name}
      />
    </div>,
  );
}
