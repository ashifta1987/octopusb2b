'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Menu } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Logo } from '../logo';
import { buttonClass } from '../styles';
import { MegaMenu, type MegaMenuColumn, type MegaMenuPromo } from './mega-menu';
import { NamedTabLink } from './named-tab-link';
import { Sheet } from './sheet';

export type PublicHeaderProps = {
  /** Content of the Services ▾ mega menu: the six services (four columns + one promoted box). */
  services: { columns: MegaMenuColumn[]; promo?: MegaMenuPromo };
  /** Signed-in visitors see "Signed in as <name> · Go to my shop ↗" instead of Sign in / Continue with Google. */
  user?: { name: string };
  /** Starts Google sign-in. Without it, the button links to `googleHref`. */
  onContinueWithGoogle?: () => void;
  googleHref?: string;
  signInHref?: string;
  /** Current top-level page for aria-current (e.g. '/how-it-works'). */
  currentHref?: string;
  /** Sticky at the top (default). Set false to render in place (demos). */
  sticky?: boolean;
  /** Landmark name of the link list (default "Main"). */
  navLabel?: string;
  /** Test ids for the Services mega menu. */
  megaMenuTestIds?: { trigger?: string; panel?: string };
  className?: string;
};

const LINKS = [
  { label: 'How it works', href: '/how-it-works' },
  { label: 'MOQ pools', href: '/services/pools' },
  { label: 'Shipping and duties', href: '/shipping' },
  { label: 'Help', href: '/help' },
];

const linkCls = (current: boolean) =>
  cx(
    'inline-flex h-ods-control items-center rounded-ods-control px-3 whitespace-nowrap hover:bg-ods-blue-tint',
    current ? 'font-bold text-ods-navy underline decoration-ods-blue decoration-[3px] underline-offset-[10px]' : 'font-medium text-ods-navy',
  );

/**
 * PublicHeader (introduction site, tab 1): logo (→ `/`, or `/shop` signed in); Services ▾ mega menu; How it works;
 * MOQ pools; Shipping and duties; Help; Sign in; Continue with Google. Sticky by default.
 * Signed in: "Signed in as <name> · Go to my shop ↗" (opens the Shop tab, `target="octopus-shop"`).
 * Narrow (container < 1080 px, i.e. phones and small tablets): logo, Sign in and a Menu button that opens a full-screen
 * Sheet with every link, the services and Continue with Google. Phones open everything in the same tab.
 */
export function PublicHeader({
  services,
  user,
  onContinueWithGoogle,
  googleHref = '/login?next=/shop',
  signInHref = '/login',
  currentHref,
  sticky = true,
  navLabel = 'Main',
  megaMenuTestIds,
  className,
}: PublicHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Part 4.6: the introduction site opens the Shop in its named tab (target="octopus-shop", no rel=noopener; phones: same tab)
  const google = onContinueWithGoogle ? (
    <button type="button" onClick={onContinueWithGoogle} data-cta="google" className={buttonClass('primary')}>
      Continue with Google
    </button>
  ) : (
    <NamedTabLink tab="shop" href={googleHref} data-cta="google" className={buttonClass('primary')}>
      Continue with Google
    </NamedTabLink>
  );
  const shopLinkCls = 'inline-flex min-h-ods-control items-center gap-1 rounded-ods-control font-semibold whitespace-nowrap text-ods-blue hover:underline';
  const shopLink = (sameTab: boolean) =>
    sameTab ? (
      <Link href="/shop" className={shopLinkCls}>
        Go to my shop
        <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
      </Link>
    ) : (
      <NamedTabLink tab="shop" href="/shop" className={shopLinkCls}>
        Go to my shop
        <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
        <span className="sr-only">(opens the Shop tab)</span>
      </NamedTabLink>
    );

  return (
    <header className={cx(sticky ? 'sticky top-0 z-(--z-sticky)' : 'relative', '@container border-b border-ods-line bg-ods-surface text-ods-text', className)}>
      <div className="mx-auto flex min-h-[calc(var(--ods-control-h)+24px)] max-w-ods-content items-center gap-3 px-ods-pad-page">
        <span className="contents @max-[479px]:hidden">
          <Logo variant="mark" area="public" signedIn={!!user} />
        </span>
        <span className="contents @min-[480px]:hidden">
          <Logo variant="mark" area="public" signedIn={!!user} height={24} />
        </span>
        <nav aria-label={navLabel} className="ms-4 hidden flex-1 @min-[1080px]:block">
          <ul className="flex items-center gap-1">
            <li>
              <MegaMenu label="Services" panelLabel="Services" columns={services.columns} promo={services.promo} testIds={megaMenuTestIds} />
            </li>
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} aria-current={currentHref === l.href ? 'page' : undefined} className={linkCls(currentHref === l.href)}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          {user ? (
            <p data-testid="signed-in-as" className="hidden items-center gap-2 text-ods-label text-ods-slate @min-[1080px]:flex">
              <span>
                Signed in as <strong className="font-semibold text-ods-navy">{user.name}</strong>
              </span>
              <span aria-hidden>·</span>
              {shopLink(false)}
            </p>
          ) : (
            <>
              <Link href={signInHref} className={cx(buttonClass('ghost'), 'px-3')}>
                Sign in
              </Link>
              <span className="hidden @min-[1080px]:inline-flex">{google}</span>
            </>
          )}
          {user ? <span className="@min-[1080px]:hidden">{shopLink(true)}</span> : null}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className={cx(buttonClass('secondary'), 'px-3 @min-[1080px]:hidden')}
          >
            <Icon icon={Menu} />
            <span className="sr-only @min-[480px]:not-sr-only">Menu</span>
          </button>
        </div>
      </div>
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" variant="full">
        <nav aria-label={`${navLabel} (menu)`}>
          <h3 className="mt-2 text-ods-label font-bold text-ods-slate">Services</h3>
          <ul className="mt-1 grid gap-0.5">
            {services.columns.flatMap((c) => c.links).map((l) => (
              <li key={l.href + l.label}>
                <Link href={l.href} onClick={() => setMenuOpen(false)} className="flex min-h-ods-control items-center gap-2 rounded-ods-control px-2 font-medium text-ods-navy hover:bg-ods-blue-tint">
                  {l.icon ? <Icon icon={l.icon} /> : null}
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="mt-4 grid gap-0.5 border-t border-ods-line pt-4">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={currentHref === l.href ? 'page' : undefined}
                  className={cx('flex min-h-ods-control items-center rounded-ods-control px-2 text-ods-navy hover:bg-ods-blue-tint', currentHref === l.href ? 'font-bold' : 'font-medium')}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 grid gap-3">
          {user ? (
            <p className="text-ods-label text-ods-slate">
              Signed in as <strong className="font-semibold text-ods-navy">{user.name}</strong> · {shopLink(true)}
            </p>
          ) : (
            <>
              <span className="grid">{google}</span>
              <Link href={signInHref} className={buttonClass('secondary', 'md', true)}>
                Sign in with work email
              </Link>
            </>
          )}
        </div>
      </Sheet>
    </header>
  );
}
