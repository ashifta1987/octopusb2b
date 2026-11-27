'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { LayoutGrid, Wallet } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { formatMoney } from '../format';
import { ACCOUNT_TAB } from '../logo-href';
import { MegaMenu, type MegaMenuColumn, type MegaMenuPromo } from './mega-menu';
import { MenuButton } from './menu-button';

export type SectionBarItem = { id: string; label: string; href: string };

export type SectionBarProps = {
  /** Section links. Default: Sourcing products · MOQ pools · Turnkey projects · Dropshipping · Warehouse (3PL) · Make My Brand · Samples · New arrivals. */
  items?: SectionBarItem[];
  /** Id of the current section (bold + 3 px blue underline + aria-current="page"). */
  current?: string;
  /** All categories ▾ mega menu content (four columns + promoted box). */
  categories?: { columns: MegaMenuColumn[]; promo?: MegaMenuPromo };
  /** Wallet balance in US$, shown at the end (links to My account › Wallet in the My account tab). */
  walletBalance?: number;
  walletHref?: string;
  /** Phones: open My account in the same tab. */
  sameTab?: boolean;
  /** Landmark name (default "Shop sections"). */
  label?: string;
  testId?: string;
  megaMenuTestIds?: { trigger?: string; panel?: string };
  className?: string;
};

const DEFAULT_ITEMS: SectionBarItem[] = [
  { id: 'products', label: 'Sourcing products', href: '/shop/products' },
  { id: 'pools', label: 'MOQ pools', href: '/shop/pools' },
  { id: 'turnkey', label: 'Turnkey projects', href: '/shop/turnkey' },
  { id: 'dropship', label: 'Dropshipping', href: '/shop/dropship' },
  { id: 'warehouse', label: 'Warehouse (3PL)', href: '/shop/warehouse' },
  { id: 'brand', label: 'Make My Brand', href: '/shop/brand' },
  { id: 'samples', label: 'Samples', href: '/shop/samples' },
  { id: 'new', label: 'New arrivals', href: '/shop/search?sort=new' },
];

const ITEM = 'relative inline-flex h-full items-center px-3 whitespace-nowrap text-ods-table';
const SELECTED = 'font-bold text-ods-navy after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:bg-ods-blue';

/**
 * SectionBar (Shop, under ShopHeader): 44 px white (32 compact). All categories ▾ (MegaMenu), the section links and the
 * wallet balance. It is a nav landmark with links; the current one is bold with a 3 px blue underline and aria-current.
 * Overflow: a ResizeObserver measures the space; links that don't fit move into "More ▾ (count)", a menu button
 * (↑ ↓ Home End, Esc returns focus). Works at any container width (under 1200 px the last links usually fold).
 * Phones: the same bar folds most links into More and shows the wallet as an icon; the Shop BottomNav (Categories sheet)
 * is the main navigation there.
 */
export function SectionBar({ items = DEFAULT_ITEMS, current, categories, walletBalance, walletHref = '/account/wallet', sameTab, label = 'Shop sections', testId, megaMenuTestIds, className }: SectionBarProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(items.length);
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const region = regionRef.current;
    const meas = measureRef.current;
    if (!region || !meas) return;
    const compute = () => {
      const kids = Array.from(meas.children) as HTMLElement[];
      const widths = kids.slice(0, items.length).map((k) => k.getBoundingClientRect().width);
      const moreW = kids[items.length]?.getBoundingClientRect().width ?? 0;
      const avail = region.clientWidth;
      const total = widths.reduce((a, b) => a + b, 0);
      let n = items.length;
      if (total > avail + 0.5) {
        n = 0;
        let acc = 0;
        while (n < widths.length && acc + widths[n] <= avail - moreW) acc += widths[n++];
      }
      setVisible(n);
      setMeasured(true);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(region);
    let alive = true;
    document.fonts?.ready.then(() => alive && compute());
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [items]);

  const shown = items.slice(0, visible);
  const hidden = items.slice(visible);
  const hiddenCurrent = hidden.some((i) => i.id === current);

  return (
    <nav aria-label={label} data-testid={testId} data-visible={visible} className={cx('@container relative border-b border-ods-line bg-ods-surface text-ods-text', className)}>
      <div className="mx-auto flex h-ods-control max-w-ods-content items-stretch px-[calc(var(--ods-pad-page)-12px)]">
        {categories ? (
          <MegaMenu
            label="All categories"
            panelLabel="All categories"
            columns={categories.columns}
            promo={categories.promo}
            triggerIcon={LayoutGrid}
            testIds={megaMenuTestIds}
            triggerClassName="inline-flex h-full shrink-0 items-center gap-2 px-3 text-ods-table font-semibold whitespace-nowrap text-ods-navy hover:bg-ods-blue-tint aria-expanded:bg-ods-blue-tint"
          />
        ) : null}
        <div ref={regionRef} className={cx('flex min-w-0 flex-1 items-stretch', !measured && 'overflow-hidden')}>
          <ul className="flex items-stretch">
            {shown.map((it) => (
              <li key={it.id} className="flex">
                <Link href={it.href} aria-current={it.id === current ? 'page' : undefined} className={cx(ITEM, it.id === current ? SELECTED : 'font-medium text-ods-text hover:text-ods-blue')}>
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
          {hidden.length ? (
            <MenuButton
              className="h-full"
              label={
                <>
                  More
                  <span aria-hidden className="rounded-ods-pill bg-ods-canvas px-1.5 text-ods-small font-semibold text-ods-slate">
                    {hidden.length}
                  </span>
                  <span className="sr-only">({hidden.length} more sections)</span>
                </>
              }
              menuLabel="More sections"
              items={hidden.map((it) => ({ id: it.id, label: it.label, href: it.href, current: it.id === current }))}
              triggerClassName={cx(ITEM, 'gap-1.5 hover:bg-ods-blue-tint aria-expanded:bg-ods-blue-tint', hiddenCurrent ? SELECTED : 'font-medium text-ods-navy')}
            />
          ) : null}
        </div>
        {walletBalance !== undefined ? (
          <Link
            href={walletHref}
            target={sameTab ? undefined : ACCOUNT_TAB}
            className="inline-flex shrink-0 items-center gap-2 px-3 text-ods-table font-semibold whitespace-nowrap text-ods-navy hover:text-ods-blue"
          >
            <Icon icon={Wallet} />
            <span className="sr-only @min-[640px]:not-sr-only">Wallet</span>
            <span className="tabular-nums @max-[519px]:sr-only">{formatMoney(walletBalance)}</span>
            {sameTab ? null : <span className="sr-only">(opens the My account tab)</span>}
          </Link>
        ) : null}
      </div>
      {/* hidden measuring row: the bold width of every link + the More button */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
      <div ref={measureRef} className="flex w-max">
        {items.map((it) => (
          <span key={it.id} className={cx(ITEM, 'font-bold')}>
            {it.label}
          </span>
        ))}
        <span className={cx(ITEM, 'gap-1.5 font-bold')}>
          More <span className="px-1.5 text-ods-small">{items.length}</span>
          <span className="size-ods-icon" />
        </span>
      </div>
      </div>
    </nav>
  );
}
