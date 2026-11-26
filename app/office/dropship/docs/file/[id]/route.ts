import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/** A 60-second signed link to one document. The staff check (and the audit row) is the definer RPC ds_doc_path; the bucket has no storage policy. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || !s.isStaff) return new NextResponse('Staff only', { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const sb = await createClient();
  const { data: path, error } = await sb.rpc('ds_doc_path', { p_doc: id });
  if (error || typeof path !== 'string') return new NextResponse('Not found', { status: 404 });
  const { data } = await createAdminClient().storage.from('dropship-documents').createSignedUrl(path, 60);
  if (!data?.signedUrl) return new NextResponse('The file could not be found in storage', { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
}
