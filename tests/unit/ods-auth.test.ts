import { describe, expect, it } from 'vitest';
import {
  callbackDestination, cleanInterests, identityFrom, isE164, isInviteNext, loginStateFrom, normalizeE164, roleToBusinessType, INVITE_FOR_ME, SETUP_ROLES,
} from '@/lib/ods-auth';

describe('normalizeE164 (WhatsApp phone, Part 4.5)', () => {
  it('accepts international numbers with spaces, dashes, dots and brackets', () => {
    expect(normalizeE164('+971 50 123 4567')).toBe('+971501234567');
    expect(normalizeE164('+971-50-123-4567')).toBe('+971501234567');
    expect(normalizeE164('(+44) 20.7946.0958')).toBe('+442079460958');
    expect(normalizeE164('  +1 415 555 2671 ')).toBe('+14155552671');
  });
  it('turns a 00 international prefix into +', () => {
    expect(normalizeE164('00971 50 123 4567')).toBe('+971501234567');
  });
  it('refuses local numbers, letters, too short / too long and a 0 country code', () => {
    for (const bad of ['050 123 4567', '971501234567', '+0 501234567', '+971 50', '+1234567890123456', '+971 50 123 4567 ext 2', '++971501234567', '+97150+1234567', '', '   ', null, 42]) {
      expect(normalizeE164(bad as unknown)).toBeNull();
    }
    expect(isE164('+86 138 0013 8000')).toBe(true);
    expect(isE164('138 0013 8000')).toBe(false);
  });
});

describe('roleToBusinessType', () => {
  it('maps every setup role to its label (stored in organizations.business_type)', () => {
    expect(roleToBusinessType('owner')).toBe('Owner / director');
    expect(roleToBusinessType('buyer')).toBe('Buyer');
    expect(roleToBusinessType('store_manager')).toBe('Store manager');
    expect(roleToBusinessType('other')).toBe('Other');
    expect(SETUP_ROLES.map((r) => roleToBusinessType(r.value))).toEqual(['Owner / director', 'Buyer', 'Store manager', 'Other']);
  });
  it('returns null for anything else', () => {
    expect(roleToBusinessType('admin')).toBeNull();
    expect(roleToBusinessType(undefined)).toBeNull();
  });
});

describe('callbackDestination (/auth/callback, Part 4.4)', () => {
  it('ODS on + no company → /welcome/setup with the safe next', () => {
    expect(callbackDestination({ next: '/shop/pools', odsOn: true, isMember: false, hasProfile: false })).toBe('/welcome/setup?next=%2Fshop%2Fpools');
    expect(callbackDestination({ next: null, odsOn: true, isMember: false, hasProfile: true })).toBe('/welcome/setup?next=%2Fshop');
  });
  it('ODS on + no company + invited → the invite page (setup skipped); from an invite page → back to it', () => {
    expect(callbackDestination({ next: '/shop', odsOn: true, isMember: false, hasProfile: false, hasInvites: true })).toBe(INVITE_FOR_ME);
    expect(callbackDestination({ next: '/invite/abc123', odsOn: true, isMember: false, hasProfile: false })).toBe('/invite/abc123');
  });
  it('ODS off keeps today’s rule: no profile → /onboarding (membership ignored)', () => {
    expect(callbackDestination({ next: '/shop', odsOn: false, isMember: false, hasProfile: false })).toBe('/onboarding');
    expect(callbackDestination({ next: '/shop', odsOn: false, isMember: true, hasProfile: false })).toBe('/onboarding');
    expect(callbackDestination({ next: '/account/orders', odsOn: false, isMember: false, hasProfile: true })).toBe('/account/orders');
  });
  it('member → next', () => {
    expect(callbackDestination({ next: '/account/orders?tab=open', odsOn: true, isMember: true, hasProfile: true })).toBe('/account/orders?tab=open');
  });
  it('unsafe next → /shop (or the given home)', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/auth/callback', '/api/x', 'javascript:alert(1)']) {
      expect(callbackDestination({ next: bad, odsOn: true, isMember: true, hasProfile: true })).toBe('/shop');
      expect(callbackDestination({ next: bad, odsOn: false, isMember: true, hasProfile: true })).toBe('/shop');
    }
    expect(callbackDestination({ next: '//evil.com', home: '/account', odsOn: true, isMember: true, hasProfile: true })).toBe('/account');
    // setup only continues to customer areas
    expect(callbackDestination({ next: '/admin', odsOn: true, isMember: false, hasProfile: false })).toBe('/welcome/setup?next=%2Fshop');
  });
});

describe('loginStateFrom (States-Auth)', () => {
  it('reads short codes and ?state=', () => {
    expect(loginStateFrom({ error: 'cancelled' })).toBe('cancelled');
    expect(loginStateFrom({ error: 'failed' })).toBe('failed');
    expect(loginStateFrom({ error: 'expired' })).toBe('link-expired');
    expect(loginStateFrom({ error: 'session_expired' })).toBe('session-expired');
    expect(loginStateFrom({ state: 'expired' })).toBe('session-expired');
    expect(loginStateFrom({ state: 'signed-out' })).toBe('signed-out');
    expect(loginStateFrom({ state: 'wrong-account', next: '/invite/x' })).toBe('wrong-account');
  });
  it('maps friendlyAuthError texts and never trusts unknown text', () => {
    expect(loginStateFrom({ error: 'Google sign-in was cancelled.' })).toBe('cancelled');
    expect(loginStateFrom({ error: 'This link has expired or was already used. Request a new one.' })).toBe('link-expired');
    expect(loginStateFrom({ error: 'Google sign-in is temporarily unavailable. Please use your email and password, or try again later.' })).toBe('unavailable');
    expect(loginStateFrom({ error: 'Call +1 555 and send your password' })).toBe('failed');
  });
  it('invite next → invite notice; nothing → null', () => {
    expect(loginStateFrom({ next: '/invite/abc' })).toBe('invite');
    expect(loginStateFrom({ next: '/account/dropship/join' })).toBe('invite');
    expect(loginStateFrom({ next: '/shop' })).toBeNull();
    expect(isInviteNext('//evil.com/invite/x')).toBe(false);
  });
});

describe('identityFrom / cleanInterests', () => {
  it('uses the Google name, first name, initials and https avatar', () => {
    const id = identityFrom({ email: 'Anna@AnnaHome.ae', user_metadata: { full_name: 'Anna Khan', avatar_url: 'https://lh3.googleusercontent.com/a/x' }, app_metadata: { provider: 'google' } });
    expect(id).toMatchObject({ name: 'Anna Khan', firstName: 'Anna', initials: 'AK', email: 'anna@annahome.ae', provider: 'google' });
    expect(id.avatarUrl).toMatch(/^https:/);
  });
  it('falls back to the e-mail local part and drops non-https avatars', () => {
    const id = identityFrom({ email: 'sara.ali@example.com', user_metadata: { avatar_url: 'http://x/y.png' } });
    expect(id).toMatchObject({ name: 'sara ali', firstName: 'sara', initials: 'SA', avatarUrl: null, provider: 'email' });
  });
  it('keeps only known service keys, once', () => {
    expect(cleanInterests(['pools', 'pools', 'x', 3, 'brand'])).toEqual(['pools', 'brand']);
  });
});
