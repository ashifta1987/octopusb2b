import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { money, fmtDate, CURRENCIES, asCurrency as asCur, type Currency } from '@/lib/format';
import { getCurrencyContext } from '@/lib/currency';
import { cn } from '@/lib/cn';
import { updateService, addPrice, createService, setServiceActive } from './actions';
import { nowMs } from '@/components/admin/server';

export const metadata = { title: 'Services & charges' };

type Price = { id: string; service_code: string; amount_minor: number; currency: string; effective_from: string; created_by: string | null; created_at: string };
type Info = { amount_minor: number | null; currency: string; converted: boolean };

/** Admin → Services & charges (Fees.png). */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ code?: string; new?: string }> }) {
  const s = await requireStaff('services', 'view', '/admin/services');
  const { code: sel, new: isNew } = await searchParams;
  const sb = await createClient();
  const [{ data: services }, { data: prices }] = await Promise.all([
    sb.from('services').select('code, name, description, unit, active, sort').order('sort'),
    sb.from('service_prices').select('id, service_code, amount_minor, currency, effective_from, created_by, created_at').order('effective_from', { ascending: false }),
  ]);
  const editable = can(s, 'services', 'edit');
  const list = services ?? [];
  const now = new Date().toISOString();
  const byCode = new Map<string, Price[]>();
  ((prices ?? []) as Price[]).forEach((p) => byCode.set(p.service_code, [...(byCode.get(p.service_code) ?? []), p]));
  const currentOf = (code: string, currency: Currency = 'USD') => byCode.get(code)?.find((p) => p.currency === currency && p.effective_from <= now);
  // CNY column: explicit CNY price, or the USD price converted at the approved rate (service_price_info marks it "converted")
  const [ctx, cnyRows] = await Promise.all([
    getCurrencyContext(),
    Promise.all(list.map(async (sv) => {
      const { data } = await sb.rpc('service_price_info', { p_code: sv.code, p_currency: 'CNY' });
      return [sv.code, ((data ?? []) as Info[])[0] ?? null] as const;
    })),
  ]);
  const cnyInfo = new Map(cnyRows);
  const infoOf = (code: string, currency: Currency): Info | null => {
    if (currency === 'CNY') return cnyInfo.get(code) ?? null;
    const p = currentOf(code, 'USD');
    return p ? { amount_minor: Number(p.amount_minor), currency: 'USD', converted: false } : null;
  };
  const selected = isNew ? null : list.find((x) => x.code === sel) ?? list[0] ?? null;
  const history = selected ? byCode.get(selected.code) ?? [] : [];
  const platformInfo = selected ? infoOf(selected.code, ctx.currency) : null;
  const people = [...new Set(history.map((h) => h.created_by).filter(Boolean) as string[])];
  const { data: profs } = people.length ? await sb.from('profiles').select('id, full_name').in('id', people) : { data: [] };
  const who = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
  const localNow = new Date(nowMs() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <>
      <PageHeader
        title="Services & charges"
        subtitle="Every paid or free service in one place. Change a price here and it updates on the product page, Request Center and checkout. Prices are kept per currency (USD and CNY); a missing CNY price is converted from USD at the approved rate and marked “converted”. Changes apply to new requests only."
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
                const pu = infoOf(sv.code, 'USD');
                const pc = infoOf(sv.code, 'CNY');
                const active = selected?.code === sv.code;
                return (
                  <li key={sv.code}>
                    <Link href={`/admin/services?code=${sv.code}`} aria-current={active ? 'true' : undefined}
                      className={cn('block px-5 py-4 border-b border-line last:border-0', active ? 'bg-tint border-l-4 border-l-coral-text' : 'hover:bg-pearl')}>
                      <div className="flex justify-between gap-3"><span className="font-semibold">{sv.name}</span><StatusBadge status={sv.active ? 'live' : 'off'} label={sv.active ? 'Live' : 'Off'} /></div>
                      <div className="mono text-sm text-muted mt-1">
                        {pu?.amount_minor === 0 ? 'Free · quoted later' : pu ? `${money(pu.amount_minor, 'USD')} ${sv.unit}` : 'USD price not set'}
                      </div>
                      {pu?.amount_minor !== 0 && (
                        <div className="mono text-xs text-muted mt-0.5">
                          {pc?.amount_minor != null ? money(pc.amount_minor, 'CNY') : 'CNY not set'}
                          {pc?.converted && <span className="ml-1.5 rounded bg-pearl border border-line px-1 py-px text-[10px] uppercase">converted</span>}
                        </div>
                      )}
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
              <Field label="Base price (USD)" htmlFor="ns-amount" hint="CNY is converted from USD until you set an explicit CNY price."><input id="ns-amount" name="amount" inputMode="decimal" className="input mono" placeholder="0.00" /></Field>
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
                <div className="sm:col-span-2 rounded-[10px] bg-pearl px-4 py-3 text-sm">
                  Buyers will see ({ctx.currency}): <b>{selected.name} · {platformInfo && platformInfo.amount_minor != null ? (platformInfo.amount_minor === 0 ? 'Free' : `${money(platformInfo.amount_minor, platformInfo.currency)} ${selected.unit}`) : 'price not set'}</b>
                  {platformInfo?.converted && <span className="text-muted"> · converted from USD at {ctx.rate} CNY/USD</span>}
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

            <Card title="Price per currency">
              <div className="px-6 pb-4 grid gap-3 sm:grid-cols-2">
                {CURRENCIES.map((c) => {
                  const i = infoOf(selected.code, c);
                  return (
                    <div key={c} className="rounded-[10px] border border-line px-4 py-3">
                      <div className="mono text-xs text-muted uppercase tracking-wider">{c}{c === ctx.currency && ' · platform currency'}</div>
                      <div className="mono text-xl font-semibold mt-1">{i && i.amount_minor != null ? money(i.amount_minor, c) : 'not set'}</div>
                      <div className="text-xs text-muted mt-0.5">{i?.converted ? `Converted from USD at ${ctx.rate} CNY/USD — set an explicit ${c} price to override` : i && i.amount_minor != null ? 'Explicit price' : `No ${c} price`}</div>
                    </div>
                  );
                })}
              </div>
              {editable && (
                <ActionForm key={'p' + selected.code} action={addPrice} className="px-6 pb-4 grid gap-4 sm:grid-cols-[120px_1fr_1fr_auto] items-end" submitLabel="Set price" confirm="Change this price? It applies to new requests from the effective date." resetOnSuccess inline>
                  <input type="hidden" name="code" value={selected.code} />
                  <Field label="Currency" htmlFor="pr-cur">
                    <select id="pr-cur" name="currency" className="input" defaultValue={ctx.currency}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="New price" htmlFor="pr-amount"><input id="pr-amount" name="amount" inputMode="decimal" className="input mono" required placeholder="0.00" /></Field>
                  <Field label="Effective from" htmlFor="pr-from" hint="Leave as now, or pick a future date to schedule."><input id="pr-from" name="effective_from" type="datetime-local" className="input" defaultValue={localNow} /></Field>
                </ActionForm>
              )}
              <Table head={['Amount', 'Currency', 'Effective from', 'Set by', 'Status']} empty={<EmptyState title="No price history" />}>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="td mono font-semibold">{money(Number(h.amount_minor), h.currency)}</td>
                    <td className="td mono text-sm">{h.currency}</td>
                    <td className="td text-sm">{fmtDate(h.effective_from, true)} {new Date(h.effective_from).getFullYear()}</td>
                    <td className="td text-sm">{h.created_by ? who.get(h.created_by) ?? '—' : 'Seed'}</td>
                    <td className="td">{h.effective_from > now ? <StatusBadge status="scheduled" /> : h.id === currentOf(selected.code, asCur(h.currency))?.id ? <StatusBadge status="active" label="Current" /> : <StatusBadge status="superseded" label="Previous" />}</td>
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
