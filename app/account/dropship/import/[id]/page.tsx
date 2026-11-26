import { Suspense } from 'react';
import Link from 'next/link';
import { DsCard, DsEmptyState, DsNotice, DsSkeleton, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { getListing, rpcMessage, type ListingState } from '@/lib/dropship-ds6';
import { COUNTRY_NAMES } from '@/lib/format';
import { EditorClient } from './editor-client';

export const metadata = { title: 'Product editor · Octopus Dropship' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Release 2 · Step 6 — merchant product editor (screens/ProductEditor.html, mobile/M_ProductEditor.html).
 * The merchant's own copy for their store (ds_listing_get / ds_listing_save); the Octopus product never changes.
 */
async function Editor({ params }: { params: Promise<{ id: string }> }) {
  await requireDropshipV2Merchant('/account/dropship/import');
  const { id } = await params;
  let st: ListingState | null = null;
  let error: string | null = null;
  if (UUID.test(id)) {
    try {
      st = await getListing(id);
    } catch (e) {
      error = rpcMessage(e);
    }
  }
  const crumb = (
    <nav aria-label="Breadcrumb" className="text-[13px] text-[#5B6478]">
      <Link href="/account/dropship/catalogue?list=1" className="text-[#2A6FD1] underline">Import list</Link>
      {st ? ` / ${st.title}` : ''}
    </nav>
  );
  if (!st) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds6-editor">
        {crumb}
        <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">Edit before pushing</h1>
        {error ? (
          <DsNotice tone="bad" title="This product could not be loaded" testId="editor-error"
            action={<DsLinkButton href="/account/dropship/catalogue?list=1" variant="secondary">Back to import list</DsLinkButton>}>{error}</DsNotice>
        ) : (
          <DsCard testId="editor-not-found">
            <DsEmptyState title="This product isn't in your import list" description="Add it from Find products first, then edit your store copy here."
              icon="list" actionLabel="Find products" actionHref="/account/dropship/catalogue" />
          </DsCard>
        )}
      </div>
    );
  }
  return <EditorClient st={st} crumb={crumb} marketName={st.market ? (COUNTRY_NAMES[st.market] ?? st.market) : null} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Editor params={params} />
    </Suspense>
  );
}
