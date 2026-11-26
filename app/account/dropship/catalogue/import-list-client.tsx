'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type RefObject } from 'react';
import { DsButton, DsCard, DsEmptyState, DsLinkButton, DsNotice, DsPageHeader, DsTableCard } from '@/components/dropship-ui';
import { money } from '@/lib/format';
import { multiplierText, pct, ruleSummary, storeMoney, ROUNDING_LABEL } from '@/lib/dropship-pricing';
import type { ImportListData } from '@/lib/dropship-ds6';
import { importApplyRuleAction, importBulkAddAction, importRemoveAction } from '../ds6-actions';
import { Ds6Chips, RowStatus } from '../ds6-ui';

const usd = (c: number | null | undefined) => (c == null ? '—' : money(c, 'USD'));

/** CSV → [{ line, model_no, variant }]; header row optional (model_no, variant) */
export function parseImportCsv(text: string): { line: number; model_no: string; variant?: string }[] {
  const out: { line: number; model_no: string; variant?: string }[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let col = 0;
  let varCol = 1;
  lines.forEach((raw, i) => {
    const cells = raw.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!cells.join('')) return;
    if (i === 0 && cells.some((c) => /model/i.test(c))) {
      col = cells.findIndex((c) => /model/i.test(c));
      const v = cells.findIndex((c) => /variant/i.test(c));
      varCol = v;
      return;
    }
    out.push({ line: i + 1, model_no: (cells[col] ?? '').slice(0, 60), ...(varCol >= 0 && cells[varCol] ? { variant: cells[varCol].slice(0, 60) } : {}) });
  });
  return out.slice(0, 500);
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportListClient({ data, marketName }: { data: ImportListData; marketName: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(data.rows.filter((r) => r.variants_included > 0).map((r) => r.product_id)));
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'warn'; title: string; text?: string } | null>(null);
  const [skipped, setSkipped] = useState<{ line: number; model_no: string; reason: string }[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const selectable = data.rows.filter((r) => r.variants_included > 0);
  const chosen = data.rows.filter((r) => selected.has(r.product_id));
  const variantCount = chosen.reduce((a, r) => a + r.variants_included, 0);
  const minBp = data.rules.min_profit_bp;
  const example = useMemo(() => data.rows.find((r) => r.example && r.example.landed && r.example.landed.ok), [data.rows]);
  const currency = data.store?.shop_currency ?? data.rules.store_currency;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.product_id));

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, okTitle: string) =>
    start(async () => {
      const r = await fn();
      setNotice(r.ok ? { tone: 'ok', title: okTitle, text: r.message } : { tone: 'bad', title: 'That didn\u2019t work', text: r.message });
      router.refresh();
    });

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 512 * 1024) { setNotice({ tone: 'bad', title: 'The file is too big', text: 'Use a CSV under 500 KB (up to 500 lines).' }); return; }
    const lines = parseImportCsv(await file.text());
    if (!lines.length) { setNotice({ tone: 'bad', title: 'The file has no lines', text: 'Add one DS model number per line (column model_no).' }); return; }
    start(async () => {
      const r = await importBulkAddAction(lines);
      if (!r.ok) { setNotice({ tone: 'bad', title: 'The file could not be added', text: r.message }); return; }
      setSkipped(r.data.skipped);
      setNotice(r.data.skipped.length
        ? { tone: 'warn', title: `${r.data.skipped.length} of ${r.data.lines} lines were skipped`, text: `${r.data.added} added. ${r.data.skipped.slice(0, 3).map((s) => s.reason).join(' ')}` }
        : { tone: 'ok', title: `${r.data.added} products added`, text: 'They are in your import list now.' });
      router.refresh();
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  const pushHref = `/account/dropship/push?ids=${chosen.map((r) => r.product_id).join(',')}`;
  const header = (
    <DsPageHeader
      title="Import list"
      icon="list"
      subtitle={`Price, edit and push products to your store. Costs are landed to your main market${marketName ? `, ${marketName}` : ''}, with processing included.`}
      actions={
        <>
          <DsLinkButton href="/account/dropship/catalogue" variant="secondary" icon="plus" testId="add-more-products">Add more products</DsLinkButton>
          <DsButton icon="upload" testId="push-selected" disabled={chosen.length === 0} disabledReason="Select products to push."
            onClick={() => router.push(pushHref)}>{`Push selected (${chosen.length})`}</DsButton>
        </>
      }
    />
  );

  if (data.rows.length === 0) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds6-import-list">
        {header}
        <Ds6Chips current="import" counts={data.counts} />
        <DsCard testId="import-list-empty">
          <DsEmptyState title="Your import list is empty" description="Add products from the catalogue to price and push them." icon="list"
            actionLabel="Find products" actionHref="/account/dropship/catalogue" actionIcon="search" />
        </DsCard>
        <BulkCard fileRef={fileRef} onFile={onFile} pending={pending} />
        {notice && <DsNotice tone={notice.tone} title={notice.title} testId="import-notice">{notice.text}</DsNotice>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="ds6-import-list">
      {header}
      <Ds6Chips current="import" counts={data.counts} />
      {notice && <DsNotice tone={notice.tone} title={notice.title} testId="import-notice">{notice.text}</DsNotice>}

      <DsCard testId="import-rule-bar">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-[240px]">
            <span className="ds-label" id="rule-label">Pricing rule</span>
            <p className="m-0 text-[14px] text-[#1A174A]" aria-labelledby="rule-label" data-testid="import-rule-summary">
              {data.rules.saved ? ruleSummary(data.rules) : 'Not saved yet'}{' '}
              <Link href="/account/dropship/pricing" className="text-[#2A6FD1] font-semibold underline">{data.rules.saved ? 'Change' : 'Set your rule'}</Link>
            </p>
          </div>
          <DsButton variant="secondary" icon="refresh" disabled={pending || chosen.length === 0} disabledReason={chosen.length === 0 ? 'Select products first.' : undefined}
            onClick={() => run(() => importApplyRuleAction(chosen.map((r) => r.product_id)), 'Rule applied to the selected products')} testId="apply-rule">Apply rule to selected</DsButton>
          <DsButton variant="secondary" icon="x" disabled={pending || chosen.length === 0} disabledReason={chosen.length === 0 ? 'Select products first.' : undefined}
            onClick={() => run(async () => { const r = await importRemoveAction(chosen.map((x) => x.product_id)); if (r.ok) setSelected(new Set()); return r; }, 'Removed from your import list')} testId="remove-selected">Remove selected</DsButton>
          <span className="text-[13px] text-[#5B6478]" data-testid="selection-count">{`${chosen.length} selected · ${variantCount} variants`}</span>
        </div>
      </DsCard>

      <DsTableCard
        testId="import-table"
        title="Products"
        minWidth={820}
        headers={[
          <input key="all" type="checkbox" aria-label="Select all" className="w-4 h-4 accent-[#2A6FD1]" checked={allOn}
            onChange={() => setSelected(allOn ? new Set() : new Set(selectable.map((r) => r.product_id)))} />,
          'Product', 'Variants', 'Your cost', 'Your price', 'Margin', 'Status',
        ]}
        footer="Out-of-stock products can't be pushed until restocked. Prices below your minimum margin need a new price or a confirmation."
      >
        {data.rows.map((r) => {
          const disabled = r.variants_included === 0;
          const price = r.price_min == null ? '—' : r.price_min === r.price_max ? storeMoney(r.price_min, currency) : `${storeMoney(r.price_min, currency)} – ${storeMoney(r.price_max, currency)}`;
          return (
            <tr key={r.product_id} data-testid={`import-row-${r.model_no}`}>
              <td>
                <input type="checkbox" className="w-4 h-4 accent-[#2A6FD1]" aria-label={`Select ${r.title}`} disabled={disabled}
                  checked={selected.has(r.product_id)} onChange={() => toggle(r.product_id)} />
              </td>
              <td>
                <strong className="text-[#1A174A]">{r.title}{r.only_for_you ? ' · only for you' : ''}</strong>
                <span className="block text-[12px] text-[#5B6478]">
                  {r.model_no} · <Link href={`/account/dropship/import/${r.product_id}`} className="text-[#2A6FD1] underline" data-testid={`edit-${r.model_no}`}>Edit title, images, variants</Link>
                </span>
              </td>
              <td>{r.variants_included}{r.variants_included !== r.variants_total ? ` of ${r.variants_total}` : ''}</td>
              <td>{usd(r.landed_min)}</td>
              <td>{price}{r.price_mode === 'manual' ? <span className="block text-[12px] text-[#5B6478]">Your own price</span> : null}</td>
              <td>{pct(r.lowest_profit_bp)}</td>
              <td><RowStatus ready={r.ready} problems={r.problems} minProfitBp={minBp} testId={`status-${r.model_no}`} /></td>
            </tr>
          );
        })}
      </DsTableCard>

      <BulkCard fileRef={fileRef} onFile={onFile} pending={pending} skipped={skipped} />

      <DsCard title="How pricing works here" icon="info" testId="how-pricing">
        {example && example.example && example.example.landed && example.example.landed.ok ? (
          <ExampleRows ex={example} currency={currency} rules={data.rules} marketName={marketName} />
        ) : (
          <p className="m-0 text-[14px] text-[#5B6478]">
            Your price = landed cost (product + processing + shipping + duties if DDP) × your rule, converted to your store currency and rounded
            ({ROUNDING_LABEL[data.rules.rounding].toLowerCase()}). An example appears when a product in your list can be priced.
          </p>
        )}
      </DsCard>
    </div>
  );
}

function ExampleRows({ ex, currency, rules, marketName }: { ex: ImportListData['rows'][number]; currency: string; rules: ImportListData['rules']; marketName: string | null }) {
  const v = ex.example!;
  const landed = v.landed_usd_cents ?? 0;
  const band = v.rule_band ? rules.bands[v.rule_band - 1] : null;
  return (
    <div data-testid="how-pricing-example">
      <div className="ds-row"><span className="ds-mut">Landed cost{marketName ? ` (${marketName})` : ''}</span><span>{usd(landed)}</span></div>
      {band && <div className="ds-row"><span className="ds-mut">× rule</span><span>{`${multiplierText(band.multiplier_milli)}${band.fixed_cents ? ` + ${usd(band.fixed_cents)}` : ''}`}</span></div>}
      <div className="ds-row"><span className="ds-mut">{v.manual ? 'Your own price' : `Rounded (${ROUNDING_LABEL[rules.rounding].toLowerCase()})`}</span><span>{storeMoney(v.price_minor, currency)}</span></div>
      <div className="ds-row"><span className="ds-mut">Margin</span><span>{pct(v.profit_bp)}</span></div>
      <p className="mt-2 mb-0 text-[12px] text-[#5B6478]">Example: {ex.title}. {currency === 'USD' ? 'Prices are in US$; no exchange rate is needed.' : 'Converted with the exchange rate shown in Pricing and sync.'}</p>
    </div>
  );
}

function BulkCard({ fileRef, onFile, pending, skipped = [] }: { fileRef: RefObject<HTMLInputElement | null>; onFile: (f: File | undefined) => void; pending: boolean; skipped?: { line: number; model_no: string; reason: string }[] }) {
  return (
    <DsCard title="Bulk add by file" icon="upload" testId="bulk-add">
      <p className="mt-0 mb-2 text-[14px] text-[#1A174A]">Add many catalogue products at once with a list of dropship model numbers.</p>
      <label htmlFor="bulk-file" className="flex flex-col items-center justify-center gap-1 min-h-[88px] rounded-[12px] border border-dashed border-[#C9D0DD] bg-[#F7F9FC] p-4 text-[14px] text-[#1A174A] cursor-pointer">
        <span>Drop a CSV here or <span className="text-[#2A6FD1] font-semibold underline">choose a file</span>{pending ? ' · adding…' : ''}</span>
        <input id="bulk-file" ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" data-testid="bulk-file"
          onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <p className="mt-2 mb-0 text-[13px] text-[#5B6478]">
        Columns: model_no, variant (optional).{' '}
        <button type="button" className="text-[#2A6FD1] font-semibold underline bg-transparent border-0 p-0 min-h-[44px] cursor-pointer"
          onClick={() => download('import-list-template.csv', 'model_no,variant\nDS-000001,\n')}>Download the template</button>.
      </p>
      {skipped.length > 0 && (
        <div className="mt-3" data-testid="bulk-skipped">
          <ul className="m-0 pl-5 text-[13px] text-[#1A174A]">
            {skipped.slice(0, 10).map((s) => <li key={`${s.line}-${s.model_no}`}>{`Line ${s.line}: ${s.reason}`}</li>)}
          </ul>
          <DsButton variant="secondary" icon="download" className="mt-2"
            onClick={() => download('skipped-lines.csv', ['line,model_no,reason', ...skipped.map((s) => `${s.line},${s.model_no},"${s.reason.replace(/"/g, '""')}"`)].join('\n'))}>Download skipped lines</DsButton>
        </div>
      )}
    </DsCard>
  );
}
