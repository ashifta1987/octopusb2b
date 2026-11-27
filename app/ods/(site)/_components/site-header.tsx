'use client';

import { usePathname } from 'next/navigation';
import { PublicHeader, type MegaMenuColumn, type MegaMenuPromo } from '@octopus/ui';
import { SITE_SERVICES } from './services';
import { ReportSiteUser, type SiteUser } from './site-session';

const svc = (slug: string) => SITE_SERVICES.find((s) => s.slug === slug)!;
const link = (slug: string) => {
  const s = svc(slug);
  return { label: s.name, href: s.href, description: s.line, icon: s.icon };
};

/** Services ▾: the six services in four columns + one promoted box (MegaMenu). */
const COLUMNS: MegaMenuColumn[] = [
  { title: 'Buy from factories', links: [link('sourcing'), link('pools')] },
  { title: 'Sell online', links: [link('dropship'), link('brand')] },
  { title: 'Store and ship', links: [link('warehouse')] },
  { title: 'Full projects', links: [link('turnkey')] },
];
const PROMO: MegaMenuPromo = {
  eyebrow: 'New here?',
  title: 'Which service is right for you?',
  body: 'Compare all six side by side, then start with one product.',
  href: '/how-it-works',
  linkLabel: 'See how it works',
};

const TOP = ['/how-it-works', '/services/pools', '/shipping', '/help'];

/**
 * Introduction-site header: PublicHeader with the services menu. `report` = the session has been resolved (rendered
 * inside <Suspense>); the fallback (signed-out look) doesn't report, so it never overrides a known session.
 */
export function SiteHeader({ user, report = false, sticky = true }: { user?: SiteUser; report?: boolean; sticky?: boolean }) {
  const raw = usePathname() ?? '/';
  // the proxy rewrites public URLs to /ods/…; the browser shows the public one
  const path = raw.replace(/^\/ods(?=\/|$)/, '') || '/';
  return (
    <>
      <PublicHeader
        services={{ columns: COLUMNS, promo: PROMO }}
        user={user ?? undefined}
        signInHref="/login?next=/shop"
        googleHref="/login?next=/shop"
        currentHref={TOP.includes(path) ? path : undefined}
        sticky={sticky}
        megaMenuTestIds={{ trigger: 'services-menu-trigger', panel: 'services-menu' }}
      />
      {report ? <ReportSiteUser user={user ?? null} /> : null}
    </>
  );
}
