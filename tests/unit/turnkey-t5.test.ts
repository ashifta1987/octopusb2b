import { describe, expect, it } from 'vitest';
import {
  TK_INSPECTION_KINDS, TK_PHOTO_MAX_BYTES, TK_PHOTO_TYPES, aqlProblem, inspectionLabel, inspectionStatusLabel, parseCount, photoExt, psiGate, resultLabel,
} from '@/lib/turnkey/format';

describe('turnkey T5 helpers', () => {
  it('only the two inspections the design names, with their services', () => {
    expect(TK_INSPECTION_KINDS.map((k) => k.code)).toEqual(['factory_audit', 'pre_shipment']);
    expect(TK_INSPECTION_KINDS.map((k) => k.service)).toEqual(['factory_audit', 'pre_shipment_inspection']);
  });
  it('labels rounds like tk_inspection_label', () => {
    expect(inspectionLabel('pre_shipment', 1)).toBe('Pre-shipment inspection');
    expect(inspectionLabel('pre_shipment', 2)).toBe('Pre-shipment inspection (round 2)');
    expect(inspectionLabel('factory_audit', 1)).toBe('Factory audit');
  });
  it('client and staff status words differ where it matters', () => {
    expect(inspectionStatusLabel('submitted').label).toBe('Report being checked');
    expect(inspectionStatusLabel('submitted', 'staff').label).toBe('Submitted · review it');
    expect(resultLabel('fail').tone).toBe('red');
    expect(resultLabel(null).label).toBe('No result yet');
  });
  it('whole numbers only for AQL inputs; the sample is never larger than the lot', () => {
    expect(parseCount('500')).toBe(500);
    expect(parseCount('2.5')).toBeNull();
    expect(parseCount('-1')).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(aqlProblem(500, 50, 0, 1, 2)).toBeNull();
    expect(aqlProblem(50, 500, 0, 0, 0)).toMatch(/sample cannot be larger/);
    expect(aqlProblem(null, 5, 0, 0, 0)).toMatch(/lot size/);
    expect(aqlProblem(5, 5, null, 0, 0)).toMatch(/defects/);
  });
  it('photos: JPG / PNG / WEBP up to 10 MB', () => {
    expect([...TK_PHOTO_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(TK_PHOTO_MAX_BYTES).toBe(10485760);
    expect(photoExt('image/png')).toBe('png');
    expect(photoExt('image/jpeg')).toBe('jpg');
  });
  it('Production and QC completes with the latest pre-shipment inspection passed and published (mirrors the DB gate)', () => {
    expect(psiGate([]).done).toBe(false);
    expect(psiGate([{ kind: 'factory_audit', round: 1, status: 'published', result: 'pass' }]).done).toBe(false);
    expect(psiGate([{ kind: 'pre_shipment', round: 1, status: 'submitted', result: 'pass' }]).done).toBe(false);
    expect(psiGate([{ kind: 'pre_shipment', round: 1, status: 'published', result: 'pass_with_remarks' }]).done).toBe(true);
    expect(psiGate([{ kind: 'pre_shipment', round: 1, status: 'published', result: 'fail' }]).done).toBe(false);
    expect(psiGate([{ kind: 'pre_shipment', round: 1, status: 'published', result: 'fail', overridden: true }]).done).toBe(true);
    // the newest round decides; cancelled rounds do not count
    expect(psiGate([{ kind: 'pre_shipment', round: 1, status: 'published', result: 'pass' }, { kind: 'pre_shipment', round: 2, status: 'planned' }]).done).toBe(false);
    expect(psiGate([{ kind: 'pre_shipment', round: 1, status: 'published', result: 'pass' }, { kind: 'pre_shipment', round: 2, status: 'cancelled' }]).done).toBe(true);
  });
});
