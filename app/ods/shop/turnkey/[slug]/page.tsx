import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Skeleton } from '@octopus/ui';
import { getShopViewer } from '@/lib/shop/data';
import { findProject, loadIncluded, toProjectProps, turnkeyEnabled } from '../_lib/loaders';
import { OWN_PROJECT_SLUG, isProjectSlug } from '../_lib/turnkey-logic';
import { TurnkeyProjectView } from '../_components/turnkey-project-view';

export const metadata: Metadata = { title: 'Turnkey project', robots: { index: false, follow: false } };

type Params = Promise<{ slug: string }>;

/** ODS T4 · /shop/turnkey/[slug] (slug = turnkey_projects.project_id). */
export default function ShopTurnkeyProjectPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<Skeleton lines={8} label="Loading project" />}>
        <Content params={params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: { params: Params }) {
  const [{ slug }] = await Promise.all([params, getShopViewer()]);
  if (slug === OWN_PROJECT_SLUG) redirect(`/shop/turnkey/${OWN_PROJECT_SLUG}/start`);
  if (!isProjectSlug(slug) || !(await turnkeyEnabled())) notFound();
  const [project, included] = await Promise.all([findProject(slug), loadIncluded()]);
  if (!project) notFound();
  return <TurnkeyProjectView project={toProjectProps(project)} included={included.rows} includedError={included.error} />;
}
