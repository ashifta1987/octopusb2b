import { Suspense } from 'react';
import { requireCustomer } from '@/lib/auth';
import { AccountShell } from '@/components/shell/account-shell';
import { AssistantBubble } from '@/components/account/assistant/bubble';
import { AccountBottomBar } from '@/components/account/bottom-bar';
import { newQuoteCount, usedServices } from '@/components/account/sourcing-data';
import { getAccountContext } from '@/lib/core/account';
import { AccountShellSkeleton } from '@/components/shell/skeletons';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { EARLY_ACCESS_DEFAULTS } from '@/lib/dropship-features-shared';

export const metadata = { title: { default: 'My account', template: '%s · Octopus B2B' } };

async function Shell({ children }: { children: React.ReactNode }) {
  const s = await requireCustomer();
  // ADDON-41 board 01: wallet in the header, service tabs, section menu; Octo assistant bubble on every page (SPEC §20.5)
  const [newQuotes, used, ctx, dropshipV2Ui, dropshipFeatures] = s.org
    ? await Promise.all([
        newQuoteCount(s.org.id),
        usedServices(s.org.id),
        getAccountContext(s.org.id),
        isDropshipV2UiEnabled(),
        getDropshipFeatures(),
      ])
    : [0, [] as string[], null, false, EARLY_ACCESS_DEFAULTS];
  return (
    <AccountShell
      session={s}
      ctx={ctx}
      newQuotes={newQuotes}
      dropshipV2Ui={dropshipV2Ui}
      dropshipFeatures={dropshipFeatures}
      mobileBar={<AccountBottomBar newQuotes={newQuotes} used={used} />}
    >
      {children}
      {s.org && <AssistantBubble />}
    </AccountShell>
  );
}

/** Customer portal. Session reads happen at request time, so the shell streams behind a Suspense boundary (cacheComponents). */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AccountShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
