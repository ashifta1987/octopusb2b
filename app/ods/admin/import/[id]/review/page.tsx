// ODS T9 · /admin/import/<id>/review → the review queue filtered to this run, exactly as today (ADDON-27 §7). Replaces the
// T8 re-export of app/admin/import/[id]/review/page.tsx; no screen of its own.
import { redirect } from 'next/navigation';

export default async function RunReviewRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/import/review?run=${encodeURIComponent(id)}`);
}
