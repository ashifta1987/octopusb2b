# Add-on: remove Google sign-in for customers

> **Owner decision, 1 Nov 2026:** Google sign-in is removed for **staff as well** — `/staff/login` is work email + password + TOTP only. Where this add-on says "staff keep Google", that no longer applies.

## Change

Customers sign in with **email and password only**. Google OAuth is removed from `/login`, `/signup` and the customer flow. Staff sign-in at `/staff/login` is unaffected — staff keep Google (restricted to `@octopusb2b.com`) alongside email + password, per SPEC.md section 17.

## Why

- Fewer accounts to administer, no third-party identity dependency for buyers.
- Buyers often use shared company inboxes that are not Google.
- Password + email OTP (verify step) is enough for the customer trust level; sensitive actions still ask for the OTP again.

## What stays

- Email **sign-up with verification** (6-digit code to the inbox).
- Email **sign-in with password**.
- **Forgot password** flow (email reset link, one-time use, 1 hour expiry).
- Password rules: at least 8 characters with a number; store with Supabase Auth's default hashing.
- Lockout after 5 wrong attempts for 15 minutes.
- Create-profile step before any portal access (unchanged).
- Staff Google sign-in at `/staff/login` restricted to the `@octopusb2b.com` domain.

## Antigravity prompt 22-A — remove Google for customers

```
Read docs/SPEC.md sections 4.1, 9, 17 and docs/design/Auth.png. Remove Google OAuth from the customer sign-up and login flow:

1. Supabase: in Authentication → Providers, disable Google for the customer flow. The provider stays configured only for /staff/login (section 17), which restricts Google to the octopusb2b.com domain. Nothing else about the staff flow changes.

2. UI:
   - Edit app/(auth)/login/page.tsx and app/(auth)/signup/page.tsx to match the updated docs/design/Auth.png and html/Auth.html: email, password, Create account with email / Log in button, Forgot password link, Terms acceptance line, and the "Octopus staff? Back office login" link at the bottom. Delete the Continue with Google button, divider and handler. No more via='google' branch.
   - The three-step progress bar is always Email → Verify → Profile.

3. Code:
   - Remove the signInWithOAuth({ provider: 'google' }) call from the customer login/signup components and any onClick handler named google.
   - Keep app/auth/callback/route.ts — still needed for the staff OAuth flow and the email OTP verify step.
   - Add rate limiting on /auth/login (10 attempts per IP per minute). Lockout the account for 15 minutes after 5 consecutive wrong passwords and send an alert email with the IP.

4. Flow:
   - Sign-up: email → verify (6-digit OTP) → profile → dashboard.
   - Sign-in: email + password → dashboard. Add a 2FA step only when the customer has opted in from /account (future setting; leave the gate in middleware but default off).
   - Forgot password: email a reset link that expires in 1 hour and can be used once. On use, invalidate all existing sessions.

5. Permissions and audit log: every sign-in, failed attempt, lockout and password reset still writes to audit_log with the customer_user_id and IP.

6. CMS: on /signup and /login remove any copy that mentions Google ("Continue with Google", "or sign up with email"). Update site_settings keys auth.social_providers = []. Any email-template placeholder for Google is removed.

7. Tests:
   - Playwright: new user signs up with email, receives OTP (test inbox), verifies, lands on the profile page.
   - Playwright: existing user signs in with email + password, lands on the dashboard.
   - Playwright: 5 wrong passwords lock the account; the sixth attempt shows the lockout notice; the alert email is delivered.
   - Playwright: /signup page does not render a Continue with Google button at any viewport (360, 768, 1440).
   - pgTAP: a disabled provider cannot be used for a new identity; the audit log row for sign-up carries provider='email'.
```

Done when: `/login` and `/signup` show only the email + password form (match `docs/design/Auth.png`); the Playwright scripts above are green; `/staff/login` still shows Google because staff authentication is a different flow (section 17); no `signInWithOAuth` call exists in `app/(auth)/*`.
