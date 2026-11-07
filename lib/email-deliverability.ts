import 'server-only';
import { promises as dns } from 'node:dns';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';

export type MailCheck = { domain: string; ok: boolean; mx: string[]; error: string | null; usedBy: string[] };

/** MX lookup with a timeout; a missing MX means mail to that domain bounces. */
export async function checkMx(domain: string, timeoutMs = 4000): Promise<{ ok: boolean; mx: string[]; error: string | null }> {
  try {
    const recs = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEOUT' })), timeoutMs)),
    ]);
    const mx = recs.filter((r) => r.exchange && r.exchange !== '.').sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    return mx.length ? { ok: true, mx, error: null } : { ok: false, mx: [], error: 'Null MX: the domain does not accept mail' };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { ok: false, mx: [], error: code === 'ENODATA' || code === 'ENOTFOUND' ? 'No MX record: mail to this domain bounces' : `DNS error (${code ?? 'unknown'})` };
  }
}

export function domainOf(email: string | null | undefined): string | null {
  const m = /@([^@\s>]+)\s*>?\s*$/.exec(email ?? '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * ADDON-36 C1 — every public contact address (Company & branches) and the outgoing "from" address, grouped by domain,
 * with an MX check. Cached for an hour; shown as a red warning in the back office when a domain cannot receive mail.
 */
export async function getMailDeliverability(): Promise<MailCheck[]> {
  'use cache';
  cacheLife({ revalidate: 3600 });
  cacheTag('site-content', 'mail-deliverability');
  const sb = createPublicClient();
  const [company, branches] = await Promise.all([
    sb.from('company_profile').select('email').eq('id', 1).maybeSingle(),
    sb.from('branches').select('name, email').eq('active', true),
  ]);
  const uses = new Map<string, Set<string>>();
  const add = (email: string | null | undefined, label: string) => {
    const d = domainOf(email);
    if (!d) return;
    if (!uses.has(d)) uses.set(d, new Set());
    uses.get(d)!.add(`${label} (${email!.replace(/^.*</, '').replace(/>.*$/, '').trim()})`);
  };
  add(company.data?.email as string | null, 'Company email');
  (branches.data ?? []).forEach((b) => add(b.email as string | null, b.name as string));
  add(process.env.EMAIL_FROM ?? 'support@octopusb2b.com', 'Outgoing email “from” / reply-to');
  return Promise.all([...uses.entries()].map(async ([domain, by]) => ({ domain, ...(await checkMx(domain)), usedBy: [...by] })));
}
