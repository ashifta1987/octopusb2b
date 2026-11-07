import { Suspense } from 'react';
import { requireCustomer } from '@/lib/auth';
import { PortalShell } from '@/components/portal-shell';
import { CUSTOMER_NAV } from '@/lib/nav';
import { AssistantBubble } from '@/components/account/assistant/bubble';
import { AccountBottomBar } from '@/components/account/bottom-bar';
import { newQuoteCount, usedServices } from '@/components/account/sourcing-data';

export const metadata = { title: { default: 'My account', template: '%s · Octopus B2B' } };

async function AccountShell({ children }: { children: React.ReactNode }) {
  const s = await requireCustomer();
  // Floating Octo assistant on every customer page (hidden on /account/assistant itself) — SPEC §20.5
  // new quotes badge on "Product sourcing" + the services this customer used (mobile More sheet order)
  const [newQuotes, used] = s.org ? await Promise.all([newQuoteCount(s.org.id), usedServices(s.org.id)]) : [0, [] as string[]];
  return (
    <PortalShell session={s} nav={CUSTOMER_NAV} badges={{ '/account/sourcing': newQuotes }} mobileBar={<AccountBottomBar newQuotes={newQuotes} used={used} />}>
      {children}{s.org && <AssistantBubble />}
    </PortalShell>
  );
}

/** Customer portal. Session reads happen at request time, so the shell streams behind a Suspense boundary (cacheComponents). */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface p-8 text-muted" role="status">Loading your account…</div>}>
      <AccountShell>{children}</AccountShell>
    </Suspense>
  );
}
