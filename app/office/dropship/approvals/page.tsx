import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getApproval, getApprovalsPage, type ApprovalDetail, type ApprovalsPage } from '@/lib/dropship-ds14';
import { ApprovalsClient } from './approvals-client';

export const metadata = { title: 'Supplier approvals · Back office' };

/** AdminApprovals.html: what suppliers sent (new products, bulk uploads, price changes, stock updates) before merchants see it. */
async function Guarded({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string }> }) {
  const sp = await searchParams;
  const access = await requireDropshipV2Staff(false, '/office/dropship/approvals');
  const tab = ['review', 'changes', 'approved', 'rejected'].includes(sp.tab ?? '') ? (sp.tab as string) : 'review';
  let page: ApprovalsPage | null = null;
  let detail: ApprovalDetail | null = null;
  let error: string | null = null;
  try {
    page = await getApprovalsPage(tab);
    if (sp.id && /^[0-9a-f-]{36}$/i.test(sp.id)) detail = await getApproval(sp.id);
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!page) {
    return (
      <div className="flex flex-col gap-5" data-testid="staff-approvals-page">
        <DsPageHeader title="Supplier approvals" icon="check" />
        <DsNotice tone="bad" title="Approvals could not be loaded" testId="approvals-error" action={<DsLinkButton href="/office/dropship/approvals" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <ApprovalsClient tab={tab} page={page} detail={detail} canEdit={access.canEdit} />;
}

export default function Page(props: { searchParams: Promise<{ tab?: string; id?: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded {...props} />
    </Suspense>
  );
}
