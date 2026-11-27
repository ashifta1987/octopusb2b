import Link from 'next/link';
import Image from 'next/image';
import { Search, Bell, ClipboardList, ChevronDown, Wallet } from 'lucide-react';
import { getSiteContent } from '@/lib/content';
import { money } from '@/lib/format';
import { getShopViewer } from '@/lib/shop/data';
import { PanelLink } from './panel-link';

/**
 * CH-1 Shop header (every /shop page; design Shop_Home / M_Shop_Home): original B2B logo → /shop, big search (products,
 * MOQ pools, turnkey projects → /shop/products?q=), Quote list with count, notifications with count, company, and
 * "My account panel ↗". Section bar (navy): All categories ▾, the shop sections and the wallet balance. Reads the session,
 * so it always renders inside <Suspense> (Cache Components).
 */
const pill = 'absolute -top-1.5 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-coral text-white text-[11px] font-bold leading-5 text-center';

export async function ShopHeader({ q = '' }: { q?: string }) {
  const [v, { categories, settings }] = await Promise.all([getShopViewer(), getSiteContent()]);
  return (
    <ShopHeaderView q={q} quoteCount={v.quoteCount} unread={v.unread} orgName={v.org.name} walletCents={v.wallet ? Number(v.wallet.available_cents) : null}
      categories={categories.filter((c) => c.level === 1).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))}
      poolsOn={settings.pool_enabled !== false} turnkeyOn={settings['turnkey.enabled'] !== false} />
  );
}

/** Presentational header (no data access): used by ShopHeader and by visual / unit checks. */
export function ShopHeaderView({ q = '', quoteCount, unread, orgName, walletCents, categories: top, poolsOn, turnkeyOn }: {
  q?: string; quoteCount: number; unread: number; orgName: string; walletCents: number | null;
  categories: { id: string; slug: string; name: string }[]; poolsOn: boolean; turnkeyOn: boolean;
}) {
  const v = { quoteCount, unread, org: { name: orgName } };
  const sections: [string, string][] = [
    ['/shop/products', 'Sourcing products'],
    ...(poolsOn ? [['/shop/pools', 'MOQ pools'] as [string, string]] : []),
    ...(turnkeyOn ? [['/shop/turnkey', 'Turnkey projects'] as [string, string]] : []),
    ['/shop#dropship', 'Dropshipping'],
    ['/request/brand', 'Make My Brand'],
    ['/shop/products?samples=1', 'Samples'],
    ['/shop/products?sort=newest', 'New arrivals'],
  ];
  return (
    <header className="bg-white border-b border-line" data-testid="shop-header">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href="/shop" aria-label="Octopus B2B shop home" className="block shrink-0">
          <Image src="/images/design/logos/octopus-b2b-original.jpg" alt="Octopus B2B, Global Sourcing, Simplified" width={1024} height={270}
            sizes="220px" loading="eager" className="block h-11 sm:h-14 w-auto" />
        </Link>
        <form action="/shop/products" role="search" className="order-last md:order-none basis-full md:basis-auto md:flex-1 min-w-0 flex" data-testid="shop-search">
          <label htmlFor="shop-q" className="sr-only">Search products, MOQ pools and turnkey projects</label>
          <input id="shop-q" name="q" type="search" defaultValue={q} placeholder="Search products, MOQ pools, turnkey projects"
            className="input !min-h-12 !rounded-r-none border-r-0 flex-1 min-w-0" />
          <button type="submit" className="btn btn-primary !rounded-l-none !min-h-12 px-4"><Search size={18} strokeWidth={1.9} aria-hidden /><span className="sr-only md:not-sr-only">Search</span></button>
        </form>
        <nav aria-label="Your shop" className="ml-auto md:ml-0 flex items-center gap-4 sm:gap-5">
          <Link href="/shop/quote-list" className="relative inline-flex items-center gap-2 min-h-11 font-semibold text-ink underline underline-offset-4 decoration-line-strong hover:text-coral-text" data-testid="quote-list-link">
            <ClipboardList size={20} strokeWidth={1.9} aria-hidden />
            <span className="hidden sm:inline">Quote list</span>
            <span className="sr-only sm:hidden">Quote list</span>
            <span className="rounded-full bg-tint text-ink text-[12px] font-bold px-2 py-0.5" data-testid="quote-count" aria-label={`${v.quoteCount} ${v.quoteCount === 1 ? 'product' : 'products'}`}>{v.quoteCount}</span>
          </Link>
          <PanelLink href="/account/notifications" icon={false} className="relative min-h-11 min-w-11 justify-center text-ink hover:text-coral-text" testId="notif-link">
            <Bell size={20} strokeWidth={1.9} aria-hidden />
            <span className="sr-only">Notifications, {v.unread} unread</span>
            {v.unread > 0 && <span className={pill} aria-hidden data-testid="notif-count">{v.unread > 99 ? '99+' : v.unread}</span>}
          </PanelLink>
          <div className="hidden lg:flex flex-col items-end leading-tight max-w-[200px]">
            <span className="text-[12px] text-muted">Signed in for</span>
            <span className="text-[14px] font-semibold text-ink truncate max-w-full" data-testid="shop-company">{v.org.name}</span>
          </div>
          <PanelLink href="/account" className="min-h-11 px-4 rounded-[10px] bg-ink text-white font-semibold no-underline hover:bg-ink-2 hover:text-white" testId="panel-link">
            <span className="hidden sm:inline">My account panel</span><span className="sm:hidden">Account</span>
          </PanelLink>
        </nav>
      </div>
      <nav aria-label="Shop sections" className="bg-ink text-white">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 flex items-center gap-4">
          <div className="flex-1 min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label="Shop sections (scrolls sideways)">
            <ul className="flex items-center gap-x-6 list-none m-0 p-0 whitespace-nowrap text-[15px] font-medium">
              <li className="relative">
                <details className="group" data-testid="all-categories">
                  <summary className="list-none cursor-pointer inline-flex items-center gap-1 min-h-11 font-semibold [&::-webkit-details-marker]:hidden">
                    All categories <ChevronDown size={16} strokeWidth={1.9} aria-hidden className="group-open:rotate-180 transition-transform" />
                  </summary>
                  <ul className="absolute z-30 left-0 top-full mt-1 w-64 max-h-[60vh] overflow-y-auto bg-white text-ink rounded-[12px] border border-line shadow-lg list-none m-0 p-2">
                    {top.map((c) => (
                      <li key={c.id}><Link href={`/shop/products?c=${encodeURIComponent(c.slug)}`} className="flex items-center min-h-11 px-3 rounded-[8px] underline underline-offset-4 decoration-line-strong hover:bg-tint">{c.name}</Link></li>
                    ))}
                    <li><Link href="/shop/products" className="flex items-center min-h-11 px-3 rounded-[8px] font-semibold underline underline-offset-4 hover:bg-tint">Every product</Link></li>
                  </ul>
                </details>
              </li>
              {sections.map(([href, label]) => (
                <li key={href}><Link href={href} className="inline-flex items-center min-h-11 text-white underline underline-offset-[6px] decoration-white/40 hover:decoration-white">{label}</Link></li>
              ))}
            </ul>
          </div>
          {walletCents != null && (
            <PanelLink href="/account/wallet" icon={false} className="shrink-0 min-h-11 gap-2 text-white font-semibold underline underline-offset-[6px] decoration-white/40 hover:decoration-white" testId="shop-wallet">
              <Wallet size={18} strokeWidth={1.9} aria-hidden />
              <span className="sr-only">Wallet available:</span>
              <span className="mono">{money(walletCents, 'USD')}</span>
            </PanelLink>
          )}
        </div>
      </nav>
    </header>
  );
}

export function ShopHeaderSkeleton() {
  return <div className="h-[150px] md:h-[124px] bg-white border-b border-line" aria-hidden />;
}
