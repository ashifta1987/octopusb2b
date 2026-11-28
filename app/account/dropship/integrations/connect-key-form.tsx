'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsButton, DsInput } from '@/components/dropship-ui';
import type { C1Result } from './c1-actions';
import { connectKeyStoreAction } from './c3-actions';

/**
 * CONN S3 · Key-paste connect form for Magento 2 (Integration access token) and PrestaShop (Webservice key).
 * Tested on the server against the store before anything is sealed or stored. Built with @/components/dropship-ui so it
 * renders identically in both the classic shell and ODS (/ods/account/dropship/integrations).
 */
const COPY = {
  magento: {
    urlLabel: 'Your Magento store address',
    keyLabel: 'Integration access token',
    keyPlaceholder: 'Paste the Access Token from Magento',
    steps: 'In Magento admin: System › Extensions › Integrations › Add New Integration, grant Stores › Settings and Sales › Operations › Orders (and Shipments), Activate, and copy the Access Token.',
    extra: 'Magento 2.4.4 or later: set Stores › Configuration › Services › OAuth › Consumer Settings › "Allow OAuth Access Tokens to be used as standalone Bearer tokens" to Yes.',
    note: 'We test the token before anything is saved. You can remove the integration in Magento at any time.',
  },
  prestashop: {
    urlLabel: 'Your PrestaShop shop address',
    keyLabel: 'Webservice key',
    keyPlaceholder: 'Paste your PrestaShop Webservice key',
    steps: 'In PrestaShop admin: Advanced Parameters › Webservice › turn on the webservice, add a key with GET on orders, addresses, countries, currencies, configurations, order_carriers and PUT on order_carriers.',
    extra: null,
    note: 'We test the key before anything is saved. You can delete the key in PrestaShop at any time.',
  },
} as const;

export function ConnectKeyForm({
  platform,
  defaultUrl = '',
  testId,
  onConnected,
}: {
  platform: 'magento' | 'prestashop';
  defaultUrl?: string;
  testId: string;
  onConnected?: (r: C1Result) => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultUrl);
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const c = COPY[platform];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await connectKeyStoreAction(platform, url, secret);
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      setSecret('');
      onConnected?.({ ok: true, message: r.message });
      router.refresh();
    });
  };

  const disabledReason = !url.trim()
    ? 'Type your store address first'
    : !secret.trim()
      ? `Paste your ${c.keyLabel.toLowerCase()} first`
      : undefined;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[12px] border border-line bg-pearl p-3.5" data-testid={testId}>
      <p className="m-0 text-[12px] text-muted">{c.steps}</p>
      {c.extra && (
        <p className="m-0 text-[12px] font-semibold text-ink" data-testid={`${testId}-oauth-note`}>
          {c.extra}
        </p>
      )}
      <DsInput
        label={c.urlLabel}
        placeholder="mystore.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        inputMode="url"
        autoComplete="url"
        maxLength={300}
        data-testid={`${testId}-url`}
      />
      <DsInput
        label={c.keyLabel}
        type="password"
        placeholder={c.keyPlaceholder}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        maxLength={2048}
        data-testid={`${testId}-key`}
      />
      {err && (
        <div role="alert" className="text-[13px] text-bad" data-testid={`${testId}-error`}>
          {err}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DsButton
          type="submit"
          icon="link"
          loading={pending}
          disabled={pending || Boolean(disabledReason)}
          disabledReason={disabledReason}
          testId={`${testId}-go`}
        >
          Test and connect
        </DsButton>
      </div>
      <p className="m-0 text-[12px] text-muted">{c.note}</p>
    </form>
  );
}
