import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ProductEditor } from '@/components/backoffice/product-editor';

export const metadata = { title: 'Create product' };

export default async function NewProduct({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { supplier } = await searchParams;
  const s = (await getSession())!;
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
