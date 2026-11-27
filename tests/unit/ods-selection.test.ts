import { describe, expect, it } from 'vitest';
import {
  STEP_STATUS_TEXT,
  pickCurrentSection,
  readSearchParam,
  resolveSelectableId,
  rowScrollDelta,
  stepStatuses,
  toggleSelection,
  withSearchParam,
} from '@octopus/ui/selection-logic';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c', disabled: true }, { id: 'd' }];

describe('resolveSelectableId', () => {
  it('keeps an enabled candidate', () => expect(resolveSelectableId(items, 'b')).toBe('b'));
  it('falls back to the first enabled item for disabled, unknown or missing candidates', () => {
    expect(resolveSelectableId(items, 'c')).toBe('a');
    expect(resolveSelectableId(items, 'zzz')).toBe('a');
    expect(resolveSelectableId(items, null)).toBe('a');
    expect(resolveSelectableId([{ id: 'x', disabled: true }, { id: 'y' }])).toBe('y');
  });
  it('is undefined when nothing is enabled', () => expect(resolveSelectableId([{ id: 'x', disabled: true }], 'x')).toBeUndefined());
});

describe('URL params (?tab=)', () => {
  it('reads a param with or without the leading ?', () => {
    expect(readSearchParam('?tab=reviews&x=1', 'tab')).toBe('reviews');
    expect(readSearchParam('x=1&tab=specs', 'tab')).toBe('specs');
    expect(readSearchParam('?tab=', 'tab')).toBeNull();
    expect(readSearchParam('', 'tab')).toBeNull();
  });
  it('sets, replaces and removes a param keeping path, other params and hash', () => {
    expect(withSearchParam('/orders/42', 'tab', 'docs')).toBe('/orders/42?tab=docs');
    expect(withSearchParam('/orders/42?x=1&tab=a#top', 'tab', 'b')).toBe('/orders/42?x=1&tab=b#top');
    expect(withSearchParam('/orders/42?tab=a&x=1', 'tab', null)).toBe('/orders/42?x=1');
    expect(withSearchParam('https://staging.example.com/p?tab=a', 'tab', 'b c')).toBe('https://staging.example.com/p?tab=b+c');
  });
});

describe('toggleSelection', () => {
  it('multi adds and removes, keeping the given order', () => {
    expect(toggleSelection(['b'], 'a', { order: ['a', 'b', 'c'] })).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleSelection([], 'c')).toEqual(['c']);
  });
  it('multi with allowEmpty=false keeps the last one', () => expect(toggleSelection(['a'], 'a', { allowEmpty: false })).toEqual(['a']));
  it('single replaces and clears', () => {
    expect(toggleSelection(['a'], 'b', { mode: 'single' })).toEqual(['b']);
    expect(toggleSelection(['a'], 'a', { mode: 'single' })).toEqual([]);
    expect(toggleSelection(['a'], 'a', { mode: 'single', allowEmpty: false })).toEqual(['a']);
  });
});

describe('stepStatuses', () => {
  it('derives done / current / upcoming', () => expect(stepStatuses(4, 1)).toEqual(['done', 'current', 'upcoming', 'upcoming']));
  it('all done when current = count', () => expect(stepStatuses(3, 3)).toEqual(['done', 'done', 'done']));
  it('marks the error step', () => expect(stepStatuses(3, 1, 1)).toEqual(['done', 'error', 'upcoming']));
  it('has words for every status (never colour alone)', () => {
    for (const s of ['done', 'current', 'upcoming', 'error'] as const) expect(STEP_STATUS_TEXT[s].length).toBeGreaterThan(0);
  });
});

describe('pickCurrentSection', () => {
  const order = ['s1', 's2', 's3'];
  it('picks the first visible section in page order', () => expect(pickCurrentSection(order, { s3: true, s2: true }, null)).toBe('s2'));
  it('keeps the previous one when none is visible', () => expect(pickCurrentSection(order, { s1: false }, 's3')).toBe('s3'));
});

describe('rowScrollDelta', () => {
  const row = { left: 0, right: 300 };
  it('is 0 when the item is fully visible', () => expect(rowScrollDelta(row, { left: 50, right: 120 })).toBe(0));
  it('scrolls forward when the item overflows the end', () => expect(rowScrollDelta(row, { left: 280, right: 360 })).toBe(68));
  it('scrolls back when the item is cut at the start', () => expect(rowScrollDelta(row, { left: -40, right: 30 })).toBe(-48));
});
