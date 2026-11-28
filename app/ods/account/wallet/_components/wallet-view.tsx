import Link from 'next/link';
import { Landmark, Wallet } from 'lucide-react';
import {Card, EmptyState, Icon, Money, Skeleton, StatusPill } from '@octopus/ui';
import { OdsButton } from '../../orders/_components/ods-button';
import { curLabel, dateText, moneyText, units } from '../../orders/_lib/commerce-format';
import { KV, PageHead, PanelError } from '../../orders/_components/commerce-ui';
import { UrlCardTabs, UrlSegmented } from '../../orders/_components/url-controls';
import { WALLET_PERIODS, statementHref, walletHref, type WalletState } from '../_lib/wallet-logic';
import type { WalletVM } from '../_lib/loaders';
import { TransferSlipForm } from './transfer-slip-form';

export type WalletViewProps = {
  state: WalletState;
  status: 'ready' | 'loading';
  wallet?: WalletVM | null;
  submitTransfer?: (input: { amountCents: number; slipPath: string; bankRef?: string }) => Promise<{ ok: true; data?: undefined } | { ok: false; error: string }>;
  base?: string;
  demo?: boolean;
};

/** ODS /account/wallet (6.7, Match: C_Wallet + M_). Presentational; every panel fails on its own. */
export function WalletPageView({ state, status, wallet: w, submitTransfer, base = '/account/wallet', demo }: WalletViewProps) {
  const head = (
    <PageHead
      title={
        <span className="inline-flex items-center gap-3">
          <span className="inline-grid size-ods-control place-items-center rounded-ods-control bg-ods-blue-tint text-ods-blue">
            <Icon icon={Wallet} size="md" />
          </span>
          Wallet
        </span>
      }
      subtitle="One US dollar balance for every service."
      actions={
        <>
          <OdsButton href="#add-funds" icon="wallet" data-testid="add-funds-button">
            Add funds
          </OdsButton>
          <OdsButton variant="secondary" disabled disabledReason="Ask us in Support — finance arranges withdrawals" data-testid="withdraw">
            Withdraw
          </OdsButton>
        </>
      }
    />
  );
  if (status === 'loading' || !w) {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="wallet-page">
        {head}
        <div className="grid grid-cols-2 gap-3 ods-tablet:grid-cols-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="min-h-[96px] rounded-ods-card border border-ods-line bg-ods-surface p-4">
              <Skeleton silent lines={2} />
            </div>
          ))}
        </div>
        <Skeleton className="sr-only" label="Loading wallet" />
      </div>
    );
  }
  const s = w.summary;
  const cards = [
    { id: 'available', label: 'Available', value: s ? units(s.availableCents) : '—', money: !!s, hint: s?.pendingCents ? `Transfers being checked: ${moneyText(s.pendingCents, 'USD')}` : 'Ready to spend', testId: 'wallet-card-available' },
    { id: 'held', label: 'Held for work in progress', value: s ? units(s.onHoldCents) : '—', money: !!s, hint: 'Charged or released later', testId: 'wallet-card-held' },
    {
      id: 'due',
      label: 'Invoices due',
      value: w.due ? units(w.due.totalUsdCents) : '—',
      money: !!w.due,
      hint: w.due?.otherCurrencies.length ? `Plus ${w.due.otherCurrencies.map(([c, v]) => moneyText(v, c)).join(', ')}` : 'Deposits, balances and proformas',
      testId: 'wallet-card-due',
    },
  ];
  const cardHrefs = { available: walletHref(state, { view: 'available' }, base), held: walletHref(state, { view: 'held' }, base), due: walletHref(state, { view: 'due' }, base) };
  const periodHrefs = Object.fromEntries(WALLET_PERIODS.map(([p]) => [p, walletHref(state, { period: p }, base)]));

  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="wallet-page">
      {head}
      {!w.walletEnabled ? (
        <p className="m-0 mb-4 rounded-ods-card bg-ods-warning-tint p-4 text-ods-body text-ods-warning" role="status">
          The wallet is switched off at the moment. Top-ups are paused.
        </p>
      ) : null}
      {s === null ? (
        <Card className="mb-4">
          <PanelError what="your balance" href={walletHref(state, {}, base)} />
        </Card>
      ) : null}
      <UrlCardTabs items={cards} value={state.view} hrefs={cardHrefs} label="Wallet" testId="wallet-cards" />

      <div className="mt-5 grid gap-4 ods-desktop:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
        <Card
          id="add-funds"
          title={<span className="inline-flex items-center gap-2"><Icon icon={Landmark} size="md" className="text-ods-blue" />Add funds by bank transfer</span>}
          headingLevel={2}
          data-testid="add-funds"
          className="scroll-mt-24 self-start"
        >
          {w.bankFailed ? (
            <PanelError what="the bank details" href={walletHref(state, {}, base)} />
          ) : w.bank ? (
            <>
              <dl className="m-0 text-ods-small" data-testid="bank-details">
                {w.bank.lines.map(([k, v]) => (
                  <KV key={k} k={k}>
                    <span className="font-mono">{v}</span>
                  </KV>
                ))}
                <KV k="Your reference" strong>
                  <span className="font-mono">{s?.reference || '—'}</span>
                </KV>
              </dl>
              {w.bank.notes ? <p className="m-0 mt-2 text-ods-small text-ods-slate">{w.bank.notes}</p> : null}
              <p className="m-0 mt-2 text-ods-small text-ods-slate">Send US dollars only and always include your reference. Card top-ups aren&apos;t available.</p>
              <div className="mt-4 border-t border-ods-line pt-4">
                <h3 className="m-0 mb-3 text-ods-body font-semibold text-ods-navy">I have sent a transfer</h3>
                {w.walletEnabled && submitTransfer ? (
                  <TransferSlipForm orgId={w.orgId} reference={s?.reference ?? ''} submitTransfer={submitTransfer} demo={demo} />
                ) : (
                  <p className="m-0 text-ods-small text-ods-slate">Top-ups are not available right now.</p>
                )}
              </div>
            </>
          ) : (
            <p className="m-0 text-ods-body text-ods-slate">
              Bank details aren&apos;t published yet. Ask your account manager in{' '}
              <Link href="/account/support" className="font-semibold text-ods-blue underline">
                Support
              </Link>
              .
            </p>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {state.view === 'available' ? (
            <Card
              title="Transactions"
              headingLevel={2}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <UrlSegmented options={WALLET_PERIODS.map(([value, label]) => ({ value, label, testId: `wallet-period-${value}` }))} value={state.period} hrefs={periodHrefs} label="Period" />
                  <OdsButton href={statementHref(w.range)} variant="secondary" size="sm" icon="download" data-testid="statement-download">
                    Download statement
                  </OdsButton>
                </div>
              }
              bodyClassName="p-0"
              data-testid="transactions"
            >
              {w.transactions === null ? (
                <PanelError what="your transactions" href={walletHref(state, {}, base)} />
              ) : w.transactions.length === 0 ? (
                <EmptyState title="No wallet transactions in this period" description="Credited transfers, charges and refunds appear here." />
              ) : (
                <TxList w={w} />
              )}
              <p className="m-0 border-t border-ods-line px-4 py-3 text-ods-small">
                <Link href="/account/ledger?account=wallet" className="font-semibold text-ods-blue underline">
                  Full statement and ledger
                </Link>
              </p>
            </Card>
          ) : state.view === 'held' ? (
            <Card title="Held for work in progress" headingLevel={2} bodyClassName="p-0" data-testid="holds">
              {w.holds === null ? (
                <PanelError what="your holds" href={walletHref(state, {}, base)} />
              ) : w.holds.length === 0 ? (
                <EmptyState title="Nothing is held" description="When a service starts work for you, the amount is held here first." />
              ) : (
                <ul role="list" className="m-0 list-none p-0">
                  {w.holds.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ods-line px-4 py-3 first:border-t-0">
                      <div>
                        <p className="m-0 font-semibold text-ods-navy">{h.service}</p>
                        <p className="m-0 text-ods-small text-ods-slate">
                          <span className="font-mono">{h.ref}</span> · {dateText(h.at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill status={h.statusName} />
                        <Money amount={units(h.amountCents)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : (
            <Card title="Invoices due" headingLevel={2} bodyClassName="p-0" data-testid="due">
              {w.due === null ? (
                <PanelError what="what's due" href={walletHref(state, {}, base)} />
              ) : w.due.items.length === 0 ? (
                <EmptyState title="Nothing is due" description="Deposits, balances and proformas waiting for payment appear here." />
              ) : (
                <ul role="list" className="m-0 list-none p-0">
                  {w.due.items.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ods-line px-4 py-3 first:border-t-0">
                      <div>
                        <p className="m-0 font-semibold text-ods-navy">{d.kind === 'order' ? 'Order' : 'Proforma'}</p>
                        <p className="m-0 font-mono text-ods-small text-ods-slate">{d.ref}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Money amount={units(d.cents)} currency={curLabel(d.currency)} className="font-semibold" />
                        <OdsButton href={d.href} size="sm">
                          Pay<span className="sr-only"> {d.ref}</span>
                        </OdsButton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Transfers" headingLevel={2} bodyClassName="p-0" data-testid="transfers">
            {w.transfers === null ? (
              <PanelError what="your transfers" href={walletHref(state, {}, base)} />
            ) : w.transfers.length === 0 ? (
              <EmptyState title="No transfers yet" description="Send a US dollar transfer and upload the slip." />
            ) : (
              <ul role="list" className="m-0 list-none p-0">
                {w.transfers.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ods-line px-4 py-3 first:border-t-0">
                    <div className="min-w-0">
                      <p className="m-0 font-semibold text-ods-navy">
                        Bank transfer · <Money amount={units(t.claimedCents)} />
                      </p>
                      <p className="m-0 text-ods-small text-ods-slate">
                        Sent {dateText(t.at)}
                        {t.receivedCents != null && t.receivedCents !== t.claimedCents ? (
                          <>
                            {' '}
                            · received <Money amount={units(t.receivedCents)} />
                            {t.note ? ` (${t.note})` : ''}
                          </>
                        ) : null}
                        {t.rejectReason ? ` · ${t.rejectReason}` : ''}
                      </p>
                    </div>
                    <StatusPill status={t.statusName}>{t.statusName === 'Pending' ? 'Pending · being checked' : undefined}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <p className="m-0 mt-4 rounded-ods-card border border-ods-info bg-ods-info-tint p-4 text-ods-small text-ods-navy">
        <strong>Withdrawals:</strong> there is no online withdrawal yet. Ask us in{' '}
        <Link href="/account/support?new=1" className="font-semibold text-ods-navy underline">
          Support
        </Link>{' '}
        and finance arranges it with you.
      </p>
    </div>
  );
}

function TxList({ w }: { w: WalletVM }) {
  const rows = w.transactions ?? [];
  return (
    <>
      <div className="hidden overflow-x-auto ods-tablet:block">
        <table className="w-full border-collapse text-ods-table">
          <caption className="sr-only">Wallet transactions</caption>
          <thead>
            <tr className="h-ods-head border-y border-ods-line bg-ods-canvas text-ods-label text-ods-slate">
              <th scope="col" className="px-4 text-start font-semibold">Date</th>
              <th scope="col" className="px-3 text-start font-semibold">Description</th>
              <th scope="col" className="px-3 text-end font-semibold">Amount</th>
              <th scope="col" className="px-4 text-end font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="h-ods-row border-b border-ods-line last:border-b-0" data-testid="transaction-row">
                <td className="px-4 whitespace-nowrap">{dateText(r.at)}</td>
                <th scope="row" className="min-w-48 px-3 py-2 text-start font-normal text-ods-navy">
                  {r.memo}
                  <span className="block font-mono text-ods-small text-ods-slate">{r.journal}</span>
                </th>
                <td className="px-3 text-end">
                  <Money amount={units(r.creditCents ? r.creditCents : -r.debitCents)} currency={curLabel(r.currency)} signDisplay="always" />
                </td>
                <td className="px-4 text-end">
                  <Money amount={units(r.balanceCents)} currency={curLabel(r.currency)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul role="list" aria-label="Wallet transactions" className="m-0 list-none p-0 ods-tablet:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 border-t border-ods-line px-4 py-3" data-testid="transaction-row">
            <div className="min-w-0">
              <p className="m-0 font-semibold text-ods-navy">{r.memo}</p>
              <p className="m-0 text-ods-small text-ods-slate">
                {dateText(r.at)} · <span className="font-mono">{r.journal}</span>
              </p>
            </div>
            <Money amount={units(r.creditCents ? r.creditCents : -r.debitCents)} currency={curLabel(r.currency)} signDisplay="always" className="font-semibold" />
          </li>
        ))}
      </ul>
    </>
  );
}
