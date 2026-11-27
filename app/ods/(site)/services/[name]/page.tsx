import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteData } from '@/lib/ods-site';
import { ServicePage } from '../../_components/service-page';
import { siteService } from '../../_components/services';

/** /services/<name> (Part 4.2). Turnkey lives at /turnkey (owner decision D4). */
const NAMES = ['sourcing', 'pools', 'dropship', 'warehouse', 'brand'] as const;

type Params = Promise<{ name: string }>;
const find = (name: string) => ((NAMES as readonly string[]).includes(name) ? siteService(name) : undefined);

export function generateStaticParams() {
  return NAMES.map((name) => ({ name }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { name } = await params;
  const s = find(name);
  if (!s) return { title: 'Not found', robots: { index: false } };
  return { title: s.name, description: s.line, alternates: { canonical: `/services/${name}` } };
}

/** params are URL data: read inside <Suspense> so navigations stay instant (Cache Components). Prerendered per name. */
export default function ServiceRoute({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div aria-busy="true" className="h-[480px] bg-ods-canvas" />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Params }) {
  const { name } = await params;
  const s = find(name);
  if (!s) notFound();
  const { settings } = await getSiteData();
  return <ServicePage service={s} settings={settings} />;
}
