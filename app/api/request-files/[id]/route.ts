import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/** Download a request file: the row must be visible to the caller (RLS: own organisation or staff), then a 60 s signed URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const sb = await createClient();
  const { data: f } = await sb.from('request_files').select('storage_path, file_name').eq('id', id).maybeSingle();
  if (!f) return new NextResponse('Not found', { status: 404 });
  const { data, error } = await createAdminClient().storage.from('request-files').createSignedUrl(f.storage_path as string, 60, { download: f.file_name as string });
  if (error || !data) return new NextResponse('File unavailable', { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
