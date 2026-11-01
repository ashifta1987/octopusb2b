'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, subscribeAuthed } from '@/lib/supabase/client';

export type RealtimeSub = { table: string; filter?: string; event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*' };

/**
 * Subscribes to Supabase Realtime postgres_changes and calls router.refresh() on any change (SPEC §9 live updates).
 * RLS still applies to what the browser receives; the refresh re-reads data on the server.
 */
export function RealtimeRefresh({ channel, subs }: { channel: string; subs: RealtimeSub[] }) {
  const router = useRouter();
  const key = JSON.stringify(subs);
  useEffect(() => {
    const sb = createClient();
    const list = JSON.parse(key) as RealtimeSub[];
    let ch = sb.channel(`${channel}:${Math.random().toString(36).slice(2, 8)}`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    for (const s of list) {
      ch = ch.on(
        'postgres_changes' as never,
        { event: s.event ?? '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) } as never,
        refresh,
      );
    }
    return subscribeAuthed(sb, ch, () => {
      if (timer) clearTimeout(timer);
    });
  }, [channel, key, router]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
      <span className="w-2 h-2 rounded-full bg-ok" aria-hidden /> Live · refreshes automatically
    </span>
  );
}
