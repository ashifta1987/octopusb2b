import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Bell, Check, CircleAlert, Search, ShoppingCart } from 'lucide-react';
import { isStaging } from '@/lib/core/account';
import { DevNav } from './components/dev-nav';
import {
  Icon, Logo, OdsThemeRoot, ODS_ICON_SIZES, ODS_SERVICE_ICONS, LOGO_FILES, contrastRatio, odsBaseVars, odsDensityVars,
  odsServices, odsZ, type LogoArea, type LogoVariant, type OdsDensity,
} from '@octopus/ui';

export const metadata: Metadata = { title: 'ODS 1.0 tokens (staging)', robots: { index: false, follow: false } };

const WHITE = '#FFFFFF';
const ratio = (a: string, b: string) => `${contrastRatio(a, b).toFixed(1)}:1`;

const BRAND = ['ods-navy', 'ods-navy-dark', 'ods-navy-hover', 'ods-blue', 'ods-blue-hover', 'ods-blue-tint', 'ods-teal'] as const;
const NEUTRAL = ['ods-canvas', 'ods-surface', 'ods-line', 'ods-line-strong', 'ods-slate', 'ods-text'] as const;
const STATUS = ['ods-success', 'ods-success-tint', 'ods-warning', 'ods-warning-tint', 'ods-danger', 'ods-danger-tint', 'ods-info', 'ods-info-tint', 'ods-focus'] as const;
const USE: Partial<Record<keyof typeof odsBaseVars, string>> = {
  'ods-navy': 'Text, headings, customer sidebar, dark bands',
  'ods-navy-dark': 'Back Office top bar, footer',
  'ods-navy-hover': 'Selected sidebar item',
  'ods-blue': 'Primary buttons, links, selection, active tab bar',
  'ods-blue-hover': 'Hover / pressed primary',
  'ods-blue-tint': 'Selected background, info',
  'ods-teal': 'Accent: active sidebar marker, hero CTA on navy, avatar',
  'ods-canvas': 'Page background',
  'ods-surface': 'Cards, panels',
  'ods-line': 'Borders, grid lines',
  'ods-line-strong': 'Inputs, secondary buttons',
  'ods-slate': 'Secondary text',
  'ods-text': 'Body text',
  'ods-success': 'Paid, approved, done steps',
  'ods-warning': 'Due soon, waiting, unsaved',
  'ods-danger': 'Overdue, errors, destructive',
  'ods-info': 'Sent, open, in production',
  'ods-focus': 'Focus ring, 3 px',
};

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`ods-${id}`} data-testid={`ods-${id}`} className="border-t border-ods-line py-8">
      <h2 id={`ods-${id}`}>{title}</h2>
      {note ? <p className="mt-1 max-w-[760px] text-ods-small text-ods-slate">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Swatch({ name }: { name: keyof typeof odsBaseVars }) {
  const hex = odsBaseVars[name];
  const isText = !name.endsWith('-tint') && !['ods-canvas', 'ods-surface', 'ods-line', 'ods-line-strong', 'ods-teal', 'ods-focus'].includes(name);
  return (
    <li className="overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card">
      <div className="h-16 border-b border-ods-line" style={{ background: `var(--${name})` }} aria-hidden="true" />
      <div className="p-3">
        <div className="text-ods-label font-semibold">{name.replace('ods-', '')}</div>
        <div className="num text-left text-ods-small text-ods-slate"><code>--{name}</code> · {hex}</div>
        {USE[name] ? <div className="mt-1 text-ods-small text-ods-slate">{USE[name]}</div> : null}
        {isText ? <div className="mt-1 text-ods-small text-ods-slate">On white {ratio(hex, WHITE)}</div> : null}
      </div>
    </li>
  );
}

const SwatchGrid = ({ names }: { names: readonly (keyof typeof odsBaseVars)[] }) => (
  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 ods-desktop:grid-cols-5">{names.map((n) => <Swatch key={n} name={n} />)}</ul>
);

const TYPE = [
  ['Display (hero)', 'text-ods-display font-bold', 'ods-display', '52 / 1.08 desktop, 34 phone'],
  ['H1 page title', 'text-ods-h1 font-bold', 'ods-h1', '28 / 1.2 (24 phone) · compact 20'],
  ['H2 section', 'text-ods-h2 font-bold', 'ods-h2', '21 · compact 15'],
  ['Body', 'text-ods-body', 'ods-text-body', '15 / 1.6 · compact 13 / 1.5'],
  ['Table', 'text-ods-table', 'ods-text-table', '14 · compact 13'],
  ['Label', 'text-ods-label font-semibold', 'ods-text-label', '13, 600 · compact 12, 600'],
  ['Small / meta', 'text-ods-small text-ods-slate', 'ods-text-small', '13 · compact 12'],
] as const;

function TypePanel({ density }: { density: OdsDensity }) {
  return (
    <div data-density={density} className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
      <h3 className="capitalize">{density}</h3>
      <dl className="mt-3 space-y-3">
        {TYPE.filter(([n]) => density === 'comfortable' || !n.startsWith('Display')).map(([n, cls, v, spec]) => (
          <div key={n}>
            <dt className="text-ods-small text-ods-slate">{n} · <code>--{v}</code> · {spec}</dt>
            <dd className={`${cls} break-words`}>Pay balance US$ <span className="num">2,870.00</span></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const DENSITY_ROWS: [string, string][] = [
  ['Buttons and inputs', 'ods-control-h'], ['Table rows', 'ods-row-h'], ['Table header', 'ods-head-h'], ['Tabs', 'ods-tab-h'], ['Tab bar', 'ods-tab-bar'],
  ['Radius: controls', 'ods-radius-control'], ['Radius: cards', 'ods-radius-card'], ['Radius: pills', 'ods-radius-pill'],
  ['Page padding', 'ods-pad-page'], ['Card padding', 'ods-pad-card'], ['Gap', 'ods-gap'], ['Icon', 'ods-icon'],
];

function DensityPanel({ density }: { density: OdsDensity }) {
  const v = odsDensityVars[density];
  const id = `d-${density}`;
  return (
    <section data-density={density} data-testid={`ods-density-${density}`} aria-labelledby={`${id}-h`} className="min-w-0 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
      <h3 id={`${id}-h`} className="text-ods-h2 font-bold capitalize">{density}</h3>
      <p className="text-ods-small text-ods-slate">{density === 'comfortable' ? 'Customer areas: introduction site, Shop, My account.' : 'Staff apps: Back Office.'}</p>
      <div className="mt-ods-gap flex flex-wrap items-center gap-ods-gap">
        <button type="button" data-testid="ods-control" className="inline-flex h-ods-control items-center gap-2 rounded-ods-control bg-ods-blue px-4 text-ods-body font-semibold text-white hover:bg-ods-blue-hover">
          <Icon icon={Check} /> Save changes
        </button>
        <button type="button" className="inline-flex h-ods-control items-center gap-2 rounded-ods-control border border-ods-line-strong bg-ods-surface px-4 text-ods-body font-semibold text-ods-navy">
          Cancel
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-ods-pill bg-ods-success-tint px-2.5 py-1 text-ods-label font-semibold text-ods-success">
          <span className="size-1.5 rounded-full bg-ods-success" aria-hidden="true" /> Paid
        </span>
      </div>
      <div className="mt-ods-gap">
        <label htmlFor={`${id}-q`} className="block text-ods-label font-semibold text-ods-navy">Search orders</label>
        <div className="relative mt-1">
          <Icon icon={Search} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ods-slate" />
          <input id={`${id}-q`} data-testid="ods-input" type="search" className="h-ods-control w-full rounded-ods-control border border-ods-line-strong bg-ods-surface pr-3 pl-9 text-ods-body text-ods-text" />
        </div>
      </div>
      <div className="mt-ods-gap overflow-x-auto">
        <table className="w-full border-collapse text-ods-table">
          <caption className="sr-only">{density} density values</caption>
          <thead>
            <tr className="bg-ods-canvas">
              <th scope="col" className="h-ods-head border-b border-ods-line px-3 text-left text-ods-label font-semibold text-ods-slate">Token</th>
              <th scope="col" className="h-ods-head border-b border-ods-line px-3 text-right text-ods-label font-semibold text-ods-slate">Value</th>
            </tr>
          </thead>
          <tbody>
            {DENSITY_ROWS.map(([label, key]) => (
              <tr key={key} data-testid={key === 'ods-control-h' ? 'ods-row' : undefined}>
                <td className="h-ods-row border-b border-ods-line px-3">{label} <code className="text-ods-small text-ods-slate">--{key}</code></td>
                <td className="num h-ods-row border-b border-ods-line px-3">{v[key as keyof typeof v]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-ods-gap flex items-center gap-3 text-ods-small text-ods-slate">
        <Icon icon={Bell} className="text-ods-navy" /> Icon at <code>--ods-icon</code> ({v['ods-icon']})
      </div>
    </section>
  );
}

const LOGOS: { variant: LogoVariant; area: LogoArea; signedIn?: boolean; dark: boolean; link: string }[] = [
  { variant: 'mark', area: 'public', dark: false, link: 'Introduction site → /' },
  { variant: 'mark-white', area: 'shop', dark: true, link: 'Shop → /shop' },
  { variant: 'white-tagline', area: 'account', dark: true, link: 'My account → /shop in the "octopus-shop" tab' },
  { variant: 'full', area: 'public', signedIn: true, dark: false, link: 'Introduction site, signed in → /shop' },
];

const FAVICONS = [
  ['favicon-16.png', 16], ['favicon-32.png', 32], ['apple-touch-icon-180.png', 180], ['icon-192.png', 192], ['icon-512.png', 512],
] as const;

/** ODS 1.0 · T1: every token, both densities, logos, icons and favicons. Staging and local only (404 on live). */
export default function OdsTokensPage() {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:text-ods-navy">
        Skip to content
      </a>
      <header className="border-b border-ods-line bg-ods-surface">
        <div className="mx-auto flex max-w-ods-content flex-wrap items-center justify-between gap-3 px-ods-pad-page py-3">
          <Logo variant="mark" area="public" priority />
          <DevNav />
          <Link href="/dev/ui/current" className="inline-flex min-h-11 items-center gap-1 font-semibold text-ods-blue underline-offset-4 hover:underline">
            Current theme components <Icon icon={ArrowRight} size="sm" />
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-ods-content px-ods-pad-page pt-8 pb-24">
        <div className="flex flex-wrap items-center gap-3">
          <h1>ODS 1.0 tokens</h1>
          <span className="inline-flex items-center gap-1.5 rounded-ods-pill bg-ods-warning-tint px-2.5 py-1 text-ods-label font-semibold text-ods-warning">
            <Icon icon={CircleAlert} size="xs" /> Staging only
          </span>
        </div>
        <p className="mt-2 max-w-[760px] text-ods-slate">
          The new theme&apos;s tokens, scoped under <code>data-theme=&quot;ods&quot;</code>, so the live site is unchanged while the{' '}
          <code>ods_theme_v1</code> switch is off. Source: <code>packages/ui/src/tokens.css</code> (CSS) and <code>tokens.ts</code> (TypeScript).
          Tailwind utilities are prefixed <code>ods-</code>. This page returns 404 on the live site.
        </p>

        <Section id="colours" title="Colours" note="Taken from the logo. Never use other colours for these jobs. Contrast is shown for text colours on white.">
          <h3 className="mb-2">Brand</h3>
          <SwatchGrid names={BRAND} />
          <h3 className="mt-6 mb-2">Neutrals</h3>
          <SwatchGrid names={NEUTRAL} />
          <h3 className="mt-6 mb-2">Status</h3>
          <SwatchGrid names={STATUS} />
        </Section>

        <Section id="services" title="Service colours" note="Customer areas only. Always shown with the name and the icon, never colour alone.">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 ods-desktop:grid-cols-3">
            {odsServices.map((s) => (
              <li key={s.key} className="flex items-center gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-3 shadow-ods-card" style={{ borderInlineStart: `6px solid var(--svc-${s.key})` }}>
                <span className="grid size-11 shrink-0 place-items-center rounded-ods-control" style={{ background: `var(--svc-${s.key}-tint)`, color: `var(--svc-${s.key})` }}>
                  <Icon icon={ODS_SERVICE_ICONS[s.key]} size="lg" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold" style={{ color: `var(--svc-${s.key})` }}>{s.name}</div>
                  <div className="num text-left text-ods-small text-ods-slate">
                    <code>--svc-{s.key}</code> {s.strong} · <code>-tint</code> {s.tint} · {ratio(s.strong, s.tint)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="type" title="Typography" note="Inter 400/500/600/700, loaded only on ODS pages. Tabular figures for numbers and money (.num).">
          <div className="grid grid-cols-1 gap-ods-gap ods-tablet:grid-cols-2">
            <TypePanel density="comfortable" />
            <TypePanel density="compact" />
          </div>
          <p className="mt-3 text-ods-small text-ods-slate">
            Weights: <span className="font-normal">400 Regular</span> · <span className="font-medium">500 Medium</span> · <span className="font-semibold">600 Semibold</span> · <span className="font-bold">700 Bold</span>
          </p>
        </Section>

        <Section id="spacing" title="Spacing" note="4 px base. The steps match Tailwind's numbers (p-4 = 16 px). Page padding 32 desktop / 16 phone; compact 16.">
          <ul className="space-y-2">
            {([1, 2, 3, 4, 5, 6, 8, 12, 18, 20] as const).map((n) => (
              <li key={n} className="flex items-center gap-3">
                <code className="num w-44 shrink-0 text-left text-ods-small whitespace-nowrap">--ods-space-{n} · {odsBaseVars[`ods-space-${n}`]}</code>
                <span className="h-3 rounded-sm bg-ods-blue" style={{ width: `var(--ods-space-${n})` }} aria-hidden="true" />
              </li>
            ))}
          </ul>
        </Section>

        <Section id="radius" title="Radius" note="Comfortable: controls 8, cards 14, pills 999. Compact: 6 everywhere, status pills 4.">
          <div className="grid grid-cols-1 gap-ods-gap ods-tablet:grid-cols-2">
            {(['comfortable', 'compact'] as const).map((d) => (
              <div key={d} data-density={d} className="flex flex-wrap items-end gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
                <span className="w-full text-ods-label font-semibold capitalize">{d}</span>
                {(['control', 'card', 'pill'] as const).map((r) => (
                  <div key={r} className="text-center">
                    <div className={`size-16 border-2 border-ods-navy bg-ods-blue-tint ${r === 'control' ? 'rounded-ods-control' : r === 'card' ? 'rounded-ods-card' : 'rounded-ods-pill'}`} aria-hidden="true" />
                    <div className="mt-1 text-ods-small text-ods-slate">{r} {odsDensityVars[d][`ods-radius-${r}`]}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section id="shadows" title="Shadows" note="Nothing else.">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {([['card', 'shadow-ods-card', 'Cards'], ['pop', 'shadow-ods-pop', 'Menus and drawers'], ['dialog', 'shadow-ods-dialog', 'Dialogs']] as const).map(([k, cls, use]) => (
              <div key={k} className={`rounded-ods-card bg-ods-surface p-ods-pad-card ${cls}`}>
                <div className="font-semibold">{use}</div>
                <code className="text-ods-small text-ods-slate break-words">--ods-shadow-{k}: {odsBaseVars[`ods-shadow-${k}`]}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section id="z" title="Z-index" note="Use as z-(--z-modal) etc.">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 ods-desktop:grid-cols-7">
            {Object.entries(odsZ).map(([k, n]) => (
              <li key={k} className="rounded-ods-control border border-ods-line bg-ods-surface p-3">
                <div className="font-semibold">{k}</div>
                <code className="num text-left text-ods-small text-ods-slate">--z-{k} · {n}</code>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="focus" title="Focus ring" note="3 px #F59E0B outline, 2 px offset, on every focusable element inside an ODS root. Press Tab to see it on the buttons and links.">
          <div className="flex flex-wrap items-center gap-6">
            <button type="button" data-testid="ods-focus-demo" className="inline-flex h-ods-control items-center rounded-ods-control bg-ods-blue px-4 font-semibold text-white">Tab to me</button>
            <span className="inline-flex h-ods-control items-center rounded-ods-control border border-ods-line-strong bg-ods-surface px-4 font-semibold text-ods-navy outline-3 outline-offset-2 outline-ods-focus">
              Always shown (sample)
            </span>
            <span className="inline-flex h-ods-control items-center rounded-ods-control bg-ods-navy-dark px-4 font-semibold text-white outline-3 outline-offset-2 outline-ods-focus">
              On navy (sample)
            </span>
          </div>
        </Section>

        <Section id="densities" title="Densities side by side" note="One set of components; the density token decides the size. Comfortable = customer areas, compact = staff apps.">
          <div className="grid grid-cols-1 gap-ods-gap ods-desktop:grid-cols-2">
            <DensityPanel density="comfortable" />
            <DensityPanel density="compact" />
          </div>
        </Section>

        <Section id="logos" title="Logos" note='Files from the design package, unchanged. Always a link, alt="Octopus B2B". The six function logos stay only for service-page heroes.'>
          <ul className="grid grid-cols-1 gap-ods-gap ods-tablet:grid-cols-2">
            {LOGOS.map((l) => (
              <li key={l.variant} className="overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card">
                <div className={`flex min-h-32 items-center justify-center p-6 ${l.dark ? 'bg-ods-navy' : 'bg-ods-surface'}`}>
                  <Logo variant={l.variant} area={l.area} signedIn={l.signedIn} />
                </div>
                <div className="border-t border-ods-line p-3">
                  <div className="font-semibold"><code>{l.variant}</code> · {LOGO_FILES[l.variant].src.split('/').pop()}</div>
                  <div className="text-ods-small text-ods-slate">{LOGO_FILES[l.variant].use}</div>
                  <div className="text-ods-small text-ods-slate">Link: {l.link}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="icons" title="Icons" note="Lucide, stroke 1.9, aria-hidden next to text. 14 compact, 16–18 comfortable, 20–22 phone bottom bar. Default size follows --ods-icon.">
          <div className="flex flex-wrap items-end gap-6">
            {(Object.keys(ODS_ICON_SIZES) as (keyof typeof ODS_ICON_SIZES)[]).map((k) => (
              <div key={k} className="text-center text-ods-navy" data-testid={`ods-icon-${k}`}>
                <Icon icon={ShoppingCart} size={k} />
                <div className="mt-1 text-ods-small text-ods-slate">{k} · {ODS_ICON_SIZES[k]} px</div>
              </div>
            ))}
            {(['comfortable', 'compact'] as const).map((d) => (
              <div key={d} data-density={d} className="text-center text-ods-navy">
                <Icon icon={ShoppingCart} />
                <div className="mt-1 text-ods-small text-ods-slate">auto ({d}) · {odsDensityVars[d]['ods-icon']}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="favicons" title="Favicons" note="Generated from octopus-b2b-logo-original-transparent.png (the octopus O, unchanged). Not wired yet: the live app icon switches with the flag.">
          <ul className="flex flex-wrap items-end gap-6">
            {FAVICONS.map(([file, px]) => (
              <li key={file} className="text-center">
                <Image src={`/images/ods/icons/${file}`} alt="" width={Math.min(px, 96)} height={Math.min(px, 96)} className="mx-auto rounded-sm border border-ods-line bg-ods-surface" unoptimized />
                <div className="mt-1 text-ods-small text-ods-slate">{file} · {px}×{px}</div>
              </li>
            ))}
          </ul>
        </Section>
      </main>
    </OdsThemeRoot>
  );
}
