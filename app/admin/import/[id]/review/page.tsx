import { redirect } from 'next/navigation';

/** /admin/import/<id>/review (ADDON-27 §7) → the review queue filtered to this import run. */
export default async function RunReviewRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/import/review?run=${encodeURIComponent(id)}`);
}
