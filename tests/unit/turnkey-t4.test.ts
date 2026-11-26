import { describe, expect, it } from 'vitest';
import {
  TK_DRAWING_MAX_BYTES, TK_DRAWING_TYPES, TK_FREE_DRAWING_VERSIONS, depositCents, drawingStatusLabel, extraVersionCents, fileSize, nextVersionIsExtra, parseQty,
  quoteMargin, quoteStatusLabel,
} from '@/lib/turnkey/format';

describe('turnkey T4 helpers', () => {
  it('3 versions free; changes on version 3 or later make the next one extra', () => {
    expect(TK_FREE_DRAWING_VERSIONS).toBe(3);
    expect(nextVersionIsExtra(1)).toBe(false);
    expect(nextVersionIsExtra(2)).toBe(false);
    expect(nextVersionIsExtra(3)).toBe(true);
    expect(nextVersionIsExtra(7)).toBe(true);
  });

  it('extra version = 50% of the drawing fee, integer cents rounded half up (same as the DB constraint)', () => {
    expect(extraVersionCents(29900)).toBe(14950);
    expect(extraVersionCents(29999)).toBe(15000);
    expect(extraVersionCents(1)).toBe(1);
  });

  it('deposit = whole percent of the total, rounded half up (same as the DB constraint)', () => {
    expect(depositCents(720000, 30)).toBe(216000);
    expect(depositCents(101, 30)).toBe(30);
    expect(depositCents(105, 30)).toBe(32);
    expect(depositCents(1, 1)).toBe(0);
  });

  it('margin is unknown (null, never 0) unless every line has a cost', () => {
    expect(quoteMargin(720000, 570000, true)).toEqual({ cents: 150000, pct: 20.8 });
    expect(quoteMargin(720000, 480000, false)).toBeNull();
    expect(quoteMargin(720000, null, true)).toBeNull();
  });

  it('labels, quantities, files', () => {
    expect(drawingStatusLabel('shared').label).toBe('Waiting for your review');
    expect(drawingStatusLabel('shared', 'staff').label).toBe('Waiting for the client');
    expect(quoteStatusLabel('accepted').tone).toBe('green');
    expect(quoteStatusLabel('draft', 'staff').label).toContain('not sent');
    expect(parseQty('4')).toBe(4);
    expect(parseQty('0')).toBeNull();
    expect(parseQty('1.5')).toBeNull();
    expect(parseQty('10000000')).toBeNull();
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(1572864)).toBe('1.5 MB');
    expect(TK_DRAWING_TYPES).toContain('application/pdf');
    expect(TK_DRAWING_MAX_BYTES).toBe(20971520);
  });
});
