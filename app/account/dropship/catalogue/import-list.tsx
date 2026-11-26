import { COUNTRY_NAMES } from '@/lib/format';
import { DsNotice, DsLinkButton } from '@/components/dropship-ui';
import { getImportList, rpcMessage, type ImportListData } from '@/lib/dropship-ds6';
import { ImportListClient } from './import-list-client';

/**
 * Release 2 · Step 6 — Import list (screens/ImportList.html, mobile/M_ImportList.html, states/States-Import.html).
 * Route: /account/dropship/catalogue?list=1 (the catalogue page hands over here). Data: ds_import_list().
 */
export async function ImportListPage() {
  let data: ImportListData | null = null;
  let error: string | null = null;
  try {
    data = await getImportList();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds6-import-list">
        <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">Import list</h1>
        <DsNotice tone="bad" title="Your import list could not be loaded" testId="import-list-error"
          action={<DsLinkButton href="/account/dropship/catalogue?list=1" variant="secondary" icon="refresh">Try again</DsLinkButton>}>
          {error ?? 'Please try again in a moment.'}
        </DsNotice>
      </div>
    );
  }
  const marketName = data.market ? (COUNTRY_NAMES[data.market] ?? data.market) : null;
  return <ImportListClient data={data} marketName={marketName} />;
}
