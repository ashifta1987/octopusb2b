'use server';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { mapDbError, toCents } from '@/lib/format';
import { isRequestType, requestSchema, SERVICE_CODE, type RequestValues } from '@/components/store/request-schema';

type Result = { ok: true; redirect: string } | { ok: false; error: string };

/**
 * Request Center submit (SPEC §4.1 step 4, §4.2). Sourcing → `submit_rfq` (RFQ fee charged from the wallet when
 * wallet_enabled); other types → `request_service`. Fees are always taken from service_prices inside the RPC.
 */
export async function submitRequest(type: string, values: RequestValues, productId: string | null, idem: string): Promise<Result> {
  if (!isRequestType(type)) return { ok: false, error: 'Unknown request type.' };
  const parsed = requestSchema(type).safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the form.' };
  const session = await getSession();
  if (!session) return { ok: false, error: 'Please sign in to submit a request.' };
  if (!session.org) return { ok: false, error: mapDbError({ message: 'NO_ORG' }) };

  const v = parsed.data;
  const product = productId && /^[0-9a-f-]{36}$/i.test(productId) ? productId : null;
  const key = /^[\w-]{8,64}$/.test(idem) ? idem : null;
  const sb = await createClient();

  if (type === 'sourcing') {
    const details = [v.details, v.needed_by && `Needed by: ${v.needed_by}`].filter(Boolean).join('\n\n');
    const { data, error } = await sb.rpc('submit_rfq', {
      p_title: v.title,
      p_quantity: parseInt(v.quantity, 10),
      p_details: details,
      p_product: product,
      p_destination_country: v.destination_country || null,
      p_destination_city: v.destination_city || null,
      p_target_price_cents: v.target_price ? toCents(v.target_price) : null,
      p_incoterm: v.incoterm || null,
      p_idem: key ? `rfq:${key}` : null,
    });
    if (error) return { ok: false, error: mapDbError(error) };
    return { ok: true, redirect: `/account/sourcing/${data}` };
  }

  const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
  // ADDON-44-F: a chosen warehouse makes the (hidden) country field meaningless — keep it only for "Not listed? Ask us"
  if (clean.warehouse && clean.warehouse !== 'other') delete clean.warehouse_country;
  const { data: svcId, error } = await sb.rpc('request_service', {
    p_service: SERVICE_CODE[type],
    p_details: clean,
    p_product: product,
    p_idem: key ? `svc:${key}` : null,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  return { ok: true, redirect: svcId ? `/account/sourcing/${svcId}` : '/account/sourcing' };
}
