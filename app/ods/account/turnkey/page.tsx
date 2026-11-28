import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireAccount } from '../_lib/loaders';
import { createClient } from '@/lib/supabase/server';
import { phaseLabel } from '@/lib/turnkey/format';
import { PageHead, PageWrap } from '../_services/ui';
import { TURNKEY_STEPS, turnkeyStatusPill, turnkeyStepper } from '../_services/logic';
import { TurnkeyListView, type TurnkeyListRow, type TurnkeyListState } from './_components/turnkey-list-view';

export const metadata: Metadata = { title: 'Turnkey projects' };

type Row = { code: string; title: string; stage: string; status: string; status_reason: string | null; created_at: string; stage_changed_at: string };
type Due = { data: { ref?: string } | null; amount_cents: number; paid_cents: number };

/**
 * ODS /account/turnkey (Part 6.7, C_Turnkey). Same data as today's app/account/turnkey/page.tsx: the company's projects from
 * tk_client_projects (customer-safe view) and the unpaid Turnkey proformas (documents, service = turnkey) that make a row
 * "Waiting for your payment". Guest requests are linked to the company first with today's RPC tk_link_legacy_projects.
 */
export default function TurnkeyListPage() {
  return (
    <PageWrap testId="turnkey-page">
      <PageHead title="Turnkey projects" description="From idea to delivered stock. Follow each step and payment. The enquiry is free; each paid phase starts after your payment is confirmed." />
      <Suspense fallback={<TurnkeyListView state={{ kind: 'loading' }} />}>
        <Projects />
      </Suspense>
    </PageWrap>
  );
}

async function loadProjects(): Promise<TurnkeyListState> {
  const s = await requireAccount('/account/turnkey');
  const sb = await createClient();
  if (s.org) await sb.rpc('tk_link_legacy_projects', { p_org: s.org.id });
  const [{ data, error }, { data: dues }] = await Promise.all([
    sb.from('tk_client_projects').select('code, title, stage, status, status_reason, created_at, stage_changed_at').order('created_at', { ascending: false }).limit(200),
    sb.from('documents').select('data, amount_cents, paid_cents').eq('doc_type', 'proforma_invoice').eq('data->>service', 'turnkey').in('status', ['awaiting_payment', 'part_paid']).limit(500),
  ]);
  if (error) return { kind: 'error' };
  const toPay = new Map<string, number>();
  for (const d of (dues ?? []) as Due[]) {
    const ref = d.data?.ref;
    if (ref && Number(d.paid_cents) < Number(d.amount_cents)) toPay.set(ref, (toPay.get(ref) ?? 0) + 1);
  }
  const rows: TurnkeyListRow[] = ((data ?? []) as Row[]).map((r) => {
    const st = turnkeyStepper({ stage: r.stage, status: r.status });
    return {
      code: r.code, title: r.title,
      stepLabel: r.status === 'completed' ? 'Completed' : TURNKEY_STEPS[st.current].label,
      phaseLabel: phaseLabel(r.stage),
      status: turnkeyStatusPill(r.status),
      statusReason: (r.status === 'on_hold' || r.status === 'cancelled') ? r.status_reason : null,
      toPay: r.status !== 'cancelled' ? toPay.get(r.code) ?? 0 : 0,
      stageChangedAt: r.stage_changed_at, createdAt: r.created_at,
      stepsDone: r.status === 'completed' ? TURNKEY_STEPS.length : st.current,
    };
  });
  return { kind: 'ready', rows };
}

async function Projects() {
  return <TurnkeyListView state={await loadProjects()} />;
}
