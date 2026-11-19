import Link from 'next/link';
import { forbidden, notFound } from 'next/navigation';
import { checkProductAccess } from '@/lib/distributor/access';
import { getSession } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ProductEditor } from '@/components/backoffice/product-editor';

export const metadata = { title: 'Edit product' };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
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
