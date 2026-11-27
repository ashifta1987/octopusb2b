import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, odsBaseVars, odsColors, odsDensityVars, odsPhoneVars, odsServices } from '@octopus/ui/tokens';
import { LOGO_FILES, logoLink, logoSize } from '@octopus/ui/logo-href';

const ROOT = path.resolve(__dirname, '../..');
const css = readFileSync(path.join(ROOT, 'packages/ui/src/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Custom properties declared in the first rule whose selector list starts with `selectorStart` (optionally inside @media). */
function varsOf(selectorStart: string, from = 0): Record<string, string> {
  const at = css.indexOf(selectorStart, from);
  expect(at, `rule ${selectorStart}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Split a selector list on top-level commas (not the ones inside :is(…)). */
function splitTop(sel: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur];
}

describe('ODS tokens: tokens.css and tokens.ts are identical (Appendix A)', () => {
  it('base variables', () => {
    expect(varsOf('[data-theme="ods"] {')).toEqual(odsBaseVars);
  });
  it('comfortable and compact', () => {
    expect(varsOf('[data-theme="ods"],\n[data-theme="ods"][data-density="comfortable"]')).toEqual(odsDensityVars.comfortable);
    expect(varsOf('[data-theme="ods"][data-density="compact"],')).toEqual(odsDensityVars.compact);
  });
  it('phone overrides (comfortable only)', () => {
    expect(varsOf('[data-theme="ods"],', css.indexOf('@media (max-width: 767px)'))).toEqual(odsPhoneVars);
  });
  it('nothing is declared on :root or html: the theme is scoped (flag off = no change)', () => {
    expect(css).not.toMatch(/(^|[\s,}]):root\b/);
    for (const m of css.matchAll(/([^{}]+)\{/g)) {
      const sel = m[1].trim();
      if (sel.startsWith('@')) continue;
      for (const part of splitTop(sel)) expect(part, `selector "${part.trim()}" must be inside an ODS root`).toMatch(/data-theme="ods"/);
    }
  });
  it('Part 2.2 values the owner approved (27 Nov)', () => {
    expect(odsColors).toMatchObject({ navy: '#1A174A', blue: '#2A6FD1', teal: '#5FD3C9', canvas: '#F4F6F9', focus: '#F59E0B' });
    expect(odsDensityVars.comfortable['ods-control-h']).toBe('44px');
    expect(odsDensityVars.compact['ods-control-h']).toBe('32px');
    expect(odsServices.map((x) => x.key)).toEqual(['sourcing', 'pools', 'dropship', '3pl', 'turnkey', 'brand']);
  });
});

describe('ODS contrast (2.9: text ≥ 4.5:1)', () => {
  it('text colours on white and on the canvas', () => {
    for (const c of ['navy', 'blue', 'blueHover', 'slate', 'success', 'warning', 'danger', 'info'] as const) {
      expect(contrastRatio(odsColors[c], '#FFFFFF'), `${c} on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(odsColors[c], odsColors.canvas), `${c} on canvas`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio('#FFFFFF', odsColors.blue)).toBeGreaterThanOrEqual(4.5); // white text on primary buttons
  });
  it('each service: strong text on its tint', () => {
    for (const svc of odsServices) expect(contrastRatio(svc.strong, svc.tint), svc.name).toBeGreaterThanOrEqual(4.5);
  });
  it('status text on its tint', () => {
    for (const k of ['success', 'warning', 'danger', 'info'] as const)
      expect(contrastRatio(odsColors[k], odsColors[`${k}Tint`]), k).toBeGreaterThanOrEqual(4.5);
  });
  it('focus ring ≥ 3:1 against the navy bars (UI contrast)', () => {
    expect(contrastRatio(odsColors.focus, odsColors.navy)).toBeGreaterThanOrEqual(3);
  });
});

describe('Logo (Part 2.3)', () => {
  it('links per area', () => {
    expect(logoLink('public')).toEqual({ href: '/' });
    expect(logoLink('public', { signedIn: true })).toEqual({ href: '/shop' });
    expect(logoLink('shop')).toEqual({ href: '/shop' });
    expect(logoLink('account')).toEqual({ href: '/shop', target: 'octopus-shop' });
    expect(logoLink('account', { sameTab: true })).toEqual({ href: '/shop' });
    expect(logoLink('office')).toEqual({ href: '/office' });
  });
  it('files exist in public/images/ods with their original names, sizes keep the aspect ratio', () => {
    for (const [variant, f] of Object.entries(LOGO_FILES)) {
      const file = path.join(ROOT, 'public', f.src);
      expect(readFileSync(file).subarray(1, 4).toString(), variant).toBe('PNG');
      expect(f.src).toMatch(/^\/images\/ods\/octopus-b2b-logo(-mark|-mark-white|-white)?\.png$/);
    }
    expect(logoSize('mark', 32)).toEqual({ width: 160, height: 32 });
    // the tagline version is never narrower than 200 px
    expect(logoSize('white-tagline', 30).width).toBe(200);
  });
});
