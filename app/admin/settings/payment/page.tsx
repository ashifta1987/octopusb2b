import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { BankAccounts } from '@/components/admin/bank-accounts';

export const metadata = { title: 'Payment settings' };

/** ADDON-41 rule 5 — the bank account customers top up into (USD TT, Hong Kong). Finance and owner only; never in code. */
async function PaymentSettingsContent() {
  const s = await requireStaff('finance', 'view', '/admin/settings/payment');
  const sb = await createClient();
  const { data: c } = await sb.from('company_profile').select('legal_name').eq('id', 1).maybeSingle();
  return (
    <>
      <PageHeader title="Payment settings" subtitle="Customers top up their wallet by US dollar bank transfer to this account, quoting their wallet reference. Finance confirms each transfer in Bank transfers." />
      <BankAccounts isAdmin={s.isAdmin || can(s, 'finance', 'edit')} legalName={(c?.legal_name as string) ?? ''} />
    </>
  );
}

/** Request-time content streams inside Suspense (cacheComponents: instant navigation). */
export default function PaymentSettings() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}>
      <PaymentSettingsContent />
    </Suspense>
  );
}
