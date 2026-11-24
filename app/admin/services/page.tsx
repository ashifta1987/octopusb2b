import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { money, fmtDate, CURRENCIES, asCurrency as asCur, type Currency } from '@/lib/format';
import { getCurrencyContext } from '@/lib/currency';
import { cn } from '@/lib/cn';
import { updateService, addPrice, createService, setServiceActive, saveDropshipMarginSettings, setDropshipV2Ui } from './actions';
import { dropshipSettings } from '@/lib/dropship';
import { nowMs } from '@/components/admin/server';

export const metadata = { title: 'Services & charges' };

type Price = { id: string; service_code: string; amount_minor: number; currency: string; effective_from: string; created_by: string | null; created_at: string };
type Info = { amount_minor: number | null; currency: string; converted: boolean };

/** Admin → Services & charges (Fees.png). */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ code?: string; new?: string }> }) {
  const s = await requireStaff('services', 'view', '/admin/services');
  const { code: sel, new: isNew } = await searchParams;
  const sb = await createClient();
  const [{ data: services }, { data: priceRows }] = await Promise.all([
    sb.from('services').select('code, name, description, unit, active, sort').order('sort'),
    sb.from('service_prices').select('id, service_code, amount_minor, currency, effective_from, created_at').order('effective_from', { ascending: false }),
  ]);
  // created_by is hidden from session reads (migration 195): added with the service role after requireStaff.
  const prices = await withHiddenColumns('service_prices', priceRows, 'created_by');
  const editable = can(s, 'services', 'edit');
  const canEditPrice = (code: string) => editable || (code === 'dropship_request' && can(s, 'finance', 'edit'));
  const { data: launchRows } = await sb.from('launch_signups').select('id, email, source, created_at, notified_at').eq('feature', 'dropship').order('created_at', { ascending: false }).limit(200);
  const launch = (launchRows ?? []) as { id: string; email: string; source: string | null; created_at: string; notified_at: string | null }[];
  const dsCfg = await dropshipSettings();
  const dsOverridesText = Object.entries(dsCfg.categoryMinMarginBp)
    .map(([k, bp]) => `${k}: ${(bp / 100).toFixed(1)}`)
    .join('\n');
  const list = services ?? [];
  const now = new Date().toISOString();
  const byCode = new Map<string, Price[]>();
  (prices as unknown as Price[]).forEach((p) => byCode.set(p.service_code, [...(byCode.get(p.service_code) ?? []), p]));
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
      {!editable && (
        <div className="mb-6">
          <Notice>
            {can(s, 'finance', 'edit')
              ? 'You can view services and update the Dropship product request price.'
              : 'You can view prices. Editing needs the Services & charges · edit permission.'}
          </Notice>
        </div>
      )}

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
              {canEditPrice(selected.code) && (
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

      {/* Dropshipping minimum margin & supported countries (migration 204; decision 3 & 6) */}
      <Card title="Dropshipping · minimum margin & supported countries" className="mt-6">
        <p className="px-6 -mt-1 text-sm text-muted">
          Staff routes below the minimum margin show a warning on the Dropshipping catalogue editor (non-blocking). Category overrides are optional; empty categories use the default percentage.
        </p>
        <ActionForm
          action={saveDropshipMarginSettings}
          className="px-6 py-4 grid gap-4 sm:grid-cols-3 items-start"
          submitLabel="Save Dropshipping settings"
        >
          <Field label="Default minimum margin (%)" htmlFor="ds-min-margin" hint="e.g. 15 for 15%">
            <input
              id="ds-min-margin"
              name="default_min_margin_pct"
              inputMode="decimal"
              className="input mono"
              defaultValue={(dsCfg.minMarginBp / 100).toFixed(1)}
              disabled={!editable}
            />
          </Field>
          <Field
            label="Category overrides (optional)"
            htmlFor="ds-cat-overrides"
            hint='One "Category: %" per line (empty = use default)'
          >
            <textarea
              id="ds-cat-overrides"
              name="category_overrides"
              rows={3}
              className="input font-mono text-xs"
              defaultValue={dsOverridesText}
              placeholder={'Electronics: 18\nLighting: 16'}
              disabled={!editable}
            />
          </Field>
          <Field
            label="Supported selling countries (ISO-2)"
            htmlFor="ds-sup-countries"
            hint="Countries merchants may pick from"
          >
            <input
              id="ds-sup-countries"
              name="supported_countries"
              className="input mono text-xs"
              defaultValue={dsCfg.supportedCountries.join(', ')}
              disabled={!editable}
            />
          </Field>
        </ActionForm>
        <div className="px-6 py-4 border-t border-line flex flex-wrap items-center justify-between gap-4" data-testid="dropship-v2-ui-setting">
          <div>
            <div className="font-semibold text-[15px]">Dropship design v2 UI shell (<code className="mono text-xs">dropship_v2_ui</code>)</div>
            <p className="text-xs text-muted mt-0.5">
              When switched ON, organizations with Dropshipping enabled see the design v2 merchant shell and staff see the v2 back-office shell. Everyone else keeps the Coming soon card. Default: OFF on live, ON on staging.
            </p>
          </div>
          <ActionForm
            action={setDropshipV2Ui}
            submitLabel="Save UI switch"
            hideSubmit={!editable}
            inline
          >
            <label className="inline-flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                name="dropship_v2_ui"
                defaultChecked={dsCfg.v2Ui}
                disabled={!editable}
              />
              Enable Dropship v2 UI ({dsCfg.v2Ui ? 'ON' : 'OFF'})
            </label>
          </ActionForm>
        </div>
      </Card>

      {/* "Notify me when it launches" sign-ups for Coming-soon features (migration 203; staff with Services view only) */}
      <Card title={`Launch sign-ups · Dropshipping (${launch.length}${launch.length === 200 ? '+' : ''})`} className="mt-6">
        <p className="px-6 -mt-1 text-sm text-muted">People who asked to be told when dropshipping (store connection and dropship ordering) launches. From the home page and the Request Center.</p>
        <Table head={['Email', 'Signed up', 'From', 'Notified']} empty={<EmptyState title="No sign-ups yet" />}>
          {launch.map((l) => (
            <tr key={l.id}>
              <td className="td text-sm break-all">{l.email}</td>
              <td className="td text-sm">{fmtDate(l.created_at, true)}</td>
              <td className="td text-sm">{l.source === 'home' ? 'Home page' : l.source === 'request-page' ? 'Request Center' : l.source ?? '—'}</td>
              <td className="td text-sm">{l.notified_at ? fmtDate(l.notified_at, true) : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
