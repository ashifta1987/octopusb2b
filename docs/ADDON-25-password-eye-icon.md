# Add-on: show / hide password toggle on every password field

> **Implementation note (6 Nov 2026):** `components/password/password-input.tsx` (logic in `lib/password-reveal.ts`, unit tested). Applied to /login, /signup, /reset-password, /staff/login, /staff/set-password (invite + reset) and Staff account → change password. There is no customer change-password page and no admin form that types a password (staff are invited by email), so those items have nothing to change. The 2FA code step is untouched. Test: `tests/e2e/password-eye.mjs` (incl. axe).

## Why

You asked for an eye icon next to the admin password field so you can check what you typed. Same thing helps customers and staff too — reduces lockouts, which the audit (M4) also flagged.

## Antigravity prompt 25-A — add a password visibility toggle, accessibly

```
Read SPEC.md sections 17 (staff login) and the audit findings C6, M4, P7. Add a show/hide toggle (eye icon) to every password input in the app.

1. Build one reusable component: components/ui/password-input.tsx
   - Wraps a shadcn/ui Input with type="password" by default.
   - Right-aligned icon button that toggles type between "password" and "text".
   - Eye icon (lucide-react: Eye) when hidden, EyeOff when visible.
   - Default: hidden.
   - Tooltip on the button: "Show password" / "Hide password".
   - aria-label on the button follows the current state; aria-pressed reflects it.
   - Button is a type="button" (so pressing Enter in the input submits the form, not the toggle).
   - Button is tabbable (tabIndex=0) so keyboard users can reach it; Space and Enter both toggle it.
   - When visible, auto-hide after 15 seconds of no interaction with the field (settings key auth.password_reveal_timeout_s; default 15; 0 disables).
   - Respects prefers-reduced-motion.
   - Matches the input's visible focus ring; does not break the input's existing validation styles (invalid / required).
   - Supports autocomplete tokens (current-password, new-password) passed through from the parent.

2. Replace raw <Input type="password"> with <PasswordInput …> at:
   - /staff/login (docs/design/StaffLogin.png step 1)
   - /login (docs/design/Auth.png)
   - /signup create-password step
   - /account/security "change password" form
   - /account/security "set new password" after a reset link
   - Any admin "create staff user" or "reset password" form in /admin/staff
   - Any dialog that asks for the 2FA setup password confirmation

3. Do NOT put a reveal toggle on the 6-digit TOTP code input on /staff/login step 2 — that code is single-use and short; revealing it adds no value and makes shoulder-surfing worse. Keep it as six individual single-character inputs per the current design.

4. Security notes:
   - Never log the plaintext password, in Sentry, in audit_log or in client-side console.
   - Don't persist the "visible" state across page loads.
   - Don't autofill-trigger the reveal.
   - Rate limit the sign-in route per SPEC §17 is unchanged; the toggle doesn't bypass lockout.

5. Tests:
   - Vitest unit tests on PasswordInput: toggles state, aria-pressed flips, auto-hides after timeout, keyboard Space / Enter works, respects reduced motion.
   - Playwright golden path: on /staff/login the admin can click the eye, read the password, click again to hide, and sign in successfully. On an invalid password the error message is still shown and the reveal state resets to hidden.
   - axe on every page listed above: zero new accessibility violations.
```

Done when: every page in the list shows the eye icon; keyboard users can reach and toggle it; the TOTP code field stays as six separate inputs with no reveal; the admin can confirm what they typed before submitting at `/staff/login`.
