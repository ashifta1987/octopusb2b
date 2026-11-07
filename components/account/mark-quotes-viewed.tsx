'use client';
import { useEffect } from 'react';
import { markQuotesViewed } from '@/app/account/sourcing/actions';

/** Runs once when the customer actually opens the request (never on prefetch). */
export function MarkQuotesViewed({ rfqId }: { rfqId: string }) {
  useEffect(() => { void markQuotesViewed(rfqId); }, [rfqId]);
  return null;
}
