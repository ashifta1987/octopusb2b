import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, StatusBadge, EmptyState, Notice, Stat } from '@/components/ui';
import { RunButton } from '@/components/admin/client';
import { confirmHsType, runBackfillPreview, applyBackfill } from './actions';
import { ChangeHeading } from './change-heading';

export const metadata = { title: 'HS codes' };

type T = { id: string; name: string; type_key: string; heading: string | null; confirmed: boolean; source: string; confidence: number | null; reason: string | null; keywords: string[] };

/** Admin → HS codes: product types with their 4-digit heading, how many products use them, Confirm / Change; backfill preview. */
export default async function HsCodesPage() {
  const s = await requireStaff('products', 'approve', '/admin/hs-codes');
  const sb = await createClient();
  const [{ data: types }, { data: prods }, { data: props }] = await Promise.all([
    sb.from('hs_product_types').select('id, name, type_key, heading, confirmed, source, confidence, reason, keywords').order('name'),
    sb.from('products').select('hs_product_type_id, hs_code_status, hs_code_source').is('archived_at', null).limit(10000),
    sb.from('hs_backfill_proposals').select('product_id, heading, source, status, confidence, note, products(sku, title), hs_product_types(name)').order('status'),
  ]);
  const use = new Map<string, { total: number; suggested: number }>();
  for (const p of prods ?? []) { if (!p.hs_product_type_id) continue; const u = use.get(p.hs_product_type_id as string) ?? { total: 0, suggested: 0 }; u.total++; if (p.hs_code_status === 'suggested') u.suggested++; use.set(p.hs_product_type_id as string, u); }
  const count = (st: string) => (prods ?? []).filter((p) => p.hs_code_status === st).length;
  const isAdmin = s.isAdmin; const edit = can(s, 'products', 'approve');
  async function preview(typeId: string, h: string) {
    'use server';
    const c = await createClient();
    const { data } = await c.rpc('hs_type_change_preview', { p_type: typeId, p_heading: h });
    return ((data ?? []) as { sku: string; title: string; current_code: string | null }[]);
  }
  return (
    <>
      <PageHeader title="HS codes" subtitle="4-digit HS headings detected from each product (rules first, then the AI classifier). Confirm a product type to confirm all its products; change a heading to update them all. Codes from the sheet or typed by a person are never changed." />
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Confirmed" value={count('confirmed')} />
        <Stat label="Suggested" value={count('suggested')} hint="filled by a rule or the AI — check and confirm" hintTone={count('suggested') ? 'warn' : undefined} />
        <Stat label="Missing" value={count('missing')} hint="needs manual entry" hintTone={count('missing') ? 'bad' : undefined} />
        <Stat label="Product types" value={(types ?? []).length} />
      </div>

      <Card title="Product types" className="mb-6">
        <Table head={['Product type', 'Heading', 'Source', 'Products', 'Status', '']} empty={<EmptyState title="No product types yet" body="Types appear as products are classified." />}>
          {((types ?? []) as T[]).map((t) => {
            const u = use.get(t.id) ?? { total: 0, suggested: 0 };
            return (
              <tr key={t.id} data-testid="hs-type" data-type={t.type_key}>
                <td className="td"><div className="font-semibold">{t.name}</div>{t.reason && <div className="text-xs text-muted max-w-md">{t.reason}</div>}</td>
                <td className="td mono font-semibold">{t.heading ?? <span className="text-bad">none</span>}</td>
                <td className="td text-sm">{t.source === 'ai' ? `AI${t.confidence != null ? ` · ${Math.round(Number(t.confidence) * 100)}%` : ''}` : t.source === 'seed' ? 'Starter rule' : 'Manual'}</td>
                <td className="td mono text-sm">{u.total}{u.suggested ? <span className="text-warn"> ({u.suggested} suggested)</span> : null}</td>
                <td className="td">{t.confirmed ? <StatusBadge status="confirmed" label="Confirmed" tone="green" /> : t.heading ? <StatusBadge status="suggested" label="Suggested" tone="amber" /> : <StatusBadge status="missing" label="Needs heading" tone="red" />}</td>
                <td className="td">
                  {edit && <div className="flex flex-wrap gap-2 items-start">
                    {!t.confirmed && t.heading && <RunButton className="btn btn-primary btn-sm" action={confirmHsType.bind(null, t.id)} confirm={`Confirm heading ${t.heading} for "${t.name}"? ${u.suggested} suggested product(s) become confirmed.`}>Confirm</RunButton>}
                    <ChangeHeading typeId={t.id} current={t.heading} preview={preview.bind(null, t.id)} />
                  </div>}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Backfill existing products" action={<span className="text-sm text-muted">Preview first — nothing changes until an Admin applies it</span>}>
        <div className="px-6 pb-4 flex flex-wrap gap-3 items-center">
          {edit && <RunButton className="btn btn-ghost btn-sm" action={runBackfillPreview} confirm="Classify every product without an HS code (rules first, then AI for the rest)? Results are a preview only.">{(props ?? []).length ? 'Refresh preview' : 'Build preview'}</RunButton>}
          {isAdmin && (props ?? []).length > 0 && <RunButton className="btn btn-primary btn-sm" action={applyBackfill} confirm={`Apply the previewed HS codes to ${(props ?? []).length} products?`}>Apply to {(props ?? []).length} products</RunButton>}
        </div>
        {(props ?? []).length > 0 ? (
          <Table head={['Product', 'Would receive', 'Type', 'Status', 'Note']}>
            {(props ?? []).map((p) => {
              const prod = (Array.isArray(p.products) ? p.products[0] : p.products) as { sku: string; title: string } | null;
              const ty = (Array.isArray(p.hs_product_types) ? p.hs_product_types[0] : p.hs_product_types) as { name: string } | null;
              return (
                <tr key={p.product_id as string} data-testid="hs-proposal">
                  <td className="td text-sm"><span className="mono text-xs">{prod?.sku}</span><div>{prod?.title}</div></td>
                  <td className="td mono font-semibold">{(p.heading as string) ?? '—'}</td>
                  <td className="td text-sm">{ty?.name ?? '—'}{p.source === 'ai' && p.confidence != null ? <span className="text-muted"> · AI {Math.round(Number(p.confidence) * 100)}%</span> : null}</td>
                  <td className="td"><StatusBadge status={p.status as string} label={p.status === 'confirmed' ? 'Confirmed' : p.status === 'suggested' ? 'Suggested' : 'Missing'} tone={p.status === 'confirmed' ? 'green' : p.status === 'suggested' ? 'amber' : 'red'} /></td>
                  <td className="td text-xs text-muted">{(p.note as string) ?? ''}</td>
                </tr>
              );
            })}
          </Table>
        ) : <div className="px-6 pb-6"><Notice>No preview yet. Build one to see what every product without an HS code would receive.</Notice></div>}
      </Card>
    </>
  );
}

