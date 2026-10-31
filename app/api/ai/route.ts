import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getAiAdapter } from '@/lib/adapters/ai';

export const maxDuration = 60;

const body = z.object({
  kind: z.enum(['seo_fix', 'description', 'poster', 'photo_enhance']),
  supplier_id: z.string().uuid(),
  product_id: z.string().uuid().nullish(),
  input: z.object({
    title: z.string().trim().min(1, 'Add a product title first').max(200),
    description: z.string().max(8000).nullish(),
    category: z.string().max(200).nullish(),
    specs: z.record(z.string(), z.string()).optional(),
    moq: z.number().optional(),
    unit: z.string().max(20).optional(),
    image_url: z.string().url().optional(),
  }),
});

/** GET → current adapter mode, for the "AI mode: live/mock" note. */
export async function GET() {
  return NextResponse.json({ mode: getAiAdapter().mode });
}

/** AI product tools (SPEC §7 AiAdapter). Needs ai:create (or admin) and the supplier's "AI tools" switch on. Logged in ai_jobs. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  if (!can(s, 'ai', 'create')) return NextResponse.json({ ok: false, error: 'You do not have access to AI tools.' }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  const { kind, supplier_id, product_id, input } = parsed.data;

  const sb = await createClient();
  // RLS: only visible if the supplier is assigned to this distributor (or staff with suppliers:view)
  const { data: sup } = await sb.from('suppliers').select('id, supplier_switches(ai_tools)').eq('id', supplier_id).maybeSingle();
  if (!sup) return NextResponse.json({ ok: false, error: 'Supplier not found or not assigned to you.' }, { status: 403 });
  const sw = Array.isArray(sup.supplier_switches) ? sup.supplier_switches[0] : sup.supplier_switches;
  if (sw && sw.ai_tools === false) return NextResponse.json({ ok: false, error: 'AI tools are switched off for this supplier.' }, { status: 403 });

  // monthly usage limit per user (site setting ai_monthly_limit; staff can read non-public settings)
  const { data: lim } = await sb.from('site_settings').select('value').eq('key', 'ai_monthly_limit').maybeSingle();
  const limit = Number(lim?.value ?? 0);
  if (limit > 0) {
    const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const { count } = await sb.from('ai_jobs').select('id', { count: 'exact', head: true }).eq('created_by', s.userId).gte('created_at', start.toISOString());
    if ((count ?? 0) >= limit) return NextResponse.json({ ok: false, error: `Monthly AI limit reached (${limit}).` }, { status: 429 });
  }

  const ai = getAiAdapter();
  const kindDb = kind === 'description' ? 'description' : kind;
  const { data: job, error: jobErr } = await sb.from('ai_jobs')
    .insert({ kind: kindDb, product_id: product_id ?? null, input: { ...input, mode: ai.mode }, status: 'running', created_by: s.userId, org_id: s.org?.id ?? null })
    .select('id').single();
  if (jobErr) return NextResponse.json({ ok: false, error: jobErr.message }, { status: 500 });

  try {
    const p = { title: input.title, description: input.description ?? null, category: input.category ?? null, specs: input.specs, moq: input.moq, unit: input.unit };
    let output: Record<string, unknown>;
    if (kind === 'seo_fix') output = await ai.seoFix(p);
    else if (kind === 'description') output = await ai.describe(p);
    else if (kind === 'poster') output = await ai.poster(p);
    else {
      if (!input.image_url) throw new Error('Upload a photo first');
      const r = await ai.enhancePhoto(input.image_url, p);
      let url = r.image_url;
      if (url.startsWith('data:')) {
        // store generated image in the public product-media bucket instead of returning base64
        const [meta, b64] = url.split(',');
        const type = meta.match(/data:(.*?);/)?.[1] ?? 'image/png';
        const path = `${supplier_id}/ai-${job.id}.png`;
        const up = await sb.storage.from('product-media').upload(path, Buffer.from(b64, 'base64'), { contentType: type, upsert: true });
        if (up.error) throw new Error(up.error.message);
        url = sb.storage.from('product-media').getPublicUrl(path).data.publicUrl;
      }
      output = { image_url: url, note: r.note };
    }
    await sb.from('ai_jobs').update({ output, status: 'done' }).eq('id', job.id);
    return NextResponse.json({ ok: true, mode: ai.mode, job_id: job.id, output });
  } catch (e) {
    const msg = (e as Error).message;
    await sb.from('ai_jobs').update({ output: { error: msg }, status: 'failed' }).eq('id', job.id);
    return NextResponse.json({ ok: false, error: msg, mode: ai.mode }, { status: 502 });
  }
}
