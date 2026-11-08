import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { fmtDate } from '@/lib/format';
import { getGroupBuyTerms } from '@/components/store/data';
import { Breadcrumbs, JsonLd, breadcrumbLd, Prose } from '@/components/store/seo';

export const metadata: Metadata = {
  title: 'Group Buy Terms',
  description: 'Terms for group-buying pools on Octopus B2B: pledges, deposits held in escrow, pool price, deadlines, withdrawal, balance payment and shipping.',
  alternates: { canonical: '/pools/terms' },
};

/** Group Buy Terms (SPEC §18 item 10) — the published `terms_versions` row with kind = 'group_buy'. */
export default function GroupBuyTermsPage() {
  return (
    <Suspense fallback={<div className="max-w-[860px] mx-auto px-4 sm:px-8 py-10"><div className="card h-[480px]" /></div>}>
      <Terms />
    </Suspense>
  );
}

async function Terms() {
  const t = await getGroupBuyTerms();
  const crumbs = [{ name: 'Home', href: '/' }, { name: 'Group buying pools', href: '/pools' }, { name: 'Group Buy Terms', href: '/pools/terms' }];
  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-8 py-8">
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs items={crumbs} />
      <h1 className="text-[30px] sm:text-[36px] font-extrabold mt-4">Group Buy Terms</h1>
      {t ? (
        <>
          <p className="text-sm text-muted mt-2">Version <span className="mono">{t.version}</span>{t.published_at && <> · published {fmtDate(t.published_at)}</>}. Every pledge records the version you agreed to.</p>
          <ol className="mt-8 space-y-8">
            {t.sections.map((s) => (
              <li key={s.no} id={`s${s.no}`} className="scroll-mt-6">
                <h2 className="text-[20px] font-bold mb-3">{s.no}. {s.title}</h2>
                <Prose text={s.body} />
              </li>
            ))}
          </ol>
        </>
      ) : <p className="text-muted mt-4">The Group Buy Terms are being prepared.</p>}
      <p className="text-sm text-muted mt-10">These terms apply in addition to our general <Link href="/legal/terms" className="text-coral-text font-semibold">Terms &amp; Conditions</Link>. <Link href="/pools" className="text-coral-text font-semibold">Browse open pools</Link>.</p>
    </div>
  );
}
