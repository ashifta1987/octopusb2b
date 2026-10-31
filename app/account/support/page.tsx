import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { fmtDate, humanize } from '@/lib/format';
import { Card, EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { getSettings } from '@/components/account/data';
import { SupportNewTicket, type SupportOrderOption } from '@/components/account/support-new-ticket';
import { ticketStatusLabel, whatsappHref } from '@/components/account/support-shared';

export const metadata = { title: 'Help & complaints' };

type TicketRow = {
  id: string; code: string; subject: string; status: string; category: string; updated_at: string; order_id: string | null;
  orders: { code: string } | null;
};

function nowMs() {
  return Date.now();
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const s = await requireCustomer('/account/support');
  const { order: orderParam } = await searchParams;
  const [{ company }, settings] = await Promise.all([getSiteContent(), getSettings()]);

  const contact = (
    <>
      {company?.whatsapp && (
        <a className="btn btn-ghost text-[#156B3A] border-[#1F9D55]/60" href={whatsappHref(company.whatsapp)} target="_blank" rel="noopener noreferrer">WhatsApp support</a>
      )}
      {company?.email && <a className="btn btn-ghost" href={`mailto:${company.email}`}>Email us</a>}
    </>
  );

  const header = (
    <PageHeader
      title="Help & complaints"
      subtitle="Report a problem with an order, ask a question or tell us how we did. Our customer service team replies within 1 business day."
      actions={contact}
    />
  );

  if (!s.org) {
    return (
      <>
        {header}
        <Notice tone="amber">Your account is not linked to a buyer company. Support tickets are raised by buyer companies.</Notice>
      </>
    );
  }

  const sb = await createClient();
  const [{ data: ticketsRaw }, { data: ordersRaw }] = await Promise.all([
    sb.from('tickets').select('id, code, subject, status, category, updated_at, order_id, orders(code)').eq('org_id', s.org.id).order('updated_at', { ascending: false }).limit(100),
    sb.from('orders').select('id, code, title, status, delivered_at, claim_visible_until, claim_hidden_until').eq('org_id', s.org.id).order('created_at', { ascending: false }).limit(100),
  ]);
  const tickets = (ticketsRaw ?? []) as unknown as TicketRow[];
  const orders = (ordersRaw ?? []) as SupportOrderOption[];

  // Latest visible message per ticket for the list subtitle (RLS hides internal notes; filter anyway).
  const lastMsg = new Map<string, { body: string; is_staff: boolean; created_at: string }>();
  if (tickets.length) {
    const { data: msgs } = await sb
      .from('ticket_messages')
      .select('ticket_id, body, is_staff, created_at')
      .in('ticket_id', tickets.map((t) => t.id))
      .eq('internal', false)
      .order('created_at', { ascending: false })
      .limit(500);
    (msgs ?? []).forEach((m) => {
      if (!lastMsg.has(m.ticket_id as string)) lastMsg.set(m.ticket_id as string, { body: m.body as string, is_staff: !!m.is_staff, created_at: m.created_at as string });
    });
  }

  const defaultOrderId = orderParam && orders.some((o) => o.id === orderParam) ? orderParam : null;

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <Card title="New complaint or request">
          <div className="px-6 pb-6">
            <SupportNewTicket orders={orders} defaultOrderId={defaultOrderId} orgId={s.org.id} now={nowMs()} />
          </div>
        </Card>

        <aside className="space-y-5">
          <Card>
            <div className="p-5">
              <h2 className="text-lg font-semibold">Claim windows</h2>
              <ul className="mt-3 space-y-2 text-[15px]">
                <li><span className="font-semibold">{settings.claim_visible_days} days</span> <span className="text-muted">after delivery for visible problems — shortage, wrong goods, transit damage.</span></li>
                <li><span className="font-semibold">{settings.claim_hidden_days} days</span> <span className="text-muted">after delivery for hidden defects.</span></li>
              </ul>
              <p className="mt-3 text-sm text-muted">Photos of cartons, labels and the packing list help us resolve claims faster. Please keep the goods until we agree next steps.</p>
            </div>
          </Card>
          <Card>
            <div className="p-5">
              <h2 className="text-lg font-semibold">Talk to us</h2>
              <dl className="mt-3 space-y-2 text-[15px]">
                {company?.whatsapp && (
                  <div><dt className="text-sm text-muted">WhatsApp</dt><dd><a className="font-semibold underline" href={whatsappHref(company.whatsapp)} target="_blank" rel="noopener noreferrer">{company.whatsapp}</a></dd></div>
                )}
                {company?.email && (
                  <div><dt className="text-sm text-muted">Email</dt><dd><a className="font-semibold underline" href={`mailto:${company.email}`}>{company.email}</a></dd></div>
                )}
                {company?.phone && (
                  <div><dt className="text-sm text-muted">Phone</dt><dd><a className="font-semibold underline" href={`tel:${company.phone.replace(/\s+/g, '')}`}>{company.phone}</a></dd></div>
                )}
                {!company?.whatsapp && !company?.email && !company?.phone && <p className="text-sm text-muted">Use the form to reach our team.</p>}
              </dl>
            </div>
          </Card>
        </aside>
      </div>

      <section className="card mt-6" aria-labelledby="my-tickets">
        <h2 id="my-tickets" className="text-lg font-semibold px-6 pt-5 pb-3">My tickets</h2>
        {tickets.length === 0 ? (
          <EmptyState title="No tickets yet" body="Complaints, questions and feedback you send will appear here with our replies." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">Ticket</th><th className="th">Subject</th><th className="th">Order</th><th className="th">Status</th><th className="th">Updated</th>
                  <th className="th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const m = lastMsg.get(t.id);
                  return (
                    <tr key={t.id}>
                      <td className="td mono text-sm whitespace-nowrap">{t.code}</td>
                      <td className="td min-w-[240px]">
                        <div className="font-semibold">{t.subject}</div>
                        <div className="text-sm text-muted line-clamp-1">
                          {humanize(t.category)}
                          {m ? <> · {m.is_staff ? 'Team replied' : 'You wrote'}: {m.body.length > 90 ? `${m.body.slice(0, 90)}…` : m.body}</> : null}
                        </div>
                      </td>
                      <td className="td whitespace-nowrap text-sm">
                        {t.order_id && t.orders ? <Link href={`/account/orders/${t.order_id}`} className="mono underline">{t.orders.code}</Link> : <span className="text-muted">No order</span>}
                      </td>
                      <td className="td"><StatusBadge status={t.status} label={ticketStatusLabel(t.status)} /></td>
                      <td className="td text-sm text-muted whitespace-nowrap">{fmtDate(t.updated_at)}</td>
                      <td className="td text-right"><Link href={`/account/support/${t.id}`} className="btn btn-ghost btn-sm" aria-label={`Open ticket ${t.code}`}>Open</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
