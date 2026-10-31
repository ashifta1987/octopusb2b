import { getSession } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { CatalogScreen } from '@/components/backoffice/catalog-screen';

export const metadata = { title: 'Categories & tags' };

export default async function DistributorCatalog() {
  const s = (await getSession())!;
  return (
    <>
      <PageHeader title="Categories & tags" subtitle="Build the catalogue structure up to 4 levels deep and manage the tags buyers filter by. Also available to Admin under Admin › Categories & tags." />
      <CatalogScreen session={s} />
    </>
  );
}
