/**
 * ODS T9 · Customer record — presentational pieces (server-safe, props only; used by the real page and the staging fixtures).
 * Panel convention: data `null` = failed (ErrorState, the rest of the record keeps working), `'restricted'` = hidden or a
 * "Finance only" note, `undefined`/loading = skeleton.
 */
import type { ReactNode } from 'react';
import { Inbox, NotebookPen } from 'lucide-react';
import { ActivityFeed, Breadcrumbs, Button, Card, EmptyState, ErrorState, KpiStrip, Money, StatusPill, formatDate, formatNumber } from '@octopus/ui';
import {
  centsToAmount, creditSummary, creditTermStatusName, currencyLabel, humanizeWord, initials, monthYear, orderStatusName, paymentMethodLabel, type MoneySummary, type OpenItem,
} from '../../_lib/customer-logic';
import type {
  AccountManagerVM, ActivityTabVM, ActivityVM, CompanyVM, CreditVM, CustomerHeaderVM, DocumentsTabVM, OrderRowVM, OverviewVM, PanelData, TeamTabVM, WalletTabVM,
} from '../../_lib/types';

/* ───────── bits ───────── */

export function Panel({ title, actions, children, testId, className, loading, error }: { title: string; actions?: ReactNode; children?: ReactNode; testId?: string; className?: string; loading?: boolean; error?: boolean }) {
  return (
    <Card as="section" title={title} headingLevel={2} actions={actions} data-testid={testId} className={className} loading={loading} error={error ? <LoadError /> : undefined}>
      {children}
    </Card>
  );
}

export function LoadError({ what = 'this part' }: { what?: string }) {
  return <ErrorState title={`We couldn't load ${what}`} description="Reload the page to try again. The rest of the record still works." headingLevel={3} />;
}

export function PanelLoading({ title, testId }: { title: string; testId?: string }) {
  return <Panel title={title} testId={testId} loading />;
}

function KeyValues({ rows, testId }: { rows: [string, ReactNode][]; testId?: string }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(7rem,40%)_1fr] text-ods-table" data-testid={testId}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-ods-line py-2 pe-3 text-ods-slate">{k}</dt>
          <dd className="m-0 min-w-0 break-words border-b border-ods-line py-2 text-ods-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const money = (cents: number, cur = 'USD') => <Money amount={centsToAmount(cents)} currency={currencyLabel(cur)} />;
const date = (iso: string | null | undefined) => (iso ? formatDate(iso) : '—');
const Restricted = ({ children }: { children: ReactNode }) => <span className="text-ods-slate">{children}</span>;
const A = ({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) => (
  <a href={href} className="inline-flex min-h-6 items-center font-semibold text-ods-blue hover:underline" target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{children}</a>
);

/* ───────── header ───────── */

export function CustomerHeader({ h, actions }: { h: CustomerHeaderVM; actions: ReactNode }) {
  const place = [h.city, h.countryName].filter(Boolean).join(', ');
  return (
    <header data-testid="customer-header" className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 shadow-ods-card ods-tablet:flex-row ods-tablet:items-start">
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-ods-card bg-ods-blue-tint text-ods-body font-bold text-ods-navy">{initials(h.name)}</span>
      <div className="min-w-0 flex-1 ods-tablet:min-w-[18rem]">
        <Breadcrumbs items={[{ label: 'Customers', href: '/admin/customers' }, { label: h.name }]} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{h.name}</h1>
          <StatusPill status={h.status} data-testid="customer-status" />
          {h.vip ? <StatusPill tone="indigo">VIP</StatusPill> : null}
          <span className="text-ods-small text-ods-slate">
            <span className="font-mono">{h.buyerCode ?? 'No buyer code'}</span>
            {place ? ` · ${place}` : ''} · customer since {monthYear(h.since)}
          </span>
        </div>
        <p className="m-0 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-ods-small text-ods-slate">
          <span>Account manager <b className="text-ods-navy">{h.accountManager ? h.accountManager.name : 'Not assigned'}</b>{h.accountManager?.outOfOffice ? ' (out of office)' : ''}</span>
          <span>Owner <b className="text-ods-navy">{h.owner ?? '—'}</b></span>
          <span>Services <b className="text-ods-navy">{h.services.length ? h.services.join(', ') : 'None switched on'}</b></span>
        </p>
      </div>
      <div className="grid min-w-0 justify-items-start gap-1 ods-tablet:max-w-[26rem] ods-tablet:justify-items-end">
        <div className="flex flex-wrap items-start gap-2 ods-tablet:justify-end">
          {'href' in h.message ? <Button variant="secondary" href={h.message.href}>Message</Button> : <Button variant="secondary" disabled aria-describedby="customer-message-reason">Message</Button>}
          {'href' in h.newQuote ? <Button variant="secondary" href={h.newQuote.href}>New quote</Button> : <Button variant="secondary" disabled aria-describedby="customer-quote-reason">New quote</Button>}
          {actions}
        </div>
        {'reason' in h.message ? <p id="customer-message-reason" className="m-0 text-ods-small text-ods-slate ods-tablet:text-end">Message: {h.message.reason}</p> : null}
        {'reason' in h.newQuote ? <p id="customer-quote-reason" className="m-0 text-ods-small text-ods-slate ods-tablet:text-end">New quote: {h.newQuote.reason}</p> : null}
      </div>
    </header>
  );
}

/* ───────── overview ───────── */

export function CompanyPanel({ c }: { c: CompanyVM }) {
  return (
    <Panel title="Company" testId="company-panel">
      <KeyValues
        rows={[
          ['Legal name', c.legalName],
          ['Buyer code', <span key="b" className="font-mono">{c.buyerCode ?? '—'}</span>],
          ['Country', c.country ?? '—'],
          ['City', c.city ?? '—'],
          ['Business type', c.businessType ?? '—'],
          ['Registration no.', <span key="r" className="font-mono">{c.registrationNo ?? '—'}</span>],
          ['Website', c.website ?? '—'],
          ['KYC', <span key="k" className="inline-flex flex-wrap items-center gap-2">{humanizeWord(c.kycStatus)}{c.kycHref ? <A href={c.kycHref}>KYC review</A> : null}</span>],
          ['Customer since', date(c.since)],
        ]}
      />
    </Panel>
  );
}

export function MoneyPanel({ m, credit, statementHref }: { m: MoneySummary | null; credit: PanelData<CreditVM>; statementHref: string | null }) {
  const cur = m?.currency ?? 'USD';
  const field = (v: number | 'restricted' | null, who: string, extra?: ReactNode) =>
    v === 'restricted' ? <Restricted>{who} only</Restricted> : v === null ? <Restricted>Couldn&apos;t load</Restricted> : <span className="inline-flex flex-wrap items-baseline gap-1">{money(v, cur)}{extra}</span>;
  return (
    <Panel title="Money" testId="money-panel" actions={statementHref ? <Button variant="secondary" size="sm" href={statementHref} target="_blank">Statement</Button> : undefined} error={m === null}>
      {m ? (
        <KeyValues
          rows={[
            ['Wallet available', field(m.walletAvailableCents, 'Finance and Wallet')],
            ['Held', m.heldCents === null ? <Restricted>Couldn&apos;t load</Restricted> : money(m.heldCents, cur)],
            ['Invoices due', field(m.invoicesDueCents, 'Finance and Orders', m.invoicesDueCents !== 'restricted' && m.invoicesDueCents !== null ? <span className="text-ods-slate">· {m.invoicesDueCount} {m.invoicesDueCount === 1 ? 'invoice' : 'invoices'}{m.overdueCount ? `, ${m.overdueCount} overdue` : ''}</span> : null)],
            ['Paid last 12 months', field(m.paid12mCents, 'Finance and Orders')],
            ...(credit !== 'restricted' ? ([['Credit (Finance only)', credit === null ? <Restricted key="c">Couldn&apos;t load</Restricted> : creditSummary(credit)]] as [string, ReactNode][]) : []),
            ['Last payment', m.lastPayment === 'restricted' ? <Restricted>Finance and Orders only</Restricted> : m.lastPayment === null ? <Restricted>Couldn&apos;t load</Restricted> : m.lastPayment === 'none' ? 'No payments yet' : <span>{date(m.lastPayment.at)} · {money(m.lastPayment.cents, cur)} · {paymentMethodLabel(m.lastPayment.method)}</span>],
          ]}
        />
      ) : null}
    </Panel>
  );
}

/** Finance only (rendered only when `credit !== 'restricted'`). Decisions stay on today's two-person page. */
export function CreditPanel({ credit }: { credit: CreditVM | null }) {
  return (
    <Panel title="Credit and Pay later (Finance only)" testId="credit-panel" error={credit === null} actions={<Button variant="secondary" size="sm" href="/admin/finance/credit">Credit terms</Button>}>
      {credit ? (
        <div className="grid gap-2 text-ods-table">
          <p className="m-0">Pay later: <b>{credit.eligible ? 'Eligible' : 'Not eligible'}</b></p>
          {credit.terms.length === 0 ? (
            <p className="m-0 text-ods-slate">No credit terms proposed.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {credit.terms.map((t) => {
                const st = creditTermStatusName(t.status);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 border-b border-ods-line pb-2">
                    <StatusPill status={st} />
                    <span className="font-semibold">{money(t.limitCents, t.currency)}</span>
                    <span className="text-ods-slate">Net {t.netDays} · {t.division}{t.overdueBlocked ? ' · blocked: overdue' : ''}</span>
                    {st === 'Waiting' ? (
                      <span className="w-full text-ods-small text-ods-warning" data-testid="second-approver-needed">
                        Second approver needed{t.proposedByMe ? ': you proposed this, so a different Finance user must approve it.' : '. Decide on Credit terms.'}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="m-0 text-ods-small text-ods-slate">Credit limits always need two Finance users: the person who proposes cannot approve. Wallet balance is separate from Pay-later credit.</p>
        </div>
      ) : null}
    </Panel>
  );
}

export function OpenItemsPanel({ items }: { items: OpenItem[] | null }) {
  return (
    <Panel title="Open items" testId="open-items" error={items === null}>
      {items && items.length === 0 ? <p className="m-0 text-ods-table text-ods-slate">Nothing open. No requests, unpaid orders or invoices waiting.</p> : null}
      {items && items.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((i) => (
            <li key={i.id} className="flex min-w-0 flex-wrap items-center gap-2 text-ods-table">
              <StatusPill status={i.status} />
              {i.href ? <A href={i.href} external={i.href.startsWith('/api/')}>{i.ref}</A> : <span className="font-semibold text-ods-navy">{i.ref}</span>}
              <span className="min-w-0 text-ods-slate">{i.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

export function RecentOrdersPanel({ rows, total, onAllHref }: { rows: OrderRowVM[] | null; total: number | null; onAllHref: string }) {
  return (
    <Panel title="Recent orders" testId="recent-orders" error={rows === null} actions={total ? <A href={onAllHref}>All {total} orders</A> : undefined}>
      {rows && rows.length === 0 ? <EmptyState icon={Inbox} title="No orders yet" headingLevel={3} /> : null}
      {rows && rows.length ? (
        <div className="-mx-1 overflow-x-auto" tabIndex={0} role="region" aria-label="Recent orders table">
          <table className="w-full min-w-[560px] border-collapse text-ods-table">
            <caption className="sr-only">Five most recent orders</caption>
            <thead>
              <tr className="h-ods-head border-b border-ods-line-strong bg-ods-canvas text-ods-label text-ods-slate">
                <th scope="col" className="px-2 text-start font-semibold">Order</th>
                <th scope="col" className="px-2 text-start font-semibold">Date</th>
                <th scope="col" className="px-2 text-start font-semibold">Service</th>
                <th scope="col" className="px-2 text-start font-semibold">Products</th>
                <th scope="col" className="px-2 text-end font-semibold">Total (US$)</th>
                <th scope="col" className="px-2 text-start font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="h-ods-row border-b border-ods-line">
                  <td className="whitespace-nowrap px-2 font-mono">{o.href ? <A href={o.href}>{o.code}</A> : o.code}</td>
                  <td className="whitespace-nowrap px-2">{formatDate(o.date)}</td>
                  <td className="px-2">{o.service}</td>
                  <td className="max-w-[16rem] truncate px-2">{o.title}</td>
                  <td className="px-2 text-end tabular-nums">{o.currency === 'USD' ? formatNumber(centsToAmount(o.totalCents), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : money(o.totalCents, o.currency)}</td>
                  <td className="px-2"><StatusPill status={orderStatusName(o.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

export function ActivityPanel({ items, notesHref }: { items: ActivityVM[] | null; notesHref?: string }) {
  return (
    <Panel title="Activity" testId="customer-activity" error={items === null} actions={notesHref ? <A href={notesHref}>Notes</A> : undefined}>
      {items ? <ActivityFeed label="Customer activity" items={items.map((a) => ({ id: a.id, title: a.title, actor: a.actor, date: a.at, tone: a.tone }))} emptyTitle="No activity logged yet" /> : null}
    </Panel>
  );
}

export function OverviewPanel({ o, ordersTotal, ordersHref }: { o: OverviewVM; ordersTotal: number | null; ordersHref: string }) {
  return (
    <div className="grid gap-4" data-testid="customer-overview">
      <div className="grid gap-4 ods-desktop:grid-cols-3">
        <CompanyPanel c={o.company} />
        <div className="grid content-start gap-4">
          <MoneyPanel m={o.money} credit={o.credit} statementHref={o.statementHref} />
          {o.credit !== 'restricted' ? <CreditPanel credit={o.credit} /> : null}
        </div>
        <OpenItemsPanel items={o.openItems} />
      </div>
      <div className="grid gap-4 ods-desktop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentOrdersPanel rows={o.recentOrders} total={ordersTotal} onAllHref={ordersHref} />
        <ActivityPanel items={o.activity} notesHref="?tab=notes" />
      </div>
    </div>
  );
}

/* ───────── wallet ───────── */

export function WalletPanel({ w }: { w: WalletTabVM }) {
  const m = w.money;
  const fig = (v: number | 'restricted' | null | undefined) => (v === 'restricted' ? 'Finance only' : v == null ? '—' : money(v));
  return (
    <div className="grid gap-4" data-testid="customer-wallet">
      <Panel title="Wallet" error={m === null}>
        {m ? (
          <div className="grid gap-3">
            <KpiStrip
              variant="strip"
              label="Wallet and money"
              items={[
                { label: 'Wallet available', value: fig(m.walletAvailableCents) },
                { label: 'Held', value: fig(m.heldCents) },
                { label: 'Invoices due', value: fig(m.invoicesDueCents), hint: m.invoicesDueCents === 'restricted' ? undefined : `${m.invoicesDueCount} ${m.invoicesDueCount === 1 ? 'invoice' : 'invoices'}` },
                { label: 'Paid last 12 months', value: fig(m.paid12mCents) },
              ]}
            />
            <p className="m-0 text-ods-small text-ods-slate">Wallet reference <b className="font-mono text-ods-navy">{w.reference ?? '—'}</b>. Wallet money and Pay-later credit are separate.</p>
          </div>
        ) : null}
      </Panel>
      <Panel title="Holds" error={w.holds === null}>
        {w.holds && w.holds.length === 0 ? <p className="m-0 text-ods-table text-ods-slate">No wallet holds.</p> : null}
        {w.holds && w.holds.length ? (
          <SimpleTable caption="Wallet holds" head={['Date', 'Service', 'Amount (US$)', 'Status']} numericCols={[2]} rows={w.holds.map((h) => [date(h.at), h.service, money(h.amountCents), <StatusPill key="s" status={h.status === 'open' ? 'Held' : h.status === 'captured' ? 'Paid' : 'Released'} />])} />
        ) : null}
      </Panel>
      {w.topups !== 'restricted' ? (
        <Panel title="Bank top-ups" error={w.topups === null}>
          {w.topups && w.topups.length === 0 ? <p className="m-0 text-ods-table text-ods-slate">No top-ups yet.</p> : null}
          {w.topups && w.topups.length ? (
            <SimpleTable caption="Wallet top-ups" head={['Date', 'Method', 'Reference', 'Amount', 'Status']} numericCols={[3]} rows={w.topups.map((t) => [date(t.at), paymentMethodLabel(t.method), <span key="r" className="font-mono">{t.reference ?? '—'}</span>, money(t.amountCents, t.currency), humanizeWord(t.status)])} />
          ) : null}
          <p className="m-0 mt-2 text-ods-small text-ods-slate">Confirm bank transfers on <A href="/admin/finance/transfers">Bank transfers</A> (today&apos;s flow).</p>
        </Panel>
      ) : null}
    </div>
  );
}

function SimpleTable({ caption, head, rows, numericCols = [] }: { caption: string; head: string[]; rows: ReactNode[][]; numericCols?: number[] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[480px] border-collapse text-ods-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="h-ods-head border-b border-ods-line-strong bg-ods-canvas text-ods-label text-ods-slate">
            {head.map((h, i) => <th key={h} scope="col" className={`px-2 font-semibold ${numericCols.includes(i) ? 'text-end' : 'text-start'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="h-ods-row border-b border-ods-line">
              {r.map((c, i) => <td key={i} className={`px-2 ${numericCols.includes(i) ? 'text-end tabular-nums' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── documents (KYC part; the grid is client) ───────── */

export function KycSubmissionsPanel({ d }: { d: DocumentsTabVM }) {
  return (
    <Panel title="Verification (KYC)" error={d.kyc === null}>
      {d.kyc && d.kyc.length === 0 ? <p className="m-0 text-ods-table text-ods-slate">No KYC submission yet.</p> : null}
      {d.kyc && d.kyc.length ? (
        <ul className="m-0 grid list-none gap-2 p-0 text-ods-table">
          {d.kyc.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Submission {date(k.submittedAt)}</span>
              <span className="text-ods-slate">{humanizeWord(k.status)}</span>
              {k.href ? <A href={k.href}>Open KYC review</A> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 mt-2 text-ods-small text-ods-slate">KYC files open only on the KYC review page, with a fresh 2-step code (as today).</p>
    </Panel>
  );
}

export const supplierNote = (hidden: boolean) =>
  hidden ? <p className="m-0 text-ods-small text-ods-slate" data-testid="supplier-docs-hidden">Supplier documents (purchase orders, remittances) are hidden: they need the Suppliers or Finance permission.</p> : null;


/* ───────── team ───────── */

export function AccountManagerPanel({ am }: { am: AccountManagerVM }) {
  const c = am.current;
  return (
    <Panel title="Account manager" testId="account-manager-panel">
      {c ? (
        <div className="grid gap-1 text-ods-table">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-ods-success text-ods-small font-bold text-white">{initials(c.name)}</span>
            <div>
              <div className="font-semibold text-ods-navy">{c.name}</div>
              <div className="text-ods-small text-ods-slate">{c.title ?? 'Dedicated account manager'}{c.team ? ` · ${c.team} team` : ''}{c.office ? ` · ${c.office}` : ''}</div>
            </div>
          </div>
          {c.outOfOffice ? <div><StatusPill tone="warning">Out of office: team queue covers</StatusPill></div> : null}
          {c.email ? <div><span className="text-ods-slate">Email</span> {c.email}</div> : null}
          <div><span className="text-ods-slate">Assigned</span> {date(c.assignedAt)} by {c.assignedBy}</div>
          {c.reason ? <div><span className="text-ods-slate">Reason</span> {c.reason}</div> : null}
          {c.load != null ? <div><span className="text-ods-slate">Load</span> {c.load}/{am.cap} customers</div> : null}
        </div>
      ) : (
        <EmptyState title="No account manager yet" description="Assigned automatically on KYC verification, or assign one from Actions." headingLevel={3} />
      )}
      <h3 className="m-0 mt-4 text-ods-body font-semibold text-ods-navy">Assignment history</h3>
      {am.history === null ? <LoadError what="the history" /> : am.history.length === 0 ? (
        <p className="m-0 text-ods-small text-ods-slate">{am.auditVisible ? 'No changes logged yet.' : 'Audit log is visible to Admins.'}</p>
      ) : (
        <ActivityFeed label="Assignment history" items={am.history.map((a) => ({ id: a.id, title: a.title, actor: a.actor, date: a.at, tone: a.tone }))} />
      )}
    </Panel>
  );
}

export function TeamPanel({ t }: { t: TeamTabVM }) {
  return (
    <div className="grid gap-4 ods-desktop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="customer-team">
      <Panel title="Members" error={t.members === null}>
        {t.members && t.members.length === 0 ? <EmptyState title="No members" headingLevel={3} /> : null}
        {t.members && t.members.length ? (
          <SimpleTable caption="Company members" head={['Name', 'Email', 'Role', 'Joined']} rows={t.members.map((m) => [<b key="n" className="text-ods-navy">{m.name}</b>, m.email ?? '—', m.role, date(m.joined)])} />
        ) : null}
      </Panel>
      <AccountManagerPanel am={t.accountManager} />
    </div>
  );
}

/* ───────── activity + notes ───────── */

export function ActivityTabPanel({ a }: { a: ActivityTabVM }) {
  return (
    <div className="grid gap-4 ods-desktop:grid-cols-2" data-testid="customer-activity-tab">
      <ActivityPanel items={a.activity} />
      <Panel title="Assistant conversations" error={a.assistant === null}>
        {a.assistant && a.assistant.length === 0 ? (
          <p className="m-0 text-ods-table text-ods-slate">No conversations visible. Only the account manager, the team queue and supervisors can read a customer&apos;s assistant history.</p>
        ) : null}
        {a.assistant && a.assistant.length ? (
          <ul className="m-0 grid list-none gap-2 p-0 text-ods-table">
            {a.assistant.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ods-line pb-2">
                {x.href ? <A href={x.href}>{x.title}</A> : <span className="font-semibold">{x.title}</span>}
                <span className="flex items-center gap-2"><StatusPill tone={x.status === 'escalated' ? 'warning' : x.status === 'human' ? 'success' : x.status === 'closed' ? 'neutral' : 'info'}>{humanizeWord(x.status)}</StatusPill><span className="text-ods-small text-ods-slate">{date(x.lastAt)}</span></span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}

/** Today's Back Office has no customer notes, follow-ups or reminders table, so there is no note box (documented). */
export function NotesPanel() {
  return (
    <section data-testid="notes-panel" aria-labelledby="customer-notes-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-4">
      <h2 id="customer-notes-h" className="m-0 mb-2 text-ods-h2 font-semibold text-ods-navy">Notes and follow-ups</h2>
      <EmptyState
        icon={NotebookPen}
        title="Customer notes aren't available yet"
        description="Today's Back Office has no customer notes, follow-up tasks or reminders. They need new tables (customer notes, follow-up tasks), which aren't built yet. For now, write staff-only notes on the KYC review or the customer's support ticket."
        headingLevel={3}
      />
    </section>
  );
}

