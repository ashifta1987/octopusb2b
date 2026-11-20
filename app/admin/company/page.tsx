import { Suspense } from 'react';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, EmptyState, StatusBadge, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm } from '@/components/admin/client';
import { fmtDate } from '@/lib/format';
import { saveCompany, saveInvoicingRule } from './actions';

export const metadata = { title: 'Company' };

const LABELS: Record<string, string> = {
  legal_name: 'Legal name', legal_name_cn: 'Legal name (Chinese)', registration_no: 'Registration no.', tax_id: 'Tax ID',
  address: 'Registered address', address_cn: 'Registered address (Chinese)', registered_in: 'Registered in',
};

/**
 * Divisions step 4 — Admin › Company: the one legal company behind all six divisions (Shenzhen Octopus Trading Co.,
 * Ltd.). Company-wide Admin only; saving asks for a fresh 2FA code; every change is in the history below.
 */
async function CompanyContent() {
  const s = await requireStaff('staff', 'view', '/admin/company');
  if (!s.isAdmin) redirect('/forbidden');
  const sb = await createClient();
  const [{ data: c }, { data: banks }, { data: hist }, { data: divs }, { data: ruleRow }] = await Promise.all([
    sb.from('company_profile').select('legal_name, legal_name_cn, registration_no, tax_id, address, address_cn, registered_in, brand, updated_at').eq('id', 1).maybeSingle(),
    sb.from('company_bank_accounts').select('id, currency, bank_name, account_holder, account_number, swift, active').order('currency'),
    sb.from('audit_log').select('id, actor_id, details, created_at').eq('entity', 'company_profile').order('created_at', { ascending: false }).limit(10),
    sb.from('divisions').select('code, name, status').order('sort_order'),
    sb.from('site_settings').select('value').eq('key', 'invoicing.service_proforma_rule').maybeSingle(),
  ]);
  const rule = (ruleRow?.value as string | null) ?? 'on_full_payment';
  const actorIds = [...new Set((hist ?? []).map((h) => h.actor_id).filter((x): x is string => !!x))];
  const { data: actors } = actorIds.length ? await sb.from('profiles').select('id, full_name, email').in('id', actorIds) : { data: [] };
  const who = (id: string | null) => (id ? (actors ?? []).find((a) => a.id === id)?.full_name || (actors ?? []).find((a) => a.id === id)?.email || 'Staff' : 'System');
  const changes = (d: unknown) => {
    const x = (d ?? {}) as { old?: Record<string, unknown>; new?: Record<string, unknown> };
    return Object.keys(LABELS).filter((k) => x.old && x.new && JSON.stringify(x.old[k] ?? null) !== JSON.stringify(x.new[k] ?? null));
  };
  const v = (k: string) => ((c as Record<string, string | null> | null)?.[k] ?? '') as string;
  const mask = (n: string | null) => (n ? `•••• ${n.slice(-4)}` : '—');

  return (
    <>
      <PageHeader eyebrow={<span className="eyebrow">Admin · Company</span>} title="Company"
        subtitle="The one legal company behind all six divisions. It issues every invoice and holds every customer wallet." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Legal details" action={<span className="text-xs text-muted">Admin only · audited</span>}>
          <ActionForm action={saveCompany} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Save legal details"
            confirm="Save the legal company details? They print on every invoice. You may be asked for your 2FA code.">
            {(['legal_name', 'legal_name_cn', 'registration_no', 'tax_id'] as const).map((k) => (
              <Field key={k} label={LABELS[k]} htmlFor={`co-${k}`} hint={!v(k) && k !== 'legal_name' ? 'Not given yet — left empty' : undefined}>
                <input id={`co-${k}`} name={k} defaultValue={v(k)} className="input" maxLength={400} required={k === 'legal_name'} autoComplete="off" />
              </Field>
            ))}
            {(['address', 'address_cn'] as const).map((k) => (
              <Field key={k} label={LABELS[k]} htmlFor={`co-${k}`} className="sm:col-span-2">
                <textarea id={`co-${k}`} name={k} defaultValue={v(k)} className="input min-h-[84px]" maxLength={400} />
              </Field>
            ))}
            <Field label={LABELS.registered_in} htmlFor="co-registered_in" className="sm:col-span-2">
              <input id="co-registered_in" name="registered_in" defaultValue={v('registered_in')} className="input" maxLength={400} />
            </Field>
            <p className="sm:col-span-2 text-xs text-muted">Last changed {c?.updated_at ? fmtDate(c.updated_at as string, true) : '—'}. Saving asks for your 2FA code if it is older than the step-up window.</p>
          </ActionForm>
        </Card>
        <div className="grid gap-6 self-start">
          <Card title="Divisions" action={<Link href="/admin/divisions" className="text-sm text-coral-text font-semibold">Manage</Link>}>
            <ul className="px-6 pb-5 grid gap-2">
              {(divs ?? []).map((d) => (
                <li key={d.code} className="flex items-center justify-between gap-3 text-sm">
                  <span><span className="font-semibold">{c?.brand ?? 'Octopus B2B'} · {d.name}</span> <span className="mono text-xs text-muted">{d.code}</span></span>
                  <StatusBadge status={d.status} tone={d.status === 'active' ? 'green' : 'gray'} label={d.status === 'active' ? 'Active' : 'Inactive'} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Bank details" action={<Link href="/admin/settings/payment" className="text-sm text-coral-text font-semibold">Edit in Payment settings</Link>}>
            {(banks ?? []).length === 0 ? <EmptyState title="No bank account yet" /> : (
              <ul className="px-6 pb-5 grid gap-3">
                {(banks ?? []).map((b) => (
                  <li key={b.id} className="text-sm border border-line rounded-[10px] p-3">
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold">{b.bank_name}</span><span className="mono text-xs">{b.currency}</span></div>
                    <div className="text-muted">{b.account_holder ?? '—'} · {mask(b.account_number as string | null)}{b.swift ? ` · SWIFT ${b.swift}` : ''}</div>
                    {!b.active && <div className="text-xs text-muted mt-1">Not shown to customers</div>}
                  </li>
                ))}
              </ul>
            )}
            <div className="px-6 pb-5"><Notice>Customer top-ups go to these accounts. Finance edits them in Payment settings (also audited).</Notice></div>
          </Card>
        </div>
      </div>
      <Card title="Tax invoices for service proformas" className="mt-6" action={<span className="text-xs text-muted">Admin only · audited</span>}>
        <ActionForm action={saveInvoicingRule} className="px-6 pb-6 grid gap-3" submitLabel="Save rule" confirm="Change when tax invoices are issued for service proformas? It applies to payments from now on. You may be asked for your 2FA code.">
          <p className="text-sm text-muted">Make My Brand, 3PL and other service proformas. Revenue counts from the tax invoice; until then payments show as Customer deposits in the reports.</p>
          <label className="flex items-start gap-3 rounded-[10px] border border-line p-3 has-[:checked]:border-coral-text has-[:checked]:bg-tint">
            <input type="radio" name="rule" value="on_full_payment" defaultChecked={rule === 'on_full_payment'} className="mt-1" />
            <span><span className="font-semibold block">One tax invoice when the proforma is fully paid</span><span className="text-sm text-muted">Part payments are customer deposits until the last payment arrives.</span></span>
          </label>
          <label className="flex items-start gap-3 rounded-[10px] border border-line p-3 has-[:checked]:border-coral-text has-[:checked]:bg-tint">
            <input type="radio" name="rule" value="per_payment" defaultChecked={rule === 'per_payment'} className="mt-1" />
            <span><span className="font-semibold block">A tax invoice for every payment</span><span className="text-sm text-muted">Each payment (deposit, part payment, balance) gets its own OCT- tax invoice.</span></span>
          </label>
        </ActionForm>
      </Card>
      <Card title="Change history" className="mt-6" action={<span className="mono text-xs text-muted">last {(hist ?? []).length}</span>}>
        <Table head={['When', 'Who', 'What changed']} empty={<EmptyState title="No changes recorded yet" />}>
          {(hist ?? []).map((h) => (
            <tr key={h.id}>
              <td className="td text-sm whitespace-nowrap">{fmtDate(h.created_at as string, true)}</td>
              <td className="td text-sm">{who(h.actor_id as string | null)}</td>
              <td className="td text-sm">{changes(h.details).map((k) => LABELS[k]).join(', ') || <span className="text-muted">Website fields</span>}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

export default function CompanyPage() {
  return <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}><CompanyContent /></Suspense>;
}
