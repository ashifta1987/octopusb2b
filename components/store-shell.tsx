import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/ui';
import { getSiteContent, block } from '@/lib/content';
import { getSession } from '@/lib/auth';
import { getCurrencyContext } from '@/lib/currency';
import { activeSwitchBanner } from '@/components/store/currency';
import { CurrencySwitchBanner } from '@/components/store/currency-banner';
import { CategoryIcon, AllCategoriesIcon } from '@/components/store/home/category-icon';
import { getHomeLiveData } from '@/components/store/home/live-data';

/**
 * Storefront layout header + category bar (Main.png, Nov 2026 redesign). All copy from CMS.
 * QA §19 Performance (CLS): the header itself only reads cached CMS/currency data so it is part of the static shell;
 * only the session-dependent "My account" target and the time-based currency banner stream in (fixed-size fallbacks).
 */
export async function StoreHeader() {
  const [{ categories, settings }, live] = await Promise.all([getSiteContent(), getHomeLiveData()]);
  const top = categories.filter((c) => c.level === 1);
  // real number of live products (no marketing figure)
  const products = live.products ? new Intl.NumberFormat('en-US').format(live.products) : null;
  const pill = 'inline-flex items-center gap-[7px] px-3 py-2 rounded-full text-[13.5px] font-medium whitespace-nowrap shrink-0 hover:bg-surface hover:text-navy';
  return (
    <>
      <header className="bg-white border-b border-line sticky top-0 z-20">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-8 py-3.5 flex flex-wrap gap-x-5 gap-y-3.5 items-center">
          <Logo />
          <form action="/search" role="search" className="order-3 sm:order-2 basis-full sm:basis-[440px] sm:flex-1 flex min-w-0 border-[1.5px] border-navy rounded-[10px] overflow-hidden bg-white focus-within:ring-2 focus-within:ring-[#1D4ED8] focus-within:ring-offset-2">
            <label htmlFor="q" className="sr-only">Search products, HS codes or suppliers</label>
            <input id="q" name="q" type="search" placeholder={products ? `Search ${products} products, HS codes or suppliers` : 'Search products, HS codes or suppliers'}
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
          <li className="shrink-0">
            <Link href="/products" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-navy text-white text-[13.5px] font-semibold whitespace-nowrap hover:bg-navy-2 hover:text-white">
              <AllCategoriesIcon />All categories
            </Link>
          </li>
          {top.map((c) => (
            <li key={c.id} className="shrink-0">
              <Link href={`/c/${c.slug}`} className={`${pill} text-[#3B4556]`}><CategoryIcon slug={c.slug} />{c.name}</Link>
            </li>
          ))}
          <li className="shrink-0 w-px h-5 bg-line mx-1.5" aria-hidden />
          {settings.pool_enabled !== false && <li className="shrink-0"><Link href="/pools" className={`${pill} text-blue font-semibold`}>Group buying pools</Link></li>}
          <li className="shrink-0"><Link href="/request" className={`${pill} text-blue font-semibold`}>Request Center</Link></li>
          <li className="shrink-0"><Link href="/request/3pl" className={`${pill} text-blue font-semibold`}>3PL services</Link></li>
          <li className="shrink-0"><Link href="/request/dropship" className={`${pill} text-blue font-semibold`}>Dropshipping</Link></li>
          {settings.supplier_portal_enabled === true && <li className="shrink-0"><Link href="/supplier" className={`${pill} text-blue font-semibold`}>Sell on Octopus B2B</Link></li>}
        </ul>
      </nav>
      <Suspense fallback={null}>
        <SwitchBanner />
      </Suspense>
    </>
  );
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
  const { blocks, company, branches } = await getSiteContent();
  return (
    <footer className="bg-navy text-[#D5DBE4] mt-16">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 grid gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
        <div className="text-sm space-y-3">
          <Logo white />
          <p className="max-w-sm">{block(blocks, 'footer.about')}</p>
          {company && (
            <address className="not-italic space-y-1">
              <div className="font-semibold text-white">{company.legal_name}</div>
              <div className="text-[13px]">{company.address}</div>
              {company.contact_person && <div className="text-[13px]">Contact: {company.contact_person}</div>}
              {company.phone && <div className="font-semibold text-white">{company.phone} · WhatsApp</div>}
              {company.email && <a href={`mailto:${company.email}`} className="font-semibold text-white">{company.email}</a>}
            </address>
          )}
        </div>
        <FooterCol title="Marketplace" links={[['/products', 'Products'], ['/products', 'Categories'], ['/request/sourcing', 'Request Center'], ['/signup', 'Register as a buyer'], ['/login', 'Sign in']]} />
        <FooterCol title="Group buy" links={[['/pools', 'Open pools'], ['/pools#how', 'Start a pool'], ['/pools/terms', 'Group Buy Terms'], ['/account/pools', 'My pledges']]} />
        <FooterCol title="Suppliers" links={[['/contact', 'Sell on Octopus B2B'], ['/about', 'Verification'], ['/login', 'Supplier login']]} />
        <FooterCol title="Company" links={[['/about', 'About us'], ...(branches.length ? [['/about#offices', branches.length > 1 ? 'Our China offices' : 'Our office'] as [string, string]] : []), ['/contact', 'Contact'], ['/legal/privacy', 'Privacy policy'], ['/legal/terms', 'Terms of service']]} />
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-5 text-[13px]">© 2026 {company?.brand ?? 'Octopus B2B'} · {company?.legal_name}. All rights reserved.{branches.length > 1 && <> · {branches.map((b) => b.city ?? b.name).join(' · ')}</>} · <Link href="/staff/login" className="text-[#C5CEDB] underline underline-offset-2 hover:text-white">Staff login</Link></div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="font-semibold text-white mb-3">{title}</div>
      <ul className="space-y-2 text-sm">{links.map(([h, l]) => <li key={l}><Link href={h} className="hover:text-white">{l}</Link></li>)}</ul>
    </div>
  );
}

