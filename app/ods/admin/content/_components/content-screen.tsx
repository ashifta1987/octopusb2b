'use client';

import Image from 'next/image';
import { useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, EmptyState, StatusPill, Tabs, cx, formatDate } from '@octopus/ui';
import {
  saveBlock, createBlock, savePage, applyProposal, createPage, newTermsDraft, saveTermsSection, setTermsStatus, publishTerms, saveCompany, saveBranch, deleteBranch,
} from '@/app/admin/content/actions';
import { saveBanner, deleteBanner, saveHomeSettings } from '@/app/admin/content/home-actions';
import { saveSiteMedia } from '@/app/admin/content/media-actions';
import { Note, OdsForm, RunAction, WebsiteHead, areaCls, checkCls, fieldCls, hintCls, labelCls } from '../../_website/ods-form';
import { CONTENT_STATUS, CONTENT_TABS, HOME_FEATURES, contentStatusTone, pageIntents, termsSection, termsVars, termsView, type ContentTab } from '../../_website/website-core';
import type { Banner, ContentData } from '../_lib/data';

/** TODAY's Site content actions (app/admin/content/*), called unchanged. Fixtures pass sample ones. */
export const CONTENT_ACTIONS = { saveBlock, createBlock, savePage, applyProposal, createPage, newTermsDraft, saveTermsSection, setTermsStatus, publishTerms, saveCompany, saveBranch, deleteBranch, saveBanner, deleteBanner, saveHomeSettings, saveSiteMedia };
export type ContentActions = typeof CONTENT_ACTIONS;

export type ContentScreenProps = {
  tab: ContentTab;
  data: ContentData | { tab: ContentTab; loading: true };
  perms: { editable: boolean; canCreate: boolean; isAdmin: boolean };
  /** URL for a set of params (page path or fixture path, keeps fixture params) */
  basePath?: string;
  extraParams?: Record<string, string>;
  /** terms: section on screen, version viewed */
  sectionNo?: number;
  viewId?: string;
  /** "14 days notice" suggestion (YYYY-MM-DD) */
  suggestedPublish?: string;
  /** server-rendered slot: today's MailDeliverabilityAlert on Company & branches */
  companyAlert?: ReactNode;
  actions?: ContentActions;
};

const pill = (s: string) => (
  <StatusPill tone={contentStatusTone(s)}>{CONTENT_STATUS[s] ?? s.replace(/_/g, ' ')}</StatusPill>
);

/** ODS T9 · Website › Site content (today's 6 tabs as panels with save bars; every save = today's action). */
export function ContentScreen({ tab, data, perms, basePath = '/admin/content', extraParams = {}, sectionNo = 1, viewId, suggestedPublish, companyAlert, actions = CONTENT_ACTIONS }: ContentScreenProps) {
  const router = useRouter();
  const [nav, start] = useTransition();
  const href = (p: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams(extraParams);
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') sp.set(k, String(v));
    return `${basePath}?${sp.toString()}`;
  };
  const { editable, canCreate, isAdmin } = perms;
  const loading = 'loading' in data || nav;

  const panel = (() => {
    if ('loading' in data) return <Card loading />;
    switch (data.tab) {
      case 'terms':
        return <TermsPanel data={data} perms={perms} sectionNo={sectionNo} viewId={viewId} href={href} suggested={suggestedPublish} actions={actions} />;
      case 'pages':
        return <PagesPanel data={data} perms={perms} href={href} actions={actions} />;
      case 'blocks':
        return (
          <div className="grid gap-4">
            <Card title="Content blocks" headingLevel={2} description={`${data.blocks.length} blocks · use “|” to separate list items`} empty={data.blocks.length ? undefined : <EmptyState title="No content blocks" />}>
              <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
                {data.blocks.map((b) => (
                  <li key={b.key} className="py-3">
                    <OdsForm action={actions.saveBlock} hideSubmit={!editable} label={`Block ${b.key}`}>
                      <input type="hidden" name="key" value={b.key} />
                      <label className={labelCls}>
                        <span className="break-all font-mono">{b.key}</span>
                        <span className={hintCls}>updated {formatDate(b.updated_at)}</span>
                        <textarea name="value" className={areaCls} rows={Math.min(6, Math.ceil(b.value.length / 90) || 1)} defaultValue={b.value} disabled={!editable} />
                      </label>
                    </OdsForm>
                  </li>
                ))}
              </ul>
            </Card>
            {canCreate ? (
              <Card title="Add content block" headingLevel={2}>
                <OdsForm action={actions.createBlock} submitLabel="Add block" resetOnSuccess label="Add content block">
                  <div className="grid gap-4 ods-tablet:grid-cols-[260px_1fr]">
                    <label className={labelCls}>
                      Key <span className={hintCls}>e.g. home.banner.title</span>
                      <input name="key" className={cx(fieldCls, 'font-mono')} required />
                    </label>
                    <label className={labelCls}>
                      Value
                      <textarea name="value" className={areaCls} required />
                    </label>
                  </div>
                </OdsForm>
              </Card>
            ) : null}
          </div>
        );
      case 'company':
        return <CompanyPanel data={data} perms={perms} alert={companyAlert} actions={actions} />;
      case 'home':
        return <HomePanel data={data} perms={perms} actions={actions} />;
      case 'media':
        return (
          <div className="grid gap-3" data-testid="media-tab">
            <p className="m-0 max-w-[760px] text-ods-small text-ods-slate">
              Each slot is a Site content key. Upload a new picture (WebP, 1200 × 800, 3:2) or change the alt text; the site updates within a minute. Alt text describes what the picture shows; never staff names. “Reset” goes back to the picture shipped with the site.
            </p>
            <ul className="m-0 grid list-none gap-4 p-0 ods-tablet:grid-cols-2">
              {data.slots.map((m) => (
                <li key={m.key}>
                  <Card className="h-full">
                    <div className="flex gap-4">
                      <div className="relative aspect-[3/2] w-[150px] shrink-0 overflow-hidden rounded-ods-control border border-ods-line bg-ods-canvas">
                        <Image src={m.src} alt={m.alt} fill sizes="150px" className="object-cover" unoptimized={m.src.startsWith('http')} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-ods-navy">{m.label}</div>
                        <div className="break-all font-mono text-ods-small text-ods-slate">{m.key}</div>
                        <div className="mt-1 text-ods-small text-ods-slate">{m.path ? `Media store · ${m.path.split('/').slice(-1)[0]}` : 'Picture shipped with the site'}</div>
                      </div>
                    </div>
                    {editable ? (
                      <OdsForm action={actions.saveSiteMedia} submitLabel="Save picture" className="mt-3" label={`Picture ${m.label}`}>
                        <input type="hidden" name="key" value={m.key} />
                        <label className={labelCls}>
                          Alt text
                          <input name="alt" defaultValue={m.alt} className={fieldCls} placeholder="What the picture shows" />
                        </label>
                        <div className="flex flex-wrap gap-x-5">
                          <label className={checkCls}>
                            <input type="checkbox" name="decorative" defaultChecked={!m.alt} className="size-4" /> Decorative (no alt text)
                          </label>
                          {m.path ? (
                            <label className={checkCls}>
                              <input type="checkbox" name="reset" className="size-4" /> Reset to the shipped picture
                            </label>
                          ) : null}
                        </div>
                        <label className={labelCls}>
                          Replace picture
                          <input name="file" type="file" accept="image/webp,image/jpeg,image/png,image/avif" className="min-h-ods-control text-ods-small font-normal" />
                        </label>
                      </OdsForm>
                    ) : (
                      <p className="mt-3 text-ods-small text-ods-text">{m.alt || 'Decorative (no alt text)'}</p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        );
    }
  })();

  return (
    <div data-testid="content-page" className="flex min-w-0 flex-col gap-4">
      <WebsiteHead title="Site content" subtitle="Edit every page, text block and legal document except products. Content editors can draft; Admin publishes legal pages." />
      {!editable ? <Note tone="info" testId="read-only">Read-only: editing needs the Site content · edit permission.</Note> : null}
      <Tabs
        data-testid="content-tabs"
        label="Site content sections"
        value={tab}
        onChange={(t) => start(() => router.push(href({ tab: t }), { scroll: false }))}
        items={CONTENT_TABS.map(([k, label]) => ({ id: k, label, panel: () => (k === tab ? <div className="pt-4">{loading && !('loading' in data) ? <Card loading /> : panel}</div> : null) }))}
      />
    </div>
  );
}

type Href = (p: Record<string, string | number | undefined>) => string;
type PanelPerms = ContentScreenProps['perms'];

function TermsPanel({ data, perms, sectionNo, viewId, href, suggested, actions }: { data: Extract<ContentData, { tab: 'terms' }>; perms: PanelPerms; sectionNo: number; viewId?: string; href: Href; suggested?: string; actions: ContentActions }) {
  const { editable, isAdmin } = perms;
  const v = termsView(data.versions, viewId);
  if (!v.current) {
    return (
      <Card>
        <EmptyState headingLevel={2} title="No terms yet" description="Create the first draft with 15 sections." action={editable ? <RunAction action={() => actions.newTermsDraft()} variant="primary">Create draft</RunAction> : undefined} />
      </Card>
    );
  }
  const cur = v.current;
  const canEdit = editable && v.canEditCurrent;
  const section = termsSection(cur, sectionNo);
  const vars = termsVars(section.body);
  return (
    <div className="grid gap-4">
      <Card
        headingLevel={2}
        title={`Terms and Conditions · ${cur.version}`}
        description={`Legal · /legal/terms · ${v.live ? `live version ${v.live.version} (${v.live.published_at ? formatDate(v.live.published_at) : '—'})` : 'no live version'}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {pill(cur.status)}
            {editable && !v.working ? <RunAction action={() => actions.newTermsDraft()} confirm={{ title: 'Create a new draft?', body: 'It copies the latest version.', confirmLabel: 'Create draft' }}>New draft version</RunAction> : null}
          </span>
        }
      >
        {!canEdit ? <Note>{cur.status === 'published' ? 'This is the live version and cannot be edited. Create a new draft version to make changes.' : `This version is ${CONTENT_STATUS[cur.status] ?? cur.status}. It cannot be edited.`}</Note> : null}
        <nav aria-label="Sections" className="mt-3 flex flex-wrap gap-1.5">
          {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
            <a
              key={n}
              href={href({ tab: 'terms', s: n, v: viewId })}
              aria-current={n === section.no ? 'true' : undefined}
              aria-label={`Section ${n}`}
              className={cx('inline-flex h-ods-control min-w-ods-control items-center justify-center rounded-ods-control border px-2 font-mono text-ods-small font-semibold', n === section.no ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy hover:border-ods-navy')}
            >
              {n}
            </a>
          ))}
        </nav>
        <OdsForm key={`${cur.id}-${section.no}`} action={actions.saveTermsSection} submitLabel={`Save section ${section.no}`} hideSubmit={!canEdit} sticky className="mt-4" label={`Section ${section.no}`} data-testid="terms-form">
          <input type="hidden" name="id" value={cur.id} />
          <input type="hidden" name="no" value={section.no} />
          <label className={labelCls}>
            Section {section.no} title
            <input name="title" className={fieldCls} defaultValue={section.title} required disabled={!canEdit} />
          </label>
          <label className={labelCls}>
            Section text
            <span className={hintCls}>
              Values in double braces come from Admin settings and stay in sync, e.g. <code className="font-mono">{'{{deposit_pct}}'}</code>.
            </span>
            <textarea name="body" className={cx(areaCls, 'min-h-[260px]')} defaultValue={section.body} disabled={!canEdit} />
          </label>
          {vars.length ? (
            <div>
              <div className="text-ods-label font-semibold text-ods-navy">Live values used in this section</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {vars.map((k) => (k in data.settings ? <StatusPill key={k} tone="info">{`${k} = ${data.settings[k]}`}</StatusPill> : <StatusPill key={k} tone="warning">{`${k} = not set`}</StatusPill>))}
              </div>
            </div>
          ) : null}
        </OdsForm>
      </Card>
      <Card headingLevel={2} title="Publish" description="Legal pages need Admin approval">
        <div className="grid gap-4">
          {v.scheduled ? <Note tone="warning">{v.scheduled.version} is scheduled to go live on {v.scheduled.publish_at ? formatDate(v.scheduled.publish_at) : '—'}.</Note> : null}
          {v.working ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{v.working.version}</span>
                {pill(v.working.status)}
                {editable && v.working.status === 'draft' ? (
                  <RunAction action={() => actions.setTermsStatus(v.working!.id, 'in_review')} confirm={{ title: `Send ${v.working.version} for Admin approval?`, confirmLabel: 'Send for approval' }}>
                    Send {v.working.version} for Admin approval
                  </RunAction>
                ) : null}
                {editable && v.working.status === 'in_review' ? <RunAction action={() => actions.setTermsStatus(v.working!.id, 'draft')}>Back to draft</RunAction> : null}
              </div>
              {isAdmin ? (
                <OdsForm
                  action={actions.publishTerms}
                  submitLabel={`Publish ${v.working.version}`}
                  confirm={{ title: `Publish ${v.working.version}?`, body: 'The current live version will be superseded (or it will be scheduled if you picked a future date).', confirmLabel: 'Publish' }}
                  label="Publish terms"
                >
                  <input type="hidden" name="id" value={v.working.id} />
                  <label className={cx(labelCls, 'max-w-[280px]')}>
                    Applies from (leave empty = now)
                    <input name="publish_at" type="datetime-local" className={fieldCls} />
                    {suggested ? <span className={hintCls}>Suggested: 14 days notice → {suggested}</span> : null}
                  </label>
                </OdsForm>
              ) : (
                <p className="m-0 text-ods-small text-ods-slate">An Admin reviews and publishes or schedules this version.</p>
              )}
            </>
          ) : (
            <p className="m-0 text-ods-small text-ods-slate">No draft in progress. {editable ? 'Create a new draft version to propose changes.' : ''}</p>
          )}
          <div className="border-t border-ods-line pt-3">
            <h3 className="mb-2 text-ods-body font-bold text-ods-navy">Version history</h3>
            <ul className="m-0 list-none divide-y divide-ods-line p-0">
              {data.versions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 py-2 text-ods-small">
                  <span className="w-16 font-mono font-semibold">{x.version}</span>
                  {pill(x.status)}
                  <span className="text-ods-slate">{x.published_at ? `published ${formatDate(x.published_at)}` : x.publish_at ? `scheduled ${formatDate(x.publish_at)}` : `created ${formatDate(x.created_at)}`}</span>
                  <a href={href({ tab: 'terms', v: x.id, s: section.no })} className="ms-auto font-semibold text-ods-info underline">
                    View<span className="sr-only"> {x.version}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PagesPanel({ data, perms, href, actions }: { data: Extract<ContentData, { tab: 'pages' }>; perms: PanelPerms; href: Href; actions: ContentActions }) {
  const { editable, canCreate, isAdmin } = perms;
  const page = data.page;
  const intents = page ? pageIntents(page, isAdmin) : [];
  return (
    <div className="grid gap-4 ods-desktop:grid-cols-[300px_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Card headingLevel={2} title="Pages" empty={data.pages.length ? undefined : <EmptyState title="No pages yet" />}>
          <ul className="m-0 list-none p-0">
            {(['Legal', 'Pages'] as const).map((group) => (
              <li key={group}>
                <div className="pb-1 pt-2 text-ods-label font-semibold uppercase tracking-wider text-ods-slate">{group}</div>
                <ul className="m-0 list-none p-0">
                  {data.pages.filter((p) => (group === 'Legal') === p.is_legal).map((p) => (
                    <li key={p.id}>
                      <a
                        href={href({ tab: 'pages', page: p.slug })}
                        aria-current={page?.id === p.id ? 'true' : undefined}
                        className={cx('flex items-center justify-between gap-3 rounded-ods-control px-2 py-2', page?.id === p.id ? 'bg-ods-blue-tint font-semibold text-ods-navy' : 'hover:bg-ods-canvas')}
                      >
                        <span className="min-w-0 truncate">{p.title}</span>
                        {pill(p.status)}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
        {canCreate ? (
          <Card headingLevel={2} title="New page">
            <OdsForm action={actions.createPage} submitLabel="Create draft" resetOnSuccess label="New page">
              <label className={labelCls}>
                Title
                <input name="title" className={fieldCls} required />
              </label>
              <label className={labelCls}>
                Slug <span className={hintCls}>Optional — generated from the title</span>
                <input name="slug" className={cx(fieldCls, 'font-mono')} />
              </label>
              <label className={checkCls}>
                <input type="checkbox" name="is_legal" className="size-4" /> Legal page (Admin must publish)
              </label>
            </OdsForm>
          </Card>
        ) : null}
      </div>
      {page ? (
        <div className="grid content-start gap-4">
          <Card headingLevel={2} title={page.title} description={`${page.is_legal ? 'Legal' : 'Page'} · /${page.slug} · updated ${formatDate(page.updated_at)}`} actions={pill(page.status)}>
            {intents[0] === 'proposal' ? <Note tone="warning">This legal page is live. Your changes are saved as a proposal for an Admin to publish.</Note> : null}
            <OdsForm
              key={page.id}
              action={actions.savePage}
              hideSubmit
              sticky
              className="mt-3"
              label={`Edit ${page.title}`}
              data-testid="page-form"
              buttons={
                editable ? (
                  <>
                    {intents.includes('proposal') ? (
                      <Button type="submit" size="sm" name="intent" value="review">
                        Submit changes for Admin approval
                      </Button>
                    ) : null}
                    {intents.includes('draft') ? (
                      <Button type="submit" size="sm" variant="secondary" name="intent" value="draft">
                        Save draft
                      </Button>
                    ) : null}
                    {intents.includes('review') ? (
                      <Button type="submit" size="sm" variant="secondary" name="intent" value="review">
                        Send for review
                      </Button>
                    ) : null}
                    {intents.includes('publish') ? (
                      <Button type="submit" size="sm" name="intent" value="publish">
                        Publish
                      </Button>
                    ) : null}
                  </>
                ) : undefined
              }
            >
              <input type="hidden" name="id" value={page.id} />
              <label className={labelCls}>
                Title
                <input name="title" className={fieldCls} defaultValue={page.title} required disabled={!editable} />
              </label>
              <label className={labelCls}>
                Body <span className={hintCls}>Plain text / Markdown.</span>
                <textarea name="body" className={cx(areaCls, 'min-h-[320px]')} defaultValue={page.body} disabled={!editable} />
              </label>
            </OdsForm>
          </Card>
          {data.proposals.length ? (
            <Card headingLevel={2} title="Proposals waiting for Admin">
              <ul className="m-0 list-none divide-y divide-ods-line p-0">
                {data.proposals.map((p) => {
                  const snap = p.snapshot as { title?: string; body?: string };
                  return (
                    <li key={p.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold">{snap.title}</span>
                        <span className="text-ods-small text-ods-slate">
                          by {p.created_by ? (data.who[p.created_by] ?? '—') : '—'} · {formatDate(p.created_at)}
                        </span>
                        {isAdmin ? (
                          <span className="ms-auto">
                            <RunAction variant="primary" action={() => actions.applyProposal(p.id)} confirm={{ title: 'Publish this proposal?', body: 'It replaces the live legal page.', confirmLabel: 'Publish proposal' }}>
                              Publish proposal
                            </RunAction>
                          </span>
                        ) : null}
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-ods-small font-semibold text-ods-info">Show text</summary>
                        <pre tabIndex={0} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-ods-control bg-ods-canvas p-3 text-ods-small">{snap.body}</pre>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
          <Card headingLevel={2} title="Version history" empty={data.history.length ? undefined : <EmptyState title="No saved versions yet" />}>
            <ul className="m-0 list-none divide-y divide-ods-line p-0">
              {data.history.map((h) => {
                const snap = h.snapshot as { status?: string; title?: string };
                return (
                  <li key={h.id} className="flex flex-wrap items-center gap-3 py-2 text-ods-small">
                    <span className="font-mono text-ods-slate">{formatDate(h.created_at)}</span>
                    {snap.status ? pill(snap.status) : null}
                    <span>{snap.title}</span>
                    <span className="ms-auto text-ods-slate">{h.created_by ? (data.who[h.created_by] ?? '—') : '—'}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState title="Select a page" />
        </Card>
      )}
    </div>
  );
}

const COMPANY_FIELDS: [string, string, boolean?][] = [
  ['legal_name', 'Legal name'], ['brand', 'Brand'], ['tagline', 'Tagline'], ['contact_person', 'Contact person'],
  ['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['website', 'Website'], ['address', 'Address', true], ['address_cn', 'Address (Chinese)', true],
  ['legal_name_cn', 'Legal name (Chinese)'], ['registered_in', 'Registered in'], ['governing_law', 'T&C governed by'],
];
const TONES = ['blue', 'rose', 'cyan', 'pink', 'amber', 'green', 'purple'];

function BranchFields({ b, editable, countries }: { b: Record<string, unknown>; editable: boolean; countries: [string, string][] }) {
  const v = (k: string) => (b[k] == null ? '' : String(b[k]));
  const f = (name: string, label: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}, wide = false) => (
    <label className={cx(labelCls, wide && 'ods-tablet:col-span-3')}>
      {label}
      <input name={name} className={fieldCls} defaultValue={v(name)} disabled={!editable} {...extra} />
    </label>
  );
  return (
    <div className="grid gap-3 ods-tablet:grid-cols-3">
      {f('name', 'Name', { required: true })}
      {f('city', 'City')}
      <label className={labelCls}>
        Country
        <select name="country" className={fieldCls} defaultValue={v('country')} disabled={!editable}>
          <option value="">—</option>
          {v('country') && !countries.some(([, n]) => n === v('country')) ? <option value={v('country')}>{v('country')}</option> : null}
          {countries.map(([code, n]) => (
            <option key={code} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {f('address', 'Address', {}, true)}
      {f('phone', 'Phone')}
      {f('email', 'Email', { type: 'email' })}
      <div className="grid grid-cols-2 items-end gap-3">
        {f('sort', 'Sort', { type: 'number' })}
        <label className={checkCls}>
          <input type="checkbox" name="active" defaultChecked={b.active !== false} disabled={!editable} className="size-4" /> Active
        </label>
      </div>
      <details className="rounded-ods-control border border-ods-line px-3 py-2 ods-tablet:col-span-3">
        <summary className="cursor-pointer text-ods-small font-semibold text-ods-navy">About page card</summary>
        <div className="mt-3 grid gap-3 ods-tablet:grid-cols-3">
          {f('city_local', 'City (local script)', { lang: 'zh-CN' })}
          {f('province', 'Province')}
          {f('badge', 'Badge', { placeholder: 'Sourcing office' })}
          <label className={cx(labelCls, 'ods-tablet:col-span-2')}>
            Tagline
            <input name="tagline" className={fieldCls} defaultValue={v('tagline')} disabled={!editable} />
          </label>
          {f('hours', 'Opening hours', { placeholder: 'Mon–Sat 09:00–18:30 CST' })}
          <label className={cx(labelCls, 'ods-tablet:col-span-2')}>
            Specialities (comma-separated)
            <input name="specialities" className={fieldCls} defaultValue={Array.isArray(b.specialities) ? (b.specialities as string[]).join(', ') : ''} disabled={!editable} />
          </label>
          <label className={labelCls}>
            Chip colour
            <select name="tone" className={fieldCls} defaultValue={v('tone') || 'blue'} disabled={!editable}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={cx(labelCls, 'ods-tablet:col-span-3')}>
            Description
            <textarea name="description" className={areaCls} defaultValue={v('description')} disabled={!editable} />
          </label>
          <label className={checkCls}>
            <input type="checkbox" name="is_hq" defaultChecked={b.is_hq === true} disabled={!editable} className="size-4" /> Headquarters
          </label>
        </div>
      </details>
    </div>
  );
}

function CompanyPanel({ data, perms, alert, actions }: { data: Extract<ContentData, { tab: 'company' }>; perms: PanelPerms; alert?: ReactNode; actions: ContentActions }) {
  const { editable } = perms;
  return (
    <div className="grid gap-4">
      {alert}
      <Card headingLevel={2} title="Company details" description="Shown in the footer, About and Contact pages and every document">
        <OdsForm action={actions.saveCompany} submitLabel="Save company details" hideSubmit={!editable} sticky label="Company details" data-testid="company-form">
          <div className="grid gap-4 ods-tablet:grid-cols-2">
            {COMPANY_FIELDS.map(([k, label, wide]) => (
              <label key={k} className={cx(labelCls, wide && 'ods-tablet:col-span-2')}>
                {label}
                {wide ? (
                  <textarea name={k} className={areaCls} defaultValue={data.company[k] ?? ''} disabled={!editable} />
                ) : (
                  <input name={k} className={fieldCls} defaultValue={data.company[k] ?? ''} required={k === 'legal_name'} disabled={!editable} type={k === 'email' ? 'email' : 'text'} />
                )}
              </label>
            ))}
          </div>
        </OdsForm>
      </Card>
      <Note>
        Bank accounts customers pay into are in{' '}
        <a href="/admin/settings/payment" className="font-semibold underline">
          Admin › Payment settings
        </a>{' '}
        (finance and owner).
      </Note>
      <Card headingLevel={2} title="Branches" empty={data.branches.length || editable ? undefined : <EmptyState title="No branches yet" />}>
        <ul className="m-0 list-none divide-y divide-ods-line p-0">
          {data.branches.map((b) => (
            <li key={String(b.id)} className="py-4">
              <OdsForm action={actions.saveBranch} submitLabel="Save branch" hideSubmit={!editable} label={`Branch ${String(b.name ?? '')}`}>
                <input type="hidden" name="id" value={String(b.id)} />
                <BranchFields b={b} editable={editable} countries={data.countries} />
              </OdsForm>
              {editable ? (
                <div className="mt-2">
                  <RunAction variant="danger" action={() => actions.deleteBranch(String(b.id))} confirm={{ title: `Delete branch “${String(b.name)}”?`, body: 'This cannot be undone.', confirmLabel: 'Delete branch', destructive: true }}>
                    Delete branch
                  </RunAction>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <div className="mt-2 border-t border-ods-line pt-4">
            <h3 className="mb-3 text-ods-body font-bold text-ods-navy">Add branch</h3>
            <OdsForm action={actions.saveBranch} submitLabel="Add branch" resetOnSuccess label="Add branch">
              <BranchFields b={{ active: true, sort: data.branches.length + 1 }} editable countries={data.countries} />
            </OdsForm>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const local = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

function BannerForm({ b, editable, actions }: { b?: Banner; editable: boolean; actions: ContentActions }) {
  const t = (name: keyof Banner | string, label: string, def: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className={labelCls}>
      {label}
      <input name={String(name)} defaultValue={def} className={fieldCls} disabled={!editable} {...extra} />
    </label>
  );
  return (
    <OdsForm action={actions.saveBanner} submitLabel={b ? 'Save banner' : 'Add banner'} hideSubmit={!editable} resetOnSuccess={!b} label={b ? `Banner ${b.title}` : 'New banner'}>
      <input type="hidden" name="id" value={b?.id ?? ''} />
      <div className="grid gap-3 ods-tablet:grid-cols-2">
        {t('eyebrow', 'Eyebrow pills (“New · Turnkey Projects”)', b?.eyebrow ?? '')}
        {t('title', 'Title', b?.title ?? '')}
        <label className={cx(labelCls, 'ods-tablet:col-span-2')}>
          Body
          <textarea name="body" defaultValue={b?.body ?? ''} rows={2} className={areaCls} disabled={!editable} />
        </label>
        {t('cta_label', 'Button label', b?.cta_label ?? '')}
        {t('cta_href', 'Button link', b?.cta_href ?? '', { placeholder: '/turnkey' })}
        {t('cta2_label', 'Second button label', b?.cta2_label ?? '')}
        {t('cta2_href', 'Second button link', b?.cta2_href ?? '')}
        {t('ticks', 'Ticks (separate with |)', b?.ticks.join(' | ') ?? '')}
        {t('image_url', 'Image (https, optional — shown faded behind the text)', b?.image_url ?? '')}
        <label className={labelCls}>
          Theme
          <select name="theme" defaultValue={b?.theme ?? 'navy'} className={fieldCls} disabled={!editable}>
            <option value="navy">Navy</option>
            <option value="blue">Blue</option>
            <option value="light">Light</option>
          </select>
        </label>
        {t('sort', 'Order', String(b?.sort ?? 10), { type: 'number' })}
        {t('starts_at', 'Starts (optional)', local(b?.starts_at ?? null), { type: 'datetime-local' })}
        {t('ends_at', 'Ends (optional)', local(b?.ends_at ?? null), { type: 'datetime-local' })}
        <label className={checkCls}>
          <input type="checkbox" name="show_open_project" defaultChecked={b?.show_open_project ?? false} disabled={!editable} className="size-4" /> Show container + live “open project” card (Turnkey)
        </label>
        <label className={checkCls}>
          <input type="checkbox" name="active" defaultChecked={b?.active ?? true} disabled={!editable} className="size-4" /> Active
        </label>
      </div>
    </OdsForm>
  );
}

function HomePanel({ data, perms, actions }: { data: Extract<ContentData, { tab: 'home' }>; perms: PanelPerms; actions: ContentActions }) {
  const { editable, isAdmin } = perms;
  return (
    <div className="grid gap-4">
      <Card headingLevel={2} title="Lead banners" description="Up to 3 active, in-date banners rotate every 7 s (pause on hover; no motion for reduced-motion users)">
        <div className="grid gap-4">
          {data.banners.map((b) => (
            <div key={b.id} className="rounded-ods-card border border-ods-line p-3">
              <div className="mb-3 flex flex-wrap justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-ods-navy">
                  {b.title} {pill(b.active ? 'active' : 'inactive')}
                </div>
                <div className="text-ods-small text-ods-slate">
                  {data.bannerStats[b.id]} (30 days){b.ends_at ? ` · ends ${formatDate(b.ends_at)}` : ''}
                </div>
              </div>
              <BannerForm b={b} editable={editable} actions={actions} />
              {editable ? (
                <div className="mt-2">
                  <RunAction variant="danger" action={() => actions.deleteBanner(b.id)} confirm={{ title: `Delete “${b.title}”?`, confirmLabel: 'Delete banner', destructive: true }}>
                    Delete banner
                  </RunAction>
                </div>
              ) : null}
            </div>
          ))}
          {editable ? (
            <div className="rounded-ods-card border border-dashed border-ods-line-strong p-3">
              <h3 className="mb-3 text-ods-body font-bold text-ods-navy">Add banner</h3>
              <BannerForm editable actions={actions} />
            </div>
          ) : null}
        </div>
      </Card>
      <Card headingLevel={2} title="Side banners & announcement (30-day clicks)">
        <dl className="m-0 grid gap-1 text-ods-small">
          {[['Group buy side banner', data.sideStats.pools], ['Dropship · 3PL side banner', data.sideStats.shipping], ['Announcement bar', data.sideStats.announcement]].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[220px_minmax(0,1fr)] gap-2 border-b border-ods-line py-2 last:border-b-0">
              <dt className="text-ods-slate">{k}</dt>
              <dd className="m-0">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-ods-small text-ods-slate">
          Side-banner copy: content blocks <span className="font-mono">home.side.pools</span> and <span className="font-mono">home.side.shipping</span> (Content blocks tab).
        </p>
      </Card>
      <Card headingLevel={2} title="Home switches" description={!isAdmin ? 'Admin only' : undefined}>
        <OdsForm action={actions.saveHomeSettings} submitLabel="Save home settings" hideSubmit={!editable || !isAdmin} label="Home switches" data-testid="home-switches">
          <label className={checkCls}>
            <input type="checkbox" name="announcement_enabled" defaultChecked={data.announcementEnabled} disabled={!isAdmin} className="size-4" /> Show the announcement bar
          </label>
          <label className={labelCls}>
            Announcement — “text|link text|link” ({'{turnkey}'} = number of projects)
            <input name="announcement" defaultValue={data.announcement} className={fieldCls} disabled={!isAdmin} />
          </label>
          <label className={checkCls}>
            <input type="checkbox" name="show_placeholders" defaultChecked={data.showPlaceholders} disabled={!isAdmin} className="size-4" /> Show bracketed placeholders in Verified suppliers / What buyers say (keep OFF in production)
          </label>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-ods-label font-semibold text-ods-navy">“Everything you need” cards — tick to show, number = order</legend>
            <div className="grid gap-2 ods-tablet:grid-cols-2 ods-desktop:grid-cols-5">
              {HOME_FEATURES.map(([k, l]) => (
                <div key={k} className="flex items-center gap-2 rounded-ods-control border border-ods-line px-2 py-1 text-ods-small">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" name={`f_${k}`} defaultChecked={data.order.includes(k)} disabled={!isAdmin} className="size-4" />
                    {l}
                  </label>
                  <input type="number" name={`o_${k}`} min={1} max={10} defaultValue={data.order.includes(k) ? data.order.indexOf(k) + 1 : 10} className={cx(fieldCls, 'w-14')} aria-label={`${l} order`} disabled={!isAdmin} />
                </div>
              ))}
            </div>
          </fieldset>
        </OdsForm>
      </Card>
    </div>
  );
}
