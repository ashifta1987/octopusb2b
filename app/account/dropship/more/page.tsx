import { Suspense } from 'react';
import Link from 'next/link';
import { DsIcon, DsPageHeader, type DsIconName } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'More · Octopus Dropship' };

const MORE_ITEMS: { href: string; label: string; icon: DsIconName }[] = [
  { href: '/account/dropship/catalogue?list=1', label: 'Import list', icon: 'list' },
  { href: '/account/dropship/pushed', label: 'Pushed products', icon: 'refresh' },
  { href: '/account/dropship/pricing', label: 'Pricing and sync', icon: 'tag' },
  { href: '/account/dropship/packing', label: 'Packing and shipping', icon: 'package' },
  { href: '/account/dropship/stores', label: 'Stores', icon: 'store' },
  { href: '/account/dropship/reports', label: 'Reports', icon: 'chart' },
  { href: '/account/dropship/billing', label: 'Plan and billing', icon: 'card' },
  { href: '/account/dropship/settings', label: 'Settings', icon: 'gear' },
  { href: '/account/dropship/support', label: 'Support', icon: 'help' },
  { href: '/account/dropship/requests', label: 'Request a product', icon: 'send' },
  { href: '/account/dropship/sample', label: 'Order a sample', icon: 'package' },
  { href: '/account/dropship/landed-cost', label: 'Landed cost calculator', icon: 'globe' },
  { href: '/account', label: 'Back to my Octopus account', icon: 'arrow' },
];

async function MoreContent() {
  const { session: s } = await requireDropshipV2Merchant('/account/dropship/more');
  const name = s.profile?.full_name ?? s.email ?? 'Merchant';
  const orgName = s.org?.name ?? '';

  return (
    <div data-testid="dropship-more-page" className="flex flex-col gap-4">
      <DsPageHeader title="More" icon="more" />

      <nav aria-label="More" className="ds-card !p-0 overflow-hidden">
        {MORE_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 min-h-[52px] px-4 border-b border-[#EEF0F4] last:border-b-0 text-[#1A174A] hover:text-[#1A174A] hover:bg-[#FAFBFD] no-underline text-[15px] font-medium"
          >
            <span className="text-[#2A6FD1] inline-flex">
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
