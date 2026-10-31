# Octopus B2B × Postman

Postman is our official API partner (SPEC §15.2). This folder holds the files we publish to the public
**Octopus B2B API** workspace on the Postman API Network.

> [!IMPORTANT]
> **The repository is the source of truth — never edit the collections by hand in Postman.**
> Everything here is generated from the Zod contracts (`lib/contracts`) and the OpenAPI document (`lib/api/openapi.ts`).
> Every release overwrites the workspace, so changes made in Postman are lost. Change the code, then regenerate.

| File | What it is |
| --- | --- |
| `openapi.json` | OpenAPI 3.1 definition of the public API (also served at `/api/v1/openapi.json`) |
| `supplier-openapi.json` | OpenAPI 3.1 definition of the supplier API |
| `octopus-b2b-api-v1.postman_collection.json` | Collection **Octopus B2B API v1** — folders Auth, Settings, Catalog, RFQs & quotes, Orders, Shipments, Wallet & ledger, Service requests, Webhooks, Webhooks · verify signature (served at `/api/v1/postman.json`) |
| `octopus-b2b-supplier-api-v1.postman_collection.json` | Collection **Octopus B2B Supplier API v1** (served at `/api/v1/postman/supplier.json`) |
| `sandbox.postman_environment.json` / `live.postman_environment.json` | Environments with `base_url`, `client_id`, `client_secret`, `access_token`, `currency`, `webhook_secret`, `mock_url` — **secrets always empty** (served at `/api/v1/postman/environment/sandbox.json` and `live.json`) |
| `examples.json` | Saved example responses, generated from seed data by calling the real route handlers with a sandbox key |

## What the collections do

- **Auth built in.** A collection-level pre-request script fetches an OAuth client-credentials token from
  `{{base_url}}/oauth/token`, caches it in collection variables (`access_token`, `access_token_expires_at`), refreshes it
  one minute before expiry and adds an `Idempotency-Key` header to every POST.
- **Tests on every request:** the status code, the response JSON schema (taken from the OpenAPI document) and
  *"every amount carries a currency"* — any object with `amount_minor` must have a `currency`, and no field may be a bare
  `*_cents` integer. Money is always `{ "amount_minor": 19000, "currency": "USD" }`.
- **Chained ids.** List requests store `product_id`, `rfq_id`, `quote_id`, `order_id`, `shipment_id`, `webhook_id`; detail
  requests are skipped when the id is not known yet, so the whole collection runs top to bottom on a fresh fork.
- **Webhooks · verify signature.** An example request signs a `settings.currency_changed` delivery exactly like the platform
  (`Octopus-Signature: t=<unix>,v1=HMAC-SHA256(secret, "<t>.<raw body>")`) and its tests verify it the way your receiver
  should. Create a **mock server** from the collection, put its URL into `mock_url` and send it — the mock answers with the
  saved example. Node.js and Python snippets are in the folder description.

## A developer forks and lists products in 5 minutes

1. Open the public workspace (link on **Account → Developer**) and click **Run in Postman** / **Fork** for
   *Octopus B2B API v1* and the *Sandbox* environment.
2. In Octopus B2B → **Account → Developer**, create an API client and a **test** key (`oct_test_…`).
3. In your forked *Sandbox* environment set `client_id` (`cli_…`) and `client_secret` (the `oct_test_…` key) as
   **current values** (type secret). Select the environment.
4. Send **Catalog → Search live products**. The token is fetched automatically; tests show green.
5. Optional: **Runner → Run collection** to try every endpoint (test keys read real catalogue + your data; writes are
   simulated and return `"simulated": true`).

Never put real customer keys into shared/team environments — keep them as current values in your own fork.

## Regenerating

```bash
node scripts/postman-sync.mjs --no-push     # regenerate postman/*.json (commit the result)
node scripts/postman-sync.mjs --check       # CI: fails when the committed files are stale
node scripts/postman-sync.mjs --examples    # refresh examples.json from seed data first (needs .env.local)
node scripts/postman-sync.mjs               # regenerate + push to Postman (needs the secrets below)
```

Node ≥ 22.18 is required (the generator is TypeScript shared with the Next.js routes and is loaded with Node's built-in
type stripping). Unit tests (`tests/unit/postman.test.ts`) validate the collection structure, run every generated test
script against its saved example and fail when the committed files are stale.

## CI

- **`.github/workflows/postman.yml`** — on *release published* (and manual dispatch): installs, checks the committed files
  are current, regenerates and pushes the OpenAPI definition, both collections and the environments to the workspace through
  the Postman API, and logs the result to `integration_logs` (`integration_code = 'postman'`).
- **`.github/workflows/ci.yml` → `postman-preview`** — when Vercel reports a successful **Preview** deployment
  (`deployment_status` event), runs `newman` with the public collection against `<preview URL>/api/v1` using a sandbox key
  and fails the build on any error. `checks` also runs `postman-sync --check`.
- **Admin → Integrations → Postman** can trigger the same sync on the server: `POST /api/postman/sync`
  (needs `integrations:edit`); `GET /api/postman/sync` returns the last results.

### Repository secrets

| Secret | Used by | Notes |
| --- | --- | --- |
| `POSTMAN_API_KEY` | postman.yml (+ server env for "Sync now") | Postman API key of the workspace owner/bot account (`PMAK-…`) |
| `POSTMAN_WORKSPACE_ID` | postman.yml | Public workspace "Octopus B2B API" |
| `POSTMAN_COLLECTION_ID_PUBLIC` | postman.yml | Collection uid of *Octopus B2B API v1*. If empty the first run **creates** the collection and prints the uid — store it |
| `POSTMAN_COLLECTION_ID_SUPPLIER` | postman.yml | Collection uid of *Octopus B2B Supplier API v1* (same create-once behaviour) |
| `POSTMAN_API_ID` | postman.yml | Optional: Postman API whose OpenAPI definition is updated (`POSTMAN_API_SCHEMA_ID` optional, discovered otherwise) |
| `POSTMAN_ENVIRONMENT_ID_SANDBOX`, `POSTMAN_ENVIRONMENT_ID_LIVE` | postman.yml | Optional: environment uids to keep in sync (pushed with empty secrets) |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | postman.yml | Optional: log the sync result to `integration_logs` |
| `POSTMAN_SANDBOX_CLIENT_ID`, `POSTMAN_SANDBOX_CLIENT_SECRET` | ci.yml `postman-preview` | API client + **`oct_test_`** key of a dedicated sandbox org with catalog/quotes/orders/shipments/wallet/webhooks scopes |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | ci.yml `postman-preview` | Optional: Vercel "Protection Bypass for Automation" secret when previews are protected |

### Developer page links

`lib/api/postman-links.ts` exports the workspace URL (`NEXT_PUBLIC_POSTMAN_WORKSPACE_URL`), the Run-in-Postman fork link
(`NEXT_PUBLIC_POSTMAN_COLLECTION_UID`, optional `NEXT_PUBLIC_POSTMAN_ENVIRONMENT_UID` / `NEXT_PUBLIC_POSTMAN_WORKSPACE_ID`)
and the download fallbacks.
