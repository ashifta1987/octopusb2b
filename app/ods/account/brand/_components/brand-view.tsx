import type { ReactNode } from 'react';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, Stepper, Tabs, formatDate, formatNumber } from '@octopus/ui';
import { PageHead, Facts, TextLink } from '../../_services/ui';
import { BRAND_ORDER_STATUSES, BRAND_TABS, brandStatus, type BrandTab } from '../../_services/logic';
import { ProofReply } from './proof-reply';

/** One brand project as the customer sees it (brand_projects customer columns + product title + signed logo links). */
export type BrandProject = {
  id: string; ref: string; status: string; createdAt: string;
  product: { title: string; href: string | null } | null; productLink: string | null;
  quantity: number | null; branding: string; destination: string;
  logos: { path: string; name: string; url: string | null }[];
};
export type BrandState = { kind: 'ready'; projects: BrandProject[] } | { kind: 'loading' } | { kind: 'error' };

const STEPS = [['submitted', 'Submitted'], ['proof', 'Proof'], ['sample', 'Sample'], ['quoted', 'Quoted'], ['production', 'Production'], ['stocked', 'Stocked']] as const;

function ProjectFacts({ p }: { p: BrandProject }) {
  return (
    <Facts items={[
      ['Product', p.product ? (p.product.href ? <TextLink href={p.product.href}>{p.product.title}</TextLink> : p.product.title) : p.productLink ?? '—'],
      ['Quantity', p.quantity ? `${formatNumber(p.quantity)} units` : 'Your account manager confirms the minimum'],
      ['Branding and packaging', p.branding || '—'],
      ['Stock goes to', p.destination],
    ]} />
  );
}

function ProofCard({ p }: { p: BrandProject }) {
  const s = brandStatus(p.status);
  const at = STEPS.findIndex(([k]) => k === p.status);
  return (
    <article aria-labelledby={`bp-${p.id}`} className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card" data-testid="proof-card" id={p.ref}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`bp-${p.id}`} className="m-0 text-ods-h2 text-ods-navy"><span className="tabular-nums">{p.ref}</span>{p.product ? ` · ${p.product.title}` : ''}</h3>
        <StatusPill tone={s.tone}>{s.label}</StatusPill>
      </div>
      {at >= 0 ? <Stepper label={`Progress of ${p.ref}`} current={at} steps={STEPS.map(([id, label]) => ({ id, label }))} /> : null}
      <ProjectFacts p={p} />
      {p.status === 'proof' ? (
        <div className="flex flex-col gap-3 border-t border-ods-line pt-4">
          <p className="m-0 text-ods-body">Your account manager shares the packaging and logo proof with you. Check it, then approve it or ask for changes. Nothing is produced before you approve.</p>
          <ProofReply refCode={p.ref} />
        </div>
      ) : null}
    </article>
  );
}

/**
 * /account/brand (Part 6.7, C_Brand): Tabs Proofs · Files · Orders (`?tab=`). Proofs: projects waiting for your proof answer
 * (approve or request changes → support ticket, see ProofReply) and the rest of your projects; Files: your logo files (private
 * bucket, 10-minute links, as today); Orders: projects with a quote or later.
 */
export function BrandView({ state, tab, tabParam = 'tab' }: { state: BrandState; tab: BrandTab; tabParam?: string | null }) {
  const head = <PageHead title="Make My Brand" description="Your brand on your products: logo, packaging, labels and inserts. Your account manager sends a proof and a quote before you pay anything."
    actions={<Button href="/request/brand" data-testid="brand-start">Start a brand project</Button>} />;
  if (state.kind === 'loading') return <div className="flex flex-col gap-6">{head}<Skeleton lines={6} label="Loading your brand projects" /></div>;
  if (state.kind === 'error') return <div className="flex flex-col gap-6">{head}<ErrorState headingLevel={2} title="Your brand projects could not be loaded" description="Reload the page. If it keeps happening, contact support." action={<Button variant="secondary" href="/account/brand">Reload</Button>} /></div>;
  const all = state.projects;
  if (!all.length) {
    return <div className="flex flex-col gap-6">{head}<EmptyState headingLevel={2} title="No brand projects yet" description="Pick a verified product, upload your logo and tell us where the stock goes." action={<Button href="/request/brand">Start a brand project</Button>} /></div>;
  }
  const proofs = all.filter((p) => p.status === 'proof');
  const others = all.filter((p) => p.status !== 'proof');
  const orders = all.filter((p) => BRAND_ORDER_STATUSES.includes(p.status));
  const files = all.flatMap((p) => p.logos.map((l) => ({ ...l, ref: p.ref })));

  const proofsPanel = (
    <div className="flex flex-col gap-6">
      {proofs.length ? proofs.map((p) => <ProofCard key={p.id} p={p} />) : <EmptyState headingLevel={3} title="No proof waiting for you" description="When your account manager shares a proof, it appears here to approve or comment." />}
      {others.length ? (
        <section aria-labelledby="brand-others-h" className="flex flex-col gap-4">
          <h3 id="brand-others-h" className="m-0 text-ods-h2 text-ods-navy">Your other brand projects</h3>
          {others.map((p) => <ProofCard key={p.id} p={p} />)}
        </section>
      ) : null}
    </div>
  );

  const filesPanel = (
    <Card title="Logo files (private)" headingLevel={3} description="Download links work for 10 minutes. Reload the page for a new link." data-testid="brand-files">
      {files.length === 0 ? <EmptyState headingLevel={4} title="No files yet" description="Logo files you upload with a brand project appear here." /> : (
        <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
          {files.map((f) => (
            <li key={f.path} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="flex flex-col"><span className="font-semibold">{f.name}</span><span className="text-ods-small text-ods-slate tabular-nums">{f.ref}</span></span>
              {f.url ? <Button variant="secondary" size="sm" href={f.url} target="_blank">Download<span className="sr-only"> {f.name}</span></Button> : <span className="text-ods-small text-ods-slate">Reload for a link</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const ordersPanel = (
    <Card title="Brand orders" headingLevel={3} description="Projects with a quote, in production or in our warehouse. Proformas and invoices are in Invoices." data-testid="brand-orders">
      {orders.length === 0 ? <EmptyState headingLevel={4} title="No brand orders yet" description="A project becomes an order once you have its quote." /> : (
        <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
          {orders.map((p) => {
            const s = brandStatus(p.status);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="flex flex-col"><span className="font-semibold">{p.product?.title ?? p.productLink ?? p.ref}</span><span className="text-ods-small text-ods-slate"><span className="tabular-nums">{p.ref}</span> · {p.quantity ? `${formatNumber(p.quantity)} units` : 'Quantity to confirm'} · {p.destination} · sent {formatDate(p.createdAt)}</span></span>
                <StatusPill tone={s.tone}>{s.label}</StatusPill>
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 mt-3 text-ods-small text-ods-slate"><TextLink href="/account/invoices">Invoices</TextLink> · <TextLink href="/account/warehouse">Branded stock in the warehouse</TextLink></p>
    </Card>
  );

  const label: Record<BrandTab, { label: string; count?: number; panel: ReactNode }> = {
    proofs: { label: 'Proofs', count: proofs.length || undefined, panel: proofsPanel },
    files: { label: 'Files', count: files.length || undefined, panel: filesPanel },
    orders: { label: 'Orders', count: orders.length || undefined, panel: ordersPanel },
  };
  return (
    <div className="flex flex-col gap-6">
      {head}
      <Tabs label="Make My Brand" param={tabParam ?? undefined} defaultValue={tab} data-testid="brand-tabs" panelClassName="pt-6"
        items={BRAND_TABS.map((id) => ({ id, label: label[id].label, count: label[id].count, panel: label[id].panel, testId: `brand-tab-${id}` }))} />
    </div>
  );
}
