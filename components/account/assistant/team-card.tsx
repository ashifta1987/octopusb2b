import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAssistantSettings } from '@/lib/assistant/settings';
import { getAccountTeam, getTeamStats, type TeamStats } from '@/lib/assistant/team';
import type { AccountTeam } from '@/lib/assistant/types';

/** "Your account team" (Assistant.png right rail + Customer.png dashboard strip). Server components. */

const OctoSquare = ({ size = 44 }: { size?: number }) => (
  <span aria-hidden className="flex-none rounded-[12px] bg-blue-fill text-white flex items-center justify-center font-display font-bold text-[16px]" style={{ width: size, height: size }}>O</span>
);
const ManagerCircle = ({ initials, size = 44 }: { initials: string; size?: number }) => (
  <span aria-hidden className="flex-none rounded-full bg-navy text-white flex items-center justify-center font-display font-bold text-[15px]" style={{ width: size, height: size }}>{initials}</span>
);

function waLink(phone: string | null) {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 8 ? `https://wa.me/${d}` : null;
}

export function AccountTeamCard({ team, stats }: { team: AccountTeam | null; stats: TeamStats }) {
  const wa = waLink(team?.phone ?? null);
  return (
    <section className="card p-5 flex flex-col gap-3.5" aria-labelledby="team-h">
      <h2 id="team-h" className="m-0 font-display font-bold text-[16px] leading-[1.2]">Your account team</h2>
      <div className="flex gap-3 items-start">
        <OctoSquare />
        <div className="flex flex-col gap-[3px] flex-1 min-w-0">
          <strong className="font-semibold text-[14px]">Octo <span className="font-normal text-muted">· AI assistant</span></strong>
          <span className="text-[12px] text-[#166534] inline-flex gap-1 items-center"><span aria-hidden className="w-1.5 h-1.5 rounded-full bg-[#166534]" />Online 24/7 · instant replies</span>
          <span className="text-[12px] text-muted">
            {stats.sessions ? `Handled ${stats.resolvedByBot} of your ${stats.sessions} past conversation${stats.sessions === 1 ? '' : 's'} on its own` : 'Answers from your own orders, RFQs, wallet and shipments'}
          </span>
        </div>
      </div>
      <div className="h-px bg-[#EEF0F3]" />
      {team ? (
        <div className="flex gap-3 items-start">
          <ManagerCircle initials={team.initials} />
          <div className="flex flex-col gap-[3px] flex-1 min-w-0">
            <strong className="font-semibold text-[14px]">{team.name}</strong>
            <span className="text-[12px] text-muted">{[team.title, team.team ? `${team.team} team` : null, team.office].filter(Boolean).join(' · ')}</span>
            {team.hours_label && <span className="text-[12px] text-muted">Hours: {team.hours_label}{team.out_of_office ? ' · out of office — the team queue covers' : ''}</span>}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {team.email && <a href={`mailto:${team.email}`} className="btn btn-ghost btn-sm">Email</a>}
              {wa && <a href={wa} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">WhatsApp</a>}
              {team.email && <a href={`mailto:${team.email}?subject=${encodeURIComponent('Book a call')}`} className="btn btn-dark btn-sm">Book a call</a>}
            </div>
          </div>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">A dedicated account manager is assigned once your company is verified. Until then, Octo hands questions to the account team.</p>
      )}
      <div className="h-px bg-[#EEF0F3]" />
      <dl className="m-0 flex flex-col gap-1.5 text-[13px] text-[#3B4556]">
        <div className="flex justify-between gap-3"><dt>Monthly response SLA</dt><dd className="m-0 font-semibold">{stats.slaPct != null ? `${stats.slaPct}% within ${stats.slaMinutes} min` : `Target: ${stats.slaMinutes} min`}</dd></div>
        <div className="flex justify-between gap-3"><dt>Bot resolution rate</dt><dd className="m-0 font-semibold">{stats.botResolutionPct != null ? `${stats.botResolutionPct}%` : '—'}</dd></div>
        <div className="flex justify-between gap-3"><dt>Average satisfaction</dt><dd className="m-0 font-semibold">{stats.satisfactionPct != null ? `${stats.satisfactionPct}% helpful (${stats.ratings})` : 'No ratings yet'}</dd></div>
      </dl>
    </section>
  );
}

/** Dashboard strip between the KPIs and the sponsored ad (Customer.png). */
export async function AccountTeamStrip({ orgId }: { orgId: string }) {
  const sb = await createClient();
  const [team, settings] = await Promise.all([getAccountTeam(sb), getAssistantSettings()]);
  if (!settings.enabled) return null;
  const stats = await getTeamStats(sb, orgId, settings.slaMinutes);
  return (
    <section aria-label="Your account team" className="mb-6 rounded-[16px] border border-[#B9D2F5] bg-[#F7FAFE] px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="flex items-center gap-3 flex-[1_1_300px] min-w-0">
        <OctoSquare size={44} />
        <div className="min-w-0">
          <div className="font-semibold">Octo, your account assistant</div>
          <div className="text-[12.5px] text-muted">AI · online 24/7 · instant replies{stats.botResolutionPct != null ? ` · ${stats.botResolutionPct}% resolved without human` : ''}</div>
        </div>
      </div>
      {team && (
        <div className="flex items-center gap-3 flex-[1_1_300px] min-w-0">
          <ManagerCircle initials={team.initials} size={44} />
          <div className="min-w-0">
            <div className="font-semibold">{team.name}</div>
            <div className="text-[12.5px] text-muted">{[team.title, team.office, team.out_of_office ? 'out of office' : null].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      )}
      <Link href="/account/assistant" className="btn btn-primary ml-auto">Open assistant</Link>
    </section>
  );
}
