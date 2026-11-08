import Link from 'next/link';
import { MailDeliverabilityAlert } from '@/components/admin/mail-deliverability';
import { HomeTab } from './home-tab';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Notice, Table } from '@/components/ui';
import { Tabs, Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  saveBlock, createBlock, savePage, applyProposal, createPage, newTermsDraft, saveTermsSection, setTermsStatus, publishTerms,
  saveCompany, saveBranch, deleteBranch,
} from './actions';
import { nowMs } from '@/components/admin/server';

export const metadata = { title: 'Site content' };

type Section = { no: number; title: string; body: string };
type Terms = { id: string; version: string; status: string; sections: Section[]; publish_at: string | null; published_at: string | null; created_at: string };

const TABS = [
  { key: 'terms', label: 'Terms & conditions' },
  { key: 'pages', label: 'Pages' },
  { key: 'blocks', label: 'Content blocks' },
  { key: 'company', label: 'Company & branches' },
  { key: 'home', label: 'Home page' },
];

/** Admin → Site content (CMS.png). Content editors draft; Admin publishes legal pages. */
export default async function ContentPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string; s?: string; v?: string }> }) {
  const sess = await requireStaff('content', 'view', '/admin/content');
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : 'terms';
  const editable = can(sess, 'content', 'edit');

  return (
    <>
      <PageHeader
        title="Site content"
        subtitle="Edit every page, text block and legal document except products. Content editors can draft; Admin publishes legal pages."
      />
      <Tabs tabs={TABS} active={tab} base="/admin/content" />
      {!editable && <div className="mb-6"><Notice>Read-only: editing needs the Site content · edit permission.</Notice></div>}
      {tab === 'terms' && <TermsTab isAdmin={sess.isAdmin} editable={editable} sectionNo={Number(sp.s) || 1} viewId={sp.v} />}
      {tab === 'pages' && <PagesTab isAdmin={sess.isAdmin} editable={editable} canCreate={can(sess, 'content', 'create')} slug={sp.page} />}
      {tab === 'blocks' && <BlocksTab editable={editable} canCreate={can(sess, 'content', 'create')} />}
      {tab === 'company' && <CompanyTab editable={editable} isAdmin={sess.isAdmin} />}
      {tab === 'home' && <HomeTab editable={editable} isAdmin={sess.isAdmin} />}
    </>
  );
}

/* ───────── Terms ───────── */
async function TermsTab({ isAdmin, editable, sectionNo, viewId }: { isAdmin: boolean; editable: boolean; sectionNo: number; viewId?: string }) {
  const sb = await createClient();
  const [{ data }, { data: settings }] = await Promise.all([
    sb.from('terms_versions').select('id, version, status, sections, publish_at, published_at, created_at').eq('kind', 'general').order('created_at', { ascending: false }),
    sb.from('site_settings').select('key, value'),
  ]);
  const versions = (data ?? []) as Terms[];
  const live = versions.find((v) => v.status === 'published');
  const working = versions.find((v) => v.status === 'draft' || v.status === 'in_review');
  const scheduled = versions.find((v) => v.status === 'scheduled');
  const current = (viewId && versions.find((v) => v.id === viewId)) || working || scheduled || live;
  const settingMap = new Map((settings ?? []).map((r) => [r.key, r.value]));
  if (!current) {
    return (
      <Card><EmptyState title="No terms yet" body="Create the first draft with 15 sections." action={editable && <RunButton className="btn btn-primary" action={newTermsDraft}>Create draft</RunButton>} /></Card>
    );
  }
  const canEdit = editable && ['draft', 'in_review'].includes(current.status);
  const no = Math.min(15, Math.max(1, sectionNo));
  const section = current.sections.find((x) => x.no === no) ?? { no, title: `Section ${no}`, body: '' };
  const vars = [...new Set([...(section.body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi))].map((m) => m[1]))];
  const vParam = viewId ? `&v=${viewId}` : '';
  const localNow = new Date(nowMs() + 14 * 864e5).toISOString().slice(0, 16);

  return (
    <div className="grid gap-6">
      <Card>
        <div className="px-6 pt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mono text-xs text-muted">LEGAL · /legal/terms · {live ? `live version ${live.version} (${fmtDate(live.published_at)})` : 'no live version'}</div>
            <h2 className="text-2xl font-semibold mt-1">Terms and Conditions · {current.version}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={current.status} label={current.status === 'published' ? `Live ${current.version}` : undefined} />
            {editable && !working && <RunButton className="btn btn-ghost btn-sm" confirm="Create a new draft copying the latest version?" action={newTermsDraft}>New draft version</RunButton>}
          </div>
        </div>
        {!canEdit && (
          <div className="px-6 pt-3"><Notice tone="blue">{current.status === 'published' ? 'This is the live version and cannot be edited. Create a new draft version to make changes.' : `This version is ${current.status}. It cannot be edited.`}</Notice></div>
        )}
        <nav aria-label="Sections" className="px-6 pt-4 flex flex-wrap gap-2">
          {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
            <Link key={n} href={`/admin/content?tab=terms&s=${n}${vParam}`} aria-current={n === no ? 'true' : undefined} aria-label={`Section ${n}`}
              className={cn('min-w-10 h-10 inline-flex items-center justify-center rounded-[8px] border mono text-sm font-semibold', n === no ? 'bg-ink text-white border-ink' : 'bg-white border-line-strong hover:border-ink')}>
              {n}
            </Link>
          ))}
        </nav>
        <ActionForm key={`${current.id}-${no}`} action={saveTermsSection} className="px-6 pb-6 pt-4 grid gap-4" submitLabel={`Save section ${no}`} hideSubmit={!canEdit}>
          <input type="hidden" name="id" value={current.id} />
          <input type="hidden" name="no" value={no} />
          <Field label={`Section ${no} title`} htmlFor="t-title"><input id="t-title" name="title" className="input" defaultValue={section.title} required disabled={!canEdit} /></Field>
          <Field label="Section text" htmlFor="t-body" hint={<>Values in double braces come from Admin settings and stay in sync, e.g. <code className="mono">{'{{deposit_pct}}'}</code>.</>}>
            <textarea id="t-body" name="body" className="input min-h-[260px] py-3 leading-relaxed" defaultValue={section.body} disabled={!canEdit} />
          </Field>
          {vars.length > 0 && (
            <div>
              <div className="label">Live values used in this section</div>
              <div className="flex flex-wrap gap-2">
                {vars.map((k) => settingMap.has(k)
                  ? <span key={k} className="rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-coral-text">{k} = {String(settingMap.get(k))}</span>
                  : <span key={k} className="rounded-full bg-warn-bg px-2.5 py-1 text-xs font-semibold text-warn">{k} = not set</span>)}
              </div>
            </div>
          )}
        </ActionForm>
      </Card>

      <Card title="Publish" action={<span className="text-sm text-muted">Legal pages need Admin approval</span>}>
        <div className="px-6 pb-6 grid gap-4">
          {scheduled && <Notice tone="amber">{scheduled.version} is scheduled to go live on {fmtDate(scheduled.publish_at, true)} {scheduled.publish_at && new Date(scheduled.publish_at).getFullYear()}.</Notice>}
          {working ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{working.version}</span><StatusBadge status={working.status} />
                {editable && working.status === 'draft' && <RunButton className="btn btn-ghost btn-sm" confirm={`Send ${working.version} for Admin approval?`} action={setTermsStatus.bind(null, working.id, 'in_review')}>Send {working.version} for Admin approval</RunButton>}
                {editable && working.status === 'in_review' && <RunButton className="btn btn-ghost btn-sm" action={setTermsStatus.bind(null, working.id, 'draft')}>Back to draft</RunButton>}
              </div>
              {isAdmin ? (
                <ActionForm action={publishTerms} className="grid gap-3 sm:grid-cols-[260px_auto] items-end" submitLabel={`Publish ${working.version}`} confirm={`Publish ${working.version}? The current live version will be superseded (or it will be scheduled if you picked a future date).`} inline>
                  <input type="hidden" name="id" value={working.id} />
                  <Field label="Applies from (leave empty = now)" htmlFor="t-at" hint={`Suggested: 14 days notice → ${localNow.slice(0, 10)}`}><input id="t-at" name="publish_at" type="datetime-local" className="input" /></Field>
                </ActionForm>
              ) : <p className="text-sm text-muted">An Admin reviews and publishes or schedules this version.</p>}
            </>
          ) : <p className="text-sm text-muted">No draft in progress. {editable && 'Create a new draft version to propose changes.'}</p>}

          <div className="border-t border-line pt-4">
            <h3 className="font-semibold mb-2">Version history</h3>
            <ul className="divide-y divide-line">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-4 py-2.5 text-sm">
                  <span className="mono font-semibold w-16">{v.version}</span>
                  <StatusBadge status={v.status} />
                  <span className="text-muted">{v.published_at ? `published ${fmtDate(v.published_at)}` : v.publish_at ? `scheduled ${fmtDate(v.publish_at)}` : `created ${fmtDate(v.created_at)}`}</span>
                  <Link href={`/admin/content?tab=terms&v=${v.id}&s=${no}`} className="ml-auto btn btn-ghost btn-sm">View</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ───────── Pages ───────── */
async function PagesTab({ isAdmin, editable, canCreate, slug }: { isAdmin: boolean; editable: boolean; canCreate: boolean; slug?: string }) {
  const sb = await createClient();
  const { data } = await sb.from('pages').select('id, slug, title, body, status, is_legal, published_at, updated_at').order('is_legal', { ascending: false }).order('title');
  const pages = data ?? [];
  const page = pages.find((p) => p.slug === slug) ?? pages[0];
  const [{ data: proposals }, { data: history }] = page ? await Promise.all([
    sb.from('content_versions').select('id, snapshot, created_by, created_at').eq('entity', 'page_proposal').eq('entity_id', page.id).order('created_at', { ascending: false }),
    sb.from('content_versions').select('id, snapshot, created_by, created_at').eq('entity', 'page').eq('entity_id', page.id).order('created_at', { ascending: false }).limit(10),
  ]) : [{ data: [] }, { data: [] }];
  const people = [...new Set([...(proposals ?? []), ...(history ?? [])].map((x) => x.created_by).filter(Boolean) as string[])];
  const { data: profs } = people.length ? await sb.from('profiles').select('id, full_name').in('id', people) : { data: [] };
  const who = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
  const legalLive = page && page.is_legal && ['published', 'scheduled'].includes(page.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="grid gap-6 self-start">
        <Card className="overflow-hidden">
          {pages.length === 0 ? <EmptyState title="No pages yet" /> : (
            <ul>
              {(['Legal', 'Pages'] as const).map((group) => (
                <li key={group}>
                  <div className="px-5 pt-4 pb-1 mono text-xs font-semibold uppercase tracking-wider text-muted">{group}</div>
                  <ul>
                    {pages.filter((p) => (group === 'Legal') === p.is_legal).map((p) => (
                      <li key={p.id}>
                        <Link href={`/admin/content?tab=pages&page=${p.slug}`} aria-current={page?.id === p.id ? 'true' : undefined}
                          className={cn('flex items-center justify-between gap-3 px-5 py-3', page?.id === p.id ? 'bg-tint border-l-4 border-l-coral-text' : 'hover:bg-pearl')}>
                          <span className="font-medium">{p.title}</span><StatusBadge status={p.status} label={p.status === 'published' ? 'Live' : undefined} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canCreate && (
          <Card title="New page">
            <ActionForm action={createPage} className="px-5 pb-5 grid gap-3" submitLabel="Create draft" resetOnSuccess>
              <Field label="Title" htmlFor="np-title"><input id="np-title" name="title" className="input" required /></Field>
              <Field label="Slug" htmlFor="np-slug" hint="Optional — generated from the title"><input id="np-slug" name="slug" className="input mono" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_legal" /> Legal page (Admin must publish)</label>
            </ActionForm>
          </Card>
        )}
      </div>

      {page ? (
        <div className="grid gap-6">
          <Card>
            <div className="px-6 pt-5 flex flex-wrap justify-between gap-3">
              <div>
                <div className="mono text-xs text-muted">{page.is_legal ? 'LEGAL' : 'PAGE'} · /{page.slug} · updated {fmtDate(page.updated_at, true)}</div>
                <h2 className="text-2xl font-semibold mt-1">{page.title}</h2>
              </div>
              <StatusBadge status={page.status} label={page.status === 'published' ? 'Live' : undefined} />
            </div>
            {legalLive && !isAdmin && <div className="px-6 pt-3"><Notice tone="amber">This legal page is live. Your changes are saved as a proposal for an Admin to publish.</Notice></div>}
            <ActionForm key={page.id} action={savePage} className="px-6 pb-6 pt-4 grid gap-4" hideSubmit>
              <input type="hidden" name="id" value={page.id} />
              <Field label="Title" htmlFor="pg-title"><input id="pg-title" name="title" className="input" defaultValue={page.title} required disabled={!editable} /></Field>
              <Field label="Body" htmlFor="pg-body" hint="Plain text / Markdown."><textarea id="pg-body" name="body" className="input min-h-[320px] py-3 leading-relaxed" defaultValue={page.body} disabled={!editable} /></Field>
              {editable && (
                <div className="flex flex-wrap gap-3">
                  {legalLive && !isAdmin ? (
                    <button className="btn btn-primary" name="intent" value="review">Submit changes for Admin approval</button>
                  ) : (
                    <>
                      <button className="btn btn-ghost" name="intent" value="draft">Save draft</button>
                      <button className="btn btn-ghost" name="intent" value="review">Send for review</button>
                      {(!page.is_legal || isAdmin) && <button className="btn btn-primary" name="intent" value="publish">Publish</button>}
                    </>
                  )}
                </div>
              )}
            </ActionForm>
          </Card>

          {(proposals ?? []).length > 0 && (
            <Card title="Proposals waiting for Admin">
              <ul className="px-6 pb-5 divide-y divide-line">
                {(proposals ?? []).map((p) => {
                  const snap = p.snapshot as { title: string; body: string };
                  return (
                    <li key={p.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold">{snap.title}</span>
                        <span className="text-sm text-muted">by {p.created_by ? who.get(p.created_by) ?? '—' : '—'} · {fmtDate(p.created_at, true)}</span>
                        {isAdmin && <span className="ml-auto"><RunButton className="btn btn-primary btn-sm" confirm="Publish this proposal to the live legal page?" action={applyProposal.bind(null, p.id)}>Publish proposal</RunButton></span>}
                      </div>
                      <details className="mt-2"><summary className="text-sm cursor-pointer text-coral-text">Show text</summary><pre className="mt-2 whitespace-pre-wrap text-sm bg-pearl rounded-md p-3 max-h-64 overflow-auto">{snap.body}</pre></details>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card title="Version history">
            {(history ?? []).length === 0 ? <EmptyState title="No saved versions yet" /> : (
              <ul className="px-6 pb-5 divide-y divide-line">
                {(history ?? []).map((h) => {
                  const snap = h.snapshot as { status?: string; title?: string };
                  return (
                    <li key={h.id} className="py-2.5 flex flex-wrap items-center gap-3 text-sm">
                      <span className="mono text-xs text-muted">{fmtDate(h.created_at, true)}</span>
                      {snap.status && <StatusBadge status={snap.status} />}
                      <span>{snap.title}</span>
                      <span className="text-muted ml-auto">{h.created_by ? who.get(h.created_by) ?? '—' : '—'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : <Card><EmptyState title="Select a page" /></Card>}
    </div>
  );
}

/* ───────── Content blocks ───────── */
async function BlocksTab({ editable, canCreate }: { editable: boolean; canCreate: boolean }) {
  const sb = await createClient();
  const { data } = await sb.from('content_blocks').select('key, value, status, updated_at').order('key');
  const blocks = data ?? [];
  return (
    <div className="grid gap-6">
      <Card title="Content blocks" action={<span className="text-sm text-muted">{blocks.length} blocks · use “|” to separate list items</span>}>
        {blocks.length === 0 ? <EmptyState title="No content blocks" /> : (
          <ul className="divide-y divide-line">
            {blocks.map((b) => (
              <li key={b.key} className="px-6 py-4">
                <ActionForm action={saveBlock} className="grid gap-2 lg:grid-cols-[220px_1fr_auto] items-start" submitLabel="Save" submitClass="btn btn-ghost btn-sm" hideSubmit={!editable} inline>
                  <input type="hidden" name="key" value={b.key} />
                  <label htmlFor={`blk-${b.key}`} className="mono text-sm font-semibold pt-2 break-all">{b.key}<span className="block text-xs font-normal text-muted">updated {fmtDate(b.updated_at)}</span></label>
                  <textarea id={`blk-${b.key}`} name="value" className="input py-2 min-h-[44px]" rows={Math.min(6, Math.ceil(b.value.length / 90) || 1)} defaultValue={b.value} disabled={!editable} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canCreate && (
        <Card title="Add content block">
          <ActionForm action={createBlock} className="px-6 pb-6 grid gap-4 sm:grid-cols-[260px_1fr]" submitLabel="Add block" resetOnSuccess>
            <Field label="Key" htmlFor="nb-key" hint="e.g. home.banner.title"><input id="nb-key" name="key" className="input mono" required /></Field>
            <Field label="Value" htmlFor="nb-value"><textarea id="nb-value" name="value" className="input py-2" required /></Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

/* ───────── Company & branches ───────── */
async function CompanyTab({ editable, isAdmin }: { editable: boolean; isAdmin: boolean }) {
  const sb = await createClient();
  const [{ data: company }, { data: branches }] = await Promise.all([
    sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
    sb.from('branches').select('*').order('sort'),
  ]);
  const c = (company ?? {}) as Record<string, string | null>;
  const fields: [string, string, boolean?][] = [
    ['legal_name', 'Legal name'], ['brand', 'Brand'], ['tagline', 'Tagline'], ['contact_person', 'Contact person'],
    ['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['website', 'Website'], ['address', 'Address', true], ['address_cn', 'Address (Chinese)', true],
    ['legal_name_cn', 'Legal name (Chinese)'], ['registered_in', 'Registered in'], ['governing_law', 'T&C governed by'],
  ];
  const countries = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <div className="grid gap-6">
      <div><MailDeliverabilityAlert showOk /></div>
      <Card title="Company details" action={<span className="text-sm text-muted">Shown in the footer, About and Contact pages and every document</span>}>
        <ActionForm action={saveCompany} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Save company details" hideSubmit={!editable}>
          {fields.map(([k, label, wide]) => (
            <Field key={k} label={label} htmlFor={`co-${k}`} className={wide ? 'sm:col-span-2' : undefined}>
              {wide ? <textarea id={`co-${k}`} name={k} className="input py-2 min-h-16" defaultValue={c[k] ?? ''} disabled={!editable} />
                : <input id={`co-${k}`} name={k} className="input" defaultValue={c[k] ?? ''} required={k === 'legal_name'} disabled={!editable} type={k === 'email' ? 'email' : 'text'} />}
            </Field>
          ))}
        </ActionForm>
      </Card>

      <Notice tone="blue">Bank accounts customers pay into are now in <Link href="/admin/settings/payment" className="font-semibold underline">Admin › Payment settings</Link> (finance and owner).</Notice>

      <Card title="Branches">
        <Table head={['Branch', 'Details', '']} empty={<EmptyState title="No branches yet" />}>
          {(branches ?? []).map((b) => (
            <tr key={b.id}>
              <td className="td align-top w-[40%]" colSpan={2}>
                <ActionForm action={saveBranch} className="grid gap-3 sm:grid-cols-3" submitLabel="Save branch" submitClass="btn btn-ghost btn-sm" hideSubmit={!editable}>
                  <input type="hidden" name="id" value={b.id} />
                  <BranchFields b={b} editable={editable} countries={countries} prefix={b.id} />
                </ActionForm>
              </td>
              <td className="td align-top text-right">
                {editable && <RunButton className="btn btn-ghost btn-sm" confirm={`Delete branch “${b.name}”? This cannot be undone.`} action={deleteBranch.bind(null, b.id)}>Delete</RunButton>}
              </td>
            </tr>
          ))}
        </Table>
        {editable && (
          <div className="px-6 py-5 border-t border-line">
            <h3 className="font-semibold mb-3">Add branch</h3>
            <ActionForm action={saveBranch} className="grid gap-3 sm:grid-cols-3" submitLabel="Add branch" resetOnSuccess>
              <BranchFields b={{ active: true, sort: (branches?.length ?? 0) + 1 }} editable countries={countries} prefix="new" />
            </ActionForm>
          </div>
        )}
      </Card>
    </div>
  );
}

function BranchFields({ b, editable, countries, prefix }: { b: Record<string, unknown>; editable: boolean; countries: [string, string][]; prefix: string }) {
  const v = (k: string) => (b[k] == null ? '' : String(b[k]));
  return (
    <>
      <Field label="Name" htmlFor={`${prefix}-name`}><input id={`${prefix}-name`} name="name" className="input" defaultValue={v('name')} required disabled={!editable} /></Field>
      <Field label="City" htmlFor={`${prefix}-city`}><input id={`${prefix}-city`} name="city" className="input" defaultValue={v('city')} disabled={!editable} /></Field>
      <Field label="Country" htmlFor={`${prefix}-country`}>
        <select id={`${prefix}-country`} name="country" className="input" defaultValue={v('country')} disabled={!editable}>
          <option value="">—</option>
          {v('country') && !countries.some(([, n]) => n === v('country')) && <option value={v('country')}>{v('country')}</option>}
          {countries.map(([code, n]) => <option key={code} value={n}>{n}</option>)}
        </select>
      </Field>
      <Field label="Address" htmlFor={`${prefix}-address`} className="sm:col-span-3"><input id={`${prefix}-address`} name="address" className="input" defaultValue={v('address')} disabled={!editable} /></Field>
      <Field label="Phone" htmlFor={`${prefix}-phone`}><input id={`${prefix}-phone`} name="phone" className="input" defaultValue={v('phone')} disabled={!editable} /></Field>
      <Field label="Email" htmlFor={`${prefix}-email`}><input id={`${prefix}-email`} name="email" type="email" className="input" defaultValue={v('email')} disabled={!editable} /></Field>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Field label="Sort" htmlFor={`${prefix}-sort`}><input id={`${prefix}-sort`} name="sort" type="number" className="input" defaultValue={v('sort')} disabled={!editable} /></Field>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="active" defaultChecked={b.active !== false} disabled={!editable} /> Active</label>
      </div>
      <details className="sm:col-span-3 rounded-lg border border-line px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">About page card</summary>
        <div className="grid gap-3 sm:grid-cols-3 mt-3">
          <Field label="City (local script)" htmlFor={`${prefix}-city_local`}><input id={`${prefix}-city_local`} name="city_local" className="input" defaultValue={v('city_local')} disabled={!editable} lang="zh-CN" /></Field>
          <Field label="Province" htmlFor={`${prefix}-province`}><input id={`${prefix}-province`} name="province" className="input" defaultValue={v('province')} disabled={!editable} /></Field>
          <Field label="Badge" htmlFor={`${prefix}-badge`}><input id={`${prefix}-badge`} name="badge" className="input" defaultValue={v('badge')} placeholder="Sourcing office" disabled={!editable} /></Field>
          <Field label="Tagline" htmlFor={`${prefix}-tagline`} className="sm:col-span-2"><input id={`${prefix}-tagline`} name="tagline" className="input" defaultValue={v('tagline')} disabled={!editable} /></Field>
          <Field label="Opening hours" htmlFor={`${prefix}-hours`}><input id={`${prefix}-hours`} name="hours" className="input" defaultValue={v('hours')} placeholder="Mon–Sat 09:00–18:30 CST" disabled={!editable} /></Field>
          <Field label="Specialities (comma-separated)" htmlFor={`${prefix}-specialities`} className="sm:col-span-2">
            <input id={`${prefix}-specialities`} name="specialities" className="input" defaultValue={Array.isArray(b.specialities) ? (b.specialities as string[]).join(', ') : ''} disabled={!editable} />
          </Field>
          <Field label="Chip colour" htmlFor={`${prefix}-tone`}>
            <select id={`${prefix}-tone`} name="tone" className="input" defaultValue={v('tone') || 'blue'} disabled={!editable}>
              {['blue', 'rose', 'cyan', 'pink', 'amber', 'green', 'purple'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Description" htmlFor={`${prefix}-description`} className="sm:col-span-3">
            <textarea id={`${prefix}-description`} name="description" className="input py-2 min-h-20" defaultValue={v('description')} disabled={!editable} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_hq" defaultChecked={b.is_hq === true} disabled={!editable} /> Headquarters</label>
        </div>
      </details>
    </>
  );
}

