import crypto from 'node:crypto';
import Link from 'next/link';
import { DocumentButton } from '@/components/client';
import { PayProformaButton } from '@/components/account/pay-proforma-button';
import { fmtDate, money } from '@/lib/format';
import { KIND_LABEL, amountDue, docStatus, fmtQty, monthLabel, refText, unitWord, type IssuedInvoice } from '@/lib/warehouse-w6';

const TONE: Record<string, string> = {
  ok: 'bg-ok-bg text-ok', warn: 'bg-warn-bg text-warn', info: 'bg-tint text-coral-text', bad: 'bg-bad-bg text-bad', neutral: 'bg-divider text-black',
};

/**
 * Portal board 22 — monthly statements. Each statement lists every charge of the month; every line opens to the orders, stock
 * notices, pallets, packaging and returns behind it. Pay from the wallet here (existing pay path) or by bank transfer
 * (Finance records it); full payment issues the tax invoice.
 */
export function InvoicesTab({ invoices, open }: { invoices: IssuedInvoice[]; open: string | null }) {
  if (invoices.length === 0) {
    return (
      <section className="card p-5 mt-5" data-testid="wh-portal-invoices-empty">
        <h2 className="text-[18px] font-semibold m-0">No monthly statements yet</h2>
        <p className="mt-2 mb-0 text-[14px] text-black/75">
          After each month we send one statement with every charge: receiving, storage, pick and pack, packaging and returns. Each line shows the orders and
          movements behind it. All your invoices are also in <Link href="/account/invoices" className="underline">Invoices and receipts</Link>.
        </p>
      </section>
    );
  }
  return (
    <div className="mt-5 flex flex-col gap-4" data-testid="wh-portal-invoices">
      <p className="m-0 text-[14px] text-black/75">One statement per month. Open a line to see what is behind it. Questions about a charge? <Link href="/account/warehouse?tab=support" className="underline">Ask us in Support</Link>.</p>
      {invoices.map((inv, idx) => {
        const st = docStatus(inv.status);
        const due = amountDue(inv);
        const isOpen = open ? open === inv.period.slice(0, 7) : idx === 0;
        return (
          <details key={inv.id} open={isOpen} className="card p-0 overflow-hidden" data-testid={`wh-stmt-${inv.period.slice(0, 7)}`}>
            <summary className="cursor-pointer list-none p-5 flex flex-wrap items-center gap-x-6 gap-y-2 min-h-11">
              <span className="text-[18px] font-semibold">{monthLabel(inv.period)}</span>
              <span className="mono text-[13px]">{inv.number}</span>
              <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${TONE[st.tone]}`} data-testid="wh-stmt-status">{st.label}</span>
              <span className="ml-auto text-[20px] font-bold" data-testid="wh-stmt-total">{money(inv.total_cents, inv.currency)}</span>
            </summary>
            <div className="px-5 pb-5 flex flex-col gap-3">
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Charges for ${monthLabel(inv.period)}`}>
                <table className="w-full text-[14px] border-collapse" style={{ minWidth: 560 }}>
                  <thead>
                    <tr className="text-left text-[12.5px] text-black/70 border-b border-line">
                      <th scope="col" className="py-2 pr-3 font-semibold">Charge</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">Quantity</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">Price</th>
                      <th scope="col" className="py-2 font-semibold text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l) => (
                      <tr key={l.id} className="border-b border-line align-top" data-testid={`wh-stmt-line-${l.seq}`} data-kind={l.kind}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold">{KIND_LABEL[l.kind]}</div>
                          <div className="text-[13px] text-black/70">{l.description}</div>
                          {l.refs.length > 0 && (
                            <details className="mt-1" data-testid={`wh-stmt-refs-${l.seq}`}>
                              <summary className="cursor-pointer text-[13px] font-semibold underline min-h-11 inline-flex items-center">
                                Show the {l.refs.length} {l.kind === 'storage' ? 'pallet' : l.kind === 'receiving' ? 'stock notice' : l.kind === 'returns' ? 'return' : l.kind === 'materials' ? 'packaging use' : 'order'}{l.refs.length === 1 ? '' : 's'} behind this line
                              </summary>
                              <ul className="m-0 mt-1 pl-4 flex flex-col gap-1 text-[13px]">
                                {l.refs.map((r, i) => {
                                  const t = refText(r);
                                  return (
                                    <li key={`${r.id}-${i}`}>
                                      {t.href ? <Link href={t.href} className="underline">{t.label}</Link> : <span>{t.label}</span>}
                                      <span className="text-black/70"> · {t.detail} · {fmtDate('at' in r ? r.at : r.from)}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </details>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">{fmtQty(l.qty)} {unitWord(l.unit_label, Number(l.qty))}</td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">{money(l.unit_cents, inv.currency)}</td>
                        <td className="py-2.5 whitespace-nowrap text-right font-semibold">{money(l.amount_cents, inv.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={3} className="pt-3 text-right font-bold">Total</th>
                      <td className="pt-3 text-right font-bold">{money(inv.total_cents, inv.currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {due > 0 ? (
                  <PayProformaButton documentId={inv.document_id} amountCents={due} label={money(due, inv.currency)} idempotencyKey={`wallet:${inv.document_id}:${crypto.randomUUID()}`} />
                ) : null}
                <DocumentButton docId={inv.document_id} compact />
                {inv.tax_invoice ? <a className="btn btn-ghost btn-sm" href={`/api/documents/${inv.tax_invoice.id}/pdf`} target="_blank" rel="noopener">Tax invoice PDF</a> : null}
                <span className="text-[13px] text-black/70">
                  {due > 0 ? `Paid ${money(inv.paid_cents, inv.currency)} so far. You can also pay by bank transfer quoting ${inv.number}; we confirm it here.`
                    : inv.tax_invoice ? `Paid. Tax invoice ${inv.tax_invoice.number}.` : st.label}
                </span>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
