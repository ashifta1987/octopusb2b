import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getDocsPage, type DocsPage } from '@/lib/dropship-ds14';
import { DocsClient } from './docs-client';

export const metadata = { title: 'Docs · Back office' };

type SP = { q?: string; status?: string };

/**
 * Docs: certificates, test reports and HS documents linked to Dropship products, stored in the private bucket dropship-documents.
 * (AdminDocs.html shows the per-order shipping documents: the commercial invoice and packing slip come from Warehouse OS labels and the
 * packing slip route; this screen is the product document manager the owner asked for. See NOTES.)
 */
async function Guarded({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const access = await requireDropshipV2Staff(false, '/office/dropship/docs');
  const q = sp.q && /^[\w .-]{0,80}$/.test(sp.q) ? sp.q : '';
  const status = ['pending', 'verified', 'rejected', 'expired'].includes(sp.status ?? '') ? (sp.status as string) : '';
  let data: DocsPage | null = null;
  let error: string | null = null;
  try { data = await getDocsPage(q, status); } catch (e) { error = rpcMessage(e); }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="staff-docs-page">
        <DsPageHeader title="Docs" icon="file" />
        <DsNotice tone="bad" title="Docs could not be loaded" testId="docs-error" action={<DsLinkButton href="/office/dropship/docs" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <DocsClient data={data} q={q} status={status} canEdit={access.canEdit && data.can_edit} />;
}

export default function Page(props: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded {...props} />
    </Suspense>
  );
}
