'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bootstrap } from '@/lib/assistant/bootstrap';
import { Conversation } from './conversation';

const STORE_KEY = 'octo.drawer.session';

/** Floating Octo bubble on every customer portal page (SPEC §20.5): bottom-right button → 420 px drawer with the same conversation. */
export function AssistantBubble() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);
  const [created, setCreated] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hidden = pathname?.startsWith('/account/assistant');

  const load = useCallback(async (page: string) => {
    setLoading(true);
    setError(null);
    try {
      const id = window.localStorage.getItem(STORE_KEY);
      const r = await fetch(`/api/assistant/session?${new URLSearchParams({ ...(id ? { id } : {}), page })}`, { cache: 'no-store' });
      const data = (await r.json()) as Bootstrap & { error?: string };
      if (!r.ok) throw new Error(data.error ?? 'Octo is unavailable right now.');
      // a closed conversation starts fresh
      if (!data.session || data.session.status === 'closed') {
        window.localStorage.removeItem(STORE_KEY);
        data.session = null;
        data.messages = [];
      }
      setBoot(data);
      setCreated(false);
      setN((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (hidden) return null;

  return (
    <>
      {!open && (
        <button ref={btnRef} type="button" aria-haspopup="dialog" aria-expanded={open}
          onClick={() => { setOpen(true); load(window.location.pathname); }}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-navy text-white pl-1.5 pr-4 py-1.5 shadow-lg hover:bg-[#262A6B] focus-visible:outline-3">
          <span aria-hidden className="w-9 h-9 rounded-full bg-blue flex items-center justify-center font-display font-bold">O</span>
          <span className="text-sm font-semibold">Ask Octo</span>
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Octo, your account assistant" className="fixed inset-y-0 right-0 z-50 w-[420px] max-w-full bg-surface border-l border-line shadow-2xl flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-line">
            <span aria-hidden className="w-9 h-9 rounded-[10px] bg-blue text-white flex items-center justify-center font-display font-bold">O</span>
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-[15px] leading-tight">Octo · AI assistant</div>
              <div className="text-[12px] text-muted truncate">{boot?.team ? `with ${boot.team.name}, your account manager` : 'answers from your own account data'}</div>
            </div>
            <Link href={`/account/assistant${boot?.session ? `?session=${boot.session.id}` : ''}`} className="text-[12px] font-semibold text-blue" onClick={() => setOpen(false)}>Full page</Link>
            <button type="button" aria-label="Close assistant" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setTimeout(() => btnRef.current?.focus(), 0); }}>✕</button>
          </div>
          <div className="flex-1 min-h-0 p-3 flex flex-col">
            {loading && !boot && <div role="status" className="p-6 text-sm text-muted">Loading Octo…</div>}
            {error && <div role="alert" className="m-2 rounded-[10px] border border-bad/40 bg-[#FDE8E8] px-4 py-3 text-sm text-[#A32D2D]">{error}</div>}
            {boot && (
              <Conversation
                key={n}
                channel="drawer"
                sessionId={boot.session?.id ?? null}
                sessionStatus={boot.session?.status}
                startedAt={boot.session?.started_at}
                initialMessages={boot.messages}
                onSessionChange={(id) => { window.localStorage.setItem(STORE_KEY, id); setCreated(true); }}
                orgName={boot.orgName}
                team={boot.team}
                withinHours={boot.withinHours}
                hoursLabel={boot.hoursLabel}
                hint={boot.hint}
                page={pathname}
                className="flex-1 min-h-0"
              />
            )}
            {(boot?.session || created) && (
              <button type="button" className="mt-2 self-center text-[12px] font-semibold text-blue" onClick={() => { window.localStorage.removeItem(STORE_KEY); load(window.location.pathname); }}>
                New conversation
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
