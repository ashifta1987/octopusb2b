import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';

/** ADDON-41 audit + notifications helpers (server only). audit_log is append-only. */
export async function audit(input: {
  action: string; orgId?: string | null; service?: string | null; refType: string; refId: string; before?: unknown; after?: unknown;
}) {
  const { error } = await createAdminClient().rpc('audit', {
    p_action: input.action, p_org: input.orgId ?? null, p_service: input.service ?? null, p_ref_type: input.refType, p_ref_id: input.refId,
    p_before: (input.before ?? null) as never, p_after: (input.after ?? null) as never,
  });
  if (error) throw new Error(`Audit failed: ${error.message}`); // never fail silently: an action without its audit row is an error
}

export async function notify(input: { orgId: string; userId?: string | null; service?: string | null; title: string; body?: string; link?: string }) {
  const { error } = await createAdminClient().from('notifications').insert({
    org_id: input.orgId, user_id: input.userId ?? null, service: input.service ?? null, title: input.title, body: input.body ?? null, link: input.link ?? null,
  });
  if (error) throw new Error(`Notification failed: ${error.message}`);
}

