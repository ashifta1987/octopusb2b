import { createClient } from '@/lib/supabase/server';
import { getEmail } from '@/lib/adapters';
import { DOC_TITLE, esc } from '@/components/account/doc-html';


/** Emails the signed-in user a link to the document (access verified via RLS). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: claims } = await sb.auth.getClaims();
  const email = claims?.claims?.email as string | undefined;
  if (!claims?.claims?.sub) return Response.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!email) return Response.json({ ok: false, error: 'NO_EMAIL' }, { status: 400 });

  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  const { data: doc } = await sb.from('documents').select('id, doc_type, number').eq('id', id).maybeSingle();
  if (!doc) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });

  const label = DOC_TITLE[doc.doc_type as string] ?? 'Document';
  const site = (process.env.NEXT_PUBLIC_SITE_URL || new URL(_req.url).origin).replace(/\/+$/, '');
  const link = `${site}/api/documents/${doc.id}/pdf`;
  const { data: co } = await sb.from('company_profile').select('legal_name, brand, email').eq('id', 1).maybeSingle();
  const brand = esc(co?.brand ?? 'Octopus B2B');

  const html = `<!doctype html><html><body style="margin:0;background:#F5F6F8;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#11133C">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #E2E5EA;border-radius:12px;padding:28px">
  <h1 style="font-size:20px;margin:0 0 12px">${esc(label)} ${esc(doc.number)}</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Your ${esc(label.toLowerCase())} from ${brand} is ready. Open it to view, print or save as PDF (sign-in required).</p>
  <p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#2A6FD6;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px">View ${esc(label.toLowerCase())}</a></p>
  <p style="font-size:12px;color:#5A6475;margin:0">${esc(co?.legal_name ?? '')}${co?.email ? ` · ${esc(co.email)}` : ''}</p>
</div></body></html>`;

  try {
    await getEmail().send({ to: email, subject: `${label} ${doc.number}`, html });
  } catch {
    return Response.json({ ok: false, error: 'EMAIL_FAILED' }, { status: 502 });
  }
  await sb.from('documents').update({ emailed_at: new Date().toISOString() }).eq('id', doc.id);
  return Response.json({ ok: true });
}
