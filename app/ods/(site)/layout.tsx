import { Suspense, type ReactNode } from 'react';
import { SiteFooter } from '@octopus/ui/components/site-footer';
import { AuthBroadcastListener } from '@octopus/ui/components/auth-broadcast';
import { getSession } from '@/lib/auth';
import { currentYear, getSiteData } from '@/lib/ods-site';
import { FOOTER_COLUMNS } from './_components/services';
import { SiteHeader } from './_components/site-header';

/**
 * Introduction site (Part 3.1 / 4.1): skip link, sticky PublicHeader, <main id="main">, footer.
 * The session is request data, so the header resolves it inside <Suspense> (Cache Components) with the signed-out
 * header as the fallback; every page body stays static.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ods-navy focus:shadow-ods-pop"
      >
        Skip to content
      </a>
      <Suspense fallback={<SiteHeader />}>
        <SessionHeader />
      </Suspense>
      <main id="main" tabIndex={-1} className="flex-1 bg-ods-canvas focus:outline-none">
        {children}
      </main>
      <Footer />
      {/* Part 4.6: a sign-out in another tab swaps this tab back to "Sign in" */}
      <AuthBroadcastListener mode="refresh" />
    </>
  );
}

async function SessionHeader() {
  const s = await getSession().catch(() => null);
  const full = s?.profile?.full_name?.trim() || s?.email?.split('@')[0] || '';
  const user = s ? { name: full.split(/\s+/)[0] || 'there' } : null;
  return <SiteHeader user={user} report />;
}

async function Footer() {
  const [{ company }, year] = await Promise.all([getSiteData(), currentYear()]);
  return (
    <SiteFooter
      columns={FOOTER_COLUMNS}
      summary="Sourcing, pools, dropshipping, warehousing, turnkey projects and branding from China."
      legalName={company?.legal_name}
      year={year}
      localeLabel="English · US$"
    />
  );
}
