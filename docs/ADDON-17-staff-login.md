# Add-on: staff and back-office login

The same text as docs/SPEC.md section 17, kept here so the Antigravity prompt is easy to find. Screen design: docs/design/StaffLogin.png (+ -2-verify, -3-workspace) and docs/design/html/StaffLogin.html.

## 17. Addendum: staff and back-office login

Added 1 Nov 2026. Staff do not use the customer login. They have their own sign-in page at `/staff/login` (design: `docs/design/StaffLogin.png`, steps `StaffLogin-2-verify.png` and `StaffLogin-3-workspace.png`, HTML `docs/design/html/StaffLogin.html`). Links to it sit at the bottom of the customer login page ("Octopus staff? Back office login") and in the storefront footer ("Staff login").

### 17.1 Who signs in here

Operations, Finance, Support, Sourcing agent, QC coordinator, Content editor, Distributor and Admin (section 3). Suppliers keep their own portal login when the supplier portal opens. Customers use `/login`.

### 17.2 Sign-in flow

1. **Sign in:** "Sign in with Google", allowed only for `@octopusb2b.com` accounts, or work email and password. No self sign-up: accounts exist only after Admin invites them in Staff & roles.
2. **Two-step verification (required):** a 6-digit code from an authenticator app (TOTP through Supabase Auth MFA). On first sign-in the staff member scans a QR code and saves 10 backup codes. "Trust this computer for 12 hours" is optional.
3. **Choose workspace:** cards for only the areas the person's role allows (Back office, Shipping, Support desk, Finance, Admin, Distributor panel, Site content). If a person has only one area, they go straight to it. A workspace switcher sits in the top bar of every staff page.

### 17.3 Rules

| Rule | Detail |
| --- | --- |
| Invitation only | Admin creates the staff user, sets role(s) and office; the invite email has a 24-hour link to set a password. Deactivating a user ends all their sessions at once |
| Separate from customers | A staff email cannot hold a customer account. Middleware sends anyone without a staff role away from `/office`, `/admin`, `/distributor` and `/staff` |
| 2FA everywhere | Every staff session must reach Supabase assurance level `aal2`. RLS policies for staff tables check `auth.jwt()->>'aal' = 'aal2'` as well as `has_permission()` |
| Lockout | 5 wrong passwords or codes lock the account for 15 minutes and notify Admin |
| Sessions | Idle timeout 30 minutes, maximum 12 hours. Sensitive actions (money approvals, restore, KYC document download, role changes) ask for the code again if it is older than 10 minutes |
| Reset | Forgot password sends a reset link. Lost phone: only an Admin can reset someone's 2FA, and that is logged |
| Optional IP rule | Admin can limit Admin and Finance sign-ins to office IP addresses (setting) |
| Audit | Every sign-in, failure, lockout, 2FA reset and workspace switch goes in the audit log with IP and device |

Admin screen changes: Staff & roles gets columns for 2FA status, last sign-in and active sessions, with actions Invite, Resend invite, Reset 2FA, End sessions and Deactivate. A "Security" panel holds the lockout, session and IP settings.

### 17.4 Antigravity prompt

Run this together with P1 (auth), or now if P1 is already built.

**Prompt 17-A — Staff and back-office login**

```
Read docs/SPEC.md sections 3, 12 and 17. Build a separate staff sign-in for the back office:
1. Route /staff/login matching docs/design/StaffLogin.png, StaffLogin-2-verify.png and StaffLogin-3-workspace.png (exact styles in docs/design/html/StaffLogin.html). Step 1: Google sign-in restricted to the octopusb2b.com domain, or email + password. Step 2: TOTP code with Supabase Auth MFA (enrol with QR code and 10 backup codes on first sign-in; optional trust this computer for 12 hours). Step 3: workspace cards built from the user's roles and permissions; skip this step when only one area is allowed.
2. Staff are invitation-only: from /admin/staff (docs/design/Staff.png) Admin invites a user, sets roles and office; the invite email has a 24-hour set-password link. Add columns 2FA status, last sign-in, active sessions and actions Resend invite, Reset 2FA, End sessions, Deactivate. Add a Security panel: lockout (5 attempts, 15 minutes), idle timeout 30 minutes, maximum session 12 hours, optional office IP allow-list for Admin and Finance.
3. Middleware: /office, /admin, /distributor and /staff/* require a staff role and aal2; otherwise redirect to /staff/login. Customers who open these paths go to /login. A staff email cannot create a customer account.
4. RLS: staff policies check has_permission() and auth.jwt()->>'aal' = 'aal2'. Add a step-up check that asks for a fresh code (older than 10 minutes) before money approvals, restores, KYC document downloads and role changes.
5. Add a workspace switcher and the user menu (profile, change password, 2FA devices, sign out) to the portal top bar for staff.
6. Link to /staff/login from the customer login page ("Octopus staff? Back office login") and the storefront footer ("Staff login"), as in docs/design/Auth.png and Main.png.
7. Audit log entries for sign-in, failure, lockout, 2FA reset, session end and workspace switch, with IP and device.
Tests: Playwright for invite -> set password -> enrol 2FA -> choose workspace; a customer cannot open /office; staff without aal2 cannot read staff tables (pgTAP); lockout after 5 failures.
```

Done when: an invited staff member can sign in with password and code and land in their workspace; a customer is turned away from `/office` and `/admin`; resetting 2FA and ending sessions works from Staff & roles.
