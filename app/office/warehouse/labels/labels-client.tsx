'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsChip, DsEmptyState, DsInput, DsSelect } from '@/components/dropship-ui';
import { Barcode128 } from '@/components/warehouse/barcode';
import { fmtWh, itemText } from '@/lib/warehouse-inbound';
import { PALLET_STATUS, cartonRef, type LabelBoard } from '@/lib/warehouse-putaway';
import { logLabelPrintAction } from '../putaway-actions';
import { logLabelPrintAction as logParcelPrintAction } from '../w4-actions';
import { CARRIER_LABEL, SHIPMENT_STATUS, grams, type ReadyLabel } from '@/lib/warehouse-w4';
import { MsgLine, useRun } from '../wh-run';

export type LabelKind = 'carton' | 'pallet' | 'bin' | 'parcel';
const KIND_TEXT: Record<LabelKind, string> = { carton: 'Carton labels', pallet: 'Pallet labels', bin: 'Bin location labels', parcel: 'Parcel labels' };
const MAX_SHEET = 600;

type Label = { ref: string; wh: string; render: () => ReactNode; title: string; detail: string; printed: number };

/** print only the label sheet (the staff menu, header and controls are hidden on paper) */
const PRINT_CSS = `
@media print {
  @page { margin: 6mm; }
  body * { visibility: hidden !important; }
  #wh-label-sheet, #wh-label-sheet * { visibility: visible !important; }
  #wh-label-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
  .wh-label { break-inside: avoid; page-break-inside: avoid; }
}`;

function LabelBox({ children, size }: { children: ReactNode; size: 'large' | 'small' }) {
  return (
    <div className={`wh-label bg-white text-black border border-black rounded-sm p-3 flex flex-col gap-1.5 overflow-hidden ${size === 'large' ? 'w-[100mm] min-h-[70mm]' : 'w-[100mm] min-h-[45mm]'} max-w-full box-border`}>
      {children}
    </div>
  );
}

export function LabelsClient({ board, initialKind, initialRef, current, warehouseNames, parcelLabels, parcelUrls }: {
  board: LabelBoard; initialKind: LabelKind; initialRef: string | null; current: string | null; warehouseNames: Record<string, string>;
  parcelLabels: ReadyLabel[]; parcelUrls: Record<string, string>;
}) {
  const { pending, msg, run, setMsg } = useRun();
  const [kind, setKind] = useState<LabelKind>(initialKind);
  const places = board.can_print;
  const [wh, setWh] = useState(current && places.includes(current) ? current : places[0] ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(initialRef ? [initialRef] : []));
  const [copies, setCopies] = useState('1');
  const [filter, setFilter] = useState('');
  const whName = (c: string) => warehouseNames[c] ?? c;

  const labels: Label[] = useMemo(() => {
    if (kind === 'bin') {
      return board.bins.filter((b) => b.warehouse_code === wh).map((b) => ({
        ref: b.code, wh: b.warehouse_code, printed: b.printed, title: b.code, detail: [b.zone, b.status === 'blocked' ? 'blocked' : null].filter(Boolean).join(' · '),
        render: () => (
          <LabelBox size="small">
            <div className="flex justify-between text-[11px] uppercase tracking-[.08em]"><span>Bin location</span><span>{whName(b.warehouse_code)}</span></div>
            <div className="text-[34px] font-bold font-mono leading-none tracking-[.04em]">{b.code}</div>
            {b.zone && <div className="text-[12px]">Zone {b.zone}</div>}
            <Barcode128 value={b.code} height={48} showText={false} testId={`wh-barcode-${b.code}`} />
          </LabelBox>
        ),
      }));
    }
    if (kind === 'pallet') {
      return board.pallets.filter((p) => p.warehouse_code === wh).map((p) => ({
        ref: p.code, wh: p.warehouse_code, printed: p.printed, title: p.code,
        detail: [p.owner, p.asn_code, p.bin_code ? `in ${p.bin_code}` : (PALLET_STATUS[p.status]?.[0] ?? p.status)].filter(Boolean).join(' · '),
        render: () => (
          <LabelBox size="large">
            <div className="flex justify-between text-[11px] uppercase tracking-[.08em]"><span>Pallet</span><span>{whName(p.warehouse_code)}</span></div>
            <div className="text-[30px] font-bold font-mono leading-none">{p.code}</div>
            <div className="text-[14px] font-semibold">{p.owner}</div>
            <div className="text-[12px]">{p.asn_code ? `Source ${p.asn_code}` : 'No stock notice'}{p.bin_code ? ` · Bin ${p.bin_code}` : ''}{p.units ? ` · ${p.units} units` : ''}</div>
            <div className="text-[11px]">Built {fmtWh(p.created_at)}</div>
            <Barcode128 value={p.code} height={64} testId={`wh-barcode-${p.code}`} />
          </LabelBox>
        ),
      }));
    }
    if (kind === 'carton') {
      return board.asns.filter((a) => a.warehouse_code === wh).flatMap((a) => a.lines.map((l) => {
        const ref = cartonRef(a.code, l.n);
        return {
          ref, wh: a.warehouse_code, printed: l.printed, title: ref, detail: `${itemText(l.item)} · ${l.qty} units · ${a.owner}`,
          render: () => (
            <LabelBox size="large">
              <div className="flex justify-between text-[11px] uppercase tracking-[.08em]"><span>Carton · {a.code}</span><span>Line {l.n} of {a.lines.length}</span></div>
              <div className="text-[14px] font-semibold">{a.owner}</div>
              <div className="text-[18px] font-bold leading-tight">{itemText(l.item)}</div>
              <div className="text-[12px]">{l.qty} units on the notice{l.lot_code ? ` · ${l.lot_code}` : ''} · {whName(a.warehouse_code)}</div>
              <Barcode128 value={ref} height={64} testId={`wh-barcode-${ref}`} />
            </LabelBox>
          ),
        };
      }));
    }
    return [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, wh, board]);

  const shown = labels.filter((l) => !filter || `${l.title} ${l.detail}`.toUpperCase().includes(filter.toUpperCase()));
  const chosen = labels.filter((l) => selected.has(l.ref));
  const n = Number(copies);
  const sheetCount = chosen.length * (n > 0 ? n : 0);
  const why = chosen.length === 0 ? 'Choose at least one label' : !(n >= 1 && n <= 100) ? 'Print 1 to 100 copies'
    : sheetCount > MAX_SHEET ? `Up to ${MAX_SHEET} labels per sheet (this is ${sheetCount})` : undefined;
  const toggle = (ref: string) => setSelected((s) => { const x = new Set(s); if (x.has(ref)) x.delete(ref); else x.add(ref); return x; });
  const switchKind = (k: LabelKind) => { setKind(k); setSelected(new Set()); setFilter(''); setMsg(null); };

  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <div className="print:hidden flex flex-col gap-5">
        <div role="group" aria-label="Label type" className="flex flex-wrap gap-2" data-testid="wh-label-kinds">
          {(Object.keys(KIND_TEXT) as LabelKind[]).map((k) => (
            <DsChip key={k} pressed={kind === k} onClick={() => switchKind(k)} testId={`wh-label-kind-${k}`}>{KIND_TEXT[k]}</DsChip>
          ))}
        </div>
        {kind === 'parcel' ? (
          <ParcelLabels labels={parcelLabels} urls={parcelUrls} filter={filter} setFilter={setFilter} whName={whName} />
        ) : places.length === 0 ? (
          <DsCard><p className="m-0 text-[13.5px] text-muted">You don’t work at a warehouse here, so you can’t print its labels.</p></DsCard>
        ) : (
          <DsCard title={KIND_TEXT[kind]} icon="file" noPadding testId="wh-label-picker"
            subtitle={kind === 'bin' ? 'Each bin has its own location label.' : kind === 'carton' ? 'One label per stock notice line; print one copy per carton.' : 'Pallet number, owner, source and bin.'}>
            <div className="px-5 py-3 flex flex-wrap gap-3 items-end border-b border-divider">
              {places.length > 1 && (
                <DsSelect label="Warehouse" value={wh} onChange={(e) => { setWh(e.target.value); setSelected(new Set()); }} containerClassName="w-[200px]">
                  {places.map((c) => <option key={c} value={c}>{whName(c)}</option>)}
                </DsSelect>
              )}
              <DsInput label="Find" value={filter} onChange={(e) => setFilter(e.target.value)} containerClassName="w-[200px]" />
              <DsButton variant="link" onClick={() => setSelected(new Set(shown.map((l) => l.ref)))} disabled={shown.length === 0} testId="wh-label-select-all">Select all shown ({shown.length})</DsButton>
              <DsButton variant="link" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear</DsButton>
            </div>
            {shown.length === 0 ? (
              <p className="m-0 px-5 py-4 text-[13.5px] text-muted" data-testid="wh-label-none">
                {kind === 'bin' ? 'No bins here yet. Create them under Putaway › Manage bins.' : kind === 'pallet' ? 'No open or stored pallets here.' : 'No stock notices here.'}
              </p>
            ) : (
              <ul className="list-none m-0 p-0 max-h-[360px] overflow-y-auto" role="list" aria-label={`${KIND_TEXT[kind]} to print`} tabIndex={0}>
                {shown.slice(0, 1000).map((l) => (
                  <li key={l.ref} className="border-b border-divider last:border-0 px-5 py-1.5 flex items-center justify-between gap-2" data-testid={`wh-label-row-${l.ref}`}>
                    <DsCheckbox label={<span><span className="font-mono font-semibold">{l.title}</span>{l.detail ? <span className="text-muted"> · {l.detail}</span> : null}</span>}
                      checked={selected.has(l.ref)} onChange={() => toggle(l.ref)} />
                    {l.printed > 0 && <DsBadge tone="neutral">Printed {l.printed}×</DsBadge>}
                  </li>
                ))}
              </ul>
            )}
            <div className="px-5 py-3 flex flex-wrap gap-3 items-end border-t border-divider">
              <DsInput label="Copies of each" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, '').slice(0, 3))} containerClassName="w-[140px]" />
              <DsButton icon="file" disabled={pending || Boolean(why)} disabledReason={chosen.length ? why : undefined} testId="wh-label-print"
                onClick={() => run(() => logLabelPrintAction(wh, kind, chosen.map((l) => l.ref), n), () => { window.print(); })}>
                {chosen.some((l) => l.printed > 0) ? 'Reprint' : 'Print'} {chosen.length || ''} label{chosen.length === 1 ? '' : 's'}
              </DsButton>
              <MsgLine msg={msg} testId="wh-label-msg" />
            </div>
          </DsCard>
        )}
      </div>

      {kind !== 'parcel' && chosen.length > 0 && !why && (
        <section id="wh-label-sheet" aria-label="Label sheet preview" className="ds-card flex flex-wrap gap-3" data-testid="wh-label-sheet">
          {chosen.flatMap((l) => Array.from({ length: n }, (_, i) => <div key={`${l.ref}-${i}`}>{l.render()}</div>))}
        </section>
      )}

      <div className="print:hidden">
        <DsCard title="Print log" icon="clock" noPadding testId="wh-label-log" subtitle="Who printed which labels, and how many copies.">
          {board.prints.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-muted">Nothing printed yet.</p> : (
            <ul className="list-none m-0 p-0">
              {board.prints.map((p) => (
                <li key={p.id} className="border-b border-divider last:border-0 px-5 py-2 text-[13.5px]">
                  <span className="font-mono font-semibold">{p.ref}</span> · {p.kind} · {p.copies} cop{p.copies === 1 ? 'y' : 'ies'}
                  <span className="text-muted"> · {p.by_name ?? 'staff'} · {fmtWh(p.created_at)} · {whName(p.warehouse_code)}</span>
                </li>
              ))}
            </ul>
          )}
        </DsCard>
      </div>
    </div>
  );
}

/** W4: carrier parcel labels (made at Dispatch and freight); each opens its PDF to print, and every print is logged. */
function ParcelLabels({ labels, urls, filter, setFilter, whName }: {
  labels: ReadyLabel[]; urls: Record<string, string>; filter: string; setFilter: (v: string) => void; whName: (c: string) => string;
}) {
  const shown = labels.filter((l) => !filter || `${l.tracking_no} ${l.order_code}`.toUpperCase().includes(filter.toUpperCase()));
  return (
    <DsCard title="Parcel labels" icon="file" noPadding testId="wh-label-parcel"
      subtitle="Carrier labels made at Dispatch and freight (last 30 days, and every label not handed over yet). Print opens the 10 × 15 cm PDF.">
      <div className="px-5 py-3 flex flex-wrap gap-3 items-end border-b border-divider">
        <DsInput label="Find" value={filter} onChange={(e) => setFilter(e.target.value)} containerClassName="w-[220px]" />
      </div>
      {shown.length === 0 ? (
        <div className="px-5 py-4"><DsEmptyState icon="package" title="No parcel labels yet" description="Make labels for packed orders under Dispatch and freight." actionLabel="Open Dispatch and freight" actionHref="/office/warehouse/dispatch" actionIcon="truck" /></div>
      ) : (
        <ul className="list-none m-0 p-0 max-h-[480px] overflow-y-auto" role="list" aria-label="Parcel labels" tabIndex={0}>
          {shown.map((l) => (
            <li key={l.id} className="border-b border-divider last:border-0 px-5 py-2 flex flex-wrap items-center gap-2" data-testid={`wh-parcel-label-${l.tracking_no}`}>
              <span className="font-mono font-semibold">{l.tracking_no}</span>
              <span className="text-[13px] text-muted">{l.order_code} · parcel {l.parcel_seq} · {CARRIER_LABEL[l.carrier]} {l.service_name} · {grams(l.weight_g)} · to {l.ship_country} · {whName(l.warehouse_code)}</span>
              {l.sandbox && <DsBadge tone="warn">Sandbox</DsBadge>}
              <DsBadge tone={SHIPMENT_STATUS[l.status][1]}>{SHIPMENT_STATUS[l.status][0]}</DsBadge>
              {l.printed > 0 && <DsBadge tone="neutral">Printed {l.printed}×</DsBadge>}
              {urls[l.label_path] ? (
                <a href={urls[l.label_path]} target="_blank" rel="noreferrer" className="ds-btn ds-btn-secondary ml-auto" onClick={() => { void logParcelPrintAction(l.id); }}
                  data-testid={`wh-parcel-label-print-${l.tracking_no}`}>
                  {l.printed > 0 ? 'Reprint' : 'Print'}<span className="sr-only"> label {l.tracking_no} (opens the PDF)</span>
                </a>
              ) : <span className="ml-auto text-[12.5px] text-muted">PDF not available</span>}
            </li>
          ))}
        </ul>
      )}
    </DsCard>
  );
}
