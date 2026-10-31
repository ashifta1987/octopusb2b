# Octopus B2B

Global B2B wholesale marketplace for industrial supplies — Shenzhen Octopus Trading Co. Ltd.
Spec: [`docs/SPEC.md`](docs/SPEC.md) · Designs: [`docs/design/`](docs/design/README.md)

**Stack:** Next.js 16 (App Router, React 19, TypeScript, Tailwind v4, Cache Components) · Supabase (Postgres + RLS, Auth, Storage, Realtime, pg_cron) · Vercel · OpenAI (AI product tools).

## Run locally

```bash
pnpm install
cp .env.example .env.local      # fill in Supabase URL/keys, DATABASE_URL, OPENAI_API_KEY, CRON_SECRET, WEBHOOK_SIGNING_SECRET
pnpm db:migrate                 # apply supabase/migrations (forward-only)
pnpm db:seed                    # categories, suppliers, 60 products, services, CMS, T&C (first time only)
DEMO_PASSWORD=... node scripts/seed-users.mjs   # one demo user per role + a demo trade flow
pnpm dev
```

## Areas

| Path | Who |
| --- | --- |
| `/`, `/products`, `/c/...`, `/p/[slug]`, `/request/[type]`, `/legal/...` | Public storefront |
| `/login`, `/signup`, `/onboarding` | Auth (email + 6-digit OTP, Google) |
| `/account/*` | Customer: RFQs, orders, wallet, ledger, KYC, support, API keys, ads |
| `/distributor/*` | Distributor: supplier switches, products + AI tools, Excel import, catalog, RFQs |
| `/office/*` | Back office: queues, KYC, moderation, RFQ quoting, orders, YunExpress shipping, support desk |
| `/admin/*` | Admin: KPIs, finance & approvals, wallet, services & charges, CMS & T&C, ads, geography, staff & roles, integrations, suppliers |
| `/api/v1/*` | Public REST API (OAuth client credentials / `oct_test_` & `oct_live_` keys) — `openapi.json`, `postman.json` |
| `/api/webhooks/*`, `/api/cron/*` | YunExpress + payment webhooks, outbox worker, scheduled jobs |

## Rules (SPEC §0)

- Permissions are enforced in Postgres RLS + security-definer RPCs, not only in the UI.
- Status changes go through `transition_*` RPCs; money moves only through balanced ledger journals with idempotency keys.
- No prices, fees, contacts or legal text in code — they live in `service_prices`, `site_settings`, `content_blocks`, `company_profile`, `terms_versions`.
- Integrations sit behind adapters in `lib/adapters` (sandbox/mock until credentials are configured).

## Tests

```bash
pnpm typecheck && pnpm lint && pnpm test   # unit (vitest)
pnpm test:db                               # RLS / ledger / state-machine checks against DATABASE_URL
pnpm test:integration                      # API route handlers against the DB
```
