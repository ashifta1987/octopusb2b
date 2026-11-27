import { describe, expect, it } from 'vitest';
import { matchesHotkey, parseHotkey } from '@octopus/ui/hooks';

const ev = (key: string, m: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) =>
  ({ key, ctrlKey: !!m.ctrl, metaKey: !!m.meta, altKey: !!m.alt, shiftKey: !!m.shift }) as KeyboardEvent;

describe('ODS keyboard shortcuts (Part 7.1)', () => {
  it('parses combos', () => {
    expect(parseHotkey('Ctrl+K')).toEqual({ key: 'k', ctrl: true, alt: false, shift: false });
    expect(parseHotkey('Alt+W')).toEqual({ key: 'w', ctrl: false, alt: true, shift: false });
    expect(parseHotkey('/')).toEqual({ key: '/', ctrl: false, alt: false, shift: false });
  });
  it('Ctrl matches Ctrl and ⌘; modifiers must match exactly', () => {
    const k = parseHotkey('Ctrl+K');
    expect(matchesHotkey(ev('k', { ctrl: true }), k)).toBe(true);
    expect(matchesHotkey(ev('K', { meta: true }), k)).toBe(true);
    expect(matchesHotkey(ev('k'), k)).toBe(false);
    expect(matchesHotkey(ev('k', { ctrl: true, alt: true }), k)).toBe(false);
    expect(matchesHotkey(ev('w', { alt: true }), parseHotkey('Alt+W'))).toBe(true);
    expect(matchesHotkey(ev('b', { ctrl: true }), parseHotkey('Ctrl+B'))).toBe(true);
  });
  it('single keys do not fire with Ctrl held', () => {
    expect(matchesHotkey(ev('/'), parseHotkey('/'))).toBe(true);
    expect(matchesHotkey(ev('/', { ctrl: true }), parseHotkey('/'))).toBe(false);
  });
});
