import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs, Skeleton } from '@octopus/ui';
import { getShopViewer } from '@/lib/shop/data';
import { shopCan, ROLE_REASON } from '@/lib/shop/shared';
import { submitEnquiryAction } from '@/app/account/turnkey/actions';
import { findProject, turnkeyEnabled } from '../../_lib/loaders';
import { OWN_PROJECT_SLUG, TURNKEY_DRAFT_REASON, TURNKEY_FILES_REASON, isProjectSlug } from '../../_lib/turnkey-logic';
import { TurnkeyStartForm } from '../../_components/start-form';

export const metadata: Metadata = { title: 'Start a turnkey project', robots: { index: false, follow: false } };

type Params = Promise<{ slug: string }>;

/**
 * ODS T4 · /shop/turnkey/[slug]/start (and /shop/turnkey/new/start for "my own project"). Sends through TODAY's
 * submitEnquiryAction → tk_submit_enquiry: creates the project at "Enquiry" in My account › Turnkey projects.
 */
export default function ShopTurnkeyStartPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<Skeleton lines={8} label="Loading form" />}>
        <Content params={params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: { params: Params }) {
  const [{ slug }, viewer] = await Promise.all([params, getShopViewer()]);
  if (!isProjectSlug(slug) || !(await turnkeyEnabled())) notFound();
  const own = slug === OWN_PROJECT_SLUG;
  const project = own ? null : await findProject(slug);
  if (!own && !project) notFound();
  const country = viewer.org.country && /^[A-Z]{2}$/.test(viewer.org.country) ? viewer.org.country : '';
  const title = project ? project.title : 'My own project';
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Shop', href: '/shop' },
          { label: 'Turnkey projects', href: '/shop/turnkey' },
          ...(project ? [{ label: project.title, href: `/shop/turnkey/${encodeURIComponent(project.project_id)}` }] : []),
          { label: 'Start' },
        ]}
      />
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-ods-h1 text-ods-navy">Start a turnkey project: {title}</h1>
        <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">Tell us your plan. Sending the request is free.</p>
      </header>
      <TurnkeyStartForm
        project={project ? { id: project.project_id, title: project.title } : null}
        defaultCountry={country}
        submit={submitEnquiryAction}
        files={{ enabled: false, reason: TURNKEY_FILES_REASON }}
        draftDisabledReason={TURNKEY_DRAFT_REASON}
        blockedReason={shopCan(viewer.role) ? undefined : ROLE_REASON}
      />
    </div>
  );
}
