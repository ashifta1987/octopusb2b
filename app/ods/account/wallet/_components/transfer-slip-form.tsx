'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { Button, Field, Input } from '@octopus/ui';
import { createClient } from '@/lib/supabase/client';

const SLIP = /\.(pdf|jpe?g|png)$/i;

/**
 * "I have sent a transfer" — TODAY's top-up flow (components/account/transfer-form.tsx), same checks and calls: the slip
 * goes to the private `transfer-slips` bucket in the company's own folder, then TODAY's submitTransfer action
 * (submit_bank_transfer RPC) tells finance, who credit the wallet with the amount that arrived. No card top-ups (today:
 * US dollar bank transfers only). `demo` (fixtures) disables sending.
 */
export function TransferSlipForm({
  orgId,
  reference,
  submitTransfer,
  demo,
}: {
  orgId: string;
  reference: string;
  submitTransfer: (input: { amountCents: number; slipPath: string; bankRef?: string }) => Promise<{ ok: true; data?: undefined } | { ok: false; error: string }>;
  demo?: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (demo) return;
    const cents = Math.round(Number(amount.replace(/,/g, '')) * 100);
    if (!Number.isFinite(cents) || cents < 100) {
      setMsg({ ok: false, text: 'Enter the amount you sent in US dollars.' });
      return;
    }
    if (!file) {
      setMsg({ ok: false, text: 'Attach the transfer slip (PDF, JPG or PNG).' });
      return;
    }
    if (!SLIP.test(file.name) || file.size > 10 * 1024 * 1024) {
      setMsg({ ok: false, text: 'The slip must be a PDF, JPG or PNG up to 10 MB.' });
      return;
    }
    setBusy('Uploading slip…');
    const path = `${orgId}/${crypto.randomUUID()}-${file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-60)}`;
    const up = await createClient().storage.from('transfer-slips').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) {
      setBusy(null);
      setMsg({ ok: false, text: `Upload failed: ${up.error.message}` });
      return;
    }
    setBusy('Sending to finance…');
    const r = await submitTransfer({ amountCents: cents, slipPath: path, bankRef: bankRef || undefined });
    setBusy(null);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error });
      return;
    }
    setMsg({ ok: true, text: 'Sent. Finance checks the bank statement and credits your wallet with the amount that arrived.' });
    setAmount('');
    setBankRef('');
    setFile(null);
    router.refresh();
  }

  return (
    <form onSubmit={send} className="grid gap-4 ods-tablet:grid-cols-2" data-testid="transfer-form">
      <Field label="Amount sent (US$)" required>
        {(c) => <Input {...c} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Bank reference" optional hint="From your bank's confirmation.">
        {(c) => <Input {...c} value={bankRef} onChange={(e) => setBankRef(e.target.value)} />}
      </Field>
      <Field label="Transfer slip" required hint={`Quote ${reference || 'your wallet reference'} on the transfer. PDF, JPG or PNG, up to 10 MB.`} className="ods-tablet:col-span-2">
        {(c) => <Input {...c} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
      </Field>
      {msg ? (
        <p role={msg.ok ? 'status' : 'alert'} className={`m-0 rounded-ods-control p-3 text-ods-small ods-tablet:col-span-2 ${msg.ok ? 'bg-ods-success-tint text-ods-success' : 'bg-ods-danger-tint text-ods-danger'}`}>
          {msg.text}
        </p>
      ) : null}
      <div className="ods-tablet:col-span-2">
        <Button type="submit" iconStart={Send} loading={!!busy} loadingText={busy ?? undefined} disabled={demo} disabledReason={demo ? 'Sample only — nothing is sent' : undefined}>
          Send to finance
        </Button>
      </div>
    </form>
  );
}
