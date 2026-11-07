import { redirect } from 'next/navigation';

/** Moved to Account › Product sourcing (7 Nov 2026). */
export default async function RfqsMoved({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  redirect(status === 'closed' ? '/account/sourcing?type=sourcing&status=Closed' : '/account/sourcing?type=sourcing');
}
