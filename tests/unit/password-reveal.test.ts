import { describe, expect, it } from 'vitest';
import { initialReveal, revealLabel, revealReducer, revealTimeout, shouldAutoHide } from '@/lib/password-reveal';

describe('password reveal state machine (ADDON-25)', () => {
  it('is hidden by default and toggles (aria-pressed / label follow the state)', () => {
    expect(initialReveal.visible).toBe(false);
    const shown = revealReducer(initialReveal, { type: 'toggle', now: 1000 });
    expect(shown.visible).toBe(true);
    expect(revealLabel(shown.visible)).toBe('Hide password');
    const hidden = revealReducer(shown, { type: 'toggle', now: 2000 });
    expect(hidden.visible).toBe(false);
    expect(revealLabel(hidden.visible)).toBe('Show password');
  });
  it('auto-hides after the timeout of no interaction, and activity resets the clock', () => {
    let s = revealReducer(initialReveal, { type: 'toggle', now: 0 });
    s = revealReducer(s, { type: 'tick', now: 14_000, timeoutS: 15 });
    expect(s.visible).toBe(true);
    s = revealReducer(s, { type: 'activity', now: 14_000 });
    s = revealReducer(s, { type: 'tick', now: 28_000, timeoutS: 15 });
    expect(s.visible).toBe(true);
    s = revealReducer(s, { type: 'tick', now: 29_000, timeoutS: 15 });
    expect(s.visible).toBe(false);
  });
  it('timeout 0 disables auto-hide; activity never reveals', () => {
    const s = revealReducer(initialReveal, { type: 'toggle', now: 0 });
    expect(shouldAutoHide(s, 10 * 60_000, 0)).toBe(false);
    expect(revealReducer(initialReveal, { type: 'activity', now: 5 }).visible).toBe(false);
  });
  it('hide action (form submit) always ends hidden', () => {
    const s = revealReducer(initialReveal, { type: 'toggle', now: 0 });
    expect(revealReducer(s, { type: 'hide' }).visible).toBe(false);
    expect(revealReducer(initialReveal, { type: 'hide' })).toBe(initialReveal);
  });
  it('parses the settings value safely', () => {
    expect(revealTimeout(undefined)).toBe(15);
    expect(revealTimeout('30')).toBe(30);
    expect(revealTimeout(0)).toBe(0);
    expect(revealTimeout(-5)).toBe(0);
    expect(revealTimeout(99999)).toBe(300);
  });
});
