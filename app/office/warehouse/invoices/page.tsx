import { Suspense } from 'react';
import { DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { nowMs } from '@/components/admin/server';
import { createClient } from '@/lib/supabase/server';
import { requireInvoiceAccess } from '@/lib/warehouse-w6-server';
import { lastClosedMonth, monthLabel, monthOptions, parseMonth, type InvoiceBoard, type InvoicePreview } from '@/lib/warehouse-w6';
import { InvoicesClient } from './invoices-client';

export const metadata = { title: 'Client invoices · Warehouse' };

/**
 * Warehouse OS · W6 monthly invoice run (§3 step 11 "one monthly invoice lists every charge"): every 3PL client for a month
 * with the charges computed from real events at the rates in effect when they happened. Warehouse admins and Finance
 * preview; Finance issues the proforma (existing document path, one per client and month). Fees that are not set are shown
 * as "not set — not charged" and never billed.
 */
async function Content({ searchParams }: { searchParams: Promise<{ month?: string; org?: string }> }) {
  const access = await requireInvoiceAccess('/office/warehouse/invoices');
  const sp = await searchParams;
  const now = nowMs();
  const options = monthOptions(now);
  const month = parseMonth(sp.month) && options.includes(parseMonth(sp.month)!) ? parseMonth(sp.month)! : lastClosedMonth(now);
  const org = /^[0-9a-f-]{36}$/i.test(sp.org ?? '') ? sp.org! : null;
  const sb = await createClient();
  const [boardRes, previewRes] = await Promise.all([
    sb.rpc('wh_invoice_board', { p_month: month }),
    org ? sb.rpc('wh_invoice_preview', { p_org: org, p_month: month }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (boardRes.error) throw new Error(`Could not load the invoice run: ${boardRes.error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-invoices-page">
      <DsPageHeader title="Client invoices" icon="dollar"
        subtitle={`${monthLabel(month)} · one invoice per client and month, from real receiving, storage, pick and pack, packaging and returns. ${access.issue ? 'You can issue invoices (Finance).' : 'Finance issues the invoices; you can preview them.'}`}
        actions={
          <form method="get" className="flex items-end gap-2" data-testid="wh-inv-month-form">
            <label className="flex flex-col text-[12px] text-muted">
              <span>Month</span>
              <select name="month" defaultValue={month.slice(0, 7)} className="ds-input min-h-[44px]" aria-label="Month">
                {options.map((m) => <option key={m} value={m.slice(0, 7)}>{monthLabel(m)}</option>)}
              </select>
            </label>
            <button type="submit" className="ds-btn ds-btn-secondary">Show</button>
          </form>
        } />
      <InvoicesClient board={boardRes.data as InvoiceBoard} preview={org && !previewRes.error ? (previewRes.data as InvoicePreview) : null}
        previewError={org && previewRes.error ? previewRes.error.message : null} month={month} canIssue={access.issue} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ month?: string; org?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
