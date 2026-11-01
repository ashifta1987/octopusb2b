'use client';

import { ErrorState } from '@/components/states';

/** Error state for this segment (SPEC §8.4). */
export default function SegmentError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorState error={error} retry={retry} home="/admin" />;
}
