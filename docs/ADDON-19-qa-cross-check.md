# Add-on: full QA cross-check

The same text as docs/SPEC.md section 19. Run this whenever you need a thorough audit, and always right before go-live. The prompt produces docs/QA_REPORT.md: a dated report with findings grouped by severity, fixes already applied, and the shortest path to a release-ready build.

## 19. Addendum: full QA cross-check

Added 1 Nov 2026. One deep review pass that walks every feature in the spec against the running app and the design files, finds every gap, fixes what can be fixed and reports the rest. Run it after any sizeable block of work and always before go-live. It is not a replacement for P10 hardening; it is the audit that produces the punch list.

### 19.1 What the pass covers

| Area | Must verify |
| --- | --- |
| **Functional** | Every role flow in §4 end to end; every state machine in §5 transitions in the right direction and refuses the wrong ones; every RPC in §9 is idempotent and runs in one transaction; every outbox event (§10) has a consumer and a retry path; scheduled jobs (§10.3) all fire |
| **Data** | Row Level Security on every table (§6 and 12); `has_permission()` guards staff endpoints; `aal=aal2` enforced on staff tables (§17); ledger journals balance per currency (§15); no column named after one currency; no orphan rows, no unused foreign keys; soft-delete respected everywhere |
| **Integrations** | Each adapter in §7 has sandbox + live modes, HMAC signature checks on every inbound webhook, 24-hour retry window, dead-letter queue surfaced in `/admin/integrations`, idempotency keys honoured, replay of a webhook event changes nothing |
| **Money** | Deposit %, balance %, service prices, claim windows, quote validity, group-buy minimums all read from settings, never hard-coded; wallet never negative; maker–checker enforced (checker cannot be requester); refund paths exist for every failure branch; FX rate on each document is locked |
| **UI vs design** | Every route in §8.3 renders the matching `docs/design/*.png` and matches the HTML snapshot (`docs/design/html/*.html`) in colour, spacing, font sizes and copy; portal sidebars collapse to a horizontal tab bar under 760 px; all CTAs reachable without horizontal scroll on a 360 px viewport; empty, loading and error states exist for every list |
| **Copy and CMS** | No hard-coded prices, contacts or legal text in components; every string comes from CMS, `site_settings`, `service_prices`, `company_profile` or product data; T&C version id is written on every order and pledge |
| **Accessibility** | WCAG 2.2 AA on every route: colour contrast ≥ 4.5:1, keyboard flow follows reading order, visible focus ring, labels on every input, status never by colour alone, tap targets ≥ 24 px, reduced-motion respected, lang attribute set, headings in order |
| **SEO** | Server-rendered product, category and pool pages; clean slugs; `generateMetadata` from product/pool data; Product, Offer, BreadcrumbList, Organization and CollectionPage JSON-LD; `sitemap.xml` and `robots.txt` generated; canonical URLs |
| **Performance** | LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on 4G throttled; images through `next/image`; no N+1 queries; `EXPLAIN` on list queries uses indexes; ISR tags revalidate on publish |
| **Security** | RLS advisor clean; staff 2FA enforced; service role key only on server; webhook signatures verified; rate limits per key and IP; `Idempotency-Key` on POST; audit log entries for logins, KYC document views, money approvals, role changes, pool settles, restore requests, price changes |
| **API** | OpenAPI 3.1 matches reality; Postman collection runs green with Newman; `oct_test_` and `oct_live_` scopes behave; `GET /v1/settings/currency` returns the active currency and rate; webhook signatures verify; `429` with `Retry-After` |
| **Group buy (§18)** | `/pools` lists only open pools, filters and sort work; `/pool/[code]` shows participants from the public view (code + country only); `settle_pool` creates one PI per pledge, one aggregate PO, three shipments; `expire_pool` refunds every deposit; supplier never sees buyer identities |
| **Backup & restore (§16)** | Nightly backup present, checksum verified, off-site; "Back up now" works; partial restore refuses ledger rows; monthly restore drill into scratch passes; export files are deterministic byte-wise |
| **Content and branches** | Branches, company details, services and charges, Terms (15 sections + Group Buy), banners all editable in CMS and reflected on the storefront; publish schedules fire |

### 19.2 Severity levels

- **block** — breaks a flow, loses money, exposes data, or ships wrong legal text. Stop until fixed.
- **major** — wrong behaviour that users will hit, but not a safety or money issue.
- **minor** — small defect or inconsistency: wrong icon, copy drift, misaligned spacing.
- **polish** — nice-to-have refinement; may be scheduled.

Every finding gets: id, severity, area, route or table, spec reference (section number), what was expected, what was found, screenshot or log, suggested fix.

### 19.3 Deliverable

`docs/QA_REPORT.md`: a dated report with a one-page summary table, then one section per area with findings grouped by severity, then a punch list ordered by severity. The report is committed to the repo; previous reports are kept so trends are visible.

### 19.4 Antigravity prompt

Run whenever you need a thorough audit; always run after P10 and after any addendum (sections 15–18).

**Prompt 19-A — Full QA cross-check**

```
Act as a senior release engineer running a deep QA pass on Octopus B2B. Read docs/SPEC.md fully (sections 1–18). The running staging app and the design files in docs/design/ are the ground truth to compare against.

Work through section 19.1 of SPEC.md area by area, in this order: Functional, Data, Integrations, Money, UI vs design, Copy and CMS, Accessibility, SEO, Performance, Security, API, Group buy, Backup & restore, Content and branches.

For each area:
1. Enumerate what the spec promises (quote the exact rule or line).
2. Prove the running app honours it. Pick the right tool: pgTAP or psql for RLS, enum, index and ledger-balance checks; a Playwright script against the Vercel preview for user flows and layout; axe for accessibility; Lighthouse CI for Core Web Vitals; Newman for the Postman collection; EXPLAIN for query plans; curl with signed and unsigned webhook payloads for integration security.
3. For UI, open each route in `docs/design/README.md` at viewports 360, 768, 1024 and 1440 px. Compare the rendered page to `docs/design/<Name>.png` and the HTML snapshot `docs/design/html/<Name>.html` (fonts, colour tokens, spacing, copy, button order, empty/loading/error states, keyboard order, visible focus ring, aria labels). Save a side-by-side screenshot pair per route under `docs/qa/<date>/`.
4. Fix anything the spec clearly covers and the app got wrong: tighten layout, add missing empty/error states, fix accessibility labels, add missing indexes, add missing RLS, refuse invalid state transitions. Do NOT invent new behaviour; keep every change inside what SPEC.md and the design files already say.
5. Record every change you made as a QA finding of its own (status: fixed) with the commit hash.
6. For anything you cannot fix safely alone (schema change touching money, external credentials, destructive migrations, design intent ambiguous), stop at a short write-up and ask.

Specific checks that must appear in the report:
- Playwright golden paths from §11.3 all green; attach the HTML trace.
- pgTAP: every table has RLS; `has_permission()` is the only staff gate; every ledger journal balances per currency; `settle_pool` is idempotent (run it twice, state unchanged).
- A customer cannot read another org's rows; a supplier cannot see buyer contacts before the order is paid; a storefront reader cannot read `suppliers.legal_name` or any staff table.
- Replay the last 20 YunExpress, payment and dropship webhooks — no duplicate side effects, no new ledger rows, no new emails.
- Replay the last 20 outbound webhook deliveries — all HMAC-signed, all retried with backoff on 5xx, all surfaced in `/account/developer`.
- Newman run of both Postman collections against sandbox: all requests pass tests; schema matches OpenAPI; `oct_test_` keys cannot read `oct_live_` data.
- Lighthouse (mobile) on `/`, `/products`, `/p/[slug]`, `/pools`, `/pool/[code]`: LCP < 2.5 s, INP < 200 ms, CLS < 0.1, SEO = 100, Best Practices ≥ 95.
- axe on every route in §8.3: zero serious violations.
- Grep for hard-coded prices, phone numbers, email addresses, URLs, legal text in `apps/web/src/**`: zero hits outside `tests/` and CMS seed data. Report every hit with file:line.
- Grep for `amount_usd_cents` or any currency-named money column: zero hits (§15.1).
- Backup check: last successful backup under 26 hours old, checksum verified, restore drill passed within the last 30 days; partial restore of a deleted product succeeds; attempt to restore a ledger row fails with the expected message.
- Group buy: open two pools in parallel, cross the threshold on one; verify one aggregate PO, three PIs, three shipments, supplier identities hidden from buyers, buyer identities hidden from supplier until paid.
- Staff login: a customer email cannot sign in at /staff/login; a staff account without MFA cannot pass step 2; lockout fires after 5 failures and alerts admin.
- Currency switch: switch to CNY in staging, create a new quote, verify it is in CNY at the approved rate; an older USD PI still prints in USD.

For each severity level, list all findings in a numbered punch list ordered block → major → minor → polish. Each item: id, area, route or table, SPEC.md section, expected, actual, evidence path, suggested fix, status (fixed | pending | needs-decision).

Write the report to docs/QA_REPORT.md with today's date in the title. Keep earlier reports. End with: a one-line verdict (go / no-go for release), the three top risks, and the shortest path to green.
```

Done when: `docs/QA_REPORT.md` exists for today's date, every block-severity item is marked fixed, and the verdict line reads "go for release" (or the three top risks are listed with named owners).
