import { createClient } from '@/lib/supabase/server';
import { Card, Table, StatusBadge } from '@/components/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { fmtDate } from '@/lib/format';
import { saveBanner, deleteBanner, saveHomeSettings } from './home-actions';

const FEATURES: [string, string][] = [['rfq', 'RFQ'], ['pool', 'Group buy'], ['turnkey', 'Turnkey Projects'], ['dropship', 'Dropshipping'], ['3pl', '3PL & global shipping'],
  ['qc', 'QC inspection'], ['certification', 'Certification'], ['wallet', 'Wallet & escrow'], ['assistant', 'AI account manager'], ['api', 'API & integrations']];

type Banner = { id: string; eyebrow: string | null; title: string; body: string | null; cta_label: string | null; cta_href: string | null; cta2_label: string | null; cta2_href: string | null;
  ticks: string[]; theme: string; image_url: string | null; show_open_project: boolean; starts_at: string | null; ends_at: string | null; sort: number; active: boolean };

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const local = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

/** Admin → Site content → Home page (ADDON-32): rotating lead banners (up to 3 shown), announcement bar, feature-card order, placeholders, banner CTR. */
export async function HomeTab({ editable, isAdmin }: { editable: boolean; isAdmin: boolean }) {
  const sb = await createClient();
  const since = daysAgo(30);
  const [{ data: banners }, { data: settings }, { data: ann }, { data: events }] = await Promise.all([
    sb.from('home_banners').select('*').order('sort'),
    sb.from('site_settings').select('key, value').in('key', ['home.announcement_enabled', 'home.show_placeholders', 'home.feature_cards']),
    sb.from('content_blocks').select('value').eq('key', 'home.announcement').maybeSingle(),
    sb.from('banner_events').select('banner_id, slot, event').gte('ts', since).limit(50000),
  ]);
  const st = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;
  const order = Array.isArray(st['home.feature_cards']) ? (st['home.feature_cards'] as string[]) : FEATURES.map(([k]) => k);
  const stat = (pred: (e: { banner_id: string | null; slot: string; event: string }) => boolean) => {
    const ev = (events ?? []).filter(pred);
    const imp = ev.filter((e) => e.event === 'impression').length; const clk = ev.filter((e) => e.event === 'click').length;
    return `${imp} views · ${clk} clicks${imp ? ` · ${((clk / imp) * 100).toFixed(1)} % CTR` : ''}`;
  };
  const bannerForm = (b?: Banner) => (
    <ActionForm action={saveBanner} submitLabel={b ? 'Save banner' : 'Add banner'} hideSubmit={!editable} resetOnSuccess={!b} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={b?.id ?? ''} />
      <label className="block text-sm"><span className="label">Eyebrow pills (“New · Turnkey Projects”)</span><input name="eyebrow" defaultValue={b?.eyebrow ?? ''} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Title</span><input name="title" defaultValue={b?.title ?? ''} className="input" disabled={!editable} /></label>
      <label className="block text-sm sm:col-span-2"><span className="label">Body</span><textarea name="body" defaultValue={b?.body ?? ''} rows={2} className="input py-2" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Button label</span><input name="cta_label" defaultValue={b?.cta_label ?? ''} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Button link</span><input name="cta_href" defaultValue={b?.cta_href ?? ''} placeholder="/turnkey" className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Second button label</span><input name="cta2_label" defaultValue={b?.cta2_label ?? ''} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Second button link</span><input name="cta2_href" defaultValue={b?.cta2_href ?? ''} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Ticks (separate with |)</span><input name="ticks" defaultValue={b?.ticks.join(' | ') ?? ''} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Image (https, optional — shown faded behind the text)</span><input name="image_url" defaultValue={b?.image_url ?? ''} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Theme</span><select name="theme" defaultValue={b?.theme ?? 'navy'} className="input" disabled={!editable}><option value="navy">Navy</option><option value="blue">Blue</option><option value="light">Light</option></select></label>
      <label className="block text-sm"><span className="label">Order</span><input name="sort" type="number" defaultValue={b?.sort ?? 10} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Starts (optional)</span><input name="starts_at" type="datetime-local" defaultValue={local(b?.starts_at ?? null)} className="input" disabled={!editable} /></label>
      <label className="block text-sm"><span className="label">Ends (optional)</span><input name="ends_at" type="datetime-local" defaultValue={local(b?.ends_at ?? null)} className="input" disabled={!editable} /></label>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="show_open_project" defaultChecked={b?.show_open_project ?? false} disabled={!editable} /> Show container + live “open project” card (Turnkey)</label>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={b?.active ?? true} disabled={!editable} /> Active</label>
    </ActionForm>
  );
  return (
    <div className="space-y-6">
      <Card title="Lead banners" action={<span className="text-sm text-muted">Up to 3 active, in-date banners rotate every 7 s (pause on hover; no motion for reduced-motion users)</span>}>
        <div className="px-6 pb-6 space-y-6">
          {((banners ?? []) as Banner[]).map((b) => (
            <div key={b.id} className="border border-line rounded-[12px] p-4">
              <div className="flex flex-wrap justify-between gap-2 mb-3">
                <div className="font-semibold">{b.title} <StatusBadge status={b.active ? 'active' : 'inactive'} /></div>
                <div className="text-sm text-muted">{stat((e) => e.banner_id === b.id)} (30 days){b.ends_at ? ` · ends ${fmtDate(b.ends_at)}` : ''}</div>
              </div>
              {bannerForm(b)}
              {editable && <div className="mt-2"><RunButton action={deleteBanner.bind(null, b.id)} confirm={`Delete “${b.title}”?`} className="btn btn-ghost btn-sm text-bad">Delete</RunButton></div>}
            </div>
          ))}
          {editable && <div className="border border-dashed border-line-2 rounded-[12px] p-4"><div className="font-semibold mb-3">New banner</div>{bannerForm()}</div>}
        </div>
      </Card>

      <Card title="Side banners & announcement (30-day clicks)">
        <div className="px-6 pb-6">
          <Table head={['Slot', 'Performance']}>
            <tr><td className="td">Group buy side banner</td><td className="td text-sm">{stat((e) => e.slot === 'side-pools')}</td></tr>
            <tr><td className="td">Dropship · 3PL side banner</td><td className="td text-sm">{stat((e) => e.slot === 'side-shipping')}</td></tr>
            <tr><td className="td">Announcement bar</td><td className="td text-sm">{stat((e) => e.slot === 'announcement')}</td></tr>
          </Table>
          <p className="text-xs text-muted mt-2">Side-banner copy: content blocks <span className="mono">home.side.pools</span> and <span className="mono">home.side.shipping</span> (Content blocks tab).</p>
        </div>
      </Card>

      <Card title="Home switches" action={!isAdmin ? <span className="text-sm text-muted">Admin only</span> : undefined}>
        <ActionForm action={saveHomeSettings} className="px-6 pb-6 space-y-4" submitLabel="Save home settings" hideSubmit={!editable || !isAdmin}>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="announcement_enabled" defaultChecked={st['home.announcement_enabled'] !== false} disabled={!isAdmin} /> Show the announcement bar</label>
          <label className="block text-sm"><span className="label">Announcement — “text|link text|link” ({'{turnkey}'} = number of projects)</span>
            <input name="announcement" defaultValue={(ann?.value as string) ?? ''} className="input" disabled={!isAdmin} /></label>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="show_placeholders" defaultChecked={st['home.show_placeholders'] === true} disabled={!isAdmin} /> Show bracketed placeholders in Verified suppliers / What buyers say (keep OFF in production)</label>
          <fieldset><legend className="label">“Everything you need” cards — tick to show, number = order</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {FEATURES.map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm border border-line rounded-[8px] px-2 py-1.5">
                  <input type="checkbox" name={`f_${k}`} defaultChecked={order.includes(k)} disabled={!isAdmin} />
                  <span className="flex-1">{l}</span>
                  <input type="number" name={`o_${k}`} min={1} max={10} defaultValue={order.includes(k) ? order.indexOf(k) + 1 : 10} className="input min-h-8 w-14 py-0" aria-label={`${l} order`} disabled={!isAdmin} />
                </label>
              ))}
            </div>
          </fieldset>
        </ActionForm>
      </Card>
    </div>
  );
}
