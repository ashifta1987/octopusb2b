/** Shared (server + client safe) helpers for the customer support pages. */

const TICKET_LABELS: Record<string, string> = {
  new: 'New',
  open: 'Open',
  waiting_customer: 'Waiting for you',
  waiting_internal: 'With our team',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
};

export function ticketStatusLabel(status: string) {
  return TICKET_LABELS[status] ?? status.replace(/_/g, ' ');
}

export function whatsappHref(number: string) {
  return `https://wa.me/${number.replace(/[^0-9]/g, '')}`;
}

export type TicketAttachment = { path: string; name: string };

export function parseAttachments(v: unknown): TicketAttachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => (a && typeof a === 'object' ? (a as Record<string, unknown>) : null))
    .filter((a): a is Record<string, unknown> => !!a && typeof a.path === 'string')
    .map((a) => ({ path: a.path as string, name: typeof a.name === 'string' ? a.name : (a.path as string).split('/').pop() ?? 'file' }));
}
