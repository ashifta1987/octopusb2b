'use client';

import { usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsButton, DsInput } from '@/components/dropship-ui';
import { startStoreConnectAction } from './c2-actions';

/**
 * CONN S2 · "Connect WooCommerce": the store address → WooCommerce's own approval page in the merchant's store (read and write).
 * We never ask for keys: WooCommerce creates them when the merchant approves and sends them straight to our server.
 */
export function ConnectStoreForm({ platform, defaultUrl = '', testId }: { platform: 'woocommerce'; defaultUrl?: string; testId: string }) {
  const pathname = usePathname();
  const [url, setUrl] = useState(defaultUrl);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await startStoreConnectAction(platform, url, pathname);
      if (!r.ok) { setErr(r.message); return; }
      window.location.assign(r.url);
    });
  };
  return (
    <form onSubmit={go} className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <DsInput label="Your WooCommerce store address" placeholder="mystore.com" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="url"
          containerClassName="flex-1" maxLength={300} data-testid={`${testId}-url`} error={err ?? undefined} />
        <DsButton type="submit" icon="link" loading={pending} disabled={pending || url.trim() === ''} disabledReason={url.trim() === '' ? 'Type your store address first' : undefined} testId={`${testId}-go`}>
          Continue to WooCommerce
        </DsButton>
      </div>
      <p className="m-0 text-[12px] text-muted">You sign in to your WordPress admin and approve read and write access. You can remove it there at any time.</p>
    </form>
  );
}
