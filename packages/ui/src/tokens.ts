/**
 * ODS 1.0 token values (NEW-THEME-MASTER-PROMPT Part 2.2 + Appendix A), for TypeScript.
 * The CSS custom properties live in ./tokens.css, scoped under [data-theme="ods"]. tests/unit/ods-tokens.test.ts
 * checks that every value here matches tokens.css exactly, so change both together.
 * Pure module: no React, no Next, so server libs, emails and tests can import `@octopus/ui/tokens`.
 */

/** Base custom properties (same in both densities). Keys are the CSS names without the leading `--`. */
export const odsBaseVars = {
  // brand (from the logo)
  'ods-navy': '#1A174A',
  'ods-navy-dark': '#14123B',
  'ods-navy-hover': '#2E2B66',
  'ods-blue': '#2A6FD1',
  'ods-blue-hover': '#1F5BB0',
  'ods-blue-tint': '#EAF1FC',
  'ods-teal': '#5FD3C9',
  // neutrals
  'ods-canvas': '#F4F6F9',
  'ods-surface': '#FFFFFF',
  'ods-line': '#E3E7EF',
  'ods-line-strong': '#C9D0DD',
  'ods-slate': '#5B6478',
  'ods-text': '#1A174A',
  // status
  'ods-success': '#0B7A75',
  'ods-success-tint': '#E3F5F3',
  'ods-warning': '#B54708',
  'ods-warning-tint': '#FFF4E5',
  'ods-danger': '#B42318',
  'ods-danger-tint': '#FDECEA',
  'ods-info': '#1D4E9A',
  'ods-info-tint': '#EAF1FC',
  'ods-focus': '#F59E0B',
  // services
  'svc-sourcing': '#1D4E9A',
  'svc-sourcing-tint': '#EAF1FC',
  'svc-pools': '#0B5F5B',
  'svc-pools-tint': '#E3F5F3',
  'svc-dropship': '#5B3AA8',
  'svc-dropship-tint': '#F0EBFB',
  'svc-3pl': '#3B4687',
  'svc-3pl-tint': '#EDEFF8',
  'svc-turnkey': '#94420A',
  'svc-turnkey-tint': '#FDF1E6',
  'svc-brand': '#A11B5A',
  'svc-brand-tint': '#FCE9F1',
  // type: Inter comes from next/font (packages/ui/src/fonts.ts) as --font-ods-inter, only on ODS roots
  'ods-font': 'var(--font-ods-inter), Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  'ods-leading-title': '1.2',
  'ods-leading-display': '1.08',
  // shadows (nothing else)
  'ods-shadow-card': '0 1px 2px rgba(26,23,74,.05)',
  'ods-shadow-pop': '0 12px 32px rgba(26,23,74,.14)',
  'ods-shadow-dialog': '0 16px 40px rgba(26,23,74,.18)',
  // z-index scale
  'z-base': '0',
  'z-sticky': '10',
  'z-dropdown': '20',
  'z-drawer': '30',
  'z-modal': '40',
  'z-toast': '50',
  'z-palette': '60',
  // layout
  'ods-content-max': '1240px',
  // spacing, 4 px base (step numbers = Tailwind's, so p-4 = --ods-space-4 = 16px)
  'ods-space-1': '4px',
  'ods-space-2': '8px',
  'ods-space-3': '12px',
  'ods-space-4': '16px',
  'ods-space-5': '20px',
  'ods-space-6': '24px',
  'ods-space-8': '32px',
  'ods-space-12': '48px',
  'ods-space-18': '72px',
  'ods-space-20': '80px',
  // focus ring: 3 px amber, 2 px offset
  'ods-focus-width': '3px',
  'ods-focus-offset': '2px',
  // motion: 150–200 ms ease-out (menus, drawers, tab indicators)
  'ods-motion-fast': '150ms',
  'ods-motion': '200ms',
  'ods-ease': 'cubic-bezier(0,0,.2,1)',
  // phone bottom bar icons
  'ods-icon-bar': '22px',
} as const;

/** Density custom properties. Comfortable = customer areas (default), compact = staff apps. */
export const odsDensityVars = {
  comfortable: {
    'ods-text-body': '15px',
    'ods-text-table': '14px',
    'ods-text-label': '13px',
    'ods-text-small': '13px',
    'ods-display': '52px',
    'ods-h1': '28px',
    'ods-h2': '21px',
    'ods-leading-body': '1.6',
    'ods-control-h': '44px',
    'ods-row-h': '52px',
    'ods-head-h': '44px',
    'ods-radius-control': '8px',
    'ods-radius-card': '14px',
    'ods-radius-pill': '999px',
    'ods-pad-page': '32px',
    'ods-pad-card': '20px',
    'ods-gap': '16px',
    'ods-tab-h': '48px',
    'ods-tab-bar': '3px',
    'ods-icon': '18px',
  },
  compact: {
    'ods-text-body': '13px',
    'ods-text-table': '13px',
    'ods-text-label': '12px',
    'ods-text-small': '12px',
    'ods-display': '52px',
    'ods-h1': '20px',
    'ods-h2': '15px',
    'ods-leading-body': '1.5',
    'ods-control-h': '32px',
    'ods-row-h': '36px',
    'ods-head-h': '34px',
    'ods-radius-control': '6px',
    'ods-radius-card': '6px',
    'ods-radius-pill': '4px',
    'ods-pad-page': '16px',
    'ods-pad-card': '12px',
    'ods-gap': '12px',
    'ods-tab-h': '36px',
    'ods-tab-bar': '2px',
    'ods-icon': '14px',
  },
} as const;

/** Phone (< 768 px) overrides, comfortable density only (compact keeps its own sizes). */
export const odsPhoneVars = { 'ods-pad-page': '16px', 'ods-h1': '24px', 'ods-display': '34px' } as const;

export type OdsDensity = keyof typeof odsDensityVars;
export type OdsBaseVar = keyof typeof odsBaseVars;
export type OdsDensityVar = keyof typeof odsDensityVars.comfortable;

/* ───────── friendly views of the same values ───────── */

export const odsColors = {
  navy: odsBaseVars['ods-navy'],
  navyDark: odsBaseVars['ods-navy-dark'],
  navyHover: odsBaseVars['ods-navy-hover'],
  blue: odsBaseVars['ods-blue'],
  blueHover: odsBaseVars['ods-blue-hover'],
  blueTint: odsBaseVars['ods-blue-tint'],
  teal: odsBaseVars['ods-teal'],
  canvas: odsBaseVars['ods-canvas'],
  surface: odsBaseVars['ods-surface'],
  line: odsBaseVars['ods-line'],
  lineStrong: odsBaseVars['ods-line-strong'],
  slate: odsBaseVars['ods-slate'],
  text: odsBaseVars['ods-text'],
  success: odsBaseVars['ods-success'],
  successTint: odsBaseVars['ods-success-tint'],
  warning: odsBaseVars['ods-warning'],
  warningTint: odsBaseVars['ods-warning-tint'],
  danger: odsBaseVars['ods-danger'],
  dangerTint: odsBaseVars['ods-danger-tint'],
  info: odsBaseVars['ods-info'],
  infoTint: odsBaseVars['ods-info-tint'],
  focus: odsBaseVars['ods-focus'],
} as const;

export type OdsServiceKey = 'sourcing' | 'pools' | 'dropship' | '3pl' | 'turnkey' | 'brand';
/** The six services: always shown with the name and the icon, never colour alone. `icon` = Lucide name (see icon.tsx). */
export const odsServices: readonly { key: OdsServiceKey; name: string; strong: string; tint: string; icon: 'box' | 'users' | 'truck' | 'package' | 'layers' | 'sparkles' }[] = [
  { key: 'sourcing', name: 'Sourcing', strong: odsBaseVars['svc-sourcing'], tint: odsBaseVars['svc-sourcing-tint'], icon: 'box' },
  { key: 'pools', name: 'MOQ pools', strong: odsBaseVars['svc-pools'], tint: odsBaseVars['svc-pools-tint'], icon: 'users' },
  { key: 'dropship', name: 'Dropshipping', strong: odsBaseVars['svc-dropship'], tint: odsBaseVars['svc-dropship-tint'], icon: 'truck' },
  { key: '3pl', name: 'Warehouse (3PL)', strong: odsBaseVars['svc-3pl'], tint: odsBaseVars['svc-3pl-tint'], icon: 'package' },
  { key: 'turnkey', name: 'Turnkey projects', strong: odsBaseVars['svc-turnkey'], tint: odsBaseVars['svc-turnkey-tint'], icon: 'layers' },
  { key: 'brand', name: 'Make My Brand', strong: odsBaseVars['svc-brand'], tint: odsBaseVars['svc-brand-tint'], icon: 'sparkles' },
];

export const odsShadows = { card: odsBaseVars['ods-shadow-card'], pop: odsBaseVars['ods-shadow-pop'], dialog: odsBaseVars['ods-shadow-dialog'] } as const;
export const odsZ = { base: 0, sticky: 10, dropdown: 20, drawer: 30, modal: 40, toast: 50, palette: 60 } as const;
export const odsSpace = [4, 8, 12, 16, 20, 24, 32, 48, 72, 80] as const;
/** phone < 768, tablet 768–1199, desktop ≥ 1200 (Tailwind variants: `ods-tablet:` and `ods-desktop:`). */
export const odsBreakpoints = { tablet: 768, desktop: 1200 } as const;
export const odsFocusRing = { color: odsBaseVars['ods-focus'], width: 3, offset: 2 } as const;

/* ───────── contrast (WCAG 2.x) for the token page and tests ───────── */

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
