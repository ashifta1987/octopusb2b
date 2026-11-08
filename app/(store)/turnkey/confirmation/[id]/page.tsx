import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { waLink } from '@/lib/turnkey/format';
import { Eyebrow } from '@/components/store/turnkey/ui';

export const metadata: Metadata = { title: 'Request received', robots: { index: false } };

/** /turnkey/confirmation/<lead_id> — reference number + next steps (ADDON-31 §4). The lead id is an unguessable UUID;
 *  only reference, project and kind are shown (no contact details). */
export default function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="h-[500px]" aria-hidden />}>
      <Body params={params} />
    </Suspense>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: lead }, { company, settings }] = await Promise.all([
    createAdminClient().from('turnkey_leads').select('reference, kind, project_id, created_at, turnkey_projects(title), turnkey_packages(tier_name)').eq('lead_id', id).maybeSingle(),
    getSiteContent(),
  ]);
  if (!lead) notFound();
  const proj = (Array.isArray(lead.turnkey_projects) ? lead.turnkey_projects[0] : lead.turnkey_projects) as { title: string } | null;
  const pkg = (Array.isArray(lead.turnkey_packages) ? lead.turnkey_packages[0] : lead.turnkey_packages) as { tier_name: string } | null;
  const quote = lead.kind === 'quote';
  const text = `Hello Octopus B2B, about my turnkey ${quote ? 'quote request' : 'interest'} ${lead.reference} (${proj?.title ?? ''}).`;
  const wa = waLink(company?.whatsapp, text);
  const wechat = typeof settings['contact.wechat'] === 'string' ? String(settings['contact.wechat']) : null;
  const steps = quote
    ? [['Within 24 h', 'A sourcing lead replies with a USD quote and Incoterm.'], ['Within 5 days', 'Sample quote for the key items.'], ['After the PO', 'We schedule QC at the factory, then consolidate and ship.']]
    : [['Now', 'Your interest is counted towards building packages for this project.'], ['When packages go live', 'We email you first with the tiers and a rough quote.'], ['Any time', 'Reply to the email or WhatsApp us to talk to a sourcing lead.']];
  return (
    <div className="max-w-[760px] mx-auto px-4 sm:px-8 py-10">
      <div className="bg-white border border-line rounded-[16px] p-6 sm:p-8" data-testid="turnkey-confirmation">
        <Eyebrow className="text-ok">{quote ? 'Quote request received' : 'Interest registered'}</Eyebrow>
        <h1 className="font-display font-bold text-[26px] sm:text-[30px] text-ink mt-2">Thank you — your reference is <span className="mono text-coral-text" data-testid="lead-reference">{lead.reference}</span></h1>
        <p className="text-muted mt-2">{proj?.title}{pkg ? ` · ${pkg.tier_name} package` : ''}. We sent a confirmation email with the same reference.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {steps.map(([t, d]) => (
            <li key={t} className="rounded-[12px] bg-pearl p-4"><div className="font-semibold text-ink">{t}</div><p className="text-[13.5px] text-muted mt-1">{d}</p></li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-primary">WhatsApp us about {lead.reference}</a>}
          {wechat && <span className="btn btn-ghost">WeChat {wechat} · quote {lead.reference}</span>}
          <Link href="/turnkey/atlas" className="btn btn-ghost">Back to the Atlas</Link>
        </div>
      </div>
    </div>
  );
}

