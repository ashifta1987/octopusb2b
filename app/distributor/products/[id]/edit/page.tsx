import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ProductEditor } from '@/components/backoffice/product-editor';

export const metadata = { title: 'Edit product' };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
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
