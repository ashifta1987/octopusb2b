import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { usd, fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { updateService, addPrice, createService, setServiceActive } from './actions';
import { nowMs } from '@/components/admin/server';

export const metadata = { title: 'Services & charges' };

type Price = { id: string; service_code: string; amount_usd_cents: number; effective_from: string; created_by: string | null; created_at: string };

/** Admin → Services & charges (Fees.png). */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ code?: string; new?: string }> }) {
  const s = await requireStaff('services', 'view', '/admin/services');
  const { code: sel, new: isNew } = await searchParams;
  const sb = await createClient();
  const [{ data: services }, { data: prices }] = await Promise.all([
    sb.from('services').select('code, name, description, unit, active, sort').order('sort'),
    sb.from('service_prices').select('id, service_code, amount_usd_cents, effective_from, created_by, created_at').order('effective_from', { ascending: false }),
  ]);
  const editable = can(s, 'services', 'edit');
  const list = services ?? [];
  const now = new Date().toISOString();
  const byCode = new Map<string, Price[]>();
  ((prices ?? []) as Price[]).forEach((p) => byCode.set(p.service_code, [...(byCode.get(p.service_code) ?? []), p]));
  const currentOf = (code: string) => byCode.get(code)?.find((p) => p.effective_from <= now);
  const selected = isNew ? null : list.find((x) => x.code === sel) ?? list[0] ?? null;
  const history = selected ? byCode.get(selected.code) ?? [] : [];
  const cur = selected ? currentOf(selected.code) : undefined;
  const people = [...new Set(history.map((h) => h.created_by).filter(Boolean) as string[])];
  const { data: profs } = people.length ? await sb.from('profiles').select('id, full_name').in('id', people) : { data: [] };
  const who = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
  const localNow = new Date(nowMs() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <>
      <PageHeader
        title="Services & charges"
        subtitle="Every paid or free service in one place. Change a price here and it updates on the product page, Request Center and checkout. All amounts in USD; changes apply to new requests only."
        actions={editable && <Link href="/admin/services?new=1" className="btn btn-primary">+ Add new service</Link>}
      />
      {!editable && <div className="mb-6"><Notice>You can view prices. Editing needs the Services & charges · edit permission.</Notice></div>}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="self-start overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-lg">All services</h2><span className="mono text-xs text-muted">{list.length} services</span>
          </div>
          {list.length === 0 ? <EmptyState title="No services yet" /> : (
            <ul>
              {list.map((sv) => {
                const p = currentOf(sv.code);
                const active = selected?.code === sv.code;
                return (
                  <li key={sv.code}>
                    <Link href={`/admin/services?code=${sv.code}`} aria-current={active ? 'true' : undefined}
                      className={cn('block px-5 py-4 border-b border-line last:border-0', active ? 'bg-blue-soft border-l-4 border-l-blue' : 'hover:bg-surface')}>
                      <div className="flex justify-between gap-3"><span className="font-semibold">{sv.name}</span><StatusBadge status={sv.active ? 'live' : 'off'} label={sv.active ? 'Live' : 'Off'} /></div>
                      <div className="mono text-sm text-muted mt-1">{p ? (Number(p.amount_usd_cents) === 0 ? 'Free · quoted later' : `${usd(Number(p.amount_usd_cents))} ${sv.unit}`) : 'price not set'}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {isNew ? (
          <Card title="New service">
            <ActionForm action={createService} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Create service">
              <Field label="Code" htmlFor="ns-code" hint="Lowercase, e.g. factory_audit. Used by RPCs; cannot be changed."><input id="ns-code" name="code" className="input mono" required pattern="[a-z0-9_]{2,32}" /></Field>
              <Field label="Service name" htmlFor="ns-name"><input id="ns-name" name="name" className="input" required /></Field>
              <Field label="Unit / pricing model" htmlFor="ns-unit"><input id="ns-unit" name="unit" className="input" placeholder="per request" required /></Field>
              <Field label="Base price (USD)" htmlFor="ns-amount"><input id="ns-amount" name="amount" inputMode="decimal" className="input mono" placeholder="0.00" /></Field>
              <Field label="Short description shown to buyers" htmlFor="ns-desc" className="sm:col-span-2"><textarea id="ns-desc" name="description" className="input min-h-20 py-2" /></Field>
              <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="active" defaultChecked /> Service is live</label>
            </ActionForm>
          </Card>
        ) : selected ? (
          <div className="grid gap-6">
            <Card>
              <div className="px-6 pt-5">
                <div className="mono text-xs text-muted uppercase tracking-wider">Editing · {selected.code}</div>
                <h2 className="text-2xl font-semibold mt-1">{selected.name}</h2>
              </div>
              <ActionForm key={selected.code} action={updateService} className="px-6 pb-6 pt-4 grid gap-4 sm:grid-cols-2" submitLabel="Save service" hideSubmit={!editable}>
                <input type="hidden" name="code" value={selected.code} />
                <Field label="Service name" htmlFor="s-name"><input id="s-name" name="name" className="input" defaultValue={selected.name} required disabled={!editable} /></Field>
                <Field label="Unit / pricing model" htmlFor="s-unit"><input id="s-unit" name="unit" className="input" defaultValue={selected.unit} required disabled={!editable} /></Field>
                <Field label="Short description shown to buyers" htmlFor="s-desc" className="sm:col-span-2"><textarea id="s-desc" name="description" className="input min-h-20 py-2" defaultValue={selected.description ?? ''} disabled={!editable} /></Field>
                <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={selected.active} disabled={!editable} /> Service is live</label>
                <div className="sm:col-span-2 rounded-[10px] bg-surface px-4 py-3 text-sm">
                  Buyers will see: <b>{selected.name} · {cur ? (Number(cur.amount_usd_cents) === 0 ? 'Free' : `${usd(Number(cur.amount_usd_cents))} ${selected.unit}`) : 'price not set'}</b>
                </div>
              </ActionForm>
              {editable && (
                <div className="px-6 pb-5 -mt-2">
                  <RunButton action={setServiceActive.bind(null, selected.code, !selected.active)} confirm={`${selected.active ? 'Deactivate' : 'Activate'} ${selected.name}?`} className={selected.active ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}>
                    {selected.active ? 'Deactivate service' : 'Activate service'}
                  </RunButton>
                </div>
              )}
            </Card>

            <Card title="Price" action={<span className="text-sm text-muted">Current: <b className="mono text-navy">{cur ? usd(Number(cur.amount_usd_cents)) : 'not set'}</b></span>}>
              {editable && (
                <ActionForm key={'p' + selected.code} action={addPrice} className="px-6 pb-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] items-end" submitLabel="Set price" confirm="Change this price? It applies to new requests from the effective date." resetOnSuccess inline>
                  <input type="hidden" name="code" value={selected.code} />
                  <Field label="New price (USD)" htmlFor="pr-amount"><input id="pr-amount" name="amount" inputMode="decimal" className="input mono" required placeholder="0.00" /></Field>
                  <Field label="Effective from" htmlFor="pr-from" hint="Leave as now, or pick a future date to schedule."><input id="pr-from" name="effective_from" type="datetime-local" className="input" defaultValue={localNow} /></Field>
                </ActionForm>
              )}
              <Table head={['Amount', 'Effective from', 'Set by', 'Status']} empty={<EmptyState title="No price history" />}>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="td mono font-semibold">{usd(Number(h.amount_usd_cents))}</td>
                    <td className="td text-sm">{fmtDate(h.effective_from, true)} {new Date(h.effective_from).getFullYear()}</td>
                    <td className="td text-sm">{h.created_by ? who.get(h.created_by) ?? '—' : 'Seed'}</td>
                    <td className="td">{h.effective_from > now ? <StatusBadge status="scheduled" /> : h.id === cur?.id ? <StatusBadge status="active" label="Current" /> : <StatusBadge status="superseded" label="Previous" />}</td>
                  </tr>
                ))}
              </Table>
              <p className="px-6 py-3 text-xs text-muted">Every price change is saved in the audit log with the old and new value.</p>
            </Card>
          </div>
        ) : <Card><EmptyState title="Select a service" /></Card>}
      </div>
    </>
  );
}
