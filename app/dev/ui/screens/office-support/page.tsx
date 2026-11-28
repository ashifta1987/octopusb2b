import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { parseSupportQuery, sortTickets, type SupportQuery } from '@/app/ods/office/support/_lib/support-core';
import type { SupportResult } from '@/app/ods/office/support/_components/support-screen';
import { SupportFixture } from '../office-orders/_fixtures';
import { ORDER_ROLES, SAMPLE_MACROS, SAMPLE_NOW, SAMPLE_SUPPORT_KPIS, SAMPLE_SUPPORT_PERMS, SAMPLE_TICKETS, SUPPORT_STATES, isSampleRole, sampleTicket, type SupportState } from '../office-orders/sample-data';

export const metadata: Metadata = { title: 'Support desk · ODS Back Office screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-support';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Staging-only fixture (T9 batch 2): Back Office › Support desk inside the real Back Office frame, SAMPLE data.
 * `?state=list | ticket | empty | error | loading | no-permission`, `?role=admin | finance | sales` (sales = view only).
 */
export default function OfficeSupportFixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = isSampleRole(one(sp.role)) ? (one(sp.role) as 'finance' | 'sales' | 'admin') : 'admin';
  const state = (SUPPORT_STATES.find((s) => s === one(sp.state)) ?? 'list') as SupportState;
  const perms = SAMPLE_SUPPORT_PERMS[role];
  const parsed = parseSupportQuery(sp);
  const ticket = sampleTicket(perms);
  const query: SupportQuery = { ...parsed, t: state === 'ticket' ? (parsed.t ?? ticket.id) : parsed.t };
  const filtered = sortTickets(
    SAMPLE_TICKETS.filter(
      (t) =>
        (query.f === 'resolved' ? ['resolved', 'closed'].includes(t.status) : !['resolved', 'closed'].includes(t.status)) &&
        (!['complaint', 'question', 'feedback'].includes(query.f) || t.category === query.f) &&
        (query.f !== 'overdue' || (!!t.slaDueAt && Date.parse(t.slaDueAt) < SAMPLE_NOW)) &&
        (query.f !== 'mine' || t.assignedToMe) &&
        (!query.p || t.priority === query.p) &&
        (!query.q || `${t.code} ${t.subject}`.toLowerCase().includes(query.q.toLowerCase())),
    ),
  );
  const result: SupportResult =
    state === 'loading'
      ? { kind: 'loading' }
      : state === 'no-permission'
        ? { kind: 'forbidden' }
        : {
            kind: 'ok',
            tickets: state === 'error' ? null : state === 'empty' ? [] : filtered,
            kpis: SAMPLE_SUPPORT_KPIS,
            macros: SAMPLE_MACROS,
            selected: query.t ? (query.t === ticket.id ? ticket : null) : null,
          };
  const links = [
    ...SUPPORT_STATES.map((s) => ({ href: `${BASE}?state=${s}&role=${role}`, text: s, current: s === state })),
    ...ORDER_ROLES.map(([r, label]) => ({ href: `${BASE}?state=${state}&role=${r}`, text: `as ${label}`, current: r === role })),
  ];
  return <SupportFixture role={role} links={links} screen={{ basePath: BASE, extraParams: { state: state === 'ticket' ? 'list' : state, role }, query, result, perms, nowMs: SAMPLE_NOW }} />;
}
