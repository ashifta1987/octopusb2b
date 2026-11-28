import { Suspense } from 'react';
import type { Metadata } from 'next';
import { loadWaiting, requireAccount, settle } from '../_lib/loaders';
import { ActionNeededView, parseActionType } from '../_components/action-view';

/**
 * ODS T6 · /account/action — Action needed (Part 6.3). Data: listWaiting (lib/core/waiting — the same four rules and
 * order as the Home "Waiting for you" list and the Shop tiles; countWaiting is unchanged). `?type=` = pay | approve |
 * review | reply. searchParams are awaited inside <Suspense> (Cache Components).
 */
export const metadata: Metadata = { title: 'Action needed' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function ActionNeededPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<ActionNeededView rows={[]} type={null} state="loading" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  await requireAccount('/account/action');
  const sp = await searchParams;
  const type = parseActionType(sp.type);
  const r = await settle(() => loadWaiting(200));
  return r.ok ? <ActionNeededView rows={r.data.rows} type={type} /> : <ActionNeededView rows={[]} type={type} state="error" />;
}
