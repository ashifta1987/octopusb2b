// ODS T9 · Back Office › Support desk (queue grid + ticket record). Replaces the T8 re-export of app/office/support/page.tsx
// inside the ODS Back Office frame. Same guard (requireStaff('support','view')), same reads (support-data.ts = today's
// queries), every write = today's server action in app/office/actions.ts, unchanged.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { replyTicket, ticketStatusForm, ticketPriorityForm, saveMacro, escalateToFinance } from '@/app/office/actions';
import { SupportScreen, type SupportActions } from './_components/support-screen';
import { loadSupportDesk } from './_lib/support-data';
import { SUPPORT_PATH, parseSupportQuery, supportPerms } from './_lib/support-core';
import { assignTicketToMeAction } from './actions';

export const metadata = { title: 'Support desk' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const ACTIONS: SupportActions = { reply: replyTicket, setStatus: ticketStatusForm, setPriority: ticketPriorityForm, assignToMe: assignTicketToMeAction, saveMacro, escalate: escalateToFinance };

async function SupportContent({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('support', 'view', SUPPORT_PATH);
  const query = parseSupportQuery(await searchParams);
  const perms = supportPerms({ isAdmin: s.isAdmin, can: (a, x) => can(s, a, x) });
  const nowMs = getNowMs();
  const d = await loadSupportDesk(s.userId, query, perms, new Date(nowMs).toISOString());
  return <SupportScreen query={query} result={{ kind: 'ok', ...d }} perms={perms} nowMs={nowMs} actions={ACTIONS} />;
}

export default function OfficeSupportPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<SupportScreen query={{ f: 'all', p: null, t: null, q: '' }} result={{ kind: 'loading' }} perms={{ canEdit: false, canEscalate: false, canSeeSuppliers: false }} nowMs={0} actions={ACTIONS} />}>
      <SupportContent searchParams={searchParams} />
    </Suspense>
  );
}
