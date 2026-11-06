'use client';
import { useMemo, useState } from 'react';
import { suggestProductId } from '@/lib/import/product-id';

type SupplierOpt = { id: string; code: string | null; legal_name: string | null; external_id: string | null };

/** ADDON-29: download the bulk-update template (blank or pre-filled) + "Generate Product Ids" helper. */
export function TemplateCard({ suppliers }: { suppliers: SupplierOpt[] }) {
  const [supplier, setSupplier] = useState('');
  const [prefix, setPrefix] = useState('');
  const [models, setModels] = useState('');
  const [copied, setCopied] = useState(false);
  const ext = suppliers.find((s) => s.id === supplier)?.external_id ?? '';
  const ids = useMemo(() => {
    const seen = new Map<string, number>();
    return models.split('\n').map((m) => m.trim()).filter(Boolean).map((m) => {
      const base = suggestProductId(prefix || ext, m);
      if (!base) return { model: m, id: '' };
      const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      return { model: m, id: n > 1 ? `${base}-${n}` : base };
    });
  }, [models, prefix, ext]);

  return (
    <div className="grid gap-6 px-6 pb-6 lg:grid-cols-2">
      <form method="get" action="/admin/import/template" className="space-y-3">
        <label className="block">
          <span className="label">Supplier to pre-fill</span>
          <select name="supplier" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">— none (empty Supplier sheet) —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{[s.code, s.external_id, s.legal_name].filter(Boolean).join(' · ')}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="kind" value="blank" className="btn btn-ghost">Blank template</button>
          <button type="submit" name="kind" value="prefilled" className="btn btn-primary" disabled={!supplier}
            title={supplier ? undefined : 'Choose a supplier first'}>Template pre-filled with existing products</button>
        </div>
        <p className="text-sm text-muted">
          Save the workbook as .xlsx. Put image files in a separate .zip (any folder structure). Filenames must match the Image file column exactly, including case.
        </p>
      </form>

      <div className="space-y-3">
        <div className="text-sm font-semibold">Generate Product Ids</div>
        <label className="block">
          <span className="label">Supplier external id</span>
          <input className="input mono" placeholder={ext || 'CN-GD-BWJ-0010'} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Factory models (one per line)</span>
          <textarea className="input mono" rows={4} value={models} onChange={(e) => setModels(e.target.value)} placeholder={'F8\nP10 Humidifier'} />
        </label>
        {ids.length > 0 && (
          <>
            <pre className="mono max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs" data-testid="generated-ids">{ids.map((r) => r.id || `(needs supplier id) ${r.model}`).join('\n')}</pre>
            <button type="button" className="btn btn-ghost" onClick={async () => {
              await navigator.clipboard.writeText(ids.map((r) => r.id).join('\n'));
              setCopied(true); setTimeout(() => setCopied(false), 1500);
            }}>{copied ? 'Copied' : 'Copy Product Ids'}</button>
          </>
        )}
      </div>
    </div>
  );
}

