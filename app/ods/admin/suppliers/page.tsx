// ODS T9 · Catalogue › Suppliers. Replaces the T8 re-export of app/admin/suppliers/page.tsx inside the ODS Back Office frame.
// Same guard (requireStaff('suppliers','view')), the same reads as today (suppliers + switches, product counts with the
// hidden products.supplier_id via withHiddenColumns, legal-name variants and the Admin-only delete preview for the
// selected supplier), today's actions unchanged (create / update / setSwitch / setArchived / deleteSupplier /
// setCanonicalName). Create shows with suppliers:create, edits with suppliers:edit, delete for Admins — as today.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { COUNTRY_NAMES } from '@/lib/format';
import { createSupplier, updateSupplier, setSwitch, setArchived, deleteSupplier } from '@/app/admin/suppliers/actions';
import { setCanonicalName } from '@/app/admin/import/actions';
import { supplierProductCounts } from '../_catalogue/core';
import { SuppliersScreen, type DelPreview, type SupplierRow, type Variant } from './_components/suppliers-screen';

export const metadata = { title: 'Suppliers' };

const ACTIONS = { create: createSupplier, update: updateSupplier, setSwitch, setArchived, remove: deleteSupplier, setCanonical: setCanonicalName };
type SP = Promise<{ id?: string; new?: string; q?: string; archived?: string }>;
const COUNTRIES = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])) as [string, string][];

async function SuppliersContent({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('suppliers', 'view', '/admin/suppliers');
  const sp = await searchParams;
  const sb = await createClient();
  let q = sb.from('suppliers').select('*, supplier_switches(*)').order('code');
  if (!sp.archived) q = q.is('archived_at', null);
  const [{ data, error }, { data: countRows }] = await Promise.all([q, sb.from('products').select('id, status').limit(20000)]);
  // products.supplier_id is hidden from session reads (migration 195): added with the service role for the rows RLS returned — as today
  const counts = supplierProductCounts(await withHiddenColumns<{ id: string; status: string }, { supplier_id: string }>('products', countRows, 'supplier_id'));
  const rows: SupplierRow[] | null = error
    ? null
    : ((data ?? []) as Record<string, unknown>[]).map((x) => {
        const sw = (Array.isArray(x.supplier_switches) ? x.supplier_switches[0] : x.supplier_switches) as Record<string, boolean> | null;
        return {
          id: String(x.id), code: String(x.code ?? ''), legal_name: String(x.legal_name ?? ''), country: String(x.country ?? ''), city: (x.city as string | null) ?? null,
          supplier_type: (x.supplier_type as string | null) ?? null, main_categories: (x.main_categories as string | null) ?? null, contact_name: (x.contact_name as string | null) ?? null,
          contact_email: (x.contact_email as string | null) ?? null, contact_phone: (x.contact_phone as string | null) ?? null, verified: !!x.verified, archived_at: (x.archived_at as string | null) ?? null,
          created_at: String(x.created_at), identity_status: (x.identity_status as string | null) ?? null, switches: sw ?? {}, counts: counts.get(String(x.id)) ?? { live: 0, total: 0, review: 0 },
        };
      });
  const sel = sp.new ? null : (rows ?? []).find((x) => x.id === sp.id) ?? null;
  const [{ data: variants }, delPreview] = sel
    ? await Promise.all([
        sb.from('supplier_name_variants').select('id, variant_name, variant_address, seen_in, is_canonical').eq('supplier_id', sel.id).order('created_at'),
        // delete-for-good preview: Admin only (supplier_delete_preview, migration 170) — as today
        s.isAdmin ? sb.rpc('supplier_delete_preview', { p_supplier: sel.id }).then((r) => (r.data as DelPreview | null) ?? null) : Promise.resolve(null),
      ])
    : [{ data: [] }, null];
  return (
    <SuppliersScreen
      state="ok"
      rows={rows}
      includeArchived={!!sp.archived}
      q={sp.q ?? ''}
      selected={sel ? { id: sel.id, variants: (variants ?? []) as Variant[], delPreview } : null}
      creating={!!sp.new}
      countries={COUNTRIES}
      perms={{ canCreate: can(s, 'suppliers', 'create'), canEdit: can(s, 'suppliers', 'edit'), isAdmin: s.isAdmin }}
      actions={ACTIONS}
    />
  );
}

export default function SuppliersPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<SuppliersScreen state="loading" rows={[]} includeArchived={false} q="" selected={null} creating={false} countries={[]} perms={{ canCreate: false, canEdit: false, isAdmin: false }} actions={ACTIONS} />}>
      <SuppliersContent searchParams={searchParams} />
    </Suspense>
  );
}
