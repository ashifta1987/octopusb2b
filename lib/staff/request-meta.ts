import 'server-only';
import { headers } from 'next/headers';

export type RequestMeta = { ip: string | null; ua: string | null };

/** Client IP + device (user agent) for audit entries and the office IP rule (SPEC §17.3). */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return metaFromHeaders(h);
}

export function metaFromHeaders(h: { get(name: string): string | null }): RequestMeta {
  const fwd = h.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0]?.trim() : null) || h.get('x-real-ip') || h.get('cf-connecting-ip') || null;
  const ua = h.get('user-agent');
  return { ip: ip ? ip.replace(/^::ffff:/, '') : null, ua: ua ? ua.slice(0, 400) : null };
}
