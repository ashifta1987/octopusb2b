'use client';

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button, EmptyState, Icon, StatusPill, cx, formatDate } from '@octopus/ui';
import type { CompanyData, DivisionCard } from '../_lib/admin-c-data';
import { COMPANY_LABELS } from '../_lib/admin-c-core';
import type { ActionResult } from './accounts-a-actions';
import { AdminForm as ActionFormOds } from './admin-c-form';
import { LocalTime, Panel } from './dashboard';

/**
 * ODS T9 · /admin/divisions and /admin/company (company-wide Admin only, as today). Saving = TODAY's actions
 * (saveDivision, saveCompany, saveInvoicingRule) unchanged: admin check, fresh-2FA step-up and audit stay in them.
 */

type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
const inputCls = 'h-ods-control w-full rounded-ods-control border border-ods-line-strong bg-ods-surface px-2.5 text-ods-body text-ods-text';
const box = 'flex cursor-pointer items-start gap-3 rounded-ods-control border border-ods-line p-3 has-[:checked]:border-ods-blue has-[:checked]:bg-ods-blue-tint';
const LOGO_LABEL: Record<string, string> = { 'octopus-b2b': 'Octopus B2B', 'octopus-dropship': 'Octopus Dropship' };

function Head({ crumb, title, sub, actions }: { crumb: string; title: string; sub: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-3xl">
        <p className="m-0 text-ods-small text-ods-slate">{crumb}</p>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{title}</h1>
        <p className="m-0 mt-0.5 text-ods-small text-ods-slate">{sub}</p>
        <p className="m-0 mt-1 inline-flex items-center gap-1 text-ods-small text-ods-slate"><Icon icon={Lock} size="xs" />Company-wide Admin only · saving asks for your 2FA code if it is older than the step-up window · every change is audited.</p>
      </div>
      {actions}
    </div>
  );
}

export function DivisionsAdmin({ divisions, logos, save }: { divisions: DivisionCard[]; logos: Record<string, string>; save: FormAction }) {
  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="divisions-page">
      <Head crumb="Admin › Company" title="Divisions" sub="Six divisions of one legal company. The code is fixed (it is in invoice numbers and reports); name, order, logo and status can be changed."
        actions={<Button href="/admin/staff#divisions" variant="secondary">People in divisions</Button>} />
      {divisions.length === 0 ? <EmptyState title="No divisions yet" headingLevel={2} /> : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
          {divisions.map((d) => (
            <Panel key={d.code} testId={`division-${d.code}`}
              title={<span className="flex items-center gap-2"><span className="rounded-ods-control bg-ods-canvas px-2 py-0.5 font-ods text-ods-small">{d.code}</span>{d.name}</span>}
              actions={<StatusPill tone={d.active ? 'success' : 'neutral'}>{d.active ? 'Active' : 'Inactive'}</StatusPill>}>
              <ActionFormOds action={save} submitLabel="Save" confirm={`Save ${d.name}? You may be asked for your 2FA code.`} className="grid gap-3 ods-tablet:grid-cols-[minmax(0,1fr)_110px]">
                <input type="hidden" name="code" value={d.code} />
                <div className="flex flex-col gap-1"><label htmlFor={`dv-name-${d.code}`} className="text-ods-label font-semibold text-ods-navy">Name</label><input id={`dv-name-${d.code}`} name="name" defaultValue={d.name} className={inputCls} required minLength={2} maxLength={60} /></div>
                <div className="flex flex-col gap-1"><label htmlFor={`dv-order-${d.code}`} className="text-ods-label font-semibold text-ods-navy">Order</label><input id={`dv-order-${d.code}`} name="sort_order" type="number" min={1} max={99} defaultValue={d.sortOrder} className={cx(inputCls, 'text-end')} required /></div>
                <fieldset className="m-0 border-0 p-0 ods-tablet:col-span-2">
                  <legend className="mb-1 text-ods-label font-semibold text-ods-navy">Logo on this division&apos;s documents</legend>
                  <div className="grid gap-2 ods-tablet:grid-cols-2">
                    {Object.entries(logos).map(([key, src]) => (
                      <label key={key} className={box}>
                        <input type="radio" name="logo_key" value={key} defaultChecked={d.logoKey === key} />
                        {/* eslint-disable-next-line @next/next/no-img-element -- approved brand file shown as-is (as today) */}
                        <img src={src} alt={LOGO_LABEL[key] ?? key} className="h-7 w-auto max-w-[150px] object-contain" />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex items-center gap-2 text-ods-body ods-tablet:col-span-2">
                  <input type="checkbox" name="active" defaultChecked={d.active} className="size-4" /> Active (shown in the division switcher and on new work)
                </label>
                <p className="m-0 text-ods-small text-ods-slate ods-tablet:col-span-2">{d.people} {d.people === 1 ? 'person' : 'people'} in this division · company-wide Admin, Finance and Support see every division.</p>
              </ActionFormOds>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

export function CompanyAdmin({ data, saveCompany, saveRule }: { data: CompanyData; saveCompany: FormAction; saveRule: FormAction }) {
  const v = data.values;
  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="company-page">
      <Head crumb="Admin › Company" title="Company" sub="The one legal company behind all six divisions. It issues every invoice and holds every customer wallet." />
      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Legal details" testId="company-legal" actions={<span className="text-ods-small text-ods-slate">Admin only · audited</span>}>
          <ActionFormOds action={saveCompany} submitLabel="Save legal details" confirm="Save the legal company details? They print on every invoice. You may be asked for your 2FA code." className="grid gap-3 ods-tablet:grid-cols-2">
            {(['legal_name', 'legal_name_cn', 'registration_no', 'tax_id'] as const).map((k) => (
              <div key={k} className="flex flex-col gap-1">
                <label htmlFor={`co-${k}`} className="text-ods-label font-semibold text-ods-navy">{COMPANY_LABELS[k]}</label>
                <input id={`co-${k}`} name={k} defaultValue={v[k]} className={inputCls} maxLength={400} required={k === 'legal_name'} autoComplete="off" aria-describedby={!v[k] && k !== 'legal_name' ? `co-${k}-h` : undefined} />
                {!v[k] && k !== 'legal_name' ? <p id={`co-${k}-h`} className="m-0 text-ods-small text-ods-slate">Not given yet — left empty</p> : null}
              </div>
            ))}
            {(['address', 'address_cn'] as const).map((k) => (
              <div key={k} className="flex flex-col gap-1 ods-tablet:col-span-2">
                <label htmlFor={`co-${k}`} className="text-ods-label font-semibold text-ods-navy">{COMPANY_LABELS[k]}</label>
                <textarea id={`co-${k}`} name={k} defaultValue={v[k]} className={cx(inputCls, 'min-h-[84px] py-2')} maxLength={400} />
              </div>
            ))}
            <div className="flex flex-col gap-1 ods-tablet:col-span-2">
              <label htmlFor="co-registered_in" className="text-ods-label font-semibold text-ods-navy">{COMPANY_LABELS.registered_in}</label>
              <input id="co-registered_in" name="registered_in" defaultValue={v.registered_in} className={inputCls} maxLength={400} />
            </div>
            <p className="m-0 text-ods-small text-ods-slate ods-tablet:col-span-2">Last changed {data.updatedAt ? formatDate(data.updatedAt) : '—'}.</p>
          </ActionFormOds>
        </Panel>
        <div className="flex min-w-0 flex-col gap-ods-gap">
          <Panel title="Divisions" testId="company-divisions" actions={<Button href="/admin/divisions" variant="link" size="sm">Manage</Button>}>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {data.divisions.map((d) => (
                <li key={d.code} className="flex items-center justify-between gap-2 text-ods-body">
                  <span><b>{data.brand} · {d.name}</b> <span className="font-ods text-ods-small text-ods-slate">{d.code}</span></span>
                  <StatusPill tone={d.active ? 'success' : 'neutral'}>{d.active ? 'Active' : 'Inactive'}</StatusPill>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Bank details" testId="company-banks" actions={<Button href="/admin/settings/payment" variant="link" size="sm">Edit in Payment settings</Button>}>
            {data.banks.length === 0 ? <EmptyState title="No bank account yet" /> : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.banks.map((b) => (
                  <li key={b.id} className="rounded-ods-control border border-ods-line p-2.5 text-ods-body">
                    <div className="flex items-center justify-between gap-2"><b>{b.bank}</b><span className="font-ods text-ods-small">{b.currency}</span></div>
                    <div className="text-ods-small text-ods-slate">{b.holder} · {b.account}{b.swift ? ` · SWIFT ${b.swift}` : ''}</div>
                    {!b.active ? <div className="text-ods-small text-ods-slate">Not shown to customers</div> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 mt-2 rounded-ods-control bg-ods-info-tint px-3 py-2 text-ods-small">Customer top-ups go to these accounts. Finance edits them in Payment settings (also audited).</p>
          </Panel>
        </div>
      </div>

      <Panel title="Tax invoices for service proformas" testId="company-invoicing-rule" actions={<span className="text-ods-small text-ods-slate">Admin only · audited</span>}>
        <ActionFormOds action={saveRule} submitLabel="Save rule" confirm="Change when tax invoices are issued for service proformas? It applies to payments from now on. You may be asked for your 2FA code." className="grid gap-2">
          <p className="m-0 text-ods-small text-ods-slate">Make My Brand, 3PL and other service proformas. Revenue counts from the tax invoice; until then payments show as Customer deposits in the reports.</p>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="sr-only">When to issue the tax invoice</legend>
            <label className={box}><input type="radio" name="rule" value="on_full_payment" defaultChecked={data.rule === 'on_full_payment'} className="mt-1" /><span><b className="block">One tax invoice when the proforma is fully paid</b><span className="text-ods-small text-ods-slate">Part payments are customer deposits until the last payment arrives.</span></span></label>
            <label className={box}><input type="radio" name="rule" value="per_payment" defaultChecked={data.rule === 'per_payment'} className="mt-1" /><span><b className="block">A tax invoice for every payment</b><span className="text-ods-small text-ods-slate">Each payment (deposit, part payment, balance) gets its own OCT- tax invoice.</span></span></label>
          </fieldset>
        </ActionFormOds>
      </Panel>

      <Panel title="Change history" testId="company-history" actions={<span className="text-ods-small text-ods-slate">last {data.history.length}</span>}>
        {data.history.length === 0 ? <EmptyState title="No changes recorded yet" /> : (
          <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
            {data.history.map((h) => (
              <li key={h.id} className="grid grid-cols-1 gap-x-4 py-2 text-ods-body ods-tablet:grid-cols-[170px_160px_minmax(0,1fr)]">
                <span className="text-ods-small text-ods-slate">{formatDate(h.at)} <LocalTime iso={h.at} /></span>
                <span className="font-semibold">{h.who}</span>
                <span>{h.what || <span className="text-ods-slate">Website fields</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Settings pages (payment / dropship) — ODS head + notice around today's settings clients. */
export function SettingsShell({ crumb, title, sub, notice, testId, children }: { crumb: string; title: string; sub: string; notice?: ReactNode; testId: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid={testId}>
      <div className="min-w-0 max-w-3xl">
        <p className="m-0 text-ods-small text-ods-slate">{crumb}</p>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{title}</h1>
        <p className="m-0 mt-0.5 text-ods-small text-ods-slate">{sub}</p>
      </div>
      {notice ? <p role="status" className="m-0 rounded-ods-control bg-ods-warning-tint px-3 py-2 text-ods-small" data-testid={`${testId}-notice`}>{notice}</p> : null}
      {children}
    </div>
  );
}
