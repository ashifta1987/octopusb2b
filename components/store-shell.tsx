import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { connection } from 'next/server';
import { getSiteContent } from '@/lib/content';
import { getSession } from '@/lib/auth';
import { getCurrencyContext } from '@/lib/currency';
import { activeSwitchBanner } from '@/components/store/currency';
import { CurrencySwitchBanner } from '@/components/store/currency-banner';
import { ServiceLinks } from '@/components/store/service-links';
import { SERVICES, SUPPORT_EMAIL, LEGAL_NAME, OFFICE_HOURS } from '@/components/site/ui';

/**
 * Website shell (octopus-design-handoff §3, pages 01–09): white header with the full-colour logo, "Log in" and a blue
 * "Create free account" (owner, 26 Nov: no "Turnkey catalogue" in the header; it is reached from Turnkey); navy service bar with the six services (current one underlined);
 * navy 4-column footer. The announcement bar is rendered by the homepage only (app/(store)/page.tsx).
 * The header reads cached settings only; the session-dependent buttons and the currency banner stream in.
 */
export async function StoreHeader() {
  const { settings } = await getSiteContent();
  return (
    <>
      <header className="bg-white text-ink border-b border-line">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <SiteLogo />
          <Suspense fallback={<SignedOutLinks />}>
            <AccountLinks />
          </Suspense>
        </div>
        <nav aria-label="Services" className="bg-ink text-white">
          <ul className="max-w-[1200px] mx-auto px-4 sm:px-6 py-1.5 flex flex-wrap gap-x-7 gap-y-0 list-none m-0 text-[15px] font-medium">
            <ServiceLinks poolsOn={settings.pool_enabled !== false} turnkeyOn={settings['turnkey.enabled'] !== false} />
          </ul>
        </nav>
      </header>
      <Suspense fallback={null}>
        <SwitchBanner />
      </Suspense>
    </>
  );
}

export function SiteLogo() {
  return (
    <Link href="/" aria-label="Octopus B2B home" className="block shrink-0">
      <Image src="/images/design/logos/octopus-b2b-colour.svg" alt="Octopus B2B, Global Sourcing, Simplified" width={1018} height={211} unoptimized
        sizes="212px" loading="eager" className="block h-12 sm:h-14 w-auto" />
    </Link>
  );
}

const headLink = 'inline-flex items-center min-h-11 font-semibold text-ink hover:text-coral-text';
const headCta = 'inline-flex items-center min-h-11 px-5 rounded-[10px] bg-coral text-white font-semibold hover:bg-coral-text hover:text-white';

function SignedOutLinks() {
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1">
      <Link href="/login" className={headLink}>Log in</Link>
      <Link href="/signup" className={headCta}>Create free account</Link>
    </div>
  );
}

/** Signed out → Log in + Create free account; signed in → My account (customer) or the staff / distributor portal. */
async function AccountLinks() {
  const session = await getSession();
  if (!session) return <SignedOutLinks />;
  const href = session.isStaff && !session.org ? (session.roles.includes('distributor') && !session.isAdmin ? '/distributor' : '/office') : '/account';
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1">
      <Link href={href} className={headCta}>My account</Link>
    </div>
  );
}

/** Banner for 14 days after a currency switch (time-based, so rendered at request time). */
async function SwitchBanner() {
  await connection();
  const banner = activeSwitchBanner(await getCurrencyContext());
  return banner ? <CurrencySwitchBanner to={banner.to} appliedAt={banner.applied_at} /> : null;
}

/** Homepage announcement (design page 01). Switch: site_settings home.announcement_enabled. */
export async function StoreAnnouncement() {
  const { settings } = await getSiteContent();
  if (settings['home.announcement_enabled'] === false) return null;
  return (
    <div className="bg-tint text-ink text-[14px] font-semibold text-center px-4 py-2.5" data-testid="announcement">
      Make My Brand: put your label on proven factory products.{' '}
      <Link href="/make-my-brand" className="inline-flex items-center min-h-6 text-ink underline hover:text-coral-text">See how it works →</Link>
    </div>
  );
}

export async function StoreFooter() {
  const { settings } = await getSiteContent();
  const hide = new Set([settings.pool_enabled === false ? 'pools' : '', settings['turnkey.enabled'] === false ? 'turnkey' : '']);
  const link = 'inline-flex items-center min-h-11 text-on-ink hover:text-white';
  const colTitle = 'm-0 mb-3 font-mono text-[12px] font-semibold tracking-[.12em] uppercase !text-on-ink-link';
  return (
    <footer className="bg-ink text-on-ink px-4 sm:px-6 pt-14 pb-8 text-[15px]">
      <div className="max-w-[1200px] mx-auto">
        <div className="grid gap-8 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          <div>
            <Image src="/images/design/logos/octopus-b2b-white.svg" alt="Octopus B2B" width={1018} height={211} unoptimized sizes="185px" className="block h-12 w-auto" />
            <p className="mt-4 mb-0 leading-[1.55]">Sourcing, branding, shared orders, turnkey projects and logistics from China, with one account and one wallet.</p>
          </div>
          <nav aria-labelledby="ft-services">
            <h2 id="ft-services" className={colTitle}>Services</h2>
            <ul className="list-none m-0 p-0 grid">
              {SERVICES.filter((s) => !hide.has(s.key)).map((s) => <li key={s.key}><Link href={s.href} className={link}>{s.label}</Link></li>)}
            </ul>
          </nav>
          <nav aria-labelledby="ft-account">
            <h2 id="ft-account" className={colTitle}>Account</h2>
            <ul className="list-none m-0 p-0 grid">
              <li><Link href="/login" className={link}>Customer log in</Link></li>
              <li><Link href="/signup" className={link}>Create free account</Link></li>
              <li><Link href="/turnkey/catalogue" className={link}>Turnkey catalogue</Link></li>
              <li><Link href="/staff/login" className={link}>Staff sign-in</Link></li>
            </ul>
          </nav>
          <div>
            <h2 className={colTitle}>Contact</h2>
            <p className="m-0 leading-[1.6]">
              Warehouse: Foshan, China<br />
              Office hours: {OFFICE_HOURS}<br />
              Support: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-on-ink underline hover:text-white">{SUPPORT_EMAIL}</a>
            </p>
          </div>
        </div>
        <div className="mt-10 pt-5 border-t border-white/15 flex flex-wrap justify-between items-center gap-3 text-[14px]">
          <span>© 2026 {LEGAL_NAME}</span>
          <span className="flex flex-wrap gap-x-5">
            <Link href="/legal/terms" className={link}>Terms</Link>
            <Link href="/legal/privacy" className={link}>Privacy</Link>
            <Link href="/suppliers" className={link}>Supplier sign-up</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}

/** Skip link + header + footer around a page (store layout and the auth pages). */
export function SiteFrame({ children, before }: { children: React.ReactNode; before?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-pearl">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 bg-white text-ink font-bold px-4 py-2.5 rounded-[8px]">Skip to content</a>
      {before}
      <Suspense fallback={<div className="h-[186px] sm:h-[140px] bg-white border-b border-line" aria-hidden />}>
        <StoreHeader />
      </Suspense>
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>
      <Suspense fallback={<div className="h-[420px] bg-ink" aria-hidden />}>
        <StoreFooter />
      </Suspense>
    </div>
  );
}
