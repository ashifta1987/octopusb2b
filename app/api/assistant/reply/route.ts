import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { AssistantError, runReply } from '@/lib/assistant/pipeline';

export const maxDuration = 60;

const body = z.object({
  session_id: z.string().uuid().nullish(),
  message: z.string().trim().min(1, 'Please type a message.').max(4000, 'Messages are limited to 4,000 characters.'),
  page: z.string().max(300).nullish(),
  channel: z.enum(['page', 'drawer', 'api']).optional(),
  prefer_human: z.boolean().optional(),
});

/** POST /api/assistant/reply — one customer turn with Octo (SPEC §20.7 item 2). Customer session; RLS applies to all reads. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!s.org) return NextResponse.json({ error: 'Please complete your company profile first.' }, { status: 400 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  const b = parsed.data;
  try {
    const res = await runReply({
      sb: await createClient(),
      admin: createAdminClient(),
      orgId: s.org.id,
      sessionId: b.session_id ?? null,
      message: b.message,
      page: b.page ?? null,
      channel: b.channel ?? 'page',
      preferHuman: b.prefer_human ?? false,
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof AssistantError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error('[assistant] reply failed', e);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
