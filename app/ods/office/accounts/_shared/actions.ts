'use server';
import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadJournal } from './accounts-server';
import type { JournalView } from './accounts-core';

/** Drawer reads (Ledger / Payments): a journal and its lines. Same permission as the pages (finance:view, 2-step session). */
export async function journalViewAction(by: { journalId: string } | { refType: 'payment'; refId: string }): Promise<{ ok: true; journal: JournalView | null } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || !s.isStaff || s.aal !== 'aal2' || !can(s, 'finance', 'view')) return { ok: false, error: 'You do not have permission to see this.' };
  const id = 'journalId' in by ? by.journalId : by.refId;
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) return { ok: false, error: 'Not found.' };
  if (!('journalId' in by) && by.refType !== 'payment') return { ok: false, error: 'Not found.' };
  try {
    return { ok: true, journal: await loadJournal(await createClient(), by) };
  } catch {
    return { ok: false, error: 'We couldn’t load the journal.' };
  }
}
