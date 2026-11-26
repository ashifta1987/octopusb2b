import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import crypto from 'node:crypto';
import { requireCustomer } from '@/lib/auth';
import { Card, Notice, PageHeader, StatusBadge, Timeline } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { fmtDate, money } from '@/lib/format';
import { countryName } from '@/lib/factory-label';
import { PAY_STATE, areaLabel, budgetLabel, feePayState, isGatedPhase, nextPhase, phaseLabel, tkPhase, tkStatus, TK_PHASES } from '@/lib/turnkey/format';
import { getTkClientFees, getTkClientProject } from '@/lib/turnkey/projects';
import { ProjectPhases, eventText } from '@/components/turnkey/project-phases';
import { TkPayFeeButton } from '@/components/turnkey/pay-fee-button';

export const metadata = { title: 'Turnkey project' };

/**
 * Turnkey T2/T3 — the client's project page (design: ClientPortal + "The 8-step flow"): the 8 phases with their dates,
 * the fees per phase (approved fees only; each paid before its phase starts) with Pay, the named account manager (the
 * cover while the manager is away), the plan as sent and the project history. Never shows who proposed or approved a
 * fee, internal notes, suppliers or Octopus costs.
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
  const fees = await getTkClientFees(p.id);
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
