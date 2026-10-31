import { createClient } from '@/lib/supabase/server';
import { loadDocument, renderDocumentHtml } from '@/components/account/doc-html';


/** Print-ready HTML for a document the signed-in user can read (RLS). `?print=1` opens the print dialog. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: claims } = await sb.auth.getClaims();
  if (!claims?.claims?.sub) return text(401, 'Please sign in to view this document.');

  const bundle = await loadDocument(id);
  if (!bundle) return text(404, 'Document not found.');

  const url = new URL(req.url);
  const html = renderDocumentHtml(bundle, { origin: url.origin, print: url.searchParams.get('print') === '1' });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    },
  });
}

function text(status: number, msg: string) {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
