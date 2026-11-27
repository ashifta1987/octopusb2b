'use client';

import Link from 'next/link';
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { usePhone } from '../hooks';
import { ACCOUNT_TAB, SHOP_TAB } from '../logo-href';

export type NamedTabLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> & {
  href: string;
  /** shop → target="octopus-shop"; account → target="octopus-account" (Part 4.6) */
  tab: 'shop' | 'account';
  children: ReactNode;
};

/**
 * Named-tab link (Part 4.6, Flow_SignInTabs): introduction → Shop and My account → Shop use `target="octopus-shop"`,
 * Shop → My account uses `target="octopus-account"`, so the already-open tab is reused.
 * - NO rel="noopener": these are same-site tabs that must be reusable. External links keep target=_blank rel=noopener.
 * - Phones (< 768 px): no target; everything opens in the same tab. The server renders the desktop target and phones drop
 *   it right after hydration (matchMedia).
 */
export const NamedTabLink = forwardRef<HTMLAnchorElement, NamedTabLinkProps>(function NamedTabLink({ href, tab, children, ...rest }, ref) {
  const phone = usePhone();
  return (
    <Link ref={ref} href={href} target={phone ? undefined : tab === 'shop' ? SHOP_TAB : ACCOUNT_TAB} data-named-tab={tab} {...rest}>
      {children}
    </Link>
  );
});
