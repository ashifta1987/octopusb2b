import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { tkImageUrl } from '@/lib/turnkey/format';
import { EmptyState } from '@/components/ui';
import { RailSkeleton, TurnkeyCard } from '@/components/shop/rails';

export const metadata: Metadata = { title: 'Turnkey projects', alternates: { canonical: '/turnkey/catalogue' } };

/** CH-1 /shop/turnkey: the owner's turnkey catalogue (getTurnkeyCatalogue, same as /turnkey/catalogue) inside the shop shell.
 *  "Start" opens the existing in-app enquiry (/account/turnkey/new?project=…) with the same sign-in. */
export default function ShopTurnkey({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return <Suspense fallback={<RailSkeleton title="turnkey projects" n={6} />}><Content searchParams={searchParams} /></Suspense>;
}

const PER = 24;
async function Content({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [{ settings }, { projects }, sp] = await Promise.all([getSiteContent(), getTurnkeyCatalogue(), searchParams]);
  if (settings['turnkey.enabled'] === false) notFound();
  const pages = Math.max(1, Math.ceil(projects.length / PER));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const list = projects.slice((page - 1) * PER, page * PER);
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6">
      <h1 className="m-0 text-[28px] sm:text-[34px] font-bold">Turnkey projects</h1>
      <p className="m-0 mt-1 text-[15px] text-black">From idea to delivered stock: design, sourcing, samples, QC, packaging and shipping.</p>
      <div className="mt-6">
        {list.length === 0 ? <div className="card"><EmptyState title="No projects listed yet" body="Tell us what you want to build and we plan it with you." action={<Link href="/account/turnkey/new" className="btn btn-primary">Start a project</Link>} /></div> : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none m-0 p-0" data-testid="turnkey-list">
            {list.map((p) => <li key={p.project_id}><TurnkeyCard p={p} image={tkImageUrl(p.hero_image_path, sb)} /></li>)}
          </ul>
        )}
      </div>
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-center gap-2">
          {page > 1 && <Link href={`/shop/turnkey?page=${page - 1}`} className="btn btn-ghost btn-sm" rel="prev">Previous</Link>}
          <span className="text-[14px] text-muted px-2">Page {page} of {pages}</span>
          {page < pages && <Link href={`/shop/turnkey?page=${page + 1}`} className="btn btn-ghost btn-sm" rel="next">Next</Link>}
        </nav>
      )}
    </div>
  );
}
