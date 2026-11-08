import Link from 'next/link';
import { getMailDeliverability } from '@/lib/email-deliverability';

/** ADDON-36 C1 — red back-office warning when a contact/sending domain has no MX record (mail would bounce). */
export async function MailDeliverabilityAlert({ showOk = false }: { showOk?: boolean }) {
  const checks = await getMailDeliverability().catch(() => null);
  if (!checks) return null;
  const bad = checks.filter((c) => !c.ok);
  if (!bad.length) {
    return showOk ? (
      <p className="mb-4 text-[13px] text-ok" data-testid="mail-ok">✓ Email deliverability: every contact domain has an MX record ({checks.map((c) => c.domain).join(', ')}).</p>
    ) : null;
  }
  return (
    <section role="alert" data-testid="mail-deliverability" className="mb-6 rounded-[14px] border border-bad/40 bg-bad-bg px-5 py-4 text-[14px] text-bad">
      <h2 className="text-[15px] font-bold text-bad">Email deliverability: customer emails to these addresses will bounce</h2>
      <ul className="mt-2 space-y-1.5">
        {bad.map((c) => (
          <li key={c.domain}><b className="mono">{c.domain}</b>: {c.error}. Used by {c.usedBy.join('; ')}.</li>
        ))}
      </ul>
      <p className="mt-2">Create mailboxes and add MX records at your DNS provider for these domains, or change the addresses in{' '}
        <Link href="/admin/content?tab=company" className="font-semibold underline">Site content → Company &amp; branches</Link>. This check runs every hour.</p>
    </section>
  );
}

