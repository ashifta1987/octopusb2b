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

async function DoRedirect({ params }: { params: Promise<{ id: string }> }): Promise<never> {
  const { id } = await params;
  return redirect(`/office/dropship/${encodeURIComponent(id)}`);
}
