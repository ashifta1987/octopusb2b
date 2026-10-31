'use client';
import { useEffect, useState } from 'react';
import { CURRENCY_PREFIX, asCurrency } from '@/lib/format';

/**
 * Site banner shown after a platform currency switch (SPEC §15.1 step 4). Dismissal is stored in localStorage
 * per switch (keyed by `appliedAt`), so a later switch shows the banner again.
 */
export function CurrencySwitchBanner({ to, appliedAt }: { to: string; appliedAt: string }) {
  const key = `octo:currency-banner:${appliedAt}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(key) === '1'; } catch { /* storage blocked → show */ }
    // Read after mount so server HTML and first client render match (no hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(!dismissed);
  }, [key]);
  if (!show) return null;
  const cur = asCurrency(to);
  return (
    <div className="bg-blue-soft border-b border-blue/30 text-navy text-[14px]" role="status">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-2.5 flex items-center justify-between gap-4">
        <p>
          <strong>Prices are now shown in {CURRENCY_PREFIX[cur]} ({cur}).</strong>{' '}
          Existing quotes and invoices keep their original currency.
        </p>
        <button
          type="button" className="btn btn-ghost btn-sm shrink-0" aria-label="Dismiss currency notice"
          onClick={() => { try { window.localStorage.setItem(key, '1'); } catch { /* ignore */ } setShow(false); }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
