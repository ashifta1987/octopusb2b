import Link from 'next/link';
import { LEGAL_NAME } from '@/components/site/ui';

/** CH-1 Shop footer (design: How sourcing works · MOQ pools · Turnkey · Shipping and duties · Help · Terms · Privacy · legal name). */
export function ShopFooter() {
  const links: [string, string][] = [
    ['/sourcing', 'How sourcing works'], ['/pools', 'MOQ pools'], ['/turnkey', 'Turnkey'], ['/3pl', 'Shipping and duties'],
    ['/contact', 'Help'], ['/legal/terms', 'Terms'], ['/legal/privacy', 'Privacy'],
  ];
  return (
    <footer className="bg-ink text-on-ink px-4 sm:px-6 py-8 text-[14px] mb-[72px] md:mb-0" data-testid="shop-footer">
      <div className="max-w-[1240px] mx-auto flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="Shop footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 list-none m-0 p-0">
            {links.map(([href, label]) => (
              <li key={href}><Link href={href} className="inline-flex items-center min-h-11 text-on-ink underline underline-offset-4 hover:text-white">{label}</Link></li>
            ))}
          </ul>
        </nav>
        <span>© 2026 {LEGAL_NAME}</span>
      </div>
    </footer>
  );
}
