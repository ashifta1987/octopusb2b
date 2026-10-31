'use server';
import { revalidatePath } from 'next/cache';
import { getAiAdapter } from '@/lib/adapters/ai';
import { getCarrier } from '@/lib/adapters';
import { guard, fail, ok, type Result } from '@/components/admin/server';

const MODES = ['sandbox', 'live', 'off'] as const;

export async function setIntegrationMode(code: string, mode: string): Promise<Result> {
  const g = await guard('integrations', 'edit');
  if ('error' in g) return g.error;
  if (!(MODES as readonly string[]).includes(mode)) return fail('Invalid mode');
  const { data, error } = await g.sb.from('integrations').update({ mode, updated_at: new Date().toISOString() }).eq('code', code).select('code');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  revalidatePath('/admin/integrations');
  return ok(`Mode set to ${mode}`);
}

export async function saveIntegrationMode(_prev: Result | null, fd: FormData): Promise<Result> {
  return setIntegrationMode(String(fd.get('code') ?? ''), String(fd.get('mode') ?? ''));
}

/** Test connection through the adapter (secrets stay in env / Vault — never returned to the browser). */
export async function testConnection(code: string): Promise<Result> {
  const g = await guard('integrations', 'edit');
  if ('error' in g) return g.error;
  let okFlag = false;
  let summary: string;
  try {
    if (code === 'ai') {
      const ai = getAiAdapter();
      const r = await ai.seoFix({ title: 'Stainless steel hex bolts M10 x 40 mm A2-70', category: 'Fasteners', moq: 1000, unit: 'pcs' });
      okFlag = !!r.seo_title;
      summary = `AI adapter mode: ${ai.mode}${ai.mode === 'mock' ? ' (OPENAI_API_KEY not set — mock output)' : ''}. Sample SEO title: “${r.seo_title}”`;
    } else if (code === 'yunexpress') {
      const c = getCarrier('yunexpress');
      const q = await c.priceTrial({ fromCountry: 'CN', toCountry: 'NL', weightKg: 1, parcels: 1 });
      okFlag = q.length > 0;
      summary = `YunExpress mode: ${c.mode}. Price trial CN→NL 1 kg returned ${q.length} services, cheapest $${(Math.min(...q.map((x) => x.priceCents)) / 100).toFixed(2)}.`;
    } else {
      return ok('Not configured yet — no adapter credentials for this connection. Add them in the server environment / Vault, then test again.');
    }
  } catch (e) {
    okFlag = false;
    summary = `Test failed: ${(e as Error).message}`;
  }
  const { error } = await g.sb.rpc('record_integration_test', { p_code: code, p_ok: okFlag, p_summary: summary });
  if (error) return fail(error);
  revalidatePath('/admin/integrations');
  return okFlag ? ok(summary) : fail(summary);
}

/** Dead-letter / failed outbox event → pending with attempts reset (retry_outbox checks integrations:edit). */
export async function retryOutbox(id: string): Promise<Result> {
  const g = await guard('integrations', 'edit');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('retry_outbox', { p_id: id });
  if (error) return fail(error);
  revalidatePath('/admin/integrations');
  return ok('Queued for retry');
}

const POSTMAN_ID = /^[A-Za-z0-9-]{0,80}$/;

/** Postman card: save workspace / collection / monitor IDs as NON-secret config (the API key stays in env / Vault). */
export async function savePostmanConfig(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('integrations', 'edit');
  if ('error' in g) return g.error;
  const val = (k: string) => String(fd.get(k) ?? '').trim();
  const fields = { workspace_id: val('workspace_id'), public_v1: val('public_v1'), supplier_v1: val('supplier_v1'), monitor_id: val('monitor_id') };
  if (Object.values(fields).some((v) => !POSTMAN_ID.test(v))) return fail('IDs may only contain letters, digits and dashes.');
  const { data: row, error: e1 } = await g.sb.from('integrations').select('config').eq('code', 'postman').maybeSingle();
  if (e1) return fail(e1);
  if (!row) return fail('NOT_FOUND');
  const config = {
    ...((row.config as Record<string, unknown>) ?? {}),
    workspace_id: fields.workspace_id || null,
    collection_ids: { public_v1: fields.public_v1 || null, supplier_v1: fields.supplier_v1 || null },
    monitor_id: fields.monitor_id || null,
  };
  const { data, error } = await g.sb.from('integrations').update({ config, updated_at: new Date().toISOString() }).eq('code', 'postman').select('code');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  revalidatePath('/admin/integrations');
  return ok('Postman IDs saved');
}
