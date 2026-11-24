import { Suspense } from 'react';
import { redirect } from 'next/navigation';

export default function RedirectLegacyDropshipProductEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <DoRedirect params={params} />
    </Suspense>
  );
}

async function DoRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/office/dropship/${encodeURIComponent(id)}`);
}
