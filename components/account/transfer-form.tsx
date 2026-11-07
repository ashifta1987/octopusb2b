'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { submitTransfer } from '@/app/account/wallet/actions';

const SLIP = /\.(pdf|jpe?g|png)$/i;

/** ADDON-41 — "I have sent a transfer": amount, optional bank reference and the slip (private storage, own company folder). */
export function TransferForm({ orgId, reference }: { orgId: string; reference: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const cents = Math.round(Number(amount.replace(/,/g, '')) * 100);
    if (!Number.isFinite(cents) || cents < 100) { setMsg({ ok: false, text: 'Enter the amount you sent in US dollars.' }); return; }
    if (!file) { setMsg({ ok: false, text: 'Attach the transfer slip (PDF, JPG or PNG).' }); return; }
    if (!SLIP.test(file.name) || file.size > 10 * 1024 * 1024) { setMsg({ ok: false, text: 'The slip must be a PDF, JPG or PNG up to 10 MB.' }); return; }
    setBusy('Uploading slip…');
    const path = `${orgId}/${crypto.randomUUID()}-${file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-60)}`;
    const up = await createClient().storage.from('transfer-slips').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) { setBusy(null); setMsg({ ok: false, text: `Upload failed: ${up.error.message}` }); return; }
    setBusy('Sending to finance…');
    const r = await submitTransfer({ amountCents: cents, slipPath: path, bankRef: bankRef || undefined });
    setBusy(null);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: 'Sent. Finance checks the bank statement and credits your wallet with the amount that arrived.' });
    setAmount(''); setBankRef(''); setFile(null);
    router.refresh();
  }

  return (
    <form onSubmit={send} className="grid gap-4 sm:grid-cols-2" data-testid="transfer-form">
      <div>
        <label htmlFor="tf-amount" className="label">Amount sent (US$)</label>
        <input id="tf-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input min-h-11" placeholder="e.g. 2500.00" />
      </div>
      <div>
        <label htmlFor="tf-ref" className="label">Bank reference (optional)</label>
        <input id="tf-ref" value={bankRef} onChange={(e) => setBankRef(e.target.value)} className="input min-h-11" placeholder="From your bank's confirmation" />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="tf-slip" className="label">Transfer slip</label>
        <input id="tf-slip" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-[14px] file:btn file:btn-ghost file:mr-3 file:min-h-11" />
        <p className="text-[12.5px] text-[#5A6475] mt-1">Quote <b className="mono">{reference}</b> on the transfer so we can match it. PDF, JPG or PNG, up to 10 MB.</p>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`sm:col-span-2 rounded-[10px] px-4 py-3 text-[14px] ${msg.ok ? 'bg-[#F0FDF4] text-[#166534]' : 'bg-[#FEF2F2] text-bad'}`}>{msg.text}</p>}
      <div className="sm:col-span-2"><button type="submit" className="btn btn-primary min-h-11" disabled={!!busy}>{busy ?? 'Send to finance'}</button></div>
    </form>
  );
}

