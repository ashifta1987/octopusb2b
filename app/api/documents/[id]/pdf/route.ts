import { getSession, can } from '@/lib/auth';
import { loadDocument, renderDocumentHtml } from '@/components/account/doc-html';

/** Print-ready HTML for a document the signed-in user can read (RLS). `?print=1` opens the print dialog. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return text(401, 'Please sign in to view this document.');

  // Supplier codes/countries require explicit supplier or finance/cost permission on an aal2 staff session (never support).
  const showSupplier =
    session.isStaff &&
    session.aal === 'aal2' &&
    (can(session, 'suppliers', 'view') || can(session, 'finance', 'view'));
  const bundle = await loadDocument(id, { staff: showSupplier });
  if (!bundle) return text(404, 'Document not found.');

  const url = new URL(req.url);
  const html = renderDocumentHtml(bundle, { origin: url.origin, print: url.searchParams.get('print') === '1', showSupplier });
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
