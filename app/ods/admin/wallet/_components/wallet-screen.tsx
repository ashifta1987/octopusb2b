'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Pencil } from 'lucide-react';
import { Button, Card, Drawer, Field, Input, KpiStrip, Modal, OctopusDataGrid, Select, StatusPill, Tabs, formatDate, type GridColumn } from '@octopus/ui';
import type { PaymentOutcome } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import { PLATFORM_SETTINGS, WALLET_TABS, creditSource, fmtMinor, human, topupPill, totalsText, type WalletPerms } from '../../finance/_accounts-b/core';
import { KV, Note, NoPermission, OutcomeNote, PageHead, PillView, RunMsg, useRun } from '../../finance/_accounts-b/kit';

export type WalletRow = { org_id: string; org_name: string; country: string | null; kyc_status: string; balance_cents: number; last_activity: string | null; currency: string };
export type CreditRow = { org_id: string; org_name: string; country: string | null; kyc_status: string; currency: string; balance_minor: number; credit_limit_minor: number; available_minor: number; override_minor: number | null; override_currency: string | null; note: string | null };
export type TopupRow = { id: string; org_name: string; country: string | null; amount_cents: number; currency: string; method: string; reference: string | null; status: string; created_at: string };
export type PriceRow = { code: string; name: string; unit: string; active: boolean; price: { amount: number; converted: boolean } | null; scheduled: { amount: number; from: string } | null };
type AdminRes = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
export type WalletActions = {
  setWallet: (key: string, value: unknown) => Promise<AdminRes>;
  saveCreditDefault: (prev: AdminRes | null, fd: FormData) => Promise<AdminRes>;
  saveCustomerCredit: (prev: AdminRes | null, fd: FormData) => Promise<AdminRes>;
  saveSettings: (prev: AdminRes | null, fd: FormData) => Promise<AdminRes>;
  confirmTopup: (id: string) => Promise<PaymentOutcome>;
};
export type WalletData = {
  walletOn: boolean;
  wallets: WalletRow[] | null;
  walletTotals: [string, number][];
  /** all wallets in the platform currency (only when several currencies or not the platform one) */
  convertedTotal: { minor: number; currency: string; rateLabel: string } | null;
  topups: TopupRow[] | null;
  topupsThisMonth: { totals: [string, number][]; count: number };
  spent: [string, number][] | null;
  credit: CreditRow[] | null;
  creditDefault: { amount_minor?: number; currency?: string; verified_only?: boolean };
  creditUsedMinor: number;
  prices: PriceRow[] | null;
  settings: Record<string, string>;
  platformCurrency: string;
  currencies: string[];
};
export type WalletScreenProps = { state: 'ok' | 'loading' | 'forbidden'; data: WalletData | null; perms: WalletPerms; approvalLimitMinor: number | null; actions: WalletActions; initialTab?: (typeof WALLET_TABS)[number][0]; initialCredit?: boolean; initialTopup?: { id: string; outcome?: PaymentOutcome } | null; fixture?: boolean };

/**
 * ODS T9 · Admin › Wallets & payments. KPIs, the wallet switch (admin), customer wallets, the credit facility (admin
 * edits in a drawer), top-ups (Confirm match = today's confirmTopup behind the T8 two-person gate, wallet:approve), the
 * service price list and platform settings (admin) — today's actions unchanged.
 */
export function WalletScreen({ state, data, perms, approvalLimitMinor, actions, initialTab, initialCredit, initialTopup, fixture }: WalletScreenProps) {
  const router = useRouter();
  const done = () => !fixture && router.refresh();
  const [tab, setTab] = useState<string>(initialTab ?? 'wallets');
  const [creditOpen, setCreditOpen] = useState(!!initialCredit);
  const [switchAsk, setSwitchAsk] = useState(false);
  const [topup, setTopup] = useState<string | null>(initialTopup?.id ?? null);
  const sw = useRun(done);
  const st = useRun(done);
  const d = data;

  const walletCols: GridColumn<WalletRow>[] = useMemo(() => [
    { id: 'customer', header: 'Customer', width: 220, accessor: (w) => w.org_name, cell: (w) => <span className="font-semibold text-ods-navy">{w.org_name}{w.country ? <span className="ms-1 text-ods-slate">· {w.country}</span> : null}</span> },
    { id: 'kyc', header: 'KYC', width: 120, accessor: (w) => w.kyc_status, cell: (w) => human(w.kyc_status) },
    { id: 'currency', header: 'Currency', width: 90, accessor: (w) => w.currency },
    { id: 'balance', header: 'Balance', numeric: true, width: 140, accessor: (w) => Number(w.balance_cents), cell: (w) => <b className={Number(w.balance_cents) < 0 ? 'text-ods-warning' : undefined}>{fmtMinor(Number(w.balance_cents), w.currency)}</b> },
    { id: 'last', header: 'Last activity', width: 130, accessor: (w) => w.last_activity ?? '', cell: (w) => (w.last_activity ? formatDate(w.last_activity, { short: true }) : '—') },
  ], []);
  const creditCols: GridColumn<CreditRow>[] = [
    { id: 'customer', header: 'Customer', width: 220, accessor: (r) => r.org_name, cell: (r) => <span className="font-semibold text-ods-navy">{r.org_name}</span> },
    { id: 'kyc', header: 'KYC', width: 110, accessor: (r) => r.kyc_status, cell: (r) => human(r.kyc_status) },
    { id: 'balance', header: 'Balance', numeric: true, width: 130, accessor: (r) => Number(r.balance_minor), cell: (r) => <span className={Number(r.balance_minor) < 0 ? 'text-ods-warning' : undefined}>{fmtMinor(Number(r.balance_minor), r.currency)}</span> },
    { id: 'limit', header: 'Credit limit', numeric: true, width: 130, accessor: (r) => Number(r.credit_limit_minor), cell: (r) => fmtMinor(Number(r.credit_limit_minor), r.currency) },
    { id: 'available', header: 'Available', numeric: true, width: 130, accessor: (r) => Number(r.available_minor), cell: (r) => fmtMinor(Number(r.available_minor), r.currency) },
    { id: 'source', header: 'Source', width: 260, sortable: false, accessor: (r) => creditSource(r, d?.creditDefault.verified_only !== false), cell: (r) => <span className="truncate text-ods-small" title={creditSource(r, d?.creditDefault.verified_only !== false)}>{creditSource(r, d?.creditDefault.verified_only !== false)}</span> },
  ];
  const topupCols: GridColumn<TopupRow>[] = [
    { id: 'time', header: 'Time', width: 150, accessor: (t) => t.created_at, cell: (t) => formatDate(t.created_at) },
    { id: 'customer', header: 'Customer', width: 200, accessor: (t) => t.org_name },
    { id: 'method', header: 'Method', width: 130, accessor: (t) => human(t.method) },
    { id: 'reference', header: 'Reference', width: 160, accessor: (t) => t.reference ?? '', cell: (t) => (t.reference ? <span className="font-mono">{t.reference}</span> : <span className="text-ods-warning">none</span>) },
    { id: 'amount', header: 'Amount', numeric: true, width: 130, accessor: (t) => Number(t.amount_cents), cell: (t) => <b className="text-ods-success">+{fmtMinor(Number(t.amount_cents), t.currency)}</b> },
    { id: 'status', header: 'Status', width: 110, accessor: (t) => t.status, cell: (t) => <PillView p={topupPill(t.status)} /> },
    {
      id: 'act',
      header: 'Action',
      width: 150,
      sortable: false,
      accessor: () => '',
      cell: (t) => (t.status === 'pending' && perms.canApproveTopups ? <Button size="sm" iconStart={CheckCircle2} onClick={() => setTopup(t.id)} data-testid="confirm-topup">Confirm match</Button> : null),
    },
  ];

  if (state === 'forbidden') return <NoPermission crumb="Wallets" title="Wallets & payments" what="wallets (Wallet view)" />;
  const pending = (d?.topups ?? []).filter((t) => t.status === 'pending');
  const topupRow = (d?.topups ?? []).find((t) => t.id === topup) ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="wallet-page">
      <PageHead crumb="Wallets" title="Wallets & payments" subtitle="Turn the wallet on or off, see customer balances and credit, confirm top-ups and review the service price list. Money actions may ask for your 2-step code again." />

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-ods-card border border-ods-line bg-ods-surface px-4 py-3" data-testid="wallet-switch">
        <div className="min-w-0">
          <h2 className="m-0 text-ods-h3 font-bold text-ods-navy">Wallet system <StatusPill tone={d?.walletOn ? 'success' : 'neutral'}>{d?.walletOn ? 'On' : 'Off'}</StatusPill></h2>
          <p className="m-0 text-ods-small text-ods-slate">{d?.walletOn ? 'Customers can top up, pay for services from their wallet, get refunds to it and withdraw.' : 'Wallet is OFF — services are paid by card / invoice and the customer Wallet page shows a notice.'}</p>
        </div>
        <Button variant="secondary" onClick={() => setSwitchAsk(true)} disabled={!perms.isAdmin || !d} disabledReason={!perms.isAdmin ? 'Only an Admin can switch the wallet on or off.' : undefined}>
          {d?.walletOn ? 'Switch wallet off' : 'Switch wallet on'}
        </Button>
      </section>
      <RunMsg msg={sw.msg} />

      <KpiStrip
        data-testid="wallet-kpis"
        label="Wallet figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Total in customer wallets', value: d?.wallets ? totalsText(d.walletTotals) : '—', hint: d?.wallets ? `${d.wallets.length} wallets` : 'Couldn’t load' },
          { label: 'Top-ups this month', value: d ? totalsText(d.topupsThisMonth.totals) : '—', hint: `${d?.topupsThisMonth.count ?? 0} top-ups` },
          { label: 'Spent on services', value: d?.spent ? totalsText(d.spent) : '—', hint: d?.spent ? 'this month (services, RFQ fees, ads)' : perms.canSeeRevenue ? 'Couldn’t load' : 'Finance or dashboard view only' },
          { label: 'Transfers to match', value: String(pending.length), hint: `${pending.filter((t) => !t.reference).length} without reference` },
        ]}
      />

      {state === 'loading' ? null : (
        <Tabs
          data-testid="wallet-tabs"
          label="Wallet sections"
          value={tab}
          onChange={setTab}
          items={WALLET_TABS.map(([t, label]) => ({
            id: t,
            label,
            count: t === 'wallets' ? d?.wallets?.length : t === 'topups' ? pending.length || undefined : undefined,
            panel:
              t === 'wallets' ? (
                <div className="flex flex-col gap-2">
                  <OctopusDataGrid<WalletRow> label="Customer wallets" data-testid="wallets-grid" rows={d?.wallets ?? []} columns={walletCols} getRowId={(w) => `${w.org_id}-${w.currency}`} error={d?.wallets === null ? 'We couldn’t load the wallets. Try again.' : undefined} onRetry={() => router.refresh()} emptyTitle="No wallets yet" headingLevel={2} searchPlaceholder="Search customer" pagination />
                  {d?.walletTotals.length ? (
                    <div className="flex flex-col gap-0.5 text-ods-small">
                      {d.walletTotals.map(([c, m]) => <div key={c} className="flex justify-between"><span>Total {c} wallets</span><b className="tabular-nums">{fmtMinor(m, c)}</b></div>)}
                      {d.convertedTotal ? <div className="flex justify-between text-ods-slate"><span>All wallets · converted at {d.convertedTotal.rateLabel}</span><b className="tabular-nums">{fmtMinor(d.convertedTotal.minor, d.convertedTotal.currency)}</b></div> : null}
                    </div>
                  ) : null}
                </div>
              ) : t === 'credit' ? (
                <div className="flex flex-col gap-3" data-testid="wallet-credit">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="m-0 text-ods-small text-ods-slate">
                      Wallets may go below zero down to the credit limit. Default: <b className="text-ods-text">{fmtMinor(Number(d?.creditDefault.amount_minor ?? 0), d?.creditDefault.currency ?? d?.platformCurrency)}</b>
                      {d?.creditDefault.verified_only !== false ? ' (KYC-verified only)' : ''} · credit used now <b className="text-ods-text">{fmtMinor(d?.creditUsedMinor ?? 0, d?.platformCurrency)}</b>
                    </p>
                    <Button variant="secondary" iconStart={Pencil} onClick={() => setCreditOpen(true)} disabled={!perms.isAdmin} disabledReason={!perms.isAdmin ? 'Admin only.' : undefined} data-testid="edit-credit">Edit limits</Button>
                  </div>
                  {d?.creditDefault.currency && d.creditDefault.currency !== d.platformCurrency ? <Note tone="warning">The default is in {d.creditDefault.currency} but the platform bills in {d.platformCurrency}, so it does not apply. Save it in {d.platformCurrency}.</Note> : null}
                  <OctopusDataGrid<CreditRow> label="Wallet credit" data-testid="wallet-credit-grid" rows={d?.credit ?? []} columns={creditCols} getRowId={(r) => r.org_id} error={d?.credit === null ? 'We couldn’t load the credit facility. Try again.' : undefined} emptyTitle="No customers yet" headingLevel={2} searchPlaceholder="Search customer" pagination />
                </div>
              ) : t === 'topups' ? (
                <OctopusDataGrid<TopupRow> label="Latest wallet top-ups" data-testid="topups-grid" rows={d?.topups ?? []} columns={topupCols} getRowId={(r) => r.id} error={d?.topups === null ? 'We couldn’t load the top-ups. Try again.' : undefined} emptyTitle="No top-ups yet" headingLevel={2} searchPlaceholder="Search customer or reference" pagination />
              ) : t === 'prices' ? (
                <Card title="Service price list" headingLevel={2} actions={<a href="/admin/services" className="text-ods-small font-semibold text-ods-info underline">Open Services &amp; charges</a>}>
                  <p className="m-0 mb-2 text-ods-small text-ods-slate">The same prices as Services &amp; charges, in the platform currency ({d?.platformCurrency}). This is what the wallet deducts.</p>
                  {d?.prices === null ? <Note tone="danger" role="alert">We couldn’t load the price list.</Note> : (
                    <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
                      {(d?.prices ?? []).map((p) => (
                        <li key={p.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-ods-body">
                          <span className="min-w-0 flex-1"><b>{p.name}</b> {!p.active ? <StatusPill tone="neutral">Inactive</StatusPill> : null}<span className="block font-mono text-ods-small text-ods-slate">{p.code} · {p.unit}</span></span>
                          <span className="text-end tabular-nums">
                            {p.price ? <b>{fmtMinor(p.price.amount, d?.platformCurrency)}{p.price.converted ? <span className="ms-1 text-[10px] font-normal uppercase text-ods-slate">converted</span> : null}</b> : <span className="text-ods-warning">not set</span>}
                            {p.scheduled ? <span className="block text-ods-small text-ods-slate">→ {fmtMinor(p.scheduled.amount, d?.platformCurrency)} from {formatDate(p.scheduled.from)}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ) : (
                <Card title="Platform settings" headingLevel={2} data-testid="wallet-settings">
                  {!perms.isAdmin ? <Note tone="info">Admin only — shown read-only.</Note> : null}
                  <SettingsForm d={d} disabled={!perms.isAdmin} onSave={(fd) => st.run(() => actions.saveSettings(null, fd), 'Settings saved')} pending={st.pending} />
                  <div className="mt-2"><RunMsg msg={st.msg} /></div>
                </Card>
              ),
          }))}
        />
      )}

      <Modal open={switchAsk} onClose={() => setSwitchAsk(false)} title={d?.walletOn ? 'Switch the wallet off?' : 'Switch the wallet on?'} description={d?.walletOn ? 'Customers will pay by card / invoice; the Wallet page shows a notice.' : 'Customers can top up, pay from the wallet, get refunds to it and withdraw.'} confirmLabel={d?.walletOn ? 'Switch off' : 'Switch on'} destructive={!!d?.walletOn}
        onConfirm={() => { setSwitchAsk(false); sw.run(() => actions.setWallet('wallet_enabled', !d?.walletOn), d?.walletOn ? 'Wallet switched off' : 'Wallet switched on'); }} />
      {creditOpen && d ? <CreditDrawer d={d} onClose={() => setCreditOpen(false)} actions={actions} onDone={done} /> : null}
      {topupRow ? <TopupDrawer key={topupRow.id} t={topupRow} approvalLimitMinor={approvalLimitMinor} onClose={() => setTopup(null)} confirm={actions.confirmTopup} onDone={done} initialOutcome={initialTopup?.outcome ?? null} /> : null}
    </div>
  );
}

function SettingsForm({ d, disabled, onSave, pending }: { d: WalletData | null; disabled: boolean; onSave: (fd: FormData) => void; pending: boolean }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(PLATFORM_SETTINGS.map((p) => [p.key, d?.settings[p.key] ?? ''])));
  const save = () => {
    const fd = new FormData();
    fd.set('_keys', PLATFORM_SETTINGS.map((p) => p.key).join(','));
    for (const p of PLATFORM_SETTINGS) {
      fd.set(`_type_${p.key}`, 'number');
      fd.set(p.key, vals[p.key] ?? '');
    }
    onSave(fd);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
        {PLATFORM_SETTINGS.map((p) => (
          <Field key={p.key} label={p.label} hint={p.hint}>
            <Input type="number" min={0} value={vals[p.key] ?? ''} onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })} disabled={disabled} className="font-mono" />
          </Field>
        ))}
      </div>
      {!disabled ? <div><Button onClick={save} loading={pending}>Save settings</Button></div> : null}
    </div>
  );
}

function CreditDrawer({ d, onClose, actions, onDone }: { d: WalletData; onClose: () => void; actions: WalletActions; onDone: () => void }) {
  const [defAmount, setDefAmount] = useState(((Number(d.creditDefault.amount_minor ?? 0)) / 100).toFixed(2));
  const [defCur, setDefCur] = useState(d.creditDefault.currency ?? d.platformCurrency);
  const [verified, setVerified] = useState(d.creditDefault.verified_only !== false);
  const [org, setOrg] = useState('');
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState(d.platformCurrency);
  const [note, setNote] = useState('');
  const [useDefault, setUseDefault] = useState(false);
  const a = useRun(onDone);
  const b = useRun(onDone);
  return (
    <Drawer open onClose={onClose} width={460} data-testid="credit-limits-drawer" title="Wallet credit limits" description="Admin only; every change is audited in the database.">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-ods-h3 font-bold text-ods-navy">Default limit</h3>
          <p className="m-0 text-ods-small text-ods-slate">Applies to every customer without their own limit. 0 = no credit by default.</p>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Credit limit" hint="e.g. 1000.00"><Input value={defAmount} onChange={(e) => setDefAmount(e.target.value)} inputMode="decimal" className="font-mono" /></Field>
            <Field label="Currency"><Select value={defCur} onChange={(e) => setDefCur(e.target.value)}>{d.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          </div>
          <label className="inline-flex items-center gap-2 text-ods-small"><input type="checkbox" className="size-4" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Only KYC-verified customers get the default</label>
          <div>
            <Button size="sm" loading={a.pending} onClick={() => { const fd = new FormData(); fd.set('amount', defAmount); fd.set('currency', defCur); if (verified) fd.set('verified_only', 'on'); a.run(() => actions.saveCreditDefault(null, fd), 'Default credit limit saved'); }}>Save default</Button>
          </div>
          <RunMsg msg={a.msg} />
        </section>
        <section className="flex flex-col gap-3 border-t border-ods-line pt-4">
          <h3 className="m-0 text-ods-h3 font-bold text-ods-navy">Customer limit</h3>
          <Field label="Customer" required><Select value={org} onChange={(e) => setOrg(e.target.value)}><option value="" disabled>Choose…</option>{(d.credit ?? []).map((r) => <option key={r.org_id} value={r.org_id}>{r.org_name}</option>)}</Select></Field>
          <label className="inline-flex items-center gap-2 text-ods-small"><input type="checkbox" className="size-4" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} /> Use default (remove their own limit)</label>
          {!useDefault ? (
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <Field label="Credit limit" hint="e.g. 2500 (0 = no credit)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="font-mono" /></Field>
              <Field label="Currency"><Select value={cur} onChange={(e) => setCur(e.target.value)}>{d.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
            </div>
          ) : null}
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. approved by director" /></Field>
          <div>
            <Button size="sm" loading={b.pending} disabled={!org} disabledReason={!org ? 'Choose a customer.' : undefined}
              onClick={() => { const fd = new FormData(); fd.set('org_id', org); fd.set('amount', amount); fd.set('currency', cur); fd.set('note', note); if (useDefault) fd.set('use_default', 'on'); b.run(() => actions.saveCustomerCredit(null, fd), 'Customer credit limit saved'); }}>
              Save customer limit
            </Button>
          </div>
          <RunMsg msg={b.msg} />
        </section>
      </div>
    </Drawer>
  );
}

function TopupDrawer({ t, approvalLimitMinor, onClose, confirm, onDone, initialOutcome }: { t: TopupRow; approvalLimitMinor: number | null; onClose: () => void; confirm: (id: string) => Promise<PaymentOutcome>; onDone: () => void; initialOutcome: PaymentOutcome | null }) {
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(initialOutcome);
  const [pending, start] = useTransition();
  const over = approvalLimitMinor !== null && t.currency === 'USD' && Number(t.amount_cents) > approvalLimitMinor;
  return (
    <Drawer open onClose={onClose} width={460} data-testid="topup-drawer" title="Confirm top-up" description={`${t.org_name} · ${human(t.method)}`}
      footer={
        <div className="flex gap-2">
          <Button iconStart={CheckCircle2} loading={pending} disabled={outcome?.kind === 'saved'} onClick={() => start(async () => { const r = await confirm(t.id); setOutcome(r); if (r.kind === 'step-up') window.location.assign(r.redirect); if (r.kind === 'saved') onDone(); })} data-testid="confirm-topup-save">
            Confirm match
          </Button>
          <Button variant="secondary" onClick={onClose}>{outcome?.kind === 'saved' ? 'Close' : 'Cancel'}</Button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        <dl className="m-0">
          <KV k="Amount"><b>{fmtMinor(Number(t.amount_cents), t.currency)}</b></KV>
          <KV k="Reference">{t.reference ?? 'none'}</KV>
          <KV k="Received">{formatDate(t.created_at)}</KV>
        </dl>
        <p className="m-0 text-ods-small text-ods-slate">Confirm {fmtMinor(Number(t.amount_cents), t.currency)} received and credit the {t.currency} wallet of {t.org_name}?</p>
        {approvalLimitMinor !== null ? <Note tone={over ? 'warning' : 'info'}>Payments over {fmtMinor(approvalLimitMinor)} need a second approver.{over ? ' This one goes to Approvals when you confirm.' : ''}</Note> : null}
        <OutcomeNote outcome={outcome} what="confirm this top-up" />
      </div>
    </Drawer>
  );
}
