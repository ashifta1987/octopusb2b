import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Notice } from '@/components/ui';
import { loadBootstrap } from '@/lib/assistant/bootstrap';
import { getAssistantSettings } from '@/lib/assistant/settings';
import { getTeamStats } from '@/lib/assistant/team';
import { AssistantPageClient } from '@/components/account/assistant/page-client';
import { AccountTeamCard } from '@/components/account/assistant/team-card';
import { HistoryOptIn } from '@/components/account/assistant/history-opt-in';

export const metadata = { title: 'AI assistant' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Still-open conversation touched in the last 3 days. */
function isRecent(iso: string) {
  return Date.now() - new Date(iso).getTime() < 3 * 86400000;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** /account/assistant — Octo + dedicated account manager (SPEC §20.5, Assistant.png). */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ session?: string; all?: string }> }) {
  const s = await requireCustomer('/account/assistant');
  if (!s.org) return <Notice tone="amber">Your staff account has no buyer company. <Link href="/onboarding" className="underline">Create a company profile</Link> to use the assistant.</Notice>;
  const sp = await searchParams;
  const sb = await createClient();
  const settings = await getAssistantSettings();
  if (!settings.enabled) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-bold mb-3">AI assistant</h1>
        <Notice tone="amber">Octo is switched off right now. Your account manager is still available — use <Link href="/account/support" className="underline">Help &amp; complaints</Link>.</Notice>
      </div>
    );
  }

  const showAll = sp.all === '1';
  const [{ data: recent, count }, { data: prof }] = await Promise.all([
    sb.from('assistant_session_mine_view').select('id, title, status, escalation_id, last_message_at, started_at, last_message', { count: 'exact' })
      .eq('org_id', s.org.id).order('last_message_at', { ascending: false }).limit(showAll ? 50 : 4),
    sb.from('profiles').select('assistant_history_opt_out').eq('id', s.userId).maybeSingle(),
  ]);
  const recentRows = (recent ?? []) as { id: string; title: string | null; status: string; escalation_id: string | null; last_message_at: string; started_at: string; last_message: string | null }[];

  // explicit ?session=… or the latest conversation that is still open and recent
  let sessionId = sp.session && UUID_RE.test(sp.session) ? sp.session : null;
  if (!sessionId && sp.session === undefined) {
    const latest = recentRows.find((r) => r.status !== 'closed' && isRecent(r.last_message_at));
    sessionId = latest?.id ?? null;
  }
  const boot = await loadBootstrap(sb, s.org, { sessionId });
  const stats = await getTeamStats(sb, s.org.id, settings.slaMinutes);
  const first = boot.team?.first_name ?? 'your account manager';
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="flex flex-wrap gap-6 items-start">
      <AssistantPageClient key={boot.session?.id ?? 'new'} boot={boot} />

      <aside className="stick flex-[0_1_320px] min-w-[280px] flex flex-col gap-4">
        <AccountTeamCard team={boot.team} stats={stats} />

        <section className="card p-5 flex flex-col gap-2.5" aria-labelledby="ctx-h">
          <h2 id="ctx-h" className="m-0 font-display font-bold text-[14px] leading-[1.2]">What Octo knows about you</h2>
          <ul className="m-0 pl-[18px] list-disc text-[13px] text-black leading-[1.6]">
            <li>Company profile and KYC status</li>
            <li>Orders, RFQs, quotes, service requests</li>
            <li>Wallet balance and ledger (last 90 days)</li>
            <li>Saved products and group-buy pledges</li>
            <li>Shipment tracking</li>
            <li>Current site T&amp;C and policy versions</li>
          </ul>
          <p className="m-0 text-[12px] text-muted">Contacts, addresses and other customers&apos; data are never sent to the AI.</p>
          <HistoryOptIn initialOptIn={!prof?.assistant_history_opt_out} />
        </section>

        <section className="card p-5 flex flex-col gap-2.5 !bg-warn-bg !border-warn-bg" aria-labelledby="esc-h">
          <h2 id="esc-h" className="m-0 font-display font-bold text-[14px] leading-[1.2]">When Octo hands off</h2>
          <ul className="m-0 pl-[18px] list-disc text-[13px] text-black leading-[1.6]">
            <li>You ask for a human</li>
            {settings.topics.length > 0 && <li>{cap(settings.topics.join(', '))}</li>}
            <li>Anything only staff can approve, or if you seem unhappy</li>
            <li>Octo&apos;s confidence drops below {Math.round(settings.threshold * 100)}% three times in a row</li>
            <li>Outside office hours{boot.hoursLabel ? ` (${boot.hoursLabel})` : ''}, if you choose to wait for {first}</li>
          </ul>
        </section>

        <section className="card p-5 flex flex-col gap-2.5" aria-labelledby="hist-h">
          <h2 id="hist-h" className="m-0 font-display font-bold text-[14px] leading-[1.2]">Recent conversations</h2>
          {recentRows.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">No conversations yet — ask Octo anything about your account.</p>
          ) : recentRows.map((r) => {
            const who = r.escalation_id ? `with ${first}` : 'Octo';
            const state = r.status === 'closed' ? 'closed' : r.status === 'bot' ? (r.escalation_id ? 'resolved' : 'open') : 'open';
            const current = r.id === boot.session?.id;
            return (
              <Link key={r.id} href={`/account/assistant?session=${r.id}`} aria-current={current ? 'page' : undefined}
                className={`flex flex-col gap-[3px] p-2.5 rounded-[10px] border ${current ? 'border-coral-text bg-tint' : 'border-line hover:border-coral-text'}`}>
                <strong className="font-semibold text-[13px] truncate">{r.title ?? 'Conversation'}</strong>
                <span className="text-[12px] text-muted">{fmt(r.last_message_at)} · {who} · {state}</span>
              </Link>
            );
          })}
          {!showAll && (count ?? 0) > recentRows.length && (
            <Link href="/account/assistant?all=1" className="inline-flex items-center min-h-11 text-coral-text font-semibold text-[13px]">See all {count} conversations →</Link>
          )}
        </section>
      </aside>
    </div>
  );
}
