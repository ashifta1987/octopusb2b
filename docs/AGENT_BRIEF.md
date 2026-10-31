# Octopus B2B — shared brief for all build agents

Repo: /Users/ashifabdulkhadar/Desktop/octopusb2bapp (Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Supabase).
Source of truth: `docs/SPEC.md`. Visual source of truth: `docs/design/<Screen>.png` (layout) + `docs/design/html/<Screen>.html` (exact copy/CSS). Index: `docs/design/README.md`. LOOK at the PNG for every screen you build (read_file on the png) and match it closely.

## Next.js 16 gotchas (read node_modules/next/dist/docs if unsure)
- `params` / `searchParams` are Promises: `const { id } = await params`.
- `cookies()`/`headers()` are async. Middleware is `proxy.ts` (already exists — don't touch).
- `revalidateTag(tag, 'max')` needs 2 args. `revalidatePath(path)` is fine.
- Server Actions: `'use server'` functions; return `{ ok: true } | { ok: false, error }` and use `mapDbError` from `lib/format.ts`.

## Already built — USE, don't modify (create your own files instead; if you truly need a shared change, tell the lead in your final report)
- `lib/supabase/server.ts`: `createClient()` (user cookie, RLS applies), `createPublicClient()` (anon), `createAdminClient()` (service role — server only, only for webhooks/cron/admin user mgmt/API keys).
- `lib/supabase/client.ts`: browser client (realtime subscriptions in client components).
- `lib/auth.ts`: `getSession()`, `can(session, area, action)`, `requireCustomer(next)`, `requireStaff(area, action, next)`, `requireRole(role, next)`.
- `lib/format.ts`: `usd(cents)`, `toCents`, `fmtDate`, `humanize`, `slugify`, `tierFor`, `mapDbError`, `COUNTRY_NAMES`.
- `lib/content.ts`: `getSiteContent()` → { settings, blocks, company, branches, categories }, `block()`, `categoryPath()`, `descendantIds()`.
- `lib/nav.ts`: CUSTOMER_NAV, DISTRIBUTOR_NAV, OFFICE_NAV.  `components/portal-shell.tsx`: `<PortalShell session nav>`.
- `components/store-shell.tsx`: `<StoreHeader/>`, `<StoreFooter/>`.
- `components/ui.tsx` (server-safe): Logo, StatusBadge, Money, SupplierCode, Card, Stat, PageHeader, EmptyState, Timeline, OrderProgress, Table, PermissionGate, Notice, SampleBadge.
- `components/client.tsx` ('use client'): ConfirmCharge, FileDrop, DocumentButton (links to `/api/documents/[id]/pdf` and POST `/api/documents/[id]/email`), ActionButton, Switch.
- `lib/adapters/index.ts`: getCarrier() (YunExpress sandbox), getPayment(), getEmail(), signPayload/verifySignature, stubs. `lib/adapters/ai.ts`: getAiAdapter() (OpenAI if OPENAI_API_KEY else mock).
- CSS utility classes in `app/globals.css`: btn, btn-primary, btn-dark, btn-ghost, btn-light, btn-danger, btn-sm, card, input, label, ph, eyebrow, mono, th, td, stick. Colors: navy, blue, blue-soft, muted, line, line-2, surface, ok, warn, bad. Fonts: font-display (Lexend), font-mono.

## Database (already migrated + seeded on the live Supabase project)
Read `supabase/migrations/*.sql` and `supabase/seed.sql` for exact tables, enums, RLS and RPCs. Key RPCs (call with `sb.rpc(name, {p_...})`):
complete_onboarding, submit_kyc, review_kyc, request_service, transition_service_request, submit_rfq, send_quote, approve_quote, transition_order, record_payment, request_topup, confirm_topup, request_finance_approval, decide_finance_approval, transition_product, create_ticket, reply_ticket, my_wallet_balance. `record_ad_click` is service-role only.
Never update `status` columns directly — use the transition RPCs. Never write ledger tables directly. Money is integer cents (USD).
Buyers/storefront must NEVER see supplier legal names/contacts/costs: use the `public_suppliers` view (id, code, country, verified, supplier_type) and `<SupplierCode/>`.
No hard-coded prices/fees/contacts/legal text: read `service_prices` (via `current_service_price` RPC or latest row), `site_settings`, `content_blocks`, `company_profile`.
If you need schema changes: write a NEW migration file `supabase/migrations/2026110100<NN>_<area>_<name>.sql` using ONLY your assigned NN range, then run `node scripts/db-migrate.mjs`. Forward-only; enable RLS on new tables.

Demo users (password in env var DEMO_PASSWORD given in your prompt): admin@, finance@, finance2@, ops@, support@, distributor@, content@, qc@, buyer@ — all `@demo.octopusb2b.com`. Buyer org has a shipped order ORD-2202, an RFQ with 3 quotes waiting, wallet balance, a QC service request and a ticket.

## Rules
- Only create/edit files inside YOUR assigned paths. Do NOT edit package.json, do NOT install packages (available: @supabase/ssr, @supabase/supabase-js, zod, react-hook-form, @hookform/resolvers, @tanstack/react-table, exceljs, openai, lucide-react, clsx, tailwind-merge, server-only). Do NOT run `next dev`/`next build` (shared .next dir). Do NOT git commit.
- Verify with `npx tsc --noEmit -p .` (ignore errors in other agents' files) and `npx eslint <your paths>`. You may test RPC/queries with small node scripts using `pg` + DATABASE_URL from `.env.local`, placed in /tmp (not the repo).
- Every list: empty state; every destructive/paid action: confirm dialog. Accessibility: labels on inputs, status never by colour alone.
- Final report: list routes/files built, any schema migrations added, anything incomplete, and any shared-file change you need.

