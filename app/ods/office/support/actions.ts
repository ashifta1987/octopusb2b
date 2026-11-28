'use server';
import { updateTicket } from '@/app/office/actions';

/** Ticket › Assign to me = TODAY's updateTicket(ticketId, { assign_to_me: true }) (support:edit), unchanged. */
export async function assignTicketToMeAction(ticketId: string) {
  return updateTicket(String(ticketId ?? ''), { assign_to_me: true });
}
