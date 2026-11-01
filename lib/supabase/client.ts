'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

/**
 * Subscribes a Realtime channel with the signed-in user's JWT. Without `realtime.setAuth()` the browser joins as the
 * anon role, RLS filters every postgres_changes row and live updates silently never arrive (found by the SPEC §21
 * trace). Returns the cleanup function for useEffect.
 */
export function subscribeAuthed(sb: SupabaseClient, ch: RealtimeChannel, onCleanup?: () => void) {
  let stopped = false;
  void sb.auth.getSession().then(async ({ data }) => {
    if (data.session) await sb.realtime.setAuth(data.session.access_token);
    if (!stopped) ch.subscribe();
  });
  return () => {
    stopped = true;
    onCleanup?.();
    void sb.removeChannel(ch);
  };
}
