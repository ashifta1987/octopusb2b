'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Customer account bottom bar on phones (7 Nov 2026): Dashboard · Product sourcing (new-quote badge) · Orders · Wallet · More.
 * The More sheet lists the other services — the ones this customer has used first — plus Settings and Log out.
 * Items are ≥ 44 px high and the bar pads for the home indicator (safe-area-inset-bottom).
 */
type Item = { href: string; label: string; key?: string };
const MORE: Item[] = [
  { href: '/account/dropship', label: 'Dropshipping', key: 'dropship' },
  { href: '/account/pools', label: 'MOQ pools', key: 'pools' },
  { href: '/account/warehouse', label: '3PL warehouse', key: '3pl' },
  { href: '/account/brand', label: 'Make My Brand', key: 'brand' },
  { href: '/account/invoices', label: 'Invoices and receipts' },
  { href: '/account/turnkey', label: 'Turnkey projects', key: 'turnkey' },
  { href: '/account/assistant', label: 'Assistant' },
  { href: '/account/developer', label: 'API' },
  { href: '/account/kyc', label: 'Settings' },
  { href: '/account/ledger', label: 'Ledger and statements' },
  { href: '/account/support', label: 'Help & complaints' },
];

const Icon = ({ d }: { d: string }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const ICONS: Record<string, string> = {
  dash: 'M3 12 12 4l9 8M5 10v10h14V10', sourcing: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  orders: 'M4 7h16l-1.5 12h-13zM9 7V5a3 3 0 0 1 6 0v2', wallet: 'M3 7h18v12H3zM16 13h2M3 7l2-3h12l2 3', more: 'M5 12h.01M12 12h.01M19 12h.01',
};

export function AccountBottomBar({ newQuotes, used }: { newQuotes: number; used: string[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  const main = [
    { href: '/account', label: 'Dashboard', icon: 'dash', on: path === '/account' },
    { href: '/account/sourcing', label: 'Sourcing', icon: 'sourcing', on: path.startsWith('/account/sourcing'), badge: newQuotes },
    { href: '/account/orders', label: 'Orders', icon: 'orders', on: path.startsWith('/account/orders') },
    { href: '/account/wallet', label: 'Wallet', icon: 'wallet', on: path.startsWith('/account/wallet') },
  ];
  const more = [...MORE].sort((a, b) => Number(!!b.key && used.includes(b.key)) - Number(!!a.key && used.includes(a.key)));
  return (
    <>
      <nav aria-label="Account" data-testid="account-bottom-bar"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-5">
          {main.map((m) => (
            <li key={m.href}>
              <Link href={m.href} prefetch={false} aria-current={m.on ? 'page' : undefined} aria-label={m.href === '/account/sourcing' ? 'Product sourcing' : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11.5px] font-semibold ${m.on ? 'text-coral-text' : 'text-muted'}`}>
                <Icon d={ICONS[m.icon]} />
                {m.label}
                {!!m.badge && m.badge > 0 && <span data-testid="bar-badge" aria-label={`${m.badge} new quotes`} className="absolute top-1.5 left-[calc(50%+6px)] min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10.5px] font-bold leading-[18px] text-center">{m.badge > 99 ? '99+' : m.badge}</span>}
              </Link>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
              className="w-full flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11.5px] font-semibold text-muted">
              <Icon d={ICONS.more} />More
            </button>
          </li>
        </ul>
      </nav>
      {open && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-[18px] pb-[calc(12px+env(safe-area-inset-bottom))] max-h-[80vh] overflow-y-auto" data-testid="more-sheet">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-[17px] font-semibold">More</h2>
              <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] min-w-[44px] text-[15px] font-semibold text-coral-text">Close</button>
            </div>
            <ul className="px-2">
              {more.map((m) => (
                <li key={m.href}>
                  <Link href={m.href} onClick={() => setOpen(false)} className="flex items-center justify-between min-h-[48px] px-3 rounded-[10px] text-[15.5px] font-medium hover:bg-pearl">
                    {m.label}{m.key && used.includes(m.key) && <span className="text-[11px] font-semibold text-muted">Used</span>}
                  </Link>
                </li>
              ))}
              <li className="border-t border-line mt-2 pt-2">
                <form action="/auth/signout" method="post"><button type="submit" className="w-full text-left min-h-[48px] px-3 rounded-[10px] text-[15.5px] font-semibold text-bad hover:bg-pearl">Log out</button></form>
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
