/**
 * Pure state machine for the password show/hide toggle (ADDON-25). Unit tested; the React component only wires
 * events and a timer to it. Never stores the password itself.
 */
export type RevealState = { visible: boolean; lastActivity: number };
export type RevealAction =
  | { type: 'toggle'; now: number }
  | { type: 'activity'; now: number }
  | { type: 'tick'; now: number; timeoutS: number }
  | { type: 'hide' };

export const initialReveal: RevealState = { visible: false, lastActivity: 0 };

export function revealReducer(s: RevealState, a: RevealAction): RevealState {
  switch (a.type) {
    case 'toggle': return { visible: !s.visible, lastActivity: a.now };
    case 'activity': return s.visible ? { ...s, lastActivity: a.now } : s;
    case 'tick': return s.visible && shouldAutoHide(s, a.now, a.timeoutS) ? { ...s, visible: false } : s;
    case 'hide': return s.visible ? { ...s, visible: false } : s;
  }
}

/** Auto-hide after `timeoutS` seconds without interaction; 0 (or less) disables auto-hide. */
export function shouldAutoHide(s: RevealState, now: number, timeoutS: number) {
  return s.visible && timeoutS > 0 && now - s.lastActivity >= timeoutS * 1000;
}

export const revealLabel = (visible: boolean) => (visible ? 'Hide password' : 'Show password');

/** Settings value → seconds (default 15, clamp 0…300). */
export function revealTimeout(raw: unknown, fallback = 15) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.min(300, Math.max(0, Math.round(n))) : fallback;
}
