import { Suspense } from 'react';
import { DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getSupSubmission, type SupSubmissionFull } from '@/lib/dropship-ds14';
import { SupplierFrame } from '../../frame';
import { NewProductClient } from './new-client';

export const metadata = { title: 'Add product · Supplier portal' };

/** SupplierNewProduct.html. ?edit=<id> reopens a draft or a product staff asked changes on. */
async function Guarded({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  let existing: SupSubmissionFull | null = null;
  if (edit && /^[0-9a-f-]{36}$/i.test(edit)) {
    try { existing = await getSupSubmission(edit); } catch (e) {
      return (
        <SupplierFrame testId="supplier-new-product-page">
          <DsPageHeader title="Add product" icon="plus" />
          <DsNotice tone="bad" title="This product could not be opened">{rpcMessage(e)}</DsNotice>
        </SupplierFrame>
      );
    }
  }
  return <NewProductClient existing={existing} />;
}

export default function Page(props: { searchParams: Promise<{ edit?: string }> }) {
  return (
    <Suspense fallback={<div className="ds-v2 ds-card"><DsSkeleton immediate /></div>}>
      <Guarded {...props} />
    </Suspense>
  );
}
