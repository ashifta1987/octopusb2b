'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { clearStaffSession, staffAudit } from '@/lib/staff/server';
import { workspaceByKey, workspacesFor } from '@/lib/staff/workspaces';

/** Staff sign-out (audited). Optional form field `to` keeps a /staff/login?… notice. */
export async function staffSignOut(formData?: FormData): Promise<void> {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  const uid = (data?.claims?.sub as string | undefined) ?? null;
  if (uid) await staffAudit(uid, 'auth.sign_out', {});
  await sb.auth.signOut();
  await clearStaffSession();
  const to = formData?.get('to');
  redirect(typeof to === 'string' && to.startsWith('/staff/login') ? to : '/staff/login');
}

/** Choose / switch workspace (SPEC §17.2 step 3 + top-bar switcher): remembers it and audits auth.workspace_switch. */
export async function switchWorkspace(formData: FormData): Promise<void> {
  const key = String(formData.get('workspace') ?? '');
  const s = await getSession();
  if (!s) redirect('/staff/login');
  const ws = workspacesFor(s).find((w) => w.key === key) ?? null;
  if (!ws) redirect('/staff/workspace');
  const sb = await createClient();
  const { data: prof } = await sb.from('profiles').select('last_workspace').eq('id', s.userId).maybeSingle();
  await sb.from('profiles').update({ last_workspace: ws.key }).eq('id', s.userId);
  await staffAudit(s.userId, 'auth.workspace_switch', { to: ws.key, from: prof?.last_workspace ?? null, from_label: workspaceByKey(prof?.last_workspace)?.label ?? null });
  redirect(ws.href);
}
