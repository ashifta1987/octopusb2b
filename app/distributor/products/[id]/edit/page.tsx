import { Suspense } from 'react';
import Link from 'next/link';
import { forbidden, notFound } from 'next/navigation';
import { checkProductAccess } from '@/lib/distributor/access';
import { getSession } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ProductEditor } from '@/components/backoffice/product-editor';

export const metadata = { title: 'Edit product' };

async function EditProductContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  // item 3: another supplier's product → 403 page, an unknown id → 404 (checked before anything is read)
  const access = await checkProductAccess(s, id);
  if (access === 'forbidden') forbidden();
  if (access === 'not_found') notFound();
  return (
    <>
      <PageHeader
        eyebrow={<nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/distributor/products">Products</Link> / Edit</nav>}
        title="Edit product"
      />
      <ProductEditor session={s} productId={id} />
    </>
  );
}

// Batch 3 (F-14): the request-time data loads inside a Suspense boundary (Next 16 Cache Components / instant navigation)
export default function EditProduct(props: Parameters<typeof EditProductContent>[0]) {
  return (
    <Suspense fallback={<div className="card p-6 text-ink" role="status">Loading…</div>}>
      <EditProductContent {...props} />
    </Suspense>
  );
}
