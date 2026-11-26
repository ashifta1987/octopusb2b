'use client';

import { ErrorState } from '@/components/states';

export default function SegmentError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorState error={error} retry={retry} home="/supplier" />;
}
