import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm } from '@/components/admin/client';
import { DIVISION_LOGOS } from '@/lib/divisions/shared';
import { saveDivision } from './actions';

export const metadata = { title: 'Divisions' };

const LOGO_LABEL: Record<string, string> = { 'octopus-b2b': 'Octopus B2B', 'octopus-dropship': 'Octopus Dropship' };

/**
 * Divisions step 4 — Admin › Divisions: the six divisions of Shenzhen Octopus Trading Co., Ltd. The code (DS, MMB, …)
 * is fixed: it is in every invoice number and report. Name, order, logo and active can be changed; every change is
 * in the audit log.
 */
async function DivisionsContent() {
  const s = await requireStaff('staff', 'view', '/admin/divisions');
  if (!s.isAdmin) redirect('/forbidden');
  const sb = await createClient();
  const [{ data: divs }, { data: members }] = await Promise.all([
    sb.from('divisions').select('id, code, name, sort_order, logo_key, status, updated_at').order('sort_order').order('name'),
    sb.from('division_members').select('division_id, role'),
  ]);
  const count = (id: string) => (members ?? []).filter((m) => m.division_id === id).length;
  return (
    <>
      <PageHeader eyebrow={<span className="eyebrow">Admin · Company</span>} title="Divisions"
        subtitle="Six divisions of one legal company. The code is fixed (it is in invoice numbers and reports); name, order, logo and status can be changed."
        actions={<Link href="/admin/staff#divisions" className="btn btn-ghost">People in divisions</Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(divs ?? []).map((d) => (
          <Card key={d.code} title={<span className="flex items-center gap-2"><span className="mono text-xs px-2 py-0.5 rounded bg-pearl">{d.code}</span>{d.name}</span>}
            action={<StatusBadge status={d.status} tone={d.status === 'active' ? 'green' : 'gray'} label={d.status === 'active' ? 'Active' : 'Inactive'} />}>
            <ActionForm action={saveDivision} className="px-6 pb-6 grid gap-4 sm:grid-cols-[1fr_110px]" submitLabel="Save"
              confirm={`Save ${d.name}? You may be asked for your 2FA code.`}>
              <input type="hidden" name="code" value={d.code} />
              <Field label="Name" htmlFor={`dv-name-${d.code}`}><input id={`dv-name-${d.code}`} name="name" defaultValue={d.name} className="input" required minLength={2} maxLength={60} /></Field>
              <Field label="Order" htmlFor={`dv-order-${d.code}`}><input id={`dv-order-${d.code}`} name="sort_order" type="number" min={1} max={99} defaultValue={d.sort_order} className="input" required /></Field>
              <fieldset className="sm:col-span-2">
                <legend className="label">Logo on this division&apos;s documents</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(DIVISION_LOGOS).map(([key, src]) => (
                    <label key={key} className="flex items-center gap-3 rounded-[10px] border border-line p-3 has-[:checked]:border-coral-text has-[:checked]:bg-tint cursor-pointer">
                      <input type="radio" name="logo_key" value={key} defaultChecked={d.logo_key === key} />
                      {/* eslint-disable-next-line @next/next/no-img-element -- approved brand file shown as-is */}
                      <img src={src} alt={LOGO_LABEL[key]} className="h-7 w-auto max-w-[150px] object-contain" />
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={d.status === 'active'} className="w-5 h-5" /> Active (shown in the division switcher and on new work)
              </label>
              <p className="sm:col-span-2 text-xs text-muted">{count(d.id)} {count(d.id) === 1 ? 'person' : 'people'} in this division · company-wide Admin, Finance and Support see every division.</p>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}

export default function DivisionsPage() {
  return <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}><DivisionsContent /></Suspense>;
}
