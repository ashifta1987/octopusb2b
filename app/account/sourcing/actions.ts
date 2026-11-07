'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { mapDbError } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';

/** Account › Product sourcing actions. Access is checked in the database (post_request_message / add_request_file / RLS). */
const Msg = z.object({ kind: z.enum(['rfq', 'service']), id: z.string().uuid(), body: z.string().trim().min(1, 'Write a message first.').max(4000) });

export async function postMessage(input: { kind: 'rfq' | 'service'; id: string; body: string; ref: string }): Promise<ActionResult> {
  const p = Msg.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid message.' };
  const sb = await createClient();
  const { error } = await sb.rpc('post_request_message', { p_kind: p.data.kind, p_id: p.data.id, p_body: p.data.body });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(`/account/sourcing/${input.ref}`);
  return { ok: true };
}

const MAX = 20 * 1024 * 1024;
const OK_TYPES = /^(image\/(jpeg|png|webp|heic)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|text\/plain)$/;

export async function uploadFile(fd: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: 'Please sign in again.' };
  const kind = String(fd.get('kind') ?? ''); const id = String(fd.get('id') ?? ''); const ref = String(fd.get('ref') ?? '');
  const fileKind = String(fd.get('file_kind') ?? 'other');
  const file = fd.get('file');
  if (!['rfq', 'service'].includes(kind) || !z.string().uuid().safeParse(id).success) return { ok: false, error: 'Invalid request.' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file.' };
  if (file.size > MAX) return { ok: false, error: 'Files can be up to 20 MB.' };
  if (!OK_TYPES.test(file.type)) return { ok: false, error: 'Upload a photo (JPG, PNG, WEBP), a PDF, an Excel or Word file.' };
  const sb = await createClient();
  // the request must be visible to the caller (RLS) before anything is stored
  const { data: vis } = await sb.rpc('request_visible', { p_kind: kind, p_id: id });
  if (!vis) return { ok: false, error: 'Request not found.' };
  const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120);
  const path = `${kind}/${id}/${Date.now()}-${safe}`;
  const admin = createAdminClient();
  const { error: up } = await admin.storage.from('request-files').upload(path, file, { contentType: file.type, upsert: false });
  if (up) return { ok: false, error: `Upload failed: ${up.message}` };
  const { error } = await sb.rpc('add_request_file', { p_kind: kind, p_id: id, p_path: path, p_name: file.name, p_file_kind: fileKind, p_size: file.size });
  if (error) { await admin.storage.from('request-files').remove([path]); return { ok: false, error: mapDbError(error) }; }
  revalidatePath(`/account/sourcing/${ref}`);
  return { ok: true };
}

/** Opening a request marks its new quotes as viewed (clears the "new quotes" badge). */
export async function markQuotesViewed(rfqId: string): Promise<void> {
  if (!z.string().uuid().safeParse(rfqId).success) return;
  const sb = await createClient();
  const { data } = await sb.rpc('mark_quotes_viewed', { p_rfq: rfqId });
  if (Number(data) > 0) { revalidatePath('/account/sourcing'); revalidatePath('/account'); }
}
