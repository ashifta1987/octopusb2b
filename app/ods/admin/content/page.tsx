// ODS T9 · Website › Site content (replaces the T8 re-export of app/admin/content/page). Same guard and permissions as
// today (requireStaff('content','view'); edit / create / Admin publish), same reads, same actions (app/admin/content/*).
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { MailDeliverabilityAlert } from '@/components/admin/mail-deliverability';
import { nowMs } from '@/components/admin/server';
import { ContentScreen } from './_components/content-screen';
import { loadContent } from './_lib/data';
import { contentTab, sectionNo } from '../_website/website-core';

export const metadata = { title: 'Site content' };

type SP = Promise<{ tab?: string; page?: string; s?: string; v?: string }>;

async function Content({ searchParams }: { searchParams: SP }) {
  const sess = await requireStaff('content', 'view', '/admin/content');
  const sp = await searchParams;
  const tab = contentTab(sp.tab);
  const now = nowMs();
  const data = await loadContent(tab, { slug: sp.page, nowMs: now });
  return (
    <ContentScreen
      tab={tab}
      data={data}
      perms={{ editable: can(sess, 'content', 'edit'), canCreate: can(sess, 'content', 'create'), isAdmin: sess.isAdmin }}
      sectionNo={sectionNo(sp.s)}
      viewId={sp.v}
      suggestedPublish={new Date(now + 14 * 864e5).toISOString().slice(0, 10)}
      companyAlert={tab === 'company' ? <MailDeliverabilityAlert showOk /> : undefined}
    />
  );
}

export default function ContentPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<ContentScreen tab="terms" data={{ tab: 'terms', loading: true }} perms={{ editable: false, canCreate: false, isAdmin: false }} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
