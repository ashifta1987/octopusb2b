import { describe, expect, it } from 'vitest';
import { ODS_OFF, isOdsTheme, odsDensityFor, odsThemeFor, parseOdsThemeSetting, type OdsArea, type OdsThemeSetting } from '@/lib/ods-flag';

const ORG = '0b9c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';
const OTHER = '11111111-2222-4333-8444-555555555555';
const AREAS: OdsArea[] = ['public', 'auth', 'shop', 'account', 'office'];
const s = (mode: OdsThemeSetting['mode'], beta_org_ids: string[] = []): OdsThemeSetting => ({ mode, beta_org_ids });

describe('ods_theme_v1: parsing (missing or malformed = off)', () => {
  it('no row / null / junk → off', () => {
    for (const v of [undefined, null, '', 0, 1, true, false, [], ['all'], {}, { mode: 'on' }, { mode: 42 }, '{bad json', 'yes'])
      expect(parseOdsThemeSetting(v)).toEqual(ODS_OFF);
  });
  it('valid objects, JSON strings and bare mode strings', () => {
    expect(parseOdsThemeSetting({ mode: 'all' })).toEqual(s('all'));
    expect(parseOdsThemeSetting({ mode: ' Staff ' })).toEqual(s('staff'));
    expect(parseOdsThemeSetting('beta')).toEqual(s('beta'));
    expect(parseOdsThemeSetting(JSON.stringify({ mode: 'beta', beta_org_ids: [ORG] }))).toEqual(s('beta', [ORG]));
  });
  it('beta ids: only UUIDs, trimmed, lower-cased, de-duplicated', () => {
    const v = parseOdsThemeSetting({ mode: 'beta', beta_org_ids: [ORG.toUpperCase(), ` ${ORG} `, 'not-a-uuid', 7, null, OTHER] });
    expect(v.beta_org_ids).toEqual([ORG, OTHER]);
    expect(parseOdsThemeSetting({ mode: 'beta', beta_org_ids: 'x' }).beta_org_ids).toEqual([]);
  });
});

describe('ods_theme_v1: who gets the theme', () => {
  it('off → nobody, in every area', () => {
    for (const area of AREAS) {
      expect(odsThemeFor(s('off', [ORG]), { area, isStaff: true, orgId: ORG })).toBe(false);
      expect(odsThemeFor(s('off'), { area })).toBe(false);
    }
  });
  it('all → everyone, signed out included', () => {
    for (const area of AREAS) expect(odsThemeFor(s('all'), { area })).toBe(true);
  });
  it('staff → staff only', () => {
    for (const area of AREAS) {
      expect(odsThemeFor(s('staff'), { area, isStaff: true })).toBe(true);
      expect(odsThemeFor(s('staff', [ORG]), { area, isStaff: false, orgId: ORG })).toBe(false);
    }
  });
  it('beta → staff + listed companies in the Shop and My account only', () => {
    const beta = s('beta', [ORG]);
    for (const area of AREAS) expect(odsThemeFor(beta, { area, isStaff: true })).toBe(true);
    expect(odsThemeFor(beta, { area: 'shop', orgId: ORG })).toBe(true);
    expect(odsThemeFor(beta, { area: 'account', orgId: ORG.toUpperCase() })).toBe(true);
    expect(odsThemeFor(beta, { area: 'account', orgId: OTHER })).toBe(false);
    expect(odsThemeFor(beta, { area: 'account', orgId: null })).toBe(false);
    // the introduction site and sign-in have no company: beta never applies to customers there (audit C9)
    expect(odsThemeFor(beta, { area: 'public', orgId: ORG })).toBe(false);
    expect(odsThemeFor(beta, { area: 'auth', orgId: ORG })).toBe(false);
    // the office is staff-only anyway; a customer org id alone never turns it on
    expect(odsThemeFor(beta, { area: 'office', orgId: ORG })).toBe(false);
  });
  it('isOdsTheme reads the setting once and fails closed', async () => {
    expect(await isOdsTheme({ area: 'shop', orgId: ORG }, async () => s('beta', [ORG]))).toBe(true);
    expect(await isOdsTheme({ area: 'shop', orgId: ORG }, async () => ODS_OFF)).toBe(false);
    expect(await isOdsTheme({ area: 'shop', isStaff: true }, async () => { throw new Error('db down'); })).toBe(false);
  });
  it('density: office compact, every customer area comfortable', () => {
    expect(odsDensityFor('office')).toBe('compact');
    for (const area of ['public', 'auth', 'shop', 'account'] as OdsArea[]) expect(odsDensityFor(area)).toBe('comfortable');
  });
});
