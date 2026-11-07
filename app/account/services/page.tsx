import { redirect } from 'next/navigation';

/** Service requests are listed in Account › Product sourcing (filter by type) since 7 Nov 2026. */
export default function ServicesMoved() {
  redirect('/account/sourcing');
}
