import { Suspense } from 'react';
import Link from 'next/link';
import { forbidden, notFound } from 'next/navigation';
import { checkSupplierAccess } from '@/lib/distributor/access';
import { getSession } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ProductEditor } from '@/components/backoffice/product-editor';

export const metadata = { title: 'Create product' };

async function NewProductContent({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { supplier } = await searchParams;
  const s = (await getSession())!;
  // item 3: ?supplier=<id> of a supplier that is not assigned → 403 page
  if (supplier) {
    const access = await checkSupplierAccess(s, supplier);
    if (access === 'forbidden') forbidden();
    if (access === 'not_found') notFound();
  }
  return (
    <>
      <PageHeader
        eyebrow={<nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/distributor/products">Products</Link> / New product</nav>}
        title="Create product"
        actions={<Link href="/distributor/products/import" className="btn btn-ghost">Many products? Use Excel</Link>}
      />
      <ProductEditor session={s} productId={null} presetSupplier={supplier} />
    </>
  );
}

// Batch 3 (F-14): the request-time data loads inside a Suspense boundary (Next 16 Cache Components / instant navigation)
export default function NewProduct(props: Parameters<typeof NewProductContent>[0]) {
  return (
    <Suspense fallback={<div className="card p-6 text-ink" role="status">Loading…</div>}>
      <NewProductContent {...props} />
    </Suspense>
  );
}
