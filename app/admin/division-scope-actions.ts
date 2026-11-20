'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { DIVISION_COOKIE, staffDivisions } from '@/lib/divisions/scope';

/** Division switcher (header): "all" or a division code this person may see. Lists, counts and notifications follow it. */
export async function setDivisionScope(fd: FormData) {
  const s = await getSession();
  if (!s?.isStaff) return;
  const code = String(fd.get('division') ?? 'all');
  const allowed = code === 'all' || (await staffDivisions(s)).some((d) => d.code === code);
  const jar = await cookies();
  if (!allowed || code === 'all') jar.delete(DIVISION_COOKIE);
  else jar.set(DIVISION_COOKIE, code, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/admin', 'layout');
  revalidatePath('/office', 'layout');
}
