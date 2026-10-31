import { redirect } from 'next/navigation';
/** Spec URL for the Group Buy Terms (SPEC §18); the terms page lives at /pools/terms. */
export default function GroupBuyTerms() { redirect('/pools/terms'); }
