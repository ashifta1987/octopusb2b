import { Suspense } from 'react';
import { requireCustomer } from '@/lib/auth';
import { PortalShell } from '@/components/portal-shell';
import { CUSTOMER_NAV } from '@/lib/nav';

export const metadata = { title: { default: 'My account', template: '%s · Octopus B2B' } };

async function AccountShell({ children }: { children: React.ReactNode }) {
  const s = await requireCustomer();
  return <PortalShell session={s} nav={CUSTOMER_NAV}>{children}</PortalShell>;
}

/** Customer portal. Session reads happen at request time, so the shell streams behind a Suspense boundary (cacheComponents). */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface p-8 text-muted" role="status">Loading your account…</div>}>
      <AccountShell>{children}</AccountShell>
    </Suspense>
  );
}
