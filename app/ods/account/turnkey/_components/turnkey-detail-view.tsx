import type { ReactNode } from 'react';
import { Button, Card, EmptyState, StatusPill, Stepper, Tabs, Timeline, formatDate, type StepperStep } from '@octopus/ui';
import { countryName } from '@/lib/factory-label';
import { money } from '@/lib/format';
import {
  TK_FREE_DRAWING_VERSIONS, TK_PHASES, areaLabel, budgetLabel, depositCents, docKindLabel, drawingStatusLabel, extraVersionCents, feePayState,
  handoverReady, inspectionLabel, inspectionStatusLabel, isGatedPhase, nextPhase, nextVersionIsExtra, phaseLabel, phaseStates, quoteStatusLabel,
  resultLabel, shipmentModeLabel, shipmentStatusLabel, tkPhase, tripStatusLabel, tripSummary, type TkStageRow, type TkTripPrices,
} from '@/lib/turnkey/format';
import type { TkClientFee, TkClientProject, TkProjectContact, TkProjectEvent } from '@/lib/turnkey/projects';
import type { TkClientQuote, TkDrawingComment, TkDrawingVersion, TkExtraFee } from '@/lib/turnkey/work';
import type { TkClientInspection } from '@/lib/turnkey/qc';
import type { TkClientBalance, TkClientDocument, TkClientHandover, TkClientShipment, TkClientTrip } from '@/lib/turnkey/shipping';
import { Cents, Facts, Notice, PageHead, TextLink, fileSizeText } from '../../_services/ui';
import { TURNKEY_TABS, odsTone, payStatePill, turnkeyStatusPill, turnkeyStepper, type TurnkeyTab } from '../../_services/logic';
import { DrawingComment, DrawingReview, HandoverSign, PassportDelete, PassportUpload, PayFeeButton, QuoteDecision, TripCancel, TripRequestForm } from './turnkey-actions';

/** Everything today's project page loads (lib/turnkey/* customer-safe readers), passed as props so fixtures can render it. */
export type TurnkeyDetailData = {
  project: TkClientProject; stages: TkStageRow[]; events: TkProjectEvent[]; managerName: string | null; contact: TkProjectContact | null;
  fees: TkClientFee[];
  drawings: { versions: TkDrawingVersion[]; comments: TkDrawingComment[]; extras: TkExtraFee[] };
  quotes: TkClientQuote[]; inspections: TkClientInspection[];
  shipping: { balance: TkClientBalance | null; shipments: TkClientShipment[]; documents: TkClientDocument[]; handover: TkClientHandover };
  trips: TkClientTrip[]; tripPrices: TkTripPrices | null;
  /** one random value per page view: idempotency keys are `<kind>:<item id>:<keySeed>` (today: one key per view per item) */
  keySeed: string;
  created?: boolean;
};

const left = (amount: number, doc: { amount_cents: number; paid_cents: number } | null) => (doc ? Math.max(0, doc.amount_cents - doc.paid_cents) : amount);

function Pill({ state }: { state: 'paid' | 'part_paid' | 'to_pay' }) {
  const p = payStatePill(state);
  return <StatusPill tone={p.tone}>{p.label}</StatusPill>;
}

function Row({ title, sub, side, children, testId }: { title: ReactNode; sub?: ReactNode; side?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col"><span className="font-semibold text-ods-text">{title}</span>{sub ? <span className="text-ods-small text-ods-slate">{sub}</span> : null}</div>
        {side ? <div className="flex flex-wrap items-center gap-2">{side}</div> : null}
      </div>
      {children}
    </li>
  );
}
const List = ({ children, label }: { children: ReactNode; label?: string }) => <ul aria-label={label} className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">{children}</ul>;

/**
 * /account/turnkey/TKP-n (Part 6.7: "stepper + tabs, like the order detail"). Same content and actions as today's page,
 * rearranged: Overview (next payment, fees, balance and shipment, China visit, handover, manager, plan) · Quotes (layout
 * drawings + quotes) · Samples (Turnkey has no sample phase today: quality checks) · Files · Messages · Timeline (phases + history).
 * Never shows who proposed or approved a fee, internal notes, factories, suppliers or Octopus costs (the readers don't select them).
 */
export function TurnkeyDetailView({ d, tab, tabParam = 'tab' }: { d: TurnkeyDetailData; tab: TurnkeyTab; tabParam?: string | null }) {
  const p = d.project;
  const open = p.status === 'open';
  const st = turnkeyStatusPill(p.status);
  const stepper = turnkeyStepper({ stage: p.stage, status: p.status, statusReason: p.status_reason, inspections: d.inspections });
  const stageRows = new Map(d.stages.map((r) => [r.stage, r]));
  const stepDates: Record<string, string[]> = { brief: ['enquiry', 'consultation'], design: ['design', 'sourcing', 'quote_deposit'], production: ['production_qc'], qc: ['production_qc'], shipping: ['shipment', 'handover'] };
  const steps: StepperStep[] = stepper.steps.map((s) => {
    const rows = (stepDates[s.id] ?? []).map((c) => stageRows.get(c)).filter(Boolean) as TkStageRow[];
    const done = rows.map((r) => r.completed_at).filter(Boolean).sort().pop();
    const started = rows.map((r) => r.started_at).filter(Boolean).sort()[0];
    const due = rows.map((r) => r.due_on).filter(Boolean).sort().pop();
    const detail = s.note ?? (s.status === 'done' && done ? `Done ${formatDate(done)}` : s.status === 'current' && due ? `Target ${formatDate(due)}` : s.status === 'current' && started ? `Since ${formatDate(started)}` : undefined);
    return { id: s.id, label: s.label, status: s.status, detail, errorText: s.status === 'error' ? stepper.errorText : undefined };
  });

  /* ── payable items (first unpaid = "What's next") ── */
  const fees = [...d.fees].sort((a, b) => (tkPhase(a.stage)?.n ?? 0) - (tkPhase(b.stage)?.n ?? 0));
  type Due = { key: string; title: string; documentId: string; cents: number; currency: string; seedKind: string; id: string };
  const dues: Due[] = [];
  for (const f of fees) if (f.document && feePayState(f.amount_cents, f.document) !== 'paid' && left(f.amount_cents, f.document) > 0) dues.push({ key: `fee-${f.id}`, title: f.service_name ?? `${tkPhase(f.stage)?.name ?? f.stage} fee`, documentId: f.document.id, cents: left(f.amount_cents, f.document), currency: f.currency, seedKind: 'tk-fee', id: f.id });
  for (const e of d.drawings.extras) if (e.status === 'open' && e.document && feePayState(e.amount_cents, e.document) !== 'paid' && left(e.amount_cents, e.document) > 0) dues.push({ key: `extra-${e.id}`, title: `Extra drawing version ${e.for_version}`, documentId: e.document.id, cents: left(e.amount_cents, e.document), currency: 'USD', seedKind: 'tk-extra', id: e.id });
  const accepted = d.quotes.find((q) => q.status === 'accepted') ?? null;
  if (accepted?.document && feePayState(accepted.deposit_cents ?? 0, accepted.document) !== 'paid' && left(0, accepted.document) > 0) dues.push({ key: `dep-${accepted.id}`, title: 'Quote deposit', documentId: accepted.document.id, cents: left(0, accepted.document), currency: accepted.currency, seedKind: 'tk-deposit', id: accepted.id });
  for (const i of d.inspections) if (i.fee?.document && i.status !== 'published' && feePayState(i.fee.amount_cents, i.fee.document) !== 'paid' && left(i.fee.amount_cents, i.fee.document) > 0) dues.push({ key: `insp-${i.fee.id}`, title: `${inspectionLabel(i.kind, i.round)} fee`, documentId: i.fee.document.id, cents: left(i.fee.amount_cents, i.fee.document), currency: i.fee.currency, seedKind: 'tk-insp', id: i.fee.id });
  const bal = d.shipping.balance;
  if (bal?.document && feePayState(bal.amount_cents, bal.document) !== 'paid' && left(bal.amount_cents, bal.document) > 0) dues.push({ key: `bal-${bal.id}`, title: 'Balance', documentId: bal.document.id, cents: left(bal.amount_cents, bal.document), currency: bal.currency, seedKind: 'tk-balance', id: bal.id });
  const payKey = (due: { seedKind: string; id: string }) => `${due.seedKind}:${due.id}:${d.keySeed}`;
  const pay = (due: Due, testId?: string) => <PayFeeButton code={p.code} documentId={due.documentId} amountCents={due.cents} label={money(due.cents, due.currency)} idempotencyKey={payKey(due)} testId={testId} />;
  const byDoc = new Map(dues.map((x) => [x.documentId, x]));
  const payFor = (docId: string | undefined | null) => { const due = docId ? byDoc.get(docId) : undefined; return due ? pay(due) : null; };

  const next = nextPhase(p.stage);
  const nextNeedsFee = !!next && isGatedPhase(next.code) && !d.fees.some((f) => f.stage === next.code) && open;
  const latest = d.drawings.versions[0] ?? null;
  const drawingFee = d.fees.find((f) => f.stage === 'design' && f.service_code === 'layout_drawing') ?? null;
  const openQuote = d.quotes.find((q) => q.status === 'sent') ?? null;
  const at = tkPhase(p.stage)?.n ?? 1;
  const ready = handoverReady(d.shipping.handover.items);
  const openTrip = d.trips.find((t) => t.status === 'requested' || t.status === 'confirmed') ?? null;
  const shipDocs = d.shipping.documents.filter((x) => x.section === 'shipment');
  const finalDocs = d.shipping.documents.filter((x) => x.section === 'handover');
  const showHandover = p.stage === 'handover' || !!d.shipping.handover.signoff;
  const place = [p.city, countryName(p.country)].filter(Boolean).join(', ');
  const messages = d.drawings.comments;

  /* ───────── panels ───────── */
  const overview = (
    <div className="grid grid-cols-1 items-start gap-6 ods-desktop:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card title="What's next" headingLevel={3} data-testid="turnkey-next">
          {dues.length ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-ods-body"><span className="font-semibold">{dues[0].title}</span>: <Cents cents={dues[0].cents} currency={dues[0].currency} /> to pay. Each paid phase starts after its payment is confirmed.</p>
              {pay(dues[0], "turnkey-pay-next")}
              <p className="m-0 text-ods-small text-ods-slate">Or pay by bank transfer quoting the proforma number; we confirm transfers within one working day.</p>
            </div>
          ) : (
            <p className="m-0 text-ods-body">{!open ? 'Nothing to do on this project now.' : nextNeedsFee && next ? `Next: ${next.name}. We agree its fee with you; it appears here once it is approved.` : 'Nothing to pay right now. We let you know when something needs you.'}</p>
          )}
        </Card>
        <Card title="Fees" headingLevel={3} description="Each paid phase starts after its fee is paid. Pay from your wallet, or by bank transfer quoting the proforma number." data-testid="turnkey-fees">
          {fees.length === 0 ? <p className="m-0 text-ods-body">No fees yet. We agree each fee with you before the work starts.</p> : (
            <List label="Fees">
              {fees.map((f) => {
                const s = feePayState(f.amount_cents, f.document);
                const ph = tkPhase(f.stage);
                return (
                  <Row key={f.id} testId={`turnkey-fee-${f.stage}`} title={f.service_name ?? `${ph?.name ?? f.stage} fee`}
                    sub={<>{ph ? `Phase ${ph.n} · ${ph.name}` : f.stage}{f.document?.number ? ` · proforma ${f.document.number}` : ''}{f.effective_from ? ` · set ${formatDate(f.effective_from)}` : ''}</>}
                    side={<><Cents cents={f.amount_cents} currency={f.currency} className="font-semibold" /><Pill state={s} /></>}>
                    {s === 'part_paid' && f.document ? <p className="m-0 text-ods-small text-ods-slate"><Cents cents={left(f.amount_cents, f.document)} currency={f.currency} /> still to pay.</p> : null}
                    {payFor(f.document?.id)}
                  </Row>
                );
              })}
            </List>
          )}
          <p className="m-0 mt-3 text-ods-small text-ods-slate">Phases paid first: {TK_PHASES.filter((x) => isGatedPhase(x.code)).map((x) => x.name).join(', ')}. Deposit, shipping and handover costs come with your quote. <TextLink href="/account/invoices">Invoices and receipts</TextLink></p>
        </Card>
        {(d.shipping.shipments.length > 0 || bal || at >= 7) ? (
          <Card title="Balance and shipment" headingLevel={3} data-testid="turnkey-shipment">
            <div className="flex flex-col gap-4">
              {bal ? (
                <div className="flex flex-col gap-2 rounded-ods-card border border-ods-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Balance <Cents cents={bal.amount_cents} currency={bal.currency} /></span><Pill state={feePayState(bal.amount_cents, bal.document)} /></div>
                  <p className="m-0 text-ods-small text-ods-slate">Quote total {money(bal.total_cents, bal.currency)} less your deposit {money(bal.deposit_cents, bal.currency)}{bal.document?.number ? ` · proforma ${bal.document.number}` : ''}. We ship after the balance is paid.</p>
                  {payFor(bal.document?.id)}
                </div>
              ) : null}
              {d.shipping.shipments.length === 0 ? <p className="m-0 text-ods-body">{at >= 7 ? 'We are booking your shipment. Tracking appears here.' : 'Tracking appears here once your goods are booked for shipment.'}</p> : d.shipping.shipments.map((sh) => {
                const ss = shipmentStatusLabel(sh.status);
                return (
                  <section key={sh.id} aria-labelledby={`sh-${sh.id}`} className="flex flex-col gap-3 rounded-ods-card border border-ods-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><h4 id={`sh-${sh.id}`} className="m-0 text-ods-body font-semibold">Shipment {sh.seq} · {shipmentModeLabel(sh.mode)}</h4><StatusPill tone={odsTone(ss.tone)}>{ss.label}</StatusPill></div>
                    <Facts items={[
                      ['Carrier', sh.carrier], ...(sh.tracking_no ? [['Tracking', sh.tracking_no] as [string, string]] : []), ...(sh.booking_ref ? [['Booking', sh.booking_ref] as [string, string]] : []),
                      ...(sh.container_no ? [['Container', sh.container_no] as [string, string]] : []), ...((sh.origin || sh.destination) ? [['Route', `${sh.origin ?? '—'} → ${sh.destination ?? '—'}`] as [string, string]] : []),
                      ...(sh.etd ? [['Departure', formatDate(sh.etd)] as [string, string]] : []), ...(sh.eta ? [['Arrival', formatDate(sh.eta)] as [string, string]] : []), ...(sh.delivered_at ? [['Delivered', formatDate(sh.delivered_at)] as [string, string]] : []),
                    ]} />
                    {sh.events.length ? <Timeline label={`Tracking of shipment ${sh.seq}`} items={sh.events.map((ev, n) => ({ id: String(ev.id), title: `${ev.status_to ? `${shipmentStatusLabel(ev.status_to).label}: ` : ''}${ev.description}`, description: ev.location ?? undefined, date: ev.happened_at, state: n === 0 ? 'current' : 'done' }))} /> : null}
                  </section>
                );
              })}
            </div>
          </Card>
        ) : null}
        {showHandover ? (
          <Card title="Handover" headingLevel={3} data-testid="turnkey-handover">
            <div className="flex flex-col gap-3">
              {d.shipping.handover.signoff ? <Notice tone="success">Signed by {d.shipping.handover.signoff.signed_name} on {formatDate(d.shipping.handover.signoff.signed_at)}. Your project is completed.</Notice> : <p className="m-0 text-ods-body">{ready.text}</p>}
              {d.shipping.handover.items.length ? (
                <List label="Final documents checklist">
                  {d.shipping.handover.items.map((it) => <Row key={it.id} title={it.label} side={<StatusPill tone={it.done_at ? 'success' : 'warning'}>{it.done_at ? 'Ready' : 'Being prepared'}</StatusPill>} />)}
                </List>
              ) : null}
              {!d.shipping.handover.signoff && ready.ready && open ? (openTrip ? <p className="m-0 text-ods-body">Your China visit is still open. You sign the handover after it is completed or cancelled.</p> : <HandoverSign code={p.code} projectId={p.id} />) : null}
            </div>
          </Card>
        ) : null}
        <Card title="Visit China with us" headingLevel={3} data-testid="turnkey-trips"
          description={`Guided factory and sourcing visits${d.tripPrices ? `: from ${money(d.tripPrices.dayCents)} per day for up to ${d.tripPrices.includedTravellers} people, each extra traveller ${money(d.tripPrices.extraTravellerDayCents)} per day` : ''}. The fee is paid before we confirm the trip.`}>
          <div className="flex flex-col gap-4">
            {d.trips.map((t) => {
              const ts = tripStatusLabel(t.status);
              const tOpen = (t.status === 'requested' || t.status === 'confirmed') && open;
              const missing = Array.from({ length: t.travellers }, (_, k) => k + 1).filter((n) => !t.passports.some((x) => x.position === n));
              return (
                <section key={t.id} aria-labelledby={`trip-${t.id}`} className="flex flex-col gap-3 rounded-ods-card border border-ods-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h4 id={`trip-${t.id}`} className="m-0 text-ods-body font-semibold">China visit · {tripSummary(t, (x) => formatDate(x))}</h4><StatusPill tone={odsTone(ts.tone)}>{ts.label}</StatusPill></div>
                  <p className="m-0 text-ods-body">Estimate from {money(t.list_cents)}{t.client_message ? ` · ${t.client_message}` : ''}</p>
                  {t.fee ? <div className="flex flex-wrap items-center gap-2 text-ods-body">Fee <Cents cents={t.fee.amount_cents} currency={t.fee.currency} className="font-semibold" />{t.fee.document?.number ? ` · proforma ${t.fee.document.number}` : ''}<Pill state={feePayState(t.fee.amount_cents, t.fee.document)} /></div> : t.status === 'requested' ? <p className="m-0 text-ods-small text-ods-slate">We are confirming the exact fee. It appears here with Pay.</p> : null}
                  {t.fee?.document && tOpen && feePayState(t.fee.amount_cents, t.fee.document) !== 'paid' && left(t.fee.amount_cents, t.fee.document) > 0
                    ? <PayFeeButton code={p.code} documentId={t.fee.document.id} amountCents={left(t.fee.amount_cents, t.fee.document)} label={money(left(t.fee.amount_cents, t.fee.document), t.fee.currency)} idempotencyKey={`tk-trip:${t.fee.id}:${d.keySeed}`} /> : null}
                  {t.itinerary ? <div><p className="m-0 font-semibold">Itinerary</p><p className="m-0 whitespace-pre-line">{t.itinerary}</p></div> : null}
                  {t.trip_report ? <div><p className="m-0 font-semibold">Trip report</p><p className="m-0 whitespace-pre-line">{t.trip_report}</p></div> : null}
                  {t.cancelled_at ? <p className="m-0 text-ods-small text-ods-slate">Cancelled: {t.cancel_reason}</p> : null}
                  {(tOpen || t.passports.length > 0) ? (
                    <div className="flex flex-col gap-2 border-t border-ods-line pt-3">
                      <p className="m-0 font-semibold">Passport copies (secure)</p>
                      <p className="m-0 text-ods-small text-ods-slate">Stored privately: only your company and the team arranging your visit can open them, through links that expire after a minute. Delete a copy at any time; we delete them 30 days after the visit.</p>
                      {t.passports.map((x) => (
                        <div key={x.id} className="flex flex-wrap items-center gap-2 text-ods-body">Traveller {x.position}: {x.full_name}
                          {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ods-blue underline">View<span className="sr-only"> passport copy of traveller {x.position}</span></a> : null}
                          <PassportDelete code={p.code} travellerId={x.id} position={x.position} />
                        </div>
                      ))}
                      {tOpen && missing.length > 0 ? <PassportUpload code={p.code} projectId={p.id} tripId={t.id} position={missing[0]} /> : null}
                    </div>
                  ) : null}
                  {tOpen && !(t.fee?.document && t.fee.document.paid_cents > 0) ? <TripCancel code={p.code} tripId={t.id} /> : null}
                </section>
              );
            })}
            {!openTrip && open && d.tripPrices ? <TripRequestForm code={p.code} projectId={p.id} prices={d.tripPrices} /> : null}
            {!d.trips.length && !(open && d.tripPrices) ? <p className="m-0 text-ods-body">Visits can be asked for while the project is open.</p> : null}
          </div>
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <Card title="Your account manager" headingLevel={3}>
          {d.managerName ? (
            <div className="flex flex-col gap-1"><p className="m-0 font-semibold">{d.managerName}</p>
              {d.contact?.on_cover ? <p className="m-0 text-ods-small text-ods-slate">Looking after your project{d.contact.usual_name ? ` while ${d.contact.usual_name} is away` : ''}{d.contact.cover_to ? `, until ${formatDate(d.contact.cover_to)}` : ''}.</p> : null}
            </div>
          ) : <p className="m-0 text-ods-body">We will name your account manager soon. Until then, use Support and we reply within one working day.</p>}
        </Card>
        <Card title="Your plan" headingLevel={3}>
          <Facts className="ods-tablet:grid-cols-1" items={[['Where', place || 'Not given'], ['Opening', p.target_open_on ? formatDate(p.target_open_on) : 'Not given'], ['Space', areaLabel(p.floor_area_m2)], ['Budget', budgetLabel(p.budget_cents)], ['Plan', <span key="p" className="whitespace-pre-line">{p.plan ?? 'Not given'}</span>]]} />
        </Card>
      </div>
    </div>
  );

  const quotes = (
    <div className="flex flex-col gap-6">
      <Card title="Layout drawings" headingLevel={3} data-testid="turnkey-drawings"
        description={`${TK_FREE_DRAWING_VERSIONS} versions are free. Each extra version costs 50% of your drawing fee${drawingFee ? ` (${money(extraVersionCents(drawingFee.amount_cents))})` : ''} and starts after you pay it.`}>
        {d.drawings.versions.length === 0 ? <EmptyState title="No drawing yet" headingLevel={4} description={p.stage === 'design' ? 'We are preparing your first layout drawing. It appears here when it is ready.' : 'Layout drawings appear here in the design phase.'} /> : (
          <div className="flex flex-col gap-4">
            {d.drawings.extras.filter((e) => e.status === 'open').map((e) => (
              <div key={e.id} className="flex flex-col gap-2 rounded-ods-card border border-ods-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Extra version {e.for_version} · <Cents cents={e.amount_cents} /></span><Pill state={feePayState(e.amount_cents, e.document)} /></div>
                {payFor(e.document?.id)}
              </div>
            ))}
            <List label="Drawing versions">
              {d.drawings.versions.map((v) => {
                const ds = drawingStatusLabel(v.status);
                return (
                  <Row key={v.id} title={`Version ${v.version}`} sub={`${v.file_name} · ${fileSizeText(v.size_bytes)} · shared ${formatDate(v.shared_at)}`}
                    side={<>{v.url ? <Button variant="secondary" size="sm" href={v.url} target="_blank">Open<span className="sr-only"> version {v.version}</span></Button> : null}<StatusPill tone={odsTone(ds.tone)}>{ds.label}</StatusPill></>}>
                    {v.message ? <p className="m-0 text-ods-body">{v.message}</p> : null}
                    {open && v.id === latest?.id && v.status === 'shared' ? <DrawingReview code={p.code} versionId={v.id} version={v.version} extraNext={nextVersionIsExtra(v.version)} extraLabel={drawingFee ? `${money(extraVersionCents(drawingFee.amount_cents))} (50% of the drawing fee)` : null} /> : null}
                    {open ? <DrawingComment code={p.code} versionId={v.id} version={v.version} /> : null}
                  </Row>
                );
              })}
            </List>
          </div>
        )}
      </Card>
      <Card title="Quotes" headingLevel={3} data-testid="turnkey-quotes" description="Our own lines and prices only.">
        {d.quotes.length === 0 ? <EmptyState title="No quote yet" headingLevel={4} description="We are collecting prices for your project. Your quote appears here when it is ready." /> : (
          <div className="flex flex-col gap-4">
            {d.quotes.map((q) => {
              const qs = quoteStatusLabel(q.status);
              const current = q.id === openQuote?.id || q.id === accepted?.id;
              return (
                <section key={q.id} aria-labelledby={`q-${q.id}`} className="flex flex-col gap-3 rounded-ods-card border border-ods-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h4 id={`q-${q.id}`} className="m-0 text-ods-body font-semibold">Version {q.version}{q.sent_at ? ` · ${formatDate(q.sent_at)}` : ''}</h4><StatusPill tone={odsTone(qs.tone)}>{qs.label}</StatusPill></div>
                  {current ? (
                    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Quote version ${q.version} lines`}>
                      <table className="w-full border-collapse text-ods-table">
                        <caption className="sr-only">Quote version {q.version} lines</caption>
                        <thead><tr className="text-ods-small text-ods-slate"><th scope="col" className="py-1 pe-2 text-start font-semibold">Item</th><th scope="col" className="px-2 py-1 text-end font-semibold">Qty</th><th scope="col" className="px-2 py-1 text-end font-semibold">Unit price</th><th scope="col" className="py-1 ps-2 text-end font-semibold">Total</th></tr></thead>
                        <tbody>{q.lines.map((l) => <tr key={l.id} className="border-t border-ods-line"><td className="py-1.5 pe-2">{l.description}</td><td className="px-2 py-1.5 text-end tabular-nums">{l.qty}</td><td className="px-2 py-1.5 text-end"><Cents cents={l.unit_price_cents} currency={q.currency} /></td><td className="py-1.5 ps-2 text-end"><Cents cents={l.total_cents} currency={q.currency} /></td></tr>)}</tbody>
                        <tfoot><tr className="border-t border-ods-line-strong"><th scope="row" colSpan={3} className="py-1.5 pe-2 text-end">Total</th><td className="py-1.5 ps-2 text-end font-semibold"><Cents cents={q.total_cents} currency={q.currency} /></td></tr></tfoot>
                      </table>
                    </div>
                  ) : <p className="m-0 text-ods-small text-ods-slate">Total {money(q.total_cents, q.currency)}{q.client_comment ? ` · your comment: ${q.client_comment}` : ''}</p>}
                  {current && q.message ? <p className="m-0 text-ods-body">{q.message}</p> : null}
                  {current && q.deposit_pct != null && q.deposit_cents != null ? <p className="m-0 text-ods-body">Deposit: {q.deposit_pct}% · <Cents cents={q.deposit_cents} currency={q.currency} className="font-semibold" />{q.valid_until && q.status === 'sent' ? ` · valid until ${formatDate(q.valid_until)}` : ''}</p> : null}
                  {q.status === 'sent' && open && q.deposit_pct != null && q.deposit_cents != null ? <QuoteDecision code={p.code} quoteId={q.id} version={q.version} depositLabel={`${q.deposit_pct}% · ${money(depositCents(q.total_cents, q.deposit_pct), q.currency)}`} /> : null}
                  {q.status === 'accepted' && q.document ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-ods-body">Deposit proforma {q.document.number ?? '—'} <Pill state={feePayState(q.deposit_cents ?? 0, q.document)} /></div>
                      {payFor(q.document.id)}
                      <p className="m-0 text-ods-small text-ods-slate">The balance ({money(q.total_cents - (q.deposit_cents ?? 0), q.currency)}) is invoiced before shipment.</p>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );

  const samples = (
    <Card title="Samples and quality checks" headingLevel={3} data-testid="turnkey-qc"
      description="Turnkey has no separate sample step today. We check your goods before they ship: a factory audit and a pre-shipment inspection. Each inspection is paid before it starts; its report appears here.">
      {d.inspections.length === 0 ? <EmptyState title="No inspections yet" headingLevel={4} description={p.stage === 'production_qc' ? 'We are arranging the inspections for your order. Their fees appear here first.' : 'Inspections are arranged in the production phase.'} /> : (
        <div className="flex flex-col gap-4">
          {d.inspections.map((i) => {
            const is = inspectionStatusLabel(i.status);
            const res = i.report ? resultLabel(i.report.result) : null;
            const pill = i.status === 'published' && res ? res : is;
            return (
              <section key={i.id} aria-labelledby={`i-${i.id}`} className="flex flex-col gap-3 rounded-ods-card border border-ods-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h4 id={`i-${i.id}`} className="m-0 text-ods-body font-semibold">{inspectionLabel(i.kind, i.round)}</h4><StatusPill tone={odsTone(pill.tone)}>{pill.label}</StatusPill></div>
                {i.scheduled_on && i.status !== 'published' ? <p className="m-0 text-ods-body">Scheduled for {formatDate(i.scheduled_on)}.</p> : null}
                {i.phase_fee_id && !i.fee ? <p className="m-0 text-ods-small text-ods-slate">Paid with your Production and QC fee.</p> : null}
                {i.fee && i.status !== 'published' ? <div className="flex flex-wrap items-center gap-2 text-ods-body">Fee <Cents cents={i.fee.amount_cents} currency={i.fee.currency} className="font-semibold" /><Pill state={feePayState(i.fee.amount_cents, i.fee.document)} /></div> : null}
                {i.status !== 'published' ? payFor(i.fee?.document?.id) : null}
                {i.report && i.status === 'published' ? (
                  <div className="flex flex-col gap-3">
                    {i.report.client_summary ? <p className="m-0 whitespace-pre-line text-ods-body">{i.report.client_summary}</p> : null}
                    <Facts items={[['Result', res?.label ?? '—'], ['Lot size', String(i.report.lot_size)], ['Sample checked', String(i.report.sample_size)], ['Defects found', `Critical ${i.report.critical_defects} · major ${i.report.major_defects} · minor ${i.report.minor_defects}`], ...(i.report.published_at ? [['Report date', formatDate(i.report.published_at)] as [string, string]] : [])]} />
                    {i.items.length ? <ul aria-label="Checklist" className="m-0 flex list-none flex-col gap-0.5 p-0 text-ods-body">{i.items.map((it) => <li key={it.id}>{it.label}: <span className="font-semibold">{it.answer === 'na' ? 'N/A' : it.answer === 'fail' ? 'Fail' : it.answer === 'pass' ? 'Pass' : '—'}</span></li>)}</ul> : null}
                    {i.photos.length ? (
                      <ul aria-label="Inspection photos" className="m-0 grid list-none grid-cols-3 gap-2 p-0 ods-tablet:grid-cols-4">
                        {i.photos.map((ph, n) => ph.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <li key={ph.id}><a href={ph.url} target="_blank" rel="noopener noreferrer" className="block"><img src={ph.url} alt={`${inspectionLabel(i.kind, i.round)} photo ${n + 1}`} className="aspect-square w-full rounded-ods-control border border-ods-line object-cover" /></a></li>
                        ) : null)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );

  const fileRows = [
    ...d.drawings.versions.map((v) => ({ id: `d-${v.id}`, title: `Layout drawing · version ${v.version}`, sub: `${v.file_name} · ${fileSizeText(v.size_bytes)}`, url: v.url })),
    ...shipDocs.map((x) => ({ id: `s-${x.id}`, title: `${docKindLabel(x.kind)}${x.title !== docKindLabel(x.kind) ? ` · ${x.title}` : ''}`, sub: `Shipping document · ${fileSizeText(x.size_bytes)}`, url: x.url })),
    ...finalDocs.map((x) => ({ id: `h-${x.id}`, title: `${docKindLabel(x.kind)}${x.title !== docKindLabel(x.kind) ? ` · ${x.title}` : ''}`, sub: `Final document · ${fileSizeText(x.size_bytes)}`, url: x.url })),
  ];
  const files = (
    <Card title="Files" headingLevel={3} data-testid="turnkey-files" description="Drawings and the documents we shared with you. Links work for a few minutes; reload the page for a new link.">
      {fileRows.length === 0 ? <EmptyState title="No files yet" headingLevel={4} description="Drawings, shipping documents and final documents appear here when we share them." /> : (
        <List label="Files">{fileRows.map((f) => <Row key={f.id} title={f.title} sub={f.sub} side={f.url ? <Button variant="secondary" size="sm" href={f.url} target="_blank">Open<span className="sr-only"> {f.title}</span></Button> : <span className="text-ods-small text-ods-slate">Reload for a link</span>} />)}</List>
      )}
      <p className="m-0 mt-3 text-ods-small text-ods-slate">Proformas, tax invoices and receipts are in <TextLink href="/account/invoices">Invoices</TextLink>.</p>
    </Card>
  );

  const messagesPanel = (
    <Card title="Messages" headingLevel={3} data-testid="turnkey-messages"
      actions={<Button variant="secondary" size="sm" href={`/account/support?about=${p.code}`}>Message us</Button>}
      description="Comments on your drawings live here. For anything else, message us: the ticket goes to your account manager.">
      {messages.length === 0 ? <EmptyState title="No messages yet" headingLevel={4} description="Comments you and our team add to drawings appear here." /> : (
        <ol aria-label="Drawing comments" className="m-0 flex list-none flex-col gap-3 p-0">
          {messages.map((c) => {
            const v = d.drawings.versions.find((x) => x.id === c.version_id);
            return (
              <li key={c.id} className={`max-w-[85%] rounded-ods-card border px-4 py-3 ${c.from_staff ? 'self-start border-ods-line bg-ods-surface' : 'self-end border-ods-blue-tint bg-ods-blue-tint'}`}>
                <p className="m-0 text-ods-small"><span className="font-semibold text-ods-navy">{c.from_staff ? 'Octopus team' : 'You'}</span>{c.kind === 'changes' ? ' · changes asked' : c.kind === 'approval' ? ' · approved' : ''}{v ? ` · version ${v.version}` : ''} · {formatDate(c.created_at)}</p>
                <p className="m-0 mt-1 whitespace-pre-wrap text-ods-body">{c.body}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );

  const phases = phaseStates(p.stage, d.stages);
  const timeline = (
    <div className="grid grid-cols-1 items-start gap-6 ods-desktop:grid-cols-2">
      <Card title="Phases" headingLevel={3}>
        <Timeline label="Project phases" items={phases.map((ph) => ({ id: ph.code, title: `${ph.n}. ${ph.name}`, description: ph.row?.due_on && ph.state !== 'done' ? `Target ${formatDate(ph.row.due_on)}` : ph.what, date: ph.state === 'done' ? ph.row?.completed_at ?? undefined : ph.row?.started_at ?? undefined, state: ph.state === 'todo' ? 'next' : ph.state }))} />
      </Card>
      <Card title="History" headingLevel={3} data-testid="turnkey-history">
        {d.events.length === 0 ? <EmptyState title="No history yet" headingLevel={4} /> : (
          <Timeline label="Project history" items={d.events.map((e) => ({ id: String(e.id), title: eventTitle(e), description: e.message ?? undefined, date: e.created_at, state: 'done' as const }))} />
        )}
      </Card>
    </div>
  );

  const panels: Record<TurnkeyTab, { label: string; count?: number; panel: ReactNode }> = {
    overview: { label: 'Overview', panel: overview },
    quotes: { label: 'Quotes', count: d.quotes.length || undefined, panel: quotes },
    samples: { label: 'Samples and QC', count: d.inspections.length || undefined, panel: samples },
    files: { label: 'Files', count: fileRows.length || undefined, panel: files },
    messages: { label: 'Messages', count: messages.length || undefined, panel: messagesPanel },
    timeline: { label: 'Timeline', panel: timeline },
  };

  return (
    <div className="flex flex-col gap-6" data-testid="turnkey-detail">
      <PageHead back={{ href: '/account/turnkey', label: 'Turnkey projects' }} title={p.title} eyebrow={`${p.code} · ${phaseLabel(p.stage)}`}
        meta={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
        actions={<Button variant="secondary" href={`/account/support?about=${p.code}`}>Message us</Button>} />
      {d.created ? <Notice tone="success">Enquiry sent. We reply with the consultation fee before any work starts.</Notice> : null}
      {p.status === 'on_hold' ? <Notice tone="warning">This project is on hold{p.status_reason ? `: ${p.status_reason}` : '.'}</Notice> : null}
      {p.status === 'cancelled' ? <Notice tone="danger">This project was cancelled{p.status_reason ? `: ${p.status_reason}` : '.'}</Notice> : null}
      {p.status === 'completed' ? <Notice tone="success">This project is completed. Thank you for working with us.</Notice> : null}
      <div className="rounded-ods-card bg-ods-surface p-ods-pad-card shadow-ods-card">
        <Stepper steps={steps} current={stepper.current} label="Project progress" data-testid="turnkey-stepper" />
      </div>
      <Tabs label="Project sections" param={tabParam ?? undefined} defaultValue={tab} sticky data-testid="turnkey-tabs"
        items={TURNKEY_TABS.map((id) => ({ id, label: panels[id].label, count: panels[id].count, panel: panels[id].panel, testId: `turnkey-tab-${id}` }))} panelClassName="pt-6" />
    </div>
  );
}

/** History line title (same words as today's eventText in components/turnkey/project-phases, kept here to avoid importing UI). */
function eventTitle(e: TkProjectEvent): string {
  const to = e.to_stage ? tkPhase(e.to_stage)?.name ?? e.to_stage : null;
  switch (e.kind) {
    case 'created': return 'Enquiry sent';
    case 'migrated': return 'Moved to your new project page';
    case 'stage_forward': return `Moved to ${to}`;
    case 'stage_back': return `Moved back to ${to}`;
    case 'status': return e.status === 'open' ? 'Project reopened' : turnkeyStatusPill(e.status ?? '').label;
    case 'due_date': return 'Target date updated';
    case 'fee': return to ? `Fee set for ${to}` : 'Fee set';
    case 'manager': return 'Account manager cover';
    case 'drawing': return 'Layout drawing';
    case 'quote': return 'Quote';
    case 'inspection': return 'Quality control';
    case 'balance': return 'Balance';
    case 'shipment': return 'Shipment';
    case 'trip': return 'China visit';
    case 'handover': return 'Handover';
    default: return e.kind;
  }
}
