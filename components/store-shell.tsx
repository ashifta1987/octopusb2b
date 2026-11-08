import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/ui';
import { getSiteContent, block } from '@/lib/content';
import { getSession } from '@/lib/auth';
import { getCurrencyContext } from '@/lib/currency';
import { activeSwitchBanner } from '@/components/store/currency';
import { CurrencySwitchBanner } from '@/components/store/currency-banner';
import { getHomeLiveData } from '@/components/store/home/live-data';
import { AnnouncementBar } from '@/components/store/home/top';
import { getTurnkeyCatalogue } from '@/lib/turnkey/data';
import { getCategoryCounts } from '@/components/store/data';
import { stockedCategories } from '@/lib/category-stock';
import { ServiceLinks } from '@/components/store/service-links';

/**
 * Storefront layout header + category bar (Main.png, Nov 2026 redesign). All copy from CMS.
 * QA §19 Performance (CLS): the header itself only reads cached CMS/currency data so it is part of the static shell;
 * only the session-dependent "My account" target and the time-based currency banner stream in (fixed-size fallbacks).
 */
export async function StoreHeader() {
  const [{ categories, settings }, live, counts] = await Promise.all([getSiteContent(), getHomeLiveData(), getCategoryCounts()]);
  // ADDON-36 C4: only categories with live products, most stocked first
  const top = stockedCategories(categories, counts).filter((c) => c.level === 1);
  // real number of live products (no marketing figure)
  const products = live.products ? new Intl.NumberFormat('en-US').format(live.products) : null;
  const pill = 'inline-flex items-center gap-[7px] px-3 py-2 rounded-full text-[14px] font-medium whitespace-nowrap shrink-0 hover:bg-pearl hover:text-ink';
  return (
    <>
      {/* brand kit: header + service rail stay together at the top while scrolling */}
      <div className="sticky top-0 z-20">
      <header className="bg-white border-b border-line">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-8 py-3.5 flex flex-wrap gap-x-5 gap-y-3.5 items-center">
          <Logo />
          <form action="/search" role="search" className="order-3 sm:order-2 basis-full sm:basis-[440px] sm:flex-1 flex min-w-0 border-[1.5px] border-ink rounded-[10px] overflow-hidden bg-white focus-within:ring-2 focus-within:ring-coral-text focus-within:ring-offset-2">
            <label htmlFor="q" className="sr-only">Search products, HS codes or suppliers</label>
            <input id="q" name="q" type="search" placeholder={products ? `Search ${products} products, HS codes or turnkey projects` : 'Search products, HS codes or turnkey projects'}
              className="flex-1 min-w-0 px-4 min-h-[46px] text-[15px] outline-none placeholder:text-muted" />
            <button type="submit" className="btn btn-dark rounded-none min-h-[46px] px-[22px]" aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </button>
          </form>
          <div className="order-2 sm:order-3 ml-auto sm:ml-0">
            <Suspense fallback={<SignedOutButtons />}>
              <AccountLinks />
            </Suspense>
          </div>
        </div>
      </header>
      <nav aria-label="Shop by category" className="bg-white border-b border-line">
        <ul className="max-w-[1360px] mx-auto px-4 sm:px-8 py-2.5 flex gap-1.5 items-center overflow-x-auto overscroll-x-contain">
          {/* ADDON-44: the services first (Make My Brand second, active service highlighted), then the categories */}
          <ServiceLinks poolsOn={settings.pool_enabled !== false} turnkeyOn={settings['turnkey.enabled'] !== false} pill={pill} />
          {settings.supplier_portal_enabled === true && <li className="shrink-0"><Link href="/suppliers" className={`${pill} text-ink`}>Sell on Octopus B2B</Link></li>}
          <li className="shrink-0 w-px h-5 bg-line mx-1.5" aria-hidden />
          <li className="shrink-0"><Link href="/products" className={`${pill} text-black`}>All categories</Link></li>
          {top.map((c) => (
            <li key={c.id} className="shrink-0">
              <Link href={`/c/${c.slug}`} className={`${pill} text-black`}>{c.name}</Link>
            </li>
          ))}
        </ul>
      </nav>
      </div>
      <Suspense fallback={null}>
        <SwitchBanner />
      </Suspense>
    </>
  );
}

/** ADDON-32 announcement bar (above the sticky header on every storefront page). Switch: site_settings home.announcement_enabled. */
export async function StoreAnnouncement() {
  const [{ settings, blocks }, turnkey] = await Promise.all([getSiteContent(), getTurnkeyCatalogue()]);
  if (settings['home.announcement_enabled'] === false) return null;
  const vars = { turnkey: settings['turnkey.enabled'] !== false && turnkey.projects.length ? turnkey.projects.length : null };
  return <AnnouncementBar blocks={blocks} vars={vars} skipTurnkey={settings['turnkey.enabled'] === false} />;
}

/** Signed-out header actions: Sign in + Register (customer sign-up → /signup → verify → /onboarding). */
function SignedOutButtons() {
  return (
    <div className="flex items-center gap-2">
      <Link href="/login" className="btn btn-ghost min-h-10 sm:min-h-[46px] px-3 sm:px-[18px] text-[14px] sm:text-[15px]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="hidden sm:block"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
        Sign in
      </Link>
      <Link href="/signup" className="btn btn-primary min-h-10 sm:min-h-[46px] px-3 sm:px-[18px] text-[14px] sm:text-[15px]">Register</Link>
    </div>
  );
}

function AccountButton({ href }: { href: string }) {
  return (
    <Link href={href} className="btn btn-ghost min-h-[46px] px-[18px]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
      My account
    </Link>
  );
}

/** Session-dependent part of the header (request time): signed out → /login, signed in → account / office / distributor portal. */
async function AccountLinks() {
  const session = await getSession();
  if (!session) return <SignedOutButtons />;
  return <AccountButton href={session.isStaff && !session.org ? (session.roles.includes('distributor') && !session.isAdmin ? '/distributor' : '/office') : '/account'} />;
}

/** Banner for 14 days after a currency switch (time-based, so rendered at request time). */
async function SwitchBanner() {
  await connection();
  const banner = activeSwitchBanner(await getCurrencyContext());
  return banner ? <CurrencySwitchBanner to={banner.to} appliedAt={banner.applied_at} /> : null;
}

export async function StoreFooter() {
  const [{ blocks, company, settings, categories }, counts] = await Promise.all([getSiteContent(), getCategoryCounts()]);
  const topCats = stockedCategories(categories, counts).filter((c) => c.level === 1).slice(0, 4);
  const turnkeyOn = settings['turnkey.enabled'] !== false;
  const domain = (company?.website ?? 'octopusb2b.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <footer className="bg-ink text-on-ink mt-16">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-10 pb-6 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div className="text-sm space-y-4">
          <Logo white size="footer" />
          <p className="max-w-[280px] leading-relaxed">{block(blocks, 'footer.about2', 'Product sourcing, brand projects, dropshipping, group buying, warehousing and turnkey businesses from China, delivered worldwide.')}</p>
          {(company?.email || company?.phone) && (
            <div className="text-[13px] space-y-0.5">
              {company?.phone && <div>{company.phone}</div>}
              {company?.email && <a href={`mailto:${company.email}`} className="hover:text-white">{company.email}</a>}
            </div>
          )}
        </div>
        <FooterCol title="Services" links={[['/#dropshipping', 'Dropshipping'], ['/make-my-brand', 'Make My Brand'], ['/#sourcing', 'Product sourcing'], ...(settings.pool_enabled !== false ? [['/pools', 'MOQ pools'] as [string, string]] : []), ...(turnkeyOn ? [['/turnkey', 'Turnkey Projects'] as [string, string]] : []), ['/#warehousing', '3PL & shipping']]} />
        <FooterCol title="My account" links={[['/login', 'Sign in'], ['/signup', 'Create account'], ['/account', 'My account'], ['/products', 'All products'], ...topCats.slice(0, 2).map((c) => [`/c/${c.slug}`, c.name] as [string, string])]} />
        <FooterCol title="Suppliers" links={[['/suppliers', 'Sell on Octopus B2B'], ['/suppliers#apply', 'Become a supplier'], ['/staff/login', 'Supplier and staff sign-in']]} />
        <FooterCol title="Company" links={[['/about', 'About us'], ['/contact', 'Contact'], ['/legal/terms', 'Terms'], ['/legal/privacy', 'Privacy']]} />
      </div>
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8">
        <div className="border-t border-white/10 py-5 text-[13px] flex flex-wrap justify-between gap-3">
          <div>© 2026 {company?.legal_name ?? company?.brand ?? 'Octopus B2B'} · <Link href="/legal/terms" className="hover:text-white">Terms</Link> · <Link href="/legal/privacy" className="hover:text-white">Privacy</Link></div>
          <div>{domain.charAt(0).toUpperCase() + domain.slice(1)}</div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="label-caps text-white mb-3">{title}</div>
      <ul className="space-y-0.5 text-[14px]">{links.map(([h, l]) => <li key={l}><Link href={h} className="inline-flex items-center min-h-11 hover:text-white">{l}</Link></li>)}</ul>
    </div>
  );
}

