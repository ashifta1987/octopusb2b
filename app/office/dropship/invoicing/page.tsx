import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getInvoices, type InvoicesPage } from '@/lib/dropship-ds14';
import { InvoicingClient } from './invoicing-client';

export const metadata = { title: 'Invoicing · Back office' };

type SP = { type?: string; q?: string; from?: string; to?: string; status?: string };

/**
 * AdminInvoicing.html, view part: OCT-DS invoices, CN-DS credit notes and STMT-DS statements of the Dropship division with filters and
 * a CSV. The legal entity is read from the existing legal entities (edited by admins in Finance). Tax rates by country, the wallet top-up
 * treatment and number prefixes are decisions for the accountant: they are not editable here and nothing is invented.
 */
async function Guarded({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireDropshipV2Staff(false, '/office/dropship/invoicing');
  const clean = (v?: string, re = /^[\w .:@-]{0,80}$/) => (v && re.test(v) ? v : '');
  const f = { type: ['invoice', 'credit_note', 'statement'].includes(sp.type ?? '') ? (sp.type as string) : '', q: clean(sp.q), from: clean(sp.from, /^\d{4}-\d{2}-\d{2}$/), to: clean(sp.to, /^\d{4}-\d{2}-\d{2}$/), status: clean(sp.status) };
  let data: InvoicesPage | null = null;
  let error: string | null = null;
  try { data = await getInvoices(f); } catch (e) { error = rpcMessage(e); }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="staff-invoicing-page">
        <DsPageHeader title="Invoicing" icon="file" />
        <DsNotice tone="bad" title="Invoicing could not be loaded" testId="invoicing-error" action={<DsLinkButton href="/office/dropship/invoicing" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <InvoicingClient data={data} filters={f} />;
}

export default function Page(props: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded {...props} />
    </Suspense>
  );
}
