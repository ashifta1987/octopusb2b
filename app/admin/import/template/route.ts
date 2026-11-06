import { getSession, can } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { buildTemplate } from '@/lib/import/template';
import { exportSupplierWorkbookData } from '@/lib/import/export';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bulk-import workbook download (ADDON-29).
 * ?kind=blank[&supplier=<uuid>]  → empty 20-column template (Supplier sheet pre-filled when a supplier is chosen)
 * ?kind=prefilled&supplier=<uuid> → that supplier's current products, ready to edit and re-upload.
 * Requires products:edit.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!can(s, 'products', 'edit')) return new Response('Forbidden', { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'prefilled' ? 'prefilled' : 'blank';
  const supplierId = url.searchParams.get('supplier') || '';
  if (supplierId && !UUID.test(supplierId)) return new Response('Bad supplier', { status: 400 });
  if (kind === 'prefilled' && !supplierId) return new Response('Choose a supplier to pre-fill', { status: 400 });

  let buf: Buffer;
  let label = 'blank';
  if (supplierId) {
    try {
      const data = await exportSupplierWorkbookData(createAdminClient(), supplierId);
      buf = await buildTemplate(kind === 'prefilled' ? data : { supplier: data.supplier, rows: [] });
      label = `${(data.supplier.external_id || data.supplier.manufacturer_code || 'supplier').replace(/[^A-Za-z0-9-]/g, '')}${kind === 'prefilled' ? '-prefilled' : ''}`;
    } catch (e) {
      if (e instanceof Error && e.message === 'NOT_FOUND') return new Response('Supplier not found', { status: 404 });
      throw e;
    }
  } else {
    buf = await buildTemplate();
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="octopus-bulk-template-${label}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
