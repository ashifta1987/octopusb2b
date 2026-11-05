import { describe, expect, it } from 'vitest';
import { friendlyAuthError } from '@/lib/auth-errors';

describe('friendlyAuthError', () => {
  it('maps the staff identity guard and Supabase DB errors to the staff message', () => {
    expect(friendlyAuthError('Database error saving new user')).toMatch(/staff sign in at Back office login/);
    expect(friendlyAuthError('STAFF_SOCIAL_SIGNIN_BLOCKED: staff accounts …')).toMatch(/Back office login/);
  });
  it('maps PKCE / flow-state problems', () => {
    expect(friendlyAuthError('PKCE code verifier not found in storage. This can happen if …')).toMatch(/different browser/);
  });
  it('maps a bad Google client secret without leaking details', () => {
    const m = friendlyAuthError('Unable to exchange external code: 4/0A');
    expect(m).toMatch(/temporarily unavailable/);
    expect(m).not.toMatch(/4\/0A/);
  });
  it('maps cancel and expired links, with a safe default', () => {
    expect(friendlyAuthError('access_denied')).toMatch(/cancelled/);
    expect(friendlyAuthError('Email link is invalid or has expired')).toMatch(/expired/);
    expect(friendlyAuthError('something odd <script>')).toBe('Sign-in did not complete. Please try again or use your email and password.');
  });
});
