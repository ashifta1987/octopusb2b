import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import crypto from 'node:crypto';
import { requireCustomer } from '@/lib/auth';
import { Card, Notice, PageHeader, StatusBadge, Timeline } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { fmtDate, money } from '@/lib/format';
import { countryName } from '@/lib/factory-label';
import {
  PAY_STATE, TK_FREE_DRAWING_VERSIONS, areaLabel, budgetLabel, depositCents, drawingStatusLabel, extraVersionCents, feePayState, fileSize, isGatedPhase,
  nextPhase, nextVersionIsExtra, phaseLabel, quoteStatusLabel, tkPhase, tkStatus, TK_PHASES, inspectionLabel, inspectionStatusLabel, resultLabel,
  docKindLabel, handoverReady, shipmentModeLabel, shipmentStatusLabel, tripPricesFrom, tripStatusLabel, tripSummary,
} from '@/lib/turnkey/format';
import { getTkClientFees, getTkClientProject } from '@/lib/turnkey/projects';
import { getTkClientDrawings, getTkClientQuotes } from '@/lib/turnkey/work';
import { getTkClientInspections } from '@/lib/turnkey/qc';
import { getTkClientShipping, getTkClientTrips, getTkTripPrices } from '@/lib/turnkey/shipping';
import { HandoverSignForm, PassportDelete, PassportUpload, TripCancelClient, TripRequestForm } from '@/components/turnkey/client-t6';
import { DrawingComment, DrawingReview, QuoteDecision } from '@/components/turnkey/client-decisions';
import { ProjectPhases, eventText } from '@/components/turnkey/project-phases';
import { TkPayFeeButton } from '@/components/turnkey/pay-fee-button';

export const metadata = { title: 'Turnkey project' };

/**
 * Turnkey T2/T3/T4 — the client's project page (design: ClientPortal + "The 8-step flow", Drawing, ChangeRequest, Quote): the 8 phases with their dates,
 * the fees per phase (approved fees only; each paid before its phase starts) with Pay, the named account manager (the
 * cover while the manager is away), the plan as sent and the project history. Never shows who proposed or approved a
 * fee, internal notes, suppliers or Octopus costs. T4: layout drawing versions (open, comment, approve or ask for changes;
 * extra versions after 3 are paid first) and the quote (lines, total, deposit; accept and pay the deposit). The quote
 * only ever shows Octopus's own lines and prices — never a factory, a cost or a margin. T5: Quality control — each
 * inspection (factory audit, pre-shipment inspection) with its fee and Pay (paid before it starts), the date, and the
 * published report: result, summary, AQL numbers, checklist answers and photos (short signed links). Never the factory,
 * the inspector's notes or names. T6: the balance with Pay (Shipment starts after it is paid); Shipment — tracking per
 * shipment (carrier, references, dates, events) and the shipping documents we shared (short signed links); the China
 * visit — request with a live estimate from the services list, the fee with Pay, the itinerary, and secure passport
 * copies (private bucket, 60-second links, delete any time); Handover — the final-documents checklist and the sign-off
 * with the typed full name, which completes the project. Never staff notes, names, factories or costs.
 */
export default function TurnkeyProjectPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ created?: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} table={false} />}>
      <ProjectDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProjectDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ created?: string }> }) {
  const { code } = await params;
  const { created } = await searchParams;
  if (!/^TKP-\d{5,}$/.test(code)) notFound();
  await requireCustomer(`/account/turnkey/${code}`);
  const d = await getTkClientProject(code);
  if (!d) notFound();
  const { project: p, stages, events, managerName, contact } = d;
  const [fees, drawings, quotes, inspections, shipping, trips, svc] = await Promise.all([getTkClientFees(p.id), getTkClientDrawings(p.id), getTkClientQuotes(p.id), getTkClientInspections(p.id),
    getTkClientShipping(p.id), getTkClientTrips(p.id), getTkTripPrices()]);
  const at = tkPhase(p.stage)?.n ?? 1;
  const bal = shipping.balance;
  const balState = bal ? feePayState(bal.amount_cents, bal.document) : null;
  const balLeft = bal?.document ? Math.max(0, bal.document.amount_cents - bal.document.paid_cents) : 0;
  const showShipment = shipping.shipments.length > 0 || !!bal || at >= 7;
  const showHandover = p.stage === 'handover' || !!shipping.handover.signoff;
  const ready = handoverReady(shipping.handover.items);
  const openTrip = trips.find((t) => t.status === 'requested' || t.status === 'confirmed') ?? null;
  const tripPrices = tripPricesFrom(svc);
  const shipDocs = shipping.documents.filter((x) => x.section === 'shipment');
  const finalDocs = shipping.documents.filter((x) => x.section === 'handover');
  const showQc = inspections.length > 0 || p.stage === 'production_qc';
  const latest = drawings.versions[0] ?? null;
  const drawingFee = fees.find((f) => f.stage === 'design' && f.service_code === 'layout_drawing') ?? null;
  const openExtras = drawings.extras.filter((e) => e.status === 'open');
  const openQuote = quotes.find((q) => q.status === 'sent') ?? null;
  const acceptedQuote = quotes.find((q) => q.status === 'accepted') ?? null;
  const showDrawings = drawings.versions.length > 0 || p.stage === 'design';
  const showQuote = quotes.length > 0 || p.stage === 'sourcing' || p.stage === 'quote_deposit';
  const st = tkStatus(p.status);
  const place = [p.city, countryName(p.country)].filter(Boolean).join(', ');
  const next = nextPhase(p.stage);
  const nextNeedsFee = next && isGatedPhase(next.code) && !fees.some((f) => f.stage === next.code) && p.status === 'open';
  const sorted = [...fees].sort((a, b) => (tkPhase(a.stage)?.n ?? 0) - (tkPhase(b.stage)?.n ?? 0));
  return (
    <>
      <PageHeader eyebrow={<Link href="/account/turnkey" className="text-sm text-muted hover:text-ink">← My turnkey projects</Link>}
        title={p.title} subtitle={`${p.code} · ${phaseLabel(p.stage)}`}
        actions={<StatusBadge status={p.status} label={st.label} tone={st.tone} />} />
      <div className="flex flex-col gap-4 mb-6">
        {created && <Notice tone="green"><span data-testid="tk-created">Enquiry sent. We reply with the consultation fee before any work starts.</span></Notice>}
        {p.status === 'on_hold' && <Notice tone="amber">This project is on hold{p.status_reason ? `: ${p.status_reason}` : '.'}</Notice>}
        {p.status === 'cancelled' && <Notice tone="red">This project was cancelled{p.status_reason ? `: ${p.status_reason}` : '.'}</Notice>}
        {p.status === 'completed' && <Notice tone="green">This project is completed. Thank you for working with us.</Notice>}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] items-start">
        <div className="flex flex-col gap-6">
          <Card title="Fees">
            <div className="px-6 pb-6 flex flex-col gap-4" data-testid="tk-fees">
              <p className="m-0 text-[14px] text-muted">Each paid phase starts after its fee is paid. Pay from your wallet, or by bank transfer quoting the proforma number (we confirm transfers within one working day).</p>
              {sorted.length === 0 && !nextNeedsFee && <p className="m-0 text-[15px]">No fees yet. We agree each fee with you before the work starts.</p>}
              {sorted.length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line border border-line rounded-[12px]">
                  {sorted.map((f) => {
                    const phase = tkPhase(f.stage);
                    const state = feePayState(f.amount_cents, f.document);
                    const ps = PAY_STATE[state];
                    const left = f.document ? Math.max(0, f.document.amount_cents - f.document.paid_cents) : f.amount_cents;
                    return (
                      <li key={f.id} className="p-4 flex flex-col gap-2" data-testid={`tk-fee-${f.stage}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold">{f.service_name ?? `${phase?.name ?? f.stage} fee`}</div>
                            <div className="text-[13px] text-muted">{phase ? `Phase ${phase.n} · ${phase.name}` : f.stage}{f.effective_from ? ` · set ${fmtDate(f.effective_from)}` : ''}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="mono font-semibold text-[15px]" data-testid={`tk-fee-amount-${f.stage}`}>{money(f.amount_cents, f.currency)}</span>
                            <StatusBadge status={state} label={ps.label} tone={ps.tone} />
                          </div>
                        </div>
                        {f.document && (
                          <div className="text-[13px] text-muted">Proforma <span className="mono">{f.document.number ?? '—'}</span>{state === 'part_paid' ? ` · ${money(left, f.currency)} still to pay` : ''} · <Link href="/account/invoices" className="underline hover:text-ink">Invoices and receipts</Link></div>
                        )}
                        {state !== 'paid' && f.document && left > 0 && (
                          <TkPayFeeButton code={p.code} documentId={f.document.id} amountCents={left} label={money(left, f.currency)}
                            idempotencyKey={`tk-fee:${f.id}:${crypto.randomUUID()}`} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {nextNeedsFee && next && (
                <p className="m-0 text-[14px]" data-testid="tk-fee-next">Next: <span className="font-semibold">{next.name}</span>. We set its fee with you; it appears here once it is approved.</p>
              )}
              <p className="m-0 text-[12.5px] text-muted">Phases paid first: {TK_PHASES.filter((x) => isGatedPhase(x.code)).map((x) => x.name).join(', ')}. Deposit, shipping and handover costs come with your quote.</p>
            </div>
          </Card>
          {showDrawings && (
            <Card title="Layout drawings">
              <div className="px-6 pb-6 flex flex-col gap-4" data-testid="tk-drawings">
                <p className="m-0 text-[14px] text-muted">
                  {TK_FREE_DRAWING_VERSIONS} versions are free. Each extra version costs 50% of your drawing fee{drawingFee ? ` (${money(extraVersionCents(drawingFee.amount_cents))})` : ''} and starts after you pay it.
                  {drawings.versions.length > 0 && ` Versions so far: ${drawings.versions.length}.`}
                </p>
                {drawings.versions.length === 0 && <p className="m-0 text-[15px]">We are preparing your first layout drawing. It appears here when it is ready.</p>}
                {openExtras.map((e) => {
                  const left = e.document ? Math.max(0, e.document.amount_cents - e.document.paid_cents) : e.amount_cents;
                  const state = feePayState(e.amount_cents, e.document);
                  return (
                    <div key={e.id} className="border border-line rounded-[12px] p-4 flex flex-col gap-2" data-testid={`tk-extra-v${e.for_version}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">Extra version {e.for_version} · <span className="mono">{money(e.amount_cents)}</span></span>
                        <StatusBadge status={state} label={PAY_STATE[state].label} tone={PAY_STATE[state].tone} />
                      </div>
                      {e.document && <div className="text-[13px] text-muted">Proforma <span className="mono">{e.document.number ?? '—'}</span> · <Link href="/account/invoices" className="underline hover:text-ink">Invoices and receipts</Link></div>}
                      {state !== 'paid' && e.document && left > 0 && (
                        <TkPayFeeButton code={p.code} documentId={e.document.id} amountCents={left} label={money(left)} idempotencyKey={`tk-extra:${e.id}:${crypto.randomUUID()}`} />
                      )}
                      {state === 'paid' && <p className="m-0 text-[13.5px] text-ok">Paid. We are working on version {e.for_version}.</p>}
                    </div>
                  );
                })}
                {drawings.extras.filter((e) => e.status === 'waived').map((e) => (
                  <p key={e.id} className="m-0 text-[13.5px]" data-testid={`tk-extra-v${e.for_version}`}>Extra version {e.for_version}: no charge.</p>
                ))}
                {drawings.versions.length > 0 && (
                  <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line border border-line rounded-[12px]">
                    {drawings.versions.map((v) => {
                      const ds = drawingStatusLabel(v.status);
                      const vc = drawings.comments.filter((c) => c.version_id === v.id);
                      return (
                        <li key={v.id} className="p-4 flex flex-col gap-3" data-testid={`tk-drawing-v${v.version}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold">Version {v.version}</div>
                              <div className="text-[13px] text-muted">{v.file_name} · {fileSize(v.size_bytes)} · shared {fmtDate(v.shared_at)}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              {v.url && <a href={v.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11" data-testid={`tk-drawing-open-v${v.version}`}>Open<span className="sr-only"> version {v.version}</span></a>}
                              <StatusBadge status={v.status} label={ds.label} tone={ds.tone} />
                            </div>
                          </div>
                          {v.message && <p className="m-0 text-[14px]">{v.message}</p>}
                          {vc.length > 0 && (
                            <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[14px]">
                              {vc.map((c) => <li key={c.id}><span className="font-semibold">{c.from_staff ? 'Octopus team' : 'You'}{c.kind === 'changes' ? ' (changes asked)' : c.kind === 'approval' ? ' (approved)' : ''}:</span> {c.body}</li>)}
                            </ul>
                          )}
                          {p.status === 'open' && v.id === latest?.id && v.status === 'shared' && (
                            <DrawingReview code={p.code} versionId={v.id} version={v.version} extraNext={nextVersionIsExtra(v.version)}
                              extraLabel={drawingFee ? `${money(extraVersionCents(drawingFee.amount_cents))} (50% of the drawing fee)` : null} />
                          )}
                          {p.status === 'open' && <DrawingComment code={p.code} versionId={v.id} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>
          )}
          {showQuote && (
            <Card title="Quote">
              <div className="px-6 pb-6 flex flex-col gap-4" data-testid="tk-quote">
                {quotes.length === 0 && <p className="m-0 text-[15px]">We are collecting prices for your project. Your quote appears here when it is ready.</p>}
                {quotes.map((q) => {
                  const qs = quoteStatusLabel(q.status);
                  const depState = q.document ? feePayState(q.deposit_cents ?? 0, q.document) : null;
                  const left = q.document ? Math.max(0, q.document.amount_cents - q.document.paid_cents) : 0;
                  const current = q.id === openQuote?.id || q.id === acceptedQuote?.id;
                  return (
                    <div key={q.id} className={`border rounded-[12px] p-4 flex flex-col gap-3 ${current ? 'border-line-strong' : 'border-line'}`} data-testid={`tk-quote-v${q.version}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">Version {q.version}{q.sent_at ? <span className="text-[13px] text-muted font-normal"> · {fmtDate(q.sent_at)}</span> : null}</span>
                        <StatusBadge status={q.status} label={qs.label} tone={qs.tone} />
                      </div>
                      {current && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[14px] border-collapse">
                            <caption className="sr-only">Quote version {q.version} lines</caption>
                            <thead><tr className="text-left text-muted text-[12.5px]"><th scope="col" className="py-1 pr-2 font-semibold">Item</th><th scope="col" className="py-1 px-2 font-semibold text-right">Qty</th><th scope="col" className="py-1 px-2 font-semibold text-right">Unit price</th><th scope="col" className="py-1 pl-2 font-semibold text-right">Total</th></tr></thead>
                            <tbody>
                              {q.lines.map((l) => (
                                <tr key={l.id} className="border-t border-line"><td className="py-1.5 pr-2">{l.description}</td><td className="py-1.5 px-2 text-right mono">{l.qty}</td><td className="py-1.5 px-2 text-right mono">{money(l.unit_price_cents, q.currency)}</td><td className="py-1.5 pl-2 text-right mono">{money(l.total_cents, q.currency)}</td></tr>
                              ))}
                            </tbody>
                            <tfoot><tr className="border-t border-line-strong"><th scope="row" colSpan={3} className="py-1.5 pr-2 text-right">Total</th><td className="py-1.5 pl-2 text-right mono font-semibold" data-testid={`tk-quote-total-v${q.version}`}>{money(q.total_cents, q.currency)}</td></tr></tfoot>
                          </table>
                        </div>
                      )}
                      {!current && <p className="m-0 text-[13.5px] text-muted">Total {money(q.total_cents, q.currency)}{q.client_comment ? ` · your comment: ${q.client_comment}` : ''}</p>}
                      {q.message && current && <p className="m-0 text-[14px]">{q.message}</p>}
                      {current && q.deposit_pct != null && q.deposit_cents != null && (
                        <p className="m-0 text-[14px]" data-testid={`tk-quote-deposit-v${q.version}`}>Deposit: {q.deposit_pct}% · <span className="mono font-semibold">{money(q.deposit_cents, q.currency)}</span>{q.valid_until && q.status === 'sent' ? ` · valid until ${fmtDate(q.valid_until)}` : ''}</p>
                      )}
                      {q.status === 'sent' && p.status === 'open' && q.deposit_pct != null && q.deposit_cents != null && (
                        <QuoteDecision code={p.code} quoteId={q.id} version={q.version} depositLabel={`${q.deposit_pct}% · ${money(depositCents(q.total_cents, q.deposit_pct), q.currency)}`} />
                      )}
                      {q.status === 'accepted' && q.document && depState && (
                        <div className="flex flex-col gap-2" data-testid="tk-deposit">
                          <div className="flex flex-wrap items-center gap-3 text-[14px]">
                            <span>Deposit proforma <span className="mono">{q.document.number ?? '—'}</span></span>
                            <StatusBadge status={depState} label={PAY_STATE[depState].label} tone={PAY_STATE[depState].tone} />
                          </div>
                          {depState !== 'paid' && left > 0 && (
                            <>
                              <TkPayFeeButton code={p.code} documentId={q.document.id} amountCents={left} label={money(left, q.currency)} idempotencyKey={`tk-deposit:${q.id}:${crypto.randomUUID()}`} />
                              <p className="m-0 text-[12.5px] text-muted">Or pay by bank transfer quoting the proforma number; we confirm transfers within one working day.</p>
                            </>
                          )}
                          {depState === 'paid' && <p className="m-0 text-[13.5px] text-ok">Deposit paid. Thank you — production comes next.</p>}
                          <p className="m-0 text-[12.5px] text-muted">The balance ({money(q.total_cents - (q.deposit_cents ?? 0), q.currency)}) is invoiced before shipment.</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {showQc && (
            <Card title="Quality control">
              <div className="px-6 pb-6 flex flex-col gap-4" data-testid="tk-qc">
                <p className="m-0 text-[14px] text-muted">We check your goods before they ship: a factory audit and a pre-shipment inspection. Each inspection is paid before it starts; its report appears here when it is ready.</p>
                {inspections.length === 0 && <p className="m-0 text-[15px]">We are arranging the inspections for your order. Their fees appear here first.</p>}
                {inspections.map((i) => {
                  const tid = `${i.kind}-${i.round}`;
                  const is = inspectionStatusLabel(i.status);
                  const state = i.fee ? feePayState(i.fee.amount_cents, i.fee.document) : null;
                  const left = i.fee?.document ? Math.max(0, i.fee.document.amount_cents - i.fee.document.paid_cents) : i.fee?.amount_cents ?? 0;
                  const res = i.report ? resultLabel(i.report.result) : null;
                  return (
                    <section key={i.id} aria-labelledby={`tk-qc-c-${i.id}`} className="border border-line rounded-[12px] p-4 flex flex-col gap-3" data-testid={`tk-inspection-${tid}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 id={`tk-qc-c-${i.id}`} className="m-0 text-[15px] font-semibold">{inspectionLabel(i.kind, i.round)}</h3>
                        <StatusBadge status={i.status} label={i.status === 'published' && res ? res.label : is.label} tone={i.status === 'published' && res ? res.tone : is.tone} />
                      </div>
                      {i.scheduled_on && i.status !== 'published' && <p className="m-0 text-[14px]" data-testid={`tk-inspection-date-${tid}`}>Scheduled for {fmtDate(i.scheduled_on)}.</p>}
                      {i.phase_fee_id && !i.fee && <p className="m-0 text-[13.5px] text-muted">Paid with your Production and QC fee.</p>}
                      {i.fee && state && i.status !== 'published' && (
                        <div className="flex flex-col gap-2" data-testid={`tk-inspection-fee-${tid}`}>
                          <div className="flex flex-wrap items-center gap-3 text-[14px]">
                            <span>Fee <span className="mono font-semibold">{money(i.fee.amount_cents, i.fee.currency)}</span>{i.fee.document ? <> · proforma <span className="mono">{i.fee.document.number ?? '—'}</span></> : null}</span>
                            <StatusBadge status={state} label={PAY_STATE[state].label} tone={PAY_STATE[state].tone} />
                          </div>
                          {state !== 'paid' && i.fee.document && left > 0 && (
                            <>
                              <TkPayFeeButton code={p.code} documentId={i.fee.document.id} amountCents={left} label={money(left, i.fee.currency)} idempotencyKey={`tk-insp:${i.fee.id}:${crypto.randomUUID()}`} />
                              <p className="m-0 text-[12.5px] text-muted">Or pay by bank transfer quoting the proforma number. We schedule the inspection after it is paid.</p>
                            </>
                          )}
                        </div>
                      )}
                      {i.report && i.status === 'published' && (
                        <div className="flex flex-col gap-3" data-testid={`tk-inspection-report-${tid}`}>
                          {i.report.client_summary && <p className="m-0 text-[14.5px] whitespace-pre-line">{i.report.client_summary}</p>}
                          <dl className="m-0 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-[14px]">
                            <dt className="text-muted">Result</dt><dd className="m-0 font-semibold" data-testid={`tk-inspection-result-${tid}`}>{res?.label}</dd>
                            <dt className="text-muted">Lot size</dt><dd className="m-0 mono">{i.report.lot_size}</dd>
                            <dt className="text-muted">Sample checked</dt><dd className="m-0 mono">{i.report.sample_size}</dd>
                            <dt className="text-muted">Defects found</dt><dd className="m-0" data-testid={`tk-inspection-defects-${tid}`}>Critical {i.report.critical_defects} · major {i.report.major_defects} · minor {i.report.minor_defects}</dd>
                            {i.report.published_at && <><dt className="text-muted">Report date</dt><dd className="m-0">{fmtDate(i.report.published_at)}</dd></>}
                          </dl>
                          {i.items.length > 0 && (
                            <ul className="list-none m-0 p-0 flex flex-col gap-0.5 text-[14px]" aria-label="Checklist">
                              {i.items.map((it) => <li key={it.id}>{it.label}: <span className="font-semibold">{it.answer === 'na' ? 'N/A' : it.answer === 'fail' ? 'Fail' : it.answer === 'pass' ? 'Pass' : '—'}</span></li>)}
                            </ul>
                          )}
                          {i.photos.length > 0 && (
                            <ul className="list-none m-0 p-0 grid grid-cols-3 sm:grid-cols-4 gap-2" aria-label="Inspection photos">
                              {i.photos.map((ph, n) => ph.url && (
                                <li key={ph.id}>
                                  <a href={ph.url} target="_blank" rel="noopener noreferrer" className="block" data-testid={`tk-inspection-photo-${tid}`}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={ph.url} alt={`${inspectionLabel(i.kind, i.round)} photo ${n + 1}`} className="w-full aspect-square object-cover rounded-[8px] border border-line" />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </Card>
          )}

          {showShipment && (
            <Card title="Balance and shipment">
              <div className="px-6 pb-6 flex flex-col gap-4" data-testid="tk-shipment">
                {bal && balState && (
                  <section aria-labelledby="tk-bal-c-h" className="border border-line rounded-[12px] p-4 flex flex-col gap-2" data-testid="tk-balance">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id="tk-bal-c-h" className="m-0 text-[15px] font-semibold">Balance <span className="mono" data-testid="tk-balance-amount">{money(bal.amount_cents, bal.currency)}</span></h3>
                      <StatusBadge status={balState} label={PAY_STATE[balState].label} tone={PAY_STATE[balState].tone} />
                    </div>
                    <p className="m-0 text-[13.5px] text-muted">Quote total {money(bal.total_cents, bal.currency)} less your deposit {money(bal.deposit_cents, bal.currency)}{bal.document ? <> · proforma <span className="mono">{bal.document.number ?? '—'}</span></> : null} · <Link href="/account/invoices" className="underline hover:text-ink">Invoices and receipts</Link></p>
                    {balState !== 'paid' && bal.document && balLeft > 0 && (
                      <>
                        <TkPayFeeButton code={p.code} documentId={bal.document.id} amountCents={balLeft} label={money(balLeft, bal.currency)} idempotencyKey={`tk-balance:${bal.id}:${crypto.randomUUID()}`} />
                        <p className="m-0 text-[12.5px] text-muted">Or pay by bank transfer quoting the proforma number. We ship after the balance is paid.</p>
                      </>
                    )}
                    {balState === 'paid' && <p className="m-0 text-[13.5px] text-ok">Balance paid. Thank you.</p>}
                  </section>
                )}
                {shipping.shipments.length === 0 && <p className="m-0 text-[15px]">{at >= 7 ? 'We are booking your shipment. Tracking appears here.' : 'Tracking appears here once your goods are booked for shipment.'}</p>}
                {shipping.shipments.map((sh) => {
                  const ss = shipmentStatusLabel(sh.status);
                  const docs = shipDocs.filter((d) => d.shipment_id === sh.id);
                  return (
                    <section key={sh.id} aria-labelledby={`tk-sh-c-${sh.id}`} className="border border-line rounded-[12px] p-4 flex flex-col gap-3" data-testid={`tk-shipment-${sh.seq}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 id={`tk-sh-c-${sh.id}`} className="m-0 text-[15px] font-semibold">Shipment {sh.seq} · {shipmentModeLabel(sh.mode)}</h3>
                        <span data-testid={`tk-shipment-status-${sh.seq}`}><StatusBadge status={sh.status} label={ss.label} tone={ss.tone} /></span>
                      </div>
                      <dl className="m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[14px]">
                        <dt className="text-muted">Carrier</dt><dd className="m-0">{sh.carrier}</dd>
                        {sh.booking_ref && <><dt className="text-muted">Booking</dt><dd className="m-0 mono">{sh.booking_ref}</dd></>}
                        {sh.container_no && <><dt className="text-muted">Container</dt><dd className="m-0 mono">{sh.container_no}</dd></>}
                        {sh.tracking_no && <><dt className="text-muted">Tracking</dt><dd className="m-0 mono">{sh.tracking_no}</dd></>}
                        {(sh.origin || sh.destination) && <><dt className="text-muted">Route</dt><dd className="m-0">{sh.origin ?? '—'} → {sh.destination ?? '—'}</dd></>}
                        {sh.etd && <><dt className="text-muted">Departure</dt><dd className="m-0">{fmtDate(sh.etd)}</dd></>}
                        {sh.eta && <><dt className="text-muted">Arrival</dt><dd className="m-0">{fmtDate(sh.eta)}</dd></>}
                        {sh.delivered_at && <><dt className="text-muted">Delivered</dt><dd className="m-0">{fmtDate(sh.delivered_at)}</dd></>}
                      </dl>
                      {sh.events.length > 0 && (
                        <ol className="list-none m-0 p-0 flex flex-col gap-1 text-[14px]" aria-label={`Tracking of shipment ${sh.seq}`} data-testid={`tk-shipment-events-${sh.seq}`}>
                          {sh.events.map((ev) => <li key={ev.id}><span className="mono text-[12.5px] text-muted">{fmtDate(ev.happened_at, true)}</span> · {ev.status_to ? <span className="font-semibold">{shipmentStatusLabel(ev.status_to).label}: </span> : null}{ev.description}{ev.location ? ` (${ev.location})` : ''}</li>)}
                        </ol>
                      )}
                      {docs.length > 0 && (
                        <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[14px]" aria-label={`Shipping documents of shipment ${sh.seq}`} data-testid={`tk-shipment-docs-${sh.seq}`}>
                          {docs.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2">{docKindLabel(d.kind)}{d.title !== docKindLabel(d.kind) ? ` · ${d.title}` : ''} <span className="text-muted text-[12.5px]">{fileSize(d.size_bytes)}</span>{d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11" data-testid={`tk-doc-open-${d.kind}`}>Open<span className="sr-only"> {d.title}</span></a>}</li>)}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            </Card>
          )}
          <Card title="Visit China with us">
            <div className="px-6 pb-6 flex flex-col gap-4" data-testid="tk-trips">
              <p className="m-0 text-[14px] text-muted">Guided factory and sourcing visits{tripPrices ? `: from ${money(tripPrices.dayCents)} per day for up to ${tripPrices.includedTravellers} people, each extra traveller ${money(tripPrices.extraTravellerDayCents)} per day` : ''}. Extras: visa invitation letter, car and driver, airport pick-up, hotel help (free). The fee is paid before we confirm the trip.</p>
              {trips.map((t) => {
                const ts = tripStatusLabel(t.status);
                const state = t.fee ? feePayState(t.fee.amount_cents, t.fee.document) : null;
                const left = t.fee?.document ? Math.max(0, t.fee.document.amount_cents - t.fee.document.paid_cents) : 0;
                const missing = Array.from({ length: t.travellers }, (_, k) => k + 1).filter((n) => !t.passports.some((x) => x.position === n));
                const open = (t.status === 'requested' || t.status === 'confirmed') && p.status === 'open';
                return (
                  <section key={t.id} aria-labelledby={`tk-trip-c-${t.id}`} className="border border-line rounded-[12px] p-4 flex flex-col gap-3" data-testid={`tk-trip-${t.seq}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id={`tk-trip-c-${t.id}`} className="m-0 text-[15px] font-semibold">China visit · {tripSummary(t, (x) => fmtDate(x))}</h3>
                      <span data-testid={`tk-trip-status-${t.seq}`}><StatusBadge status={t.status} label={ts.label} tone={ts.tone} /></span>
                    </div>
                    <p className="m-0 text-[14px]">Estimate from <span className="mono" data-testid={`tk-trip-list-${t.seq}`}>{money(t.list_cents)}</span>{t.client_message ? ` · ${t.client_message}` : ''}</p>
                    {t.fee && state && (
                      <div className="flex flex-col gap-2" data-testid={`tk-trip-fee-${t.seq}`}>
                        <div className="flex flex-wrap items-center gap-3 text-[14px]">
                          <span>Fee <span className="mono font-semibold">{money(t.fee.amount_cents, t.fee.currency)}</span>{t.fee.document ? <> · proforma <span className="mono">{t.fee.document.number ?? '—'}</span></> : null}</span>
                          <StatusBadge status={state} label={PAY_STATE[state].label} tone={PAY_STATE[state].tone} />
                        </div>
                        {state !== 'paid' && t.fee.document && left > 0 && open && (
                          <TkPayFeeButton code={p.code} documentId={t.fee.document.id} amountCents={left} label={money(left, t.fee.currency)} idempotencyKey={`tk-trip:${t.fee.id}:${crypto.randomUUID()}`} />
                        )}
                      </div>
                    )}
                    {!t.fee && t.status === 'requested' && <p className="m-0 text-[13.5px] text-muted">We are confirming the exact fee. It appears here with Pay.</p>}
                    {t.itinerary && <div className="text-[14px]" data-testid={`tk-trip-itinerary-${t.seq}`}><span className="font-semibold">Itinerary</span><p className="m-0 whitespace-pre-line">{t.itinerary}</p></div>}
                    {t.trip_report && <div className="text-[14px]"><span className="font-semibold">Trip report</span><p className="m-0 whitespace-pre-line">{t.trip_report}</p></div>}
                    {t.cancelled_at && <p className="m-0 text-[13.5px] text-muted">Cancelled: {t.cancel_reason}</p>}
                    {(open || t.passports.length > 0) && (
                      <section aria-labelledby={`tk-pass-h-${t.id}`} className="flex flex-col gap-2 border-t border-line pt-3" data-testid={`tk-passports-${t.seq}`}>
                        <h4 id={`tk-pass-h-${t.id}`} className="m-0 text-[14px] font-semibold">Passport copies (secure)</h4>
                        <p className="m-0 text-[12.5px] text-muted">Stored privately: only your company and the team arranging your visit can open them, through links that expire after a minute. Delete a copy at any time; we delete them 30 days after the visit.</p>
                        {t.passports.length > 0 && (
                          <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[14px]">
                            {t.passports.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2" data-testid={`tk-passport-${x.position}`}>Traveller {x.position}: {x.full_name}{x.url && <a href={x.url} target="_blank" rel="noopener noreferrer" className="underline" data-testid={`tk-passport-open-${x.position}`}>View<span className="sr-only"> passport copy of traveller {x.position}</span></a>}<PassportDelete code={p.code} travellerId={x.id} position={x.position} /></li>)}
                          </ul>
                        )}
                        {open && missing.length > 0 && <PassportUpload code={p.code} projectId={p.id} tripId={t.id} position={missing[0]} />}
                      </section>
                    )}
                    {open && !(t.fee?.document && t.fee.document.paid_cents > 0) && <TripCancelClient code={p.code} tripId={t.id} />}
                  </section>
                );
              })}
              {!openTrip && p.status === 'open' && tripPrices && <TripRequestForm code={p.code} projectId={p.id} prices={tripPrices} />}
            </div>
          </Card>
          {showHandover && (
            <Card title="Handover">
              <div className="px-6 pb-6 flex flex-col gap-4" data-testid="tk-handover">
                {shipping.handover.signoff ? (
                  <p className="m-0 text-[15px] text-ok font-semibold" data-testid="tk-handover-signed">Signed by {shipping.handover.signoff.signed_name} on {fmtDate(shipping.handover.signoff.signed_at, true)}. Your project is completed.</p>
                ) : <p className={`m-0 text-[14px] ${ready.ready ? 'text-ok' : 'text-muted'}`} data-testid="tk-handover-ready">{ready.text}</p>}
                {shipping.handover.items.length > 0 && (
                  <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line border border-line rounded-[12px]" aria-label="Final documents checklist">
                    {shipping.handover.items.map((it) => { const d = finalDocs.find((x) => x.id === it.document_id); return (
                      <li key={it.id} className="p-3 flex flex-wrap items-center justify-between gap-2" data-testid={`tk-handover-item-${it.position}`}>
                        <span>{it.label}{d?.url ? <> · <a href={d.url} target="_blank" rel="noopener noreferrer" className="underline">{d.title}</a></> : null}</span>
                        <StatusBadge status={it.done_at ? 'done' : 'open'} label={it.done_at ? 'Ready' : 'Being prepared'} tone={it.done_at ? 'green' : 'amber'} />
                      </li>); })}
                  </ul>
                )}
                {finalDocs.length > 0 && (
                  <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[14px]" aria-label="Final documents" data-testid="tk-final-docs">
                    {finalDocs.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2">{docKindLabel(d.kind)}{d.title !== docKindLabel(d.kind) ? ` · ${d.title}` : ''}{d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11" data-testid={`tk-doc-open-${d.kind}`}>Open<span className="sr-only"> {d.title}</span></a>}</li>)}
                  </ul>
                )}
                {!shipping.handover.signoff && ready.ready && p.status === 'open' && (openTrip
                  ? <p className="m-0 text-[13.5px] text-warn">Your China visit is still open. You sign the handover after it is completed or cancelled.</p>
                  : <HandoverSignForm code={p.code} projectId={p.id} />)}
              </div>
            </Card>
          )}
          <Card title="Phases">
            <div className="px-6 pb-6"><ProjectPhases stage={p.stage} status={p.status} rows={stages} /></div>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Your account manager">
            <div className="px-6 pb-5 text-[15px]" data-testid="tk-manager">
              {managerName ? (
                <>
                  <p className="m-0 font-semibold">{managerName}</p>
                  {contact?.on_cover && (
                    <p className="m-0 mt-1 text-[14px] text-muted" data-testid="tk-manager-cover">
                      Looking after your project{contact.usual_name ? ` while ${contact.usual_name} is away` : ''}{contact.cover_to ? `, until ${fmtDate(contact.cover_to)}` : ''}.
                    </p>
                  )}
                </>
              ) : (
                <p className="m-0">We will name your account manager soon. Until then, reply to any message from us or use Help &amp; complaints.</p>
              )}
            </div>
          </Card>
          <Card title="Your plan">
            <dl className="px-6 pb-5 m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[14px]" data-testid="tk-plan">
              <dt className="text-muted">Where</dt><dd className="m-0">{place || 'Not given'}</dd>
              <dt className="text-muted">Opening</dt><dd className="m-0">{p.target_open_on ? fmtDate(p.target_open_on) : 'Not given'}</dd>
              <dt className="text-muted">Space</dt><dd className="m-0">{areaLabel(p.floor_area_m2)}</dd>
              <dt className="text-muted">Budget</dt><dd className="m-0">{budgetLabel(p.budget_cents)}</dd>
              <dt className="text-muted">Plan</dt><dd className="m-0 whitespace-pre-line">{p.plan ?? 'Not given'}</dd>
            </dl>
          </Card>
          <Card title="History">
            <div className="px-6 pb-6" data-testid="tk-history">
              <Timeline items={events.map((e) => ({ ...eventText(e), at: e.created_at, tone: 'done' as const }))} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
