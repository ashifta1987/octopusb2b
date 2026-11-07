import { redirect } from 'next/navigation';

/** Moved to /account/sourcing/[ref] (accepts the id as well as the reference). */
export default async function RfqMoved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/account/sourcing/${encodeURIComponent(id)}`);
}
