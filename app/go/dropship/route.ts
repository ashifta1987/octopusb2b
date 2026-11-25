import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isDropshipV2UiEnabled } from '@/lib/dropship';

/**
 * Old "Start dropshipping" link. Dropshipping is Coming soon (21 Nov 2026): everyone goes to the launch sign-up on
 * /request/dropship#notify, except a company whose Dropshipping service staff already switched on (→ its catalogue).
 */
export async function GET(req: Request) {
  // Batch 3 (F-15): when Octopus Dropship is open (dropship_v2_ui ON) the old link opens the Dropship app itself
  if (await isDropshipV2UiEnabled()) return NextResponse.redirect(new URL('/account/dropship', req.url));
  const s = await getSession();
  let to = '/request/dropship#notify';
  if (s?.org) {
    const sb = await createClient();
    const { data } = await sb.from('company_services').select('status').eq('org_id', s.org.id).eq('service', 'dropship').maybeSingle();
    if (data && data.status === 'on') to = '/account/dropship/catalogue';
  }
  return NextResponse.redirect(new URL(to, req.url));
}
