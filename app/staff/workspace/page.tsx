import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { StaffFrame, StaffHeading, FrameFallback } from '../_components/frame';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { workspacesFor } from '@/lib/staff/workspaces';
import { staffSignOut, switchWorkspace } from '@/lib/staff/actions';
import { humanize } from '@/lib/format';
import { nearSlaCount } from '@/lib/staff/server';

export const metadata = { title: 'Choose workspace · Staff' };

const NEAR_SLA_HOURS = 4;

async function WorkspaceBody() {
  const s = await getSession();
  if (!s) redirect('/staff/login?next=/staff/workspace');
  if (!s.isStaff) redirect('/login');
  const list = workspacesFor(s);
  if (list.length === 1) redirect(list[0].href);

  const sb = await createClient();
  const [{ data: prof }, nearSla] = await Promise.all([
    sb.from('profiles').select('full_name, office, last_workspace').eq('id', s.userId).maybeSingle(),
    list.some((w) => w.key === 'support') ? nearSlaCount(NEAR_SLA_HOURS) : Promise.resolve(0),
  ]);
  const name = prof?.full_name || s.email || 'there';
  const roleText = s.roles.map((r) => humanize(r)).join(', ') || 'Staff';

  return (
    <div className="flex flex-col gap-5">
      <StaffHeading title={`Welcome, ${name}`} hint="Choose where to work. You only see the areas your role allows; switch anytime from the top bar." />
      {list.length === 0 ? (
        <div className="bg-white border border-line rounded-[10px] p-5 text-sm text-muted">
          No work areas are assigned to your role yet. Ask an Admin to give your role permissions in Staff &amp; roles.
        </div>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-3">
          {list.map((w) => {
            const badge = w.key === 'support' && nearSla > 0 ? `${nearSla} near SLA` : null;
            const last = prof?.last_workspace === w.key;
            return (
              <li key={w.key}>
                <form action={switchWorkspace}>
                  <input type="hidden" name="workspace" value={w.key} />
                  <button type="submit" className="w-full text-left bg-white border-2 border-line hover:border-coral-text focus-visible:border-coral-text rounded-[10px] px-4 py-4 flex items-center gap-3.5 transition-colors">
                    <span className="w-11 h-11 rounded-[8px] bg-ink text-white flex items-center justify-center font-bold text-[15px] flex-none" aria-hidden>{w.short}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-[16px] text-ink">{w.label}</span>
                      <span className="block text-sm text-black leading-[1.45]">{w.description}</span>
                    </span>
                    {(last || badge) && (
                      <span className="text-xs text-muted text-right flex-none flex flex-col gap-1">
                        {last && <span>Last used</span>}
                        {badge && <span>{badge}</span>}
                      </span>
                    )}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-between items-center text-sm text-muted gap-3 flex-wrap">
        <span>Role: {roleText}{prof?.office ? ` · ${prof.office}` : ''}</span>
        <form action={staffSignOut}><button type="submit" className="font-semibold text-coral-text">Sign out</button></form>
      </div>
    </div>
  );
}

/** StaffLogin-3-workspace.png — step 3: workspace cards for the areas the role allows (one area → straight there). */
export default function StaffWorkspacePage() {
  return (
    <StaffFrame step={2}>
      <Suspense fallback={<FrameFallback />}>
        <WorkspaceBody />
      </Suspense>
    </StaffFrame>
  );
}
