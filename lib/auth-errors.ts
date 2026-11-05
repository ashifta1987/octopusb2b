/** Plain-language messages for OAuth / email-link failures (pure, unit tested). Raw provider text is never shown. */
export function friendlyAuthError(raw: string | null | undefined): string {
  const m = String(raw ?? '');
  if (/STAFF_SOCIAL_SIGNIN_BLOCKED|Database error (saving new user|granting user|updating user|finding user)/i.test(m)) {
    return 'Google sign-in is not available for this email. Octopus staff sign in at Back office login with their work email and password.';
  }
  if (/code verifier|flow state|both auth code and code verifier/i.test(m)) {
    return 'The sign-in link expired or was opened in a different browser. Please try again from this page.';
  }
  if (/exchange external code|invalid_client|unauthorized_client/i.test(m)) {
    return 'Google sign-in is temporarily unavailable. Please use your email and password, or try again later.';
  }
  if (/access_denied|cancel/i.test(m)) return 'Google sign-in was cancelled.';
  if (/expired|invalid.*(link|token|otp)|otp_expired/i.test(m)) return 'This link has expired or was already used. Request a new one.';
  if (/redirect/i.test(m)) return 'Sign-in could not return to Octopus B2B. Please try again.';
  return 'Sign-in did not complete. Please try again or use your email and password.';
}
