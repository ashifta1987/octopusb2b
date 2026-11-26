import { Suspense } from 'react';
import { DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getSupHome, getSupProducts, type SupHome, type SupProducts } from '@/lib/dropship-ds14';
import { SupplierFrame } from './frame';
import { ProductsClient } from './products-client';

export const metadata = { title: 'Products · Supplier portal' };

/** SupplierProducts.html: your products, price and stock, what needs attention. Own supplier only (ds_sup_* RPCs). */
async function Guarded() {
  let home: SupHome | null = null;
  let data: SupProducts | null = null;
  let error: string | null = null;
  try {
    [home, data] = await Promise.all([getSupHome(), getSupProducts()]);
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!home || !data) {
    return (
      <SupplierFrame testId="supplier-products-page">
        <DsPageHeader title="Your products" icon="package" />
        <DsNotice tone="bad" title="The supplier portal could not be opened" testId="supplier-error">{error}</DsNotice>
      </SupplierFrame>
    );
  }
  return <ProductsClient home={home} data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-v2 ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
