import { describe, expect, it } from 'vitest';
import { clampQuantity, fileMatchesAccept, formatFileSize, parseDecimal, validateFile, validateNumber } from '../../packages/ui/src/form-utils';

describe('ODS forms · parseDecimal', () => {
  it('parses plain, separated and prefixed numbers', () => {
    expect(parseDecimal('1250')).toBe(1250);
    expect(parseDecimal('1,250.50')).toBe(1250.5);
    expect(parseDecimal('US$ 2,870.00')).toBe(2870);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('\u2212420')).toBe(-420);
  });
  it('returns null for empty or junk', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
    expect(parseDecimal('12a')).toBeNull();
  });
});

describe('ODS forms · validateNumber', () => {
  const fmt = (n: number) => n.toFixed(2);
  it('accepts valid numbers and empty optional values', () => {
    expect(validateNumber('', {})).toBeNull();
    expect(validateNumber('2,500.00', { min: 1, max: 50000 })).toBeNull();
  });
  it('explains what to fix in plain English', () => {
    expect(validateNumber('', { required: true })).toBe('Enter an amount.');
    expect(validateNumber('ten', {})).toBe('Enter a number, like 1250.00.');
    expect(validateNumber('0', { min: 0.01, format: fmt })).toBe('Enter 0.01 or more.');
    expect(validateNumber('60000', { max: 50000, format: fmt })).toBe('Enter 50000.00 or less.');
    expect(validateNumber('55', { min: 50, step: 10 })).toBe('Use steps of 10.');
    expect(validateNumber('70', { min: 50, step: 10 })).toBeNull();
    expect(validateNumber('0.3', { step: 0.1 })).toBeNull();
  });
});

describe('ODS forms · clampQuantity', () => {
  it('clamps to min / max and snaps to the step from min', () => {
    expect(clampQuantity(10, { min: 50, step: 10 })).toBe(50);
    expect(clampQuantity(64, { min: 50, step: 10 })).toBe(60);
    expect(clampQuantity(66, { min: 50, step: 10 })).toBe(70);
    expect(clampQuantity(999, { min: 50, max: 400, step: 10 })).toBe(400);
    expect(clampQuantity(999, { min: 50, max: 405, step: 10 })).toBe(400);
    expect(clampQuantity(Number.NaN, { min: 5 })).toBe(5);
  });
});

describe('ODS forms · files', () => {
  it('formats sizes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatFileSize(14.2 * 1024 * 1024)).toBe('14 MB');
    expect(formatFileSize(2_310_000)).toBe('2.2 MB');
  });
  it('matches accept like the browser does', () => {
    expect(fileMatchesAccept({ name: 'a.PDF', type: 'application/pdf' }, '.pdf,.png')).toBe(true);
    expect(fileMatchesAccept({ name: 'a.jpg', type: 'image/jpeg' }, 'image/*')).toBe(true);
    expect(fileMatchesAccept({ name: 'a.png', type: 'image/png' }, 'image/png')).toBe(true);
    expect(fileMatchesAccept({ name: 'a.exe', type: 'application/x-msdownload' }, '.pdf,image/*')).toBe(false);
    expect(fileMatchesAccept({ name: 'a.exe' }, '')).toBe(true);
  });
  it('explains refused files', () => {
    const opts = { accept: '.pdf,.png', acceptLabel: 'PDF or PNG', maxSize: 10 * 1024 * 1024 };
    expect(validateFile({ name: 'ok.pdf', size: 1000, type: 'application/pdf' }, opts)).toBeNull();
    expect(validateFile({ name: 'setup.exe', size: 1000 }, opts)).toBe("setup.exe can't be added: only PDF or PNG files are accepted.");
    expect(validateFile({ name: 'big.pdf', size: 12 * 1024 * 1024 }, opts)).toBe('big.pdf is 12 MB; the limit is 10 MB.');
  });
});
