'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { can } from '@/lib/auth';
import { slugify } from '@/lib/format';
import { guard, fail, ok, str, bool, type Result } from '@/components/admin/server';

type Sb = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

function refresh(extra: string[] = []) {
  revalidateTag('site-content', 'max');
  revalidatePath('/admin/content');
  extra.forEach((p) => revalidatePath(p));
}

async function snapshot(sb: Sb, entity: string, id: string, data: unknown, userId: string) {
  await sb.from('content_versions').insert({ entity, entity_id: id, snapshot: data as never, created_by: userId });
}

/* ───────── Content blocks ───────── */
export async function saveBlock(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const key = str(fd, 'key');
  const value = String(fd.get('value') ?? '');
  if (!/^[a-z0-9_.-]{2,80}$/i.test(key)) return fail('Invalid key');
  const { data, error } = await g.sb.from('content_blocks').update({ value, updated_by: g.s.userId, updated_at: new Date().toISOString() }).eq('key', key).select('key');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  await snapshot(g.sb, 'content_block', key, { value }, g.s.userId);
  refresh(['/']);
  return ok('Saved');
}

export async function createBlock(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'create');
  if ('error' in g) return g.error;
  const key = str(fd, 'key');
  const value = String(fd.get('value') ?? '');
  if (!/^[a-z0-9_.-]{2,80}$/i.test(key)) return fail('Key: letters, digits, dot, dash, underscore');
  const { error } = await g.sb.from('content_blocks').insert({ key, value, status: 'published', updated_by: g.s.userId });
  if (error) return fail(error);
  await snapshot(g.sb, 'content_block', key, { value }, g.s.userId);
  refresh(['/']);
  return ok('Block created');
}

/* ───────── Pages ───────── */
const PageInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  body: z.string().max(100_000),
  intent: z.enum(['draft', 'review', 'publish']),
});

/**
 * Save a page. Content editors draft and submit for review; only Admin publishes legal pages
 * (also enforced by the trg_guard_pages_publish trigger). A live legal page edited by a non-admin
 * becomes a proposal in content_versions that an Admin applies.
 */
export async function savePage(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const p = PageInput.safeParse({ id: str(fd, 'id'), title: str(fd, 'title'), body: String(fd.get('body') ?? ''), intent: str(fd, 'intent') || 'draft' });
  if (!p.success) return fail('Title (2+ characters) and body are required.');
  const { data: page } = await g.sb.from('pages').select('id, slug, status, is_legal').eq('id', p.data.id).maybeSingle();
  if (!page) return fail('NOT_FOUND');
  const isAdmin = g.s.isAdmin;
  const canPublish = page.is_legal ? isAdmin : (isAdmin || can(g.s, 'content', 'approve') || can(g.s, 'content', 'edit'));

  if (page.is_legal && !isAdmin && (page.status === 'published' || page.status === 'scheduled')) {
    await snapshot(g.sb, 'page_proposal', page.id, { title: p.data.title, body: p.data.body, status: 'in_review' }, g.s.userId);
    refresh();
    return ok('Submitted for Admin approval — the live page is unchanged until an Admin publishes it.');
  }
  if (p.data.intent === 'publish' && !canPublish) return fail('PUBLISH_NEEDS_ADMIN');
  const status = p.data.intent === 'publish' ? 'published' : p.data.intent === 'review' ? 'in_review' : 'draft';
  const { error } = await g.sb.from('pages').update({
    title: p.data.title, body: p.data.body, status, updated_by: g.s.userId, updated_at: new Date().toISOString(),
    ...(status === 'published' ? { published_at: new Date().toISOString() } : {}),
  }).eq('id', page.id);
  if (error) return fail(error);
  await snapshot(g.sb, 'page', page.id, { title: p.data.title, body: p.data.body, status }, g.s.userId);
  refresh([`/${page.slug}`, `/legal/${page.slug}`, `/pages/${page.slug}`]);
  return ok(status === 'published' ? 'Published' : status === 'in_review' ? 'Sent for review' : 'Draft saved');
}

/** Admin publishes a proposal (snapshot) submitted for a live legal page. */
export async function applyProposal(versionId: string): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('PUBLISH_NEEDS_ADMIN');
  const { data: v } = await g.sb.from('content_versions').select('id, entity, entity_id, snapshot').eq('id', versionId).maybeSingle();
  if (!v || v.entity !== 'page_proposal') return fail('NOT_FOUND');
  const snap = v.snapshot as { title: string; body: string };
  const { data: page, error } = await g.sb.from('pages').update({ title: snap.title, body: snap.body, status: 'published', published_at: new Date().toISOString(), updated_by: g.s.userId })
    .eq('id', v.entity_id).select('slug').maybeSingle();
  if (error) return fail(error);
  await g.sb.from('content_versions').update({ entity: 'page_proposal_applied' }).eq('id', versionId);
  await snapshot(g.sb, 'page', v.entity_id, { ...snap, status: 'published', from_proposal: versionId }, g.s.userId);
  refresh(page ? [`/${page.slug}`, `/legal/${page.slug}`] : []);
  return ok('Proposal published');
}

export async function createPage(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'create');
  if ('error' in g) return g.error;
  const title = str(fd, 'title');
  const slug = slugify(str(fd, 'slug') || title);
  if (title.length < 2 || !slug) return fail('Title and slug are required.');
  const { error } = await g.sb.from('pages').insert({ slug, title, body: '', status: 'draft', is_legal: bool(fd, 'is_legal'), updated_by: g.s.userId });
  if (error) return fail(error);
  refresh();
  return ok(`Page /${slug} created as draft`);
}

/* ───────── Terms & conditions (15 sections) ───────── */
type Section = { no: number; title: string; body: string };

function nextVersion(v: string) {
  const m = v.match(/^v?(\d+)\.(\d+)$/);
  return m ? `v${m[1]}.${Number(m[2]) + 1}` : `${v}-next`;
}

export async function newTermsDraft(): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const { data: open } = await g.sb.from('terms_versions').select('id').in('status', ['draft', 'in_review']).limit(1);
  if (open?.length) return fail('A draft already exists — edit or publish it first.');
  const { data: latest } = await g.sb.from('terms_versions').select('version, sections').order('created_at', { ascending: false }).limit(1).maybeSingle();
  let sections = (latest?.sections as Section[] | null) ?? [];
  if (sections.length !== 15) sections = Array.from({ length: 15 }, (_, i) => sections[i] ?? { no: i + 1, title: `Section ${i + 1}`, body: '' });
  const { error } = await g.sb.from('terms_versions').insert({ version: nextVersion(latest?.version ?? 'v0.9'), status: 'draft', sections, created_by: g.s.userId });
  if (error) return fail(error);
  refresh();
  return ok('New draft created from the latest version');
}

export async function saveTermsSection(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const id = str(fd, 'id');
  const no = Number(str(fd, 'no'));
  const title = str(fd, 'title');
  const body = String(fd.get('body') ?? '');
  if (!id || !(no >= 1 && no <= 15) || title.length < 2) return fail('Section title is required.');
  const { data: t } = await g.sb.from('terms_versions').select('id, status, sections, version').eq('id', id).maybeSingle();
  if (!t) return fail('NOT_FOUND');
  if (!['draft', 'in_review'].includes(t.status)) return fail('Only drafts can be edited. Create a new draft first.');
  const sections = ((t.sections as Section[]) ?? []).map((x) => (x.no === no ? { ...x, title, body } : x));
  if (!sections.some((x) => x.no === no)) sections.push({ no, title, body });
  sections.sort((a, b) => a.no - b.no);
  const { error } = await g.sb.from('terms_versions').update({ sections }).eq('id', id);
  if (error) return fail(error);
  await snapshot(g.sb, 'terms_section', `${id}:${no}`, { version: t.version, no, title, body }, g.s.userId);
  refresh();
  return ok(`Section ${no} saved`);
}

export async function setTermsStatus(id: string, to: 'draft' | 'in_review'): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.from('terms_versions').update({ status: to }).eq('id', id).in('status', ['draft', 'in_review']).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('INVALID_TRANSITION');
  refresh();
  return ok(to === 'in_review' ? 'Sent for Admin approval' : 'Moved back to draft');
}

/** Admin publishes now (supersedes the live version) or schedules publish_at. */
export async function publishTerms(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('PUBLISH_NEEDS_ADMIN');
  const id = str(fd, 'id');
  const when = str(fd, 'publish_at');
  let at: string | null = null;
  if (when) {
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) return fail('Invalid date');
    if (d.getTime() > Date.now()) at = d.toISOString();
  }
  const { data, error } = await g.sb.rpc('publish_terms', { p_id: id, p_publish_at: at });
  if (error) return fail(error);
  refresh(['/legal/terms', '/terms']);
  return ok(data === 'scheduled' ? `Scheduled for ${new Date(at!).toUTCString()}` : 'Published — previous version superseded');
}

/* ───────── Company & branches ───────── */
const Company = z.object({
  legal_name: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(80).optional(),
  tagline: z.string().trim().max(160).optional(),
  address: z.string().trim().max(500).optional(),
  address_cn: z.string().trim().max(500).optional(),
  contact_person: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  website: z.string().trim().max(120).optional(),
});

export async function saveCompany(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const raw = Object.fromEntries(['legal_name', 'brand', 'tagline', 'address', 'address_cn', 'contact_person', 'phone', 'whatsapp', 'email', 'website'].map((k) => [k, str(fd, k)]));
  const p = Company.safeParse(raw);
  if (!p.success) return fail(p.error.issues[0]?.path.join('.') + ': ' + p.error.issues[0]?.message);
  const clean = Object.fromEntries(Object.entries(p.data).map(([k, v]) => [k, v === '' ? null : v]));
  const { data, error } = await g.sb.from('company_profile').update({ ...clean, updated_at: new Date().toISOString() }).eq('id', 1).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  await snapshot(g.sb, 'company_profile', '1', clean, g.s.userId);
  refresh(['/', '/contact']);
  return ok('Company details saved');
}

export async function saveBranch(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const id = str(fd, 'id');
  const row = {
    name: str(fd, 'name'), city: str(fd, 'city') || null, country: str(fd, 'country') || null, address: str(fd, 'address') || null,
    phone: str(fd, 'phone') || null, email: str(fd, 'email') || null, sort: Number(str(fd, 'sort') || 0), active: bool(fd, 'active'),
  };
  if (row.name.length < 2) return fail('Branch name is required.');
  const q = id ? g.sb.from('branches').update(row).eq('id', id).select('id') : g.sb.from('branches').insert(row).select('id');
  const { data, error } = await q;
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  refresh(['/contact']);
  return ok(id ? 'Branch saved' : 'Branch added');
}

export async function deleteBranch(id: string): Promise<Result> {
  const g = await guard('content', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.from('branches').delete().eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  refresh(['/contact']);
  return ok('Branch deleted');
}
