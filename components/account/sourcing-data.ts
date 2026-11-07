import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { rfqStatus, serviceStatus, serviceType, type SourcingStatus, type SourcingType } from '@/lib/sourcing';

/** Account › Product sourcing data (RLS client: a customer only ever reads their own organisation's rows). */
export type SourcingRow = {
  kind: 'rfq' | 'service'; id: string; ref: string; title: string; quantity: number | null; unit: string | null;
  destination: string | null; type: SourcingType; status: SourcingStatus; raw: string; quotes: number; newQuotes: number;
  fee: number; currency: string; created_at: string; order: { id: string; code: string; status: string } | null;
};

type Rfq = { id: string; code: string; title: string; quantity: number; unit: string; destination_country: string | null; status: string; fee_minor: number | null; currency: string; created_at: string; quotes: { status: string }[] | null; orders: { id: string; code: string; status: string }[] | null };
type Svc = { id: string; code: string; service_code: string; status: string; details: Record<string, unknown> | null; fee_minor: number | null; currency: string; created_at: string };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function listSourcing(orgId: string): Promise<SourcingRow[]> {
  const sb = await createClient();
  const [{ data: rfqs }, { data: svcs }] = await Promise.all([
    sb.from('rfqs').select('id, code, title, quantity, unit, destination_country, status, fee_minor, currency, created_at, quotes(status), orders(id, code, status)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(500),
    sb.from('service_requests').select('id, code, service_code, status, details, fee_minor, currency, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(500),
  ]);
  const a: SourcingRow[] = ((rfqs ?? []) as unknown as Rfq[]).map((r) => {
    const q = r.quotes ?? []; const order = r.orders?.[0] ?? null;
    return {
      kind: 'rfq', id: r.id, ref: r.code, title: r.title, quantity: r.quantity, unit: r.unit, destination: r.destination_country, type: 'sourcing',
      status: rfqStatus(r.status, order?.status), raw: r.status, quotes: q.length, newQuotes: q.filter((x) => x.status === 'sent').length,
      fee: Number(r.fee_minor ?? 0), currency: r.currency, created_at: r.created_at, order,
    };
  });
  const b: SourcingRow[] = ((svcs ?? []) as Svc[]).map((s) => {
    const d = s.details ?? {}; const type = serviceType(s.service_code);
    return {
      kind: 'service', id: s.id, ref: s.code, title: str(d.title) ?? str(d.product) ?? str(d.order_reference) ?? str(d.store_platform) ?? '—',
      quantity: num(d.quantity) ?? num(d.monthly_orders), unit: num(d.monthly_orders) != null && num(d.quantity) == null ? 'orders / month' : null,
      destination: str(d.destination_country) ?? str(d.warehouse_country) ?? str(d.target_market), type, status: serviceStatus(s.status, type), raw: s.status,
      quotes: 0, newQuotes: 0, fee: Number(s.fee_minor ?? 0), currency: s.currency, created_at: s.created_at, order: null,
    };
  });
  return [...a, ...b].sort((x, y) => y.created_at.localeCompare(x.created_at));
}

/** New quotes (sent, not yet opened) on this organisation's sourcing requests — the menu badge. */
export async function newQuoteCount(orgId: string): Promise<number> {
  const sb = await createClient();
  const { count } = await sb.from('quotes').select('id, rfqs!inner(org_id)', { count: 'exact', head: true }).eq('status', 'sent').eq('rfqs.org_id', orgId);
  return count ?? 0;
}

/** Services this organisation has used (drives which items the mobile "More" sheet lists first). */
export async function usedServices(orgId: string): Promise<string[]> {
  const sb = await createClient();
  const [{ data: svc }, { count: pools }, { count: tk }] = await Promise.all([
    sb.from('service_requests').select('service_code').eq('org_id', orgId).limit(200),
    sb.from('pool_pledges').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    sb.from('turnkey_leads').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
  ]);
  const used = new Set((svc ?? []).map((s) => serviceType(s.service_code as string) as string));
  if (pools) used.add('pools');
  if (tk) used.add('turnkey');
  return [...used];
}

