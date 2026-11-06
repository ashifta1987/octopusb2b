import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table } from '@/components/ui';
import { Field, CountryTag } from '@/components/admin/ui';
import { ActionForm, RunButton, ToggleSetting } from '@/components/admin/client';
import { COUNTRY_NAMES, fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { createSupplier, updateSupplier, setSwitch, setArchived } from './actions';
import { setCanonicalName } from '../import/actions';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Suppliers' };

const SWITCHES: { key: string; label: string }[] = [
  { key: 'portal_login', label: 'Portal login' }, { key: 'product_upload', label: 'Product upload' }, { key: 'rfq_replies', label: 'RFQ replies' },
  { key: 'listings_live', label: 'Listings live' }, { key: 'ai_tools', label: 'AI tools' },
];
type Sup = Record<string, unknown> & { id: string; code: string; legal_name: string; country: string; verified: boolean; archived_at: string | null; created_at: string };

/** Admin → Suppliers: legal details, contacts, verification and on/off switches (staff only — buyers never see these). */
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ id?: string; new?: string; q?: string; archived?: string }> }) {
  const s = await requireStaff('suppliers', 'view', '/admin/suppliers');
  const sp = await searchParams;
  const sb = await createClient();
  let q = sb.from('suppliers').select('*, supplier_switches(*)').order('code');
  if (!sp.archived) q = q.is('archived_at', null);
  const [{ data }, { data: counts }] = await Promise.all([q, sb.from('products').select('supplier_id, status').limit(20000)]);
  let list = (data ?? []) as (Sup & { supplier_switches: Record<string, boolean> | Record<string, boolean>[] | null })[];
  if (sp.q) { const t = sp.q.toLowerCase(); list = list.filter((x) => `${x.code} ${x.legal_name} ${x.country} ${x.city ?? ''}`.toLowerCase().includes(t)); }
  const prodCount = new Map<string, { live: number; total: number; review: number }>();
  (counts ?? []).forEach((p) => { const a = prodCount.get(p.supplier_id) ?? { live: 0, total: 0, review: 0 }; if (p.status !== 'archived') a.total++; if (p.status === 'live') a.live++; if (p.status === 'submitted' || p.status === 'in_review') a.review++; prodCount.set(p.supplier_id, a); });
  const sel = sp.new ? null : list.find((x) => x.id === sp.id) ?? null;
  // ADDON-27: legal-name variants collected by bulk imports — one must be chosen before the supplier's products can be published
  const { data: variants } = sel ? await sb.from('supplier_name_variants').select('id, variant_name, variant_address, seen_in, is_canonical').eq('supplier_id', sel.id).order('created_at') : { data: [] };
  const needsIdentity = sel?.identity_status === 'needs_identity_review';
  const edit = can(s, 'suppliers', 'edit');
  const countries = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
  const sw = (x: (typeof list)[number]) => (Array.isArray(x.supplier_switches) ? x.supplier_switches[0] : x.supplier_switches) ?? {};

  return (
    <>
      <PageHeader title="Suppliers" subtitle="Legal names, contacts and verification are staff-only. Buyers see suppliers only as code + country + verified badge."
        actions={can(s, 'suppliers', 'create') && <Link href="/admin/suppliers?new=1" className="btn btn-primary">+ Add supplier</Link>} />

      <form action="/admin/suppliers" className="flex flex-wrap gap-3 mb-6">
        <label htmlFor="sq" className="sr-only">Search suppliers</label>
        <input id="sq" name="q" defaultValue={sp.q ?? ''} className="input max-w-sm" placeholder="Search code, name, country" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={!!sp.archived} /> Include archived</label>
        <button className="btn btn-ghost" type="submit">Search</button>
      </form>

      {sel && (variants ?? []).length > 0 && (
        <Card title="Legal-name variants" className="mb-6">
          <div className="px-6 pb-6 grid gap-3">
            {needsIdentity
              ? <Notice tone="amber"><b>{(variants ?? []).length} legal names in use — resolve before the first order ships.</b> None of this supplier&apos;s imported products can be published until you choose the entity that signs contracts.</Notice>
              : <Notice tone="green">Canonical legal name chosen: <b>{String(sel.legal_name)}</b></Notice>}
            <ul className="grid gap-2">
              {(variants ?? []).map((v) => (
                <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 border border-line rounded-[10px] px-4 py-3">
                  <div className="text-sm"><div className="font-semibold">{v.variant_name} {v.is_canonical && <StatusBadge status="canonical" tone="green" label="Canonical" />}</div>
                    {v.variant_address && <div className="text-muted">{v.variant_address}</div>}<div className="text-xs text-muted">Seen in: {String(v.seen_in ?? '').replace(/_/g, ' ')}</div></div>
                  {edit && !v.is_canonical && <RunButton className="btn btn-ghost btn-sm" confirm={`Make "${v.variant_name}" the canonical legal name? It becomes the supplier's legal name on contracts and documents.`} action={setCanonicalName.bind(null, sel.id, v.id)}>Use this name</RunButton>}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
      {(sp.new || sel) && (
        <Card title={sel ? `Edit ${sel.code}` : 'New supplier'} className="mb-6" action={<Link href="/admin/suppliers" className="text-sm text-blue">Close</Link>}>
          <ActionForm key={sel?.id ?? 'new'} action={sel ? updateSupplier : createSupplier} className="px-6 pb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" submitLabel={sel ? 'Save supplier' : 'Create supplier'} hideSubmit={sel ? !edit : false} resetOnSuccess={!sel}>
            {sel && <input type="hidden" name="id" value={sel.id} />}
            <Field label="Legal name" htmlFor="su-name" className="lg:col-span-2"><input id="su-name" name="legal_name" className="input" required defaultValue={String(sel?.legal_name ?? '')} /></Field>
            <Field label="Country" htmlFor="su-country">
              <select id="su-country" name="country" className="input" required defaultValue={String(sel?.country ?? '')}>
                <option value="" disabled>Select…</option>{countries.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
              </select>
            </Field>
            <Field label="City" htmlFor="su-city"><input id="su-city" name="city" className="input" defaultValue={String(sel?.city ?? '')} /></Field>
            <Field label="Type" htmlFor="su-type">
              <select id="su-type" name="supplier_type" className="input" defaultValue={String(sel?.supplier_type ?? 'Manufacturer')}>
                {['Manufacturer', 'Wholesaler', 'Trading company', '3PL partner', 'Service partner'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Main categories" htmlFor="su-cats"><input id="su-cats" name="main_categories" className="input" defaultValue={String(sel?.main_categories ?? '')} /></Field>
            <Field label="Contact name" htmlFor="su-cn"><input id="su-cn" name="contact_name" className="input" defaultValue={String(sel?.contact_name ?? '')} /></Field>
            <Field label="Contact email" htmlFor="su-ce"><input id="su-ce" name="contact_email" type="email" className="input" defaultValue={String(sel?.contact_email ?? '')} /></Field>
            <Field label="Contact phone" htmlFor="su-cp"><input id="su-cp" name="contact_phone" className="input" defaultValue={String(sel?.contact_phone ?? '')} /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" name="verified" defaultChecked={!!sel?.verified} /> Verified supplier (badge shown to buyers)</label>
          </ActionForm>
          {sel && edit && (
            <div className="px-6 pb-5">
              <RunButton confirm={sel.archived_at
                ? 'Restore this supplier? Products archived with it come back: live ones as paused (resume them in Moderation), ones that were in moderation go back to the queue, drafts stay drafts.'
                : (() => { const c = prodCount.get(sel.id); return c?.total ? `Archive ${sel.code}? All ${c.total} of its products will be archived too — ${c.live} live, ${c.review} in moderation, ${c.total - c.live - c.review} other. They disappear from the storefront, the moderation queue and the distributor portal. You can restore the supplier later.` : `Archive ${sel.code}? It has no active products.`; })()} action={setArchived.bind(null, sel.id, !sel.archived_at)}>{sel.archived_at ? 'Restore supplier' : 'Archive supplier'}</RunButton>
            </div>
          )}
        </Card>
      )}

      <Card title="All suppliers" action={<span className="mono text-xs text-muted">{list.length} suppliers</span>}>
        <Table head={['Supplier', 'Contact', 'Products', 'Verified', ...SWITCHES.map((x) => x.label), '']} empty={<EmptyState title="No suppliers match" />}>
          {list.map((x) => {
            const swv = sw(x);
            const pc = prodCount.get(x.id) ?? { live: 0, total: 0 };
            return (
              <tr key={x.id} className={cn(sel?.id === x.id && 'bg-blue-soft', x.archived_at && 'opacity-60')}>
                <td className="td"><div className="font-semibold">{x.legal_name}</div><div className="flex items-center gap-2 text-xs text-muted"><span className="mono">{x.code}</span><CountryTag code={x.country} />{String(x.city ?? '')}{x.archived_at && <StatusBadge status="archived" />}</div></td>
                <td className="td text-sm">{String(x.contact_name ?? '—')}<div className="mono text-xs text-muted">{String(x.contact_email ?? '')}</div></td>
                <td className="td text-sm">{pc.live} live / {pc.total}</td>
                <td className="td"><StatusBadge status={x.verified ? 'verified' : 'pending'} label={x.verified ? 'Verified' : 'Not verified'} /></td>
                {SWITCHES.map((k) => (
                  <td key={k.key} className="td">
                    <ToggleSetting checked={swv[k.key] !== false} label={`${k.label} · ${x.code}`} disabled={!edit} onToggle={setSwitch.bind(null, x.id, k.key)} />
                  </td>
                ))}
                <td className="td text-right"><Link href={`/admin/suppliers?id=${x.id}`} className="btn btn-ghost btn-sm">Edit</Link><div className="text-xs text-muted mt-1">since {fmtDate(x.created_at)}</div></td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
