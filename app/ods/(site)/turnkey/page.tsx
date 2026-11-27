import type { Metadata } from 'next';
import { getSiteData } from '@/lib/ods-site';
import { ServicePage } from '../_components/service-page';
import { siteService } from '../_components/services';

const s = siteService('turnkey')!;

export const metadata: Metadata = { title: s.name, description: s.line, alternates: { canonical: '/turnkey' } };

/** /turnkey — Turnkey projects, same layout as the other service pages (owner decision D4 keeps the URL). */
export default async function TurnkeyRoute() {
  const { settings } = await getSiteData();
  return <ServicePage service={s} settings={settings} />;
}
