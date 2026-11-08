import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice, Stat } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { CurrencySwitchWizard, ImpactView, LocalDateTimeInput } from '@/components/admin/currency-switch';
import { asCurrency, fmtDate, humanize, money, CURRENCY_PREFIX } from '@/lib/format';
import { setFxRate, approveSwitch, cancelSwitch } from './actions';
import { StepUpNote } from '@/components/admin/step-up';

export const metadata = { title: 'Currency' };

type FxRow = { id: string; rate: number; effective_from: string; set_by: string | null; source: string; note: string | null; created_at: string };
type SwitchRow = {
  id: string; from_currency: string; to_currency: string; rate: number; wallet_option: string; effective_at: string; status: string;
  impact: Record<string, unknown> | null; note: string | null; requested_by: string; approved_by: string | null; approved_at: string | null;
  applied_at: string | null; cancelled_at: string | null; created_at: string;
};

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_approval: 'Waiting for Finance', scheduled: 'Approved · scheduled', applied: 'Applied', cancelled: 'Cancelled' };
const STATUS_TONE: Record<string, 'gray' | 'amber' | 'blue' | 'green' | 'red'> = { draft: 'gray', pending_approval: 'amber', scheduled: 'blue', applied: 'green', cancelled: 'red' };

/** Admin → Currency (SPEC §15.1; layout in the style of WalletAdmin.png). */
export default async function CurrencyPage() {
  const s = await requireStaff('finance', 'view', '/admin/currency');
  const sb = await createClient();
  const [settings, fx, switches, services] = await Promise.all([
    sb.from('site_settings').select('key, value').in('key', ['platform_currency', 'currency_switch_banner', 'currency_rounding']),
    sb.from('fx_rates').select('id, rate, effective_from, set_by, source, note, created_at').order('effective_from', { ascending: false }).order('created_at', { ascending: false }).limit(50),
    sb.from('currency_switch_requests').select('*').order('created_at', { ascending: false }).limit(30),
    sb.from('services').select('code, name').order('sort'),
  ]);
  const set = new Map((settings.data ?? []).map((r) => [r.key, r.value]));
  const current = asCurrency(set.get('platform_currency') as string);
  const banner = set.get('currency_switch_banner') as { from: string; to: string; rate: number; applied_at: string; wallet_option: string } | null;
  const rates = (fx.data ?? []) as FxRow[];
  const now = new Date().toISOString();
  const approved = rates.find((r) => r.source === 'manual' && r.effective_from <= now);
  const upcoming = rates.filter((r) => r.source === 'manual' && r.effective_from > now).at(-1);
  const reference = rates.find((r) => r.source === 'reference');
  const reqs = (switches.data ?? []) as SwitchRow[];
  const open = reqs.find((r) => r.status === 'pending_approval' || r.status === 'scheduled');
  const people = [...new Set([...rates.map((r) => r.set_by), ...reqs.flatMap((r) => [r.requested_by, r.approved_by])].filter(Boolean) as string[])];
  const { data: profs } = people.length ? await sb.from('profiles').select('id, full_name').in('id', people) : { data: [] };
  const who = new Map((profs ?? []).map((p) => [p.id, p.full_name as string]));
  const name = (id: string | null) => (id ? who.get(id) ?? 'Staff member' : 'System');
  const serviceNames = Object.fromEntries((services.data ?? []).map((x) => [x.code, x.name]));
  const rate = Number(approved?.rate ?? 7.1);
  const isAdmin = s.isAdmin;
  const canApprove = can(s, 'finance', 'approve');
  const diff = reference && approved ? ((Number(reference.rate) - rate) / rate) * 100 : null;

  return (
    <>
      <PageHeader
        title="Currency"
        subtitle="Choose the platform currency (US dollar or Chinese yuan), keep the approved exchange rate and switch with Finance approval. Existing quotes, invoices and orders always keep their own currency."
      />
      <StepUpNote className="-mt-3 mb-4" />

      <section className="rounded-[12px] bg-ink text-white px-7 py-6 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Platform currency</h2>
          <p className="text-white/80 text-[15px] mt-1">
            New prices, quotes, invoices, wallet charges and ad budgets use <b className="text-white">{current === 'CNY' ? 'Chinese yuan (CNY)' : 'US dollars (USD)'}</b>.
            {open && <> A switch to <b className="text-white">{open.to_currency}</b> is {open.status === 'scheduled' ? `scheduled for ${fmtDate(open.effective_at, true)}` : 'waiting for Finance approval'}.</>}
          </p>
        </div>
        <span className="flex items-center gap-3">
          <span className="mono text-3xl font-semibold" aria-hidden>{CURRENCY_PREFIX[current]}</span>
          <span className="rounded-full bg-white text-ink px-4 py-1.5 font-semibold mono">{current}</span>
        </span>
      </section>

      {banner && (
        <div className="mb-6"><Notice tone="green">Last switch: {banner.from} → {banner.to} at {banner.rate} CNY/USD on {fmtDate(banner.applied_at, true)} · wallets {banner.wallet_option === 'convert' ? 'converted' : 'kept'}.</Notice></div>
      )}
      {!isAdmin && <div className="mb-6"><Notice tone="blue">Only an Admin can set rates or request a switch. {canApprove ? 'As Finance you approve or cancel requests below.' : ''}</Notice></div>}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Active currency" value={current} hint={current === 'CNY' ? 'Chinese yuan · CN¥' : 'US dollar · US$'} />
        <Stat label="Approved rate (CNY per USD)" value={<span className="mono">{rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>} hint={approved ? `effective ${fmtDate(approved.effective_from, true)}` : 'seed rate'} />
        <Stat label="Example" value={<span className="mono text-xl">{money(19000, 'USD')} = {money(Math.round(19000 * rate), 'CNY')}</span>} hint="at the approved rate" />
        <Stat label="Reference rate" value={reference ? <span className="mono">{Number(reference.rate)}</span> : '—'}
          hint={reference ? `${fmtDate(reference.effective_from, true)} · ${diff! >= 0 ? '+' : ''}${diff!.toFixed(2)}% vs approved` : 'daily job not run yet'}
          hintTone={diff != null && Math.abs(diff) > 2 ? 'warn' : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr] mb-6">
        <Card title="Set new approved rate" action={!isAdmin && <span className="text-xs text-muted">Admin only</span>}>
          <p className="px-6 -mt-1 mb-3 text-sm text-muted">Billing uses only approved (manual) rates. Reference rates are for comparison only. New documents lock the rate in force when they are created.</p>
          {isAdmin ? (
            <ActionForm action={setFxRate} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Set approved rate" resetOnSuccess
              confirm="Set this as the approved billing rate? New quotes, invoices and storefront prices use it from the effective time.">
              <Field label="Rate (CNY per 1 USD)" htmlFor="fx-rate"><input id="fx-rate" name="rate" className="input mono" inputMode="decimal" required placeholder={String(rate)} pattern="[0-9]+([.,][0-9]{1,6})?" /></Field>
              <Field label="Effective from" htmlFor="fx-from" hint="Leave empty for now, or schedule a future time."><LocalDateTimeInput id="fx-from" name="effective_from" isoName="effective_from_iso" /></Field>
              <Field label="Note" htmlFor="fx-note" className="sm:col-span-2"><input id="fx-note" name="note" className="input" maxLength={200} placeholder="e.g. Monthly review, bank rate 1 Nov" /></Field>
            </ActionForm>
          ) : <div className="px-6 pb-6 text-sm text-muted">Current approved rate: <b className="mono text-ink">{rate}</b></div>}
          {upcoming && <p className="px-6 pb-5 text-sm">Scheduled: <b className="mono">{Number(upcoming.rate)}</b> from {fmtDate(upcoming.effective_from, true)}</p>}
        </Card>

        <Card title="Rate history" action={<span className="text-xs text-muted">Manual = approved · Reference = daily comparison</span>}>
          <Table head={['Effective from', 'Rate', 'Source', 'Set by', 'Note', 'Status']} empty={<EmptyState title="No rates yet" />}>
            {rates.map((r) => (
              <tr key={r.id}>
                <td className="td text-sm whitespace-nowrap">{fmtDate(r.effective_from, true)} {new Date(r.effective_from).getFullYear()}</td>
                <td className="td mono font-semibold">{Number(r.rate)}</td>
                <td className="td"><StatusBadge status={r.source} label={r.source === 'manual' ? 'Manual' : 'Reference'} tone={r.source === 'manual' ? 'navy' : 'gray'} /></td>
                <td className="td text-sm">{r.source === 'reference' ? 'Daily job' : r.set_by ? name(r.set_by) : 'Seed'}</td>
                <td className="td text-sm max-w-[220px]">{r.note ?? '—'}</td>
                <td className="td">
                  {r.source !== 'manual' ? <span className="text-xs text-muted">display only</span>
                    : r.id === approved?.id ? <StatusBadge status="active" label="Approved · in use" />
                      : r.effective_from > now ? <StatusBadge status="scheduled" /> : <StatusBadge status="superseded" label="Previous" />}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Switch platform currency" className="mb-6" action={!isAdmin && <span className="text-xs text-muted">Admin only</span>}>
        <p className="px-6 -mt-1 mb-4 text-sm text-muted">
          Maker–checker: an Admin requests the switch, a Finance user (not the requester) approves it. At the effective time the setting changes, wallets are converted if chosen,
          storefront prices are revalidated, a site banner is shown, customers are emailed and the <span className="mono">settings.currency_changed</span> webhook is sent.
        </p>
        {isAdmin
          ? <CurrencySwitchWizard current={current} rate={rate} serviceNames={serviceNames} pending={!!open} />
          : <div className="px-6 pb-6"><Notice tone="blue">Only an Admin can request a currency switch.</Notice></div>}
      </Card>

      <Card title="Switch requests" action={<span className="text-xs text-muted">Draft → waiting for Finance → scheduled → applied / cancelled</span>}>
        <Table head={['Requested', 'Switch', 'Rate', 'Wallets', 'Effective', 'Status', 'People', '']} empty={<EmptyState title="No currency switch requests yet" body="Requests appear here with their approval status." />}>
          {reqs.map((r) => {
            const mine = r.requested_by === s.userId;
            const active = r.status === 'pending_approval' || r.status === 'scheduled';
            return (
              <tr key={r.id} className="align-top">
                <td className="td text-sm whitespace-nowrap">{fmtDate(r.created_at, true)}</td>
                <td className="td mono font-semibold whitespace-nowrap">{r.from_currency} → {r.to_currency}</td>
                <td className="td mono">{Number(r.rate)}</td>
                <td className="td text-sm">{r.wallet_option === 'convert' ? 'Convert' : 'Keep'}</td>
                <td className="td text-sm whitespace-nowrap">{r.applied_at ? <>Applied {fmtDate(r.applied_at, true)}</> : fmtDate(r.effective_at, true)}</td>
                <td className="td"><StatusBadge status={r.status} label={STATUS_LABEL[r.status] ?? humanize(r.status)} tone={STATUS_TONE[r.status]} /></td>
                <td className="td text-xs">
                  <div>Requested: {name(r.requested_by)}{mine && ' (you)'}</div>
                  {r.approved_by && <div>Approved: {name(r.approved_by)}</div>}
                  {r.note && <div className="text-muted mt-0.5 max-w-[200px]">“{r.note}”</div>}
                  {r.impact && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-coral-text font-semibold">Impact at request time</summary>
                      <div className="mt-2 w-[min(80vw,720px)]"><ImpactView impact={r.impact} to={r.to_currency} serviceNames={serviceNames} /></div>
                    </details>
                  )}
                </td>
                <td className="td text-right">
                  <span className="inline-flex flex-col items-end gap-2">
                    {r.status === 'pending_approval' && canApprove && !mine && (
                      <RunButton className="btn btn-primary btn-sm" action={approveSwitch.bind(null, r.id)}
                        confirm={`Approve switching the platform to ${r.to_currency} at ${Number(r.rate)} CNY/USD (wallets: ${r.wallet_option})? ${r.effective_at <= now ? 'It applies immediately.' : `It applies at ${fmtDate(r.effective_at, true)}.`}`}>
                        Approve
                      </RunButton>
                    )}
                    {r.status === 'pending_approval' && mine && <span className="text-xs text-muted max-w-[160px]">Another Finance user must approve.</span>}
                    {active && (isAdmin || (canApprove && r.status === 'pending_approval')) && (
                      <RunButton className="btn btn-ghost btn-sm" action={cancelSwitch.bind(null, r.id)} prompt="Reason for cancelling this currency switch?">Cancel</RunButton>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </Table>
        <p className="px-6 py-3 text-xs text-muted">Every request, approval, cancellation and switch is written to the audit log.</p>
      </Card>
    </>
  );
}
