import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/** "Start dropshipping": signed-in customers go to the catalogue, everyone else to sign-up for Dropshipping. */
export async function GET(req: Request) {
  const s = await getSession();
  const to = s?.org ? '/account/dropship/catalogue' : '/signup?service=dropship';
  return NextResponse.redirect(new URL(to, req.url));
}

