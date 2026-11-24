import { describe, it, expect } from 'vitest';
import { detectImageMime } from '@/app/office/dropship/actions';
import { sanitiseCsvCellClient } from '@/app/office/dropship/import/csv-client-util';

describe('Step 2 staff dropship helpers', () => {
  it('detectImageMime accepts real JPEG, PNG, WebP magic bytes and rejects spoofed HTML/SVG/EXE', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]);

    expect(await detectImageMime(png)).toBe('image/png');
    expect(await detectImageMime(jpg)).toBe('image/jpeg');
    expect(await detectImageMime(webp)).toBe('image/webp');
    expect(await detectImageMime(svg)).toBeNull();
    expect(await detectImageMime(exe)).toBeNull();
  });

  it('sanitiseCsvCellClient strips formula prefixes and control tabs/CRs for exported CSVs', () => {
    expect(sanitiseCsvCellClient('=HYPERLINK("http://evil.test","click")')).toBe(
      'HYPERLINK("http://evil.test","click")',
    );
    expect(sanitiseCsvCellClient('  +@=Row\terror\rdetail ')).toBe('Row error detail');
  });
});
