import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getFilePage, type FilePage } from '@/lib/dropship-c0';
import { FileClient } from './file-client';

export const metadata = { title: 'File import · Octopus Dropship' };

/**
 * C0 · CSV file connector (works now, for any store): orders CSV in (template, column choice, row errors with row numbers, preview,
 * import history → ds_order_intake channel 'csv'), product feed CSV and tracking CSV out. Data: c0_file_page().
 */
async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/integrations/file');
  let data: FilePage | null = null;
  let error: string | null = null;
  try { data = await getFilePage(); } catch (e) { error = rpcMessage(e); }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="file-page">
        <DsPageHeader title="File import" icon="file" />
        <DsNotice tone="bad" title="File import could not be loaded" testId="file-error"
          action={<DsLinkButton href="/account/dropship/integrations" variant="secondary" icon="arrow">Back to integrations</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <FileClient data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
