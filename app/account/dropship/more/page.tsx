import { Suspense } from 'react';
import Link from 'next/link';
import { DsIcon, DsPageHeader, type DsIconName } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { getDropshipFeatures, type DropshipFeatureKey } from '@/lib/dropship-features';

export const metadata = { title: 'More · Octopus Dropship' };

// EA-2: each item belongs to a feature; OFF features are not listed (no "coming soon" labels)
const MORE_ITEMS: { href: string; label: string; icon: DsIconName; feature: DropshipFeatureKey | null }[] = [
  { href: '/account/dropship/catalogue?list=1', label: 'Import list', icon: 'list', feature: 'import_list' },
  { href: '/account/dropship/orders', label: 'Orders', icon: 'cart', feature: 'orders' },
  { href: '/account/dropship/pushed', label: 'Pushed products', icon: 'refresh', feature: 'pushed' },
  { href: '/account/dropship/pricing', label: 'Pricing and sync', icon: 'tag', feature: 'pricing' },
  { href: '/account/dropship/packing', label: 'Packing and shipping', icon: 'package', feature: 'packing' },
  { href: '/account/dropship/stores', label: 'Stores', icon: 'store', feature: 'stores' },
  { href: '/account/dropship/integrations', label: 'Integrations', icon: 'link', feature: 'stores' },
  { href: '/account/dropship/reports', label: 'Reports', icon: 'chart', feature: 'reports' },
  { href: '/account/dropship/billing', label: 'Plan and billing', icon: 'card', feature: 'billing' },
  { href: '/account/dropship/settings', label: 'Settings', icon: 'gear', feature: 'settings' },
  { href: '/account/dropship/support', label: 'Support', icon: 'help', feature: 'support' },
  { href: '/account/dropship/requests', label: 'Request a product', icon: 'send', feature: 'requests' },
  { href: '/account/dropship/sample', label: 'Order a sample', icon: 'package', feature: 'samples' },
  { href: '/account/dropship/landed-cost', label: 'Landed cost calculator', icon: 'globe', feature: 'landed_cost' },
  { href: '/account', label: 'Back to my Octopus account', icon: 'arrow', feature: null },
];

async function MoreContent() {
  const { session: s } = await requireDropshipV2Merchant('/account/dropship/more');
  const features = await getDropshipFeatures();
  // Orders has its own phone tab when it is on; in early access the tab is Requests
  const items = MORE_ITEMS.filter((i) => (i.feature ? features[i.feature] : true) && !(i.feature === 'orders' && features.stores));
  const name = s.profile?.full_name ?? s.email ?? 'Merchant';
  const orgName = s.org?.name ?? '';

  return (
    <div data-testid="dropship-more-page" className="flex flex-col gap-4">
      <DsPageHeader title="More" icon="more" />

      <nav aria-label="More" className="ds-card !p-0 overflow-hidden">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 min-h-[52px] px-4 border-b border-divider last:border-b-0 text-ink hover:text-ink hover:bg-pearl no-underline text-[15px] font-medium"
          >
            <span className="text-coral-text inline-flex">
              <DsIcon name={item.icon} size={18} />
            </span>
            <span>{item.label}</span>
            <span aria-hidden="true" className="ds-mut ml-auto">
              ›
            </span>
          </Link>
        ))}
      </nav>

      <p className="ds-mut m-0 text-[13px]">
        Signed in as {name}
        {orgName ? ` · ${orgName}` : ''}
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <MoreContent />
    </Suspense>
  );
}
