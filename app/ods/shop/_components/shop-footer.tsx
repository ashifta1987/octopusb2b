import Link from 'next/link';
import { SHOP_PATHS } from '../_lib/sections';

/**
 * ODS T4 · Shop footer (Part 5.1, Shop_Main board): one white band — the six service links (introduction pages), Shipping
 * and duties, Help, Terms, Privacy — and the legal name from the company profile (hidden when missing). Server-safe.
 * Phones: links wrap; the legal name goes below. Bottom padding for the phone BottomNav is on <main>.
 */
const LINKS: { label: string; href: string }[] = [
  { label: 'How sourcing works', href: '/services/sourcing' },
  { label: 'MOQ pools', href: '/services/pools' },
  { label: 'Dropshipping', href: '/services/dropship' },
  { label: 'Warehouse (3PL)', href: '/services/warehouse' },
  { label: 'Turnkey', href: '/turnkey' },
  { label: 'Make My Brand', href: '/services/brand' },
  { label: 'Shipping and duties', href: '/shipping' },
  { label: 'Help', href: SHOP_PATHS.help },
  { label: 'Terms', href: SHOP_PATHS.terms },
  { label: 'Privacy', href: SHOP_PATHS.privacy },
];

export function ShopFooter({ legalName }: { legalName?: string | null }) {
  return (
    <footer className="border-t border-ods-line bg-ods-surface" data-testid="shop-footer">
      <div className="mx-auto flex max-w-ods-content flex-col gap-3 px-ods-pad-page py-5 ods-desktop:flex-row ods-desktop:items-center ods-desktop:justify-between">
        <nav aria-label="Shop footer">
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-[calc(var(--ods-control-h)-12px)] items-center text-ods-small font-medium text-ods-blue underline underline-offset-4 hover:text-ods-navy">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {legalName ? <p className="m-0 text-ods-small text-ods-slate">{legalName}</p> : null}
      </div>
    </footer>
  );
}
