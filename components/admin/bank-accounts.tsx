import { createClient } from '@/lib/supabase/server';
import { Card, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { BANK_COLS, type BankAccount } from '@/lib/bank-accounts';
import { saveBankAccount, deleteBankAccount } from '@/app/admin/content/actions';

/** Principal company bank accounts (migration 174; ADDON-41 Admin › Payment settings): one active account per currency, finance and owner, fresh 2FA code, audited. `isAdmin` = may edit. */
export async function BankAccounts({ isAdmin, legalName }: { isAdmin: boolean; legalName: string }) {
  const sb = await createClient();
  const { data } = await sb.from('company_bank_accounts').select(BANK_COLS).order('currency').order('active', { ascending: false });
  const list = (data ?? []) as BankAccount[];
  return (
    <Card title="Bank accounts" action={<span className="text-sm text-muted">Buyers pay into these · one active account per currency</span>}>
      <div className="px-6 pb-6 space-y-5" data-testid="bank-accounts">
        <Notice tone="amber">Shown on the wallet top-up and order payment pages and on proforma / commercial invoices, matched to the payment currency. Only finance and the owner can change them; each save asks for a fresh authenticator code and is written to the audit log.</Notice>
        {list.length === 0 && <p className="text-sm text-muted">No bank account yet — customers cannot top up their wallet until one is added.</p>}
        {list.map((a) => (
          <div key={a.id} className="rounded-[12px] border border-line p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold"><span className="mono">{a.currency}</span> · {a.bank_name}</div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.active ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-surface text-muted'}`}>{a.active ? 'Active' : 'Inactive'}</span>
            </div>
            <ActionForm action={saveBankAccount} className="grid gap-3 sm:grid-cols-2" submitLabel="Save account" submitClass="btn btn-ghost btn-sm" hideSubmit={!isAdmin}
              confirm={`Save the ${a.currency} bank account? Buyers will pay into the account shown here.`}>
              <BankFields a={a} prefix={a.id} isAdmin={isAdmin} legalName={legalName} />
            </ActionForm>
            {isAdmin && <div className="mt-2 text-right"><RunButton className="btn btn-ghost btn-sm text-bad" confirm={`Delete the ${a.currency} account at ${a.bank_name}? Buyers will no longer see it.`} action={deleteBankAccount.bind(null, a.id)}>Delete</RunButton></div>}
          </div>
        ))}
        {isAdmin ? (
          <div className="rounded-[12px] border border-dashed border-line-2 p-4">
            <h3 className="font-semibold mb-3">Add bank account</h3>
            <ActionForm action={saveBankAccount} className="grid gap-3 sm:grid-cols-2" submitLabel="Add bank account" resetOnSuccess
              confirm="Add this bank account? Buyers paying in this currency will see it.">
              <BankFields prefix="new-bank" isAdmin={isAdmin} legalName={legalName} />
            </ActionForm>
          </div>
        ) : <p className="text-sm text-muted">Only finance and the owner can add or change bank accounts.</p>}
      </div>
    </Card>
  );
}

function BankFields({ a, prefix, isAdmin, legalName }: { a?: BankAccount; prefix: string; isAdmin: boolean; legalName: string }) {
  return (
    <>
      {a && <input type="hidden" name="id" value={a.id} />}
      <Field label="Currency *" htmlFor={`${prefix}-cur`}><input id={`${prefix}-cur`} name="currency" className="input mono uppercase" defaultValue={a?.currency ?? 'USD'} maxLength={3} required disabled={!isAdmin} /></Field>
      <Field label="Bank name *" htmlFor={`${prefix}-bank`}><input id={`${prefix}-bank`} name="bank_name" className="input" defaultValue={a?.bank_name ?? ''} required disabled={!isAdmin} /></Field>
      <Field label="Account holder *" htmlFor={`${prefix}-holder`}><input id={`${prefix}-holder`} name="account_holder" className="input" defaultValue={a?.account_holder ?? legalName} required disabled={!isAdmin} /></Field>
      <Field label="Account number / IBAN *" htmlFor={`${prefix}-acc`}><input id={`${prefix}-acc`} name="account_number" className="input mono" defaultValue={a?.account_number ?? ''} required disabled={!isAdmin} autoComplete="off" /></Field>
      <Field label="SWIFT / BIC" htmlFor={`${prefix}-swift`}><input id={`${prefix}-swift`} name="swift" className="input mono uppercase" defaultValue={a?.swift ?? ''} maxLength={11} disabled={!isAdmin} /></Field>
      <Field label="Routing / sort code (ABA, CNAPS…)" htmlFor={`${prefix}-routing`}><input id={`${prefix}-routing`} name="routing_code" className="input mono" defaultValue={a?.routing_code ?? ''} disabled={!isAdmin} /></Field>
      <Field label="Bank address" htmlFor={`${prefix}-addr`} className="sm:col-span-2"><input id={`${prefix}-addr`} name="bank_address" className="input" defaultValue={a?.bank_address ?? ''} disabled={!isAdmin} /></Field>
      <Field label="Intermediary / correspondent bank" htmlFor={`${prefix}-inter`}><input id={`${prefix}-inter`} name="intermediary" className="input" defaultValue={a?.intermediary ?? ''} placeholder="Name, SWIFT, account at intermediary" disabled={!isAdmin} /></Field>
      <Field label="Note to buyers" htmlFor={`${prefix}-notes`}><input id={`${prefix}-notes`} name="notes" className="input" defaultValue={a?.notes ?? ''} placeholder="e.g. Put the invoice number in the transfer reference" disabled={!isAdmin} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="active" defaultChecked={a ? a.active : true} disabled={!isAdmin} /> Active — buyers paying in this currency see this account (replaces the current active one)</label>
    </>
  );
}
