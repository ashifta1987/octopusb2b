import { requireStaff } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { CatalogScreen } from '@/components/backoffice/catalog-screen';

export const metadata = { title: 'Categories & tags' };

export default async function AdminCatalog() {
  const s = await requireStaff('catalog', 'view', '/admin/catalog');
  return (
    <>
      <PageHeader title="Categories & tags" subtitle="Build the catalogue structure up to 4 levels deep and manage the tags buyers filter by. Distributors manage the same tree in their panel." />
      <CatalogScreen session={s} />
    </>
  );
}
